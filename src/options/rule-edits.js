// 设置页“按关键词换右侧”的纯逻辑：校验对话框表单，按原始存储（loadRaw 的结果）算出要写回的 rightRules。
// 不碰 chrome.* 和 DOM。写入一律以读时清洗的结果（mergeConfig(raw).rightRules 去掉 off）为底：
// 读时被丢掉的坏条目、超出合计的规则，下一次任何规则写入时一并写回成清洗后的样子。
import { mergeConfig } from "../lib/engines.js";
import { RULE_LIMITS, SCRIPTS, parseWords, nextRuleId, rulesBytes } from "../lib/right-rules.js";
import { spec } from "../lib/errors.js";

// #rule-engine 里“默认组合的右侧（不换）”一项的 value：带 @，不可能是引擎 id
export const KEEP = "@keep";

const stored = ({ off: _off, ...rule }) => rule;

function base(raw) {
  const cfg = mergeConfig(raw);
  return { cfg, rules: cfg.rightRules.map(stored) };
}

const wordCount = (rules) => rules.reduce((n, r) => n + (r.when === "words" ? r.words.length : 0), 0);

// form：{ when, words, script, engine, strip? }；prev：编辑时原来那条（清洗后，带 off），新增时为 null。
// 返回 { rule }（不带 id）或 { errors }
function buildRule(cfg, form, prev) {
  const errors = {};
  const rule = {};
  if (form.when === "script") {
    rule.when = "script";
    if (SCRIPTS.includes(form.script)) rule.script = form.script;
    else errors.script = spec("rule_script");
  } else {
    rule.when = "words";
    const parsed = parseWords(form.words);
    if (parsed.ok) rule.words = parsed.words;
    else errors.words = spec(parsed.error.code, ...parsed.error.args);
    if (form.strip === true) rule.strip = true;
  }
  const engine = form.engine;
  // 编辑一条原引擎已隐藏的规则：照原样保存放行；原引擎是默认左侧或已删除时必须重新选
  const keptHidden = prev?.off === "hidden" && engine === prev.engine;
  if (engine === KEEP) rule.keep = true;
  else if (keptHidden || (cfg.engines.some(e => e.id === engine) && engine !== cfg.defaultPair[0])) rule.engine = engine;
  else errors.engine = spec("rule_engine");
  return Object.keys(errors).length ? { errors } : { rule };
}

// 合计词数、序列化字节：rules 是写回的整个列表。字节超限报在词字段上（文字规则没有词字段，报在表单上）
function limitErrors(rules, rule) {
  if (wordCount(rules) > RULE_LIMITS.wordsTotal) return { words: spec("rule_words_total") };
  if (rulesBytes(rules) > RULE_LIMITS.bytes) return { [rule.when === "words" ? "words" : "form"]: spec("rule_too_large") };
  return null;
}

export function addRule(raw, form) {
  const { cfg, rules } = base(raw);
  if (rules.length >= RULE_LIMITS.rules) return { ok: false, errors: { form: spec("rule_too_many") } };
  const built = buildRule(cfg, form, null);
  if (built.errors) return { ok: false, errors: built.errors };
  const id = nextRuleId(rules);
  const rule = { id, ...built.rule };
  const next = [...rules, rule];
  const errors = limitErrors(next, rule);
  if (errors) return { ok: false, errors };
  return { ok: true, id, patch: { rightRules: next } };
}

// 另一页已删掉这条：报 rule_gone，不悄悄按新规则加回去
export function editRule(raw, id, form) {
  const { cfg, rules } = base(raw);
  const i = rules.findIndex(r => r.id === id);
  if (i < 0) return { ok: false, errors: { form: spec("rule_gone") } };
  const built = buildRule(cfg, form, cfg.rightRules[i]);
  if (built.errors) return { ok: false, errors: built.errors };
  const rule = { id, ...built.rule };
  const next = rules.with(i, rule);
  const errors = limitErrors(next, rule);
  if (errors) return { ok: false, errors };
  return { ok: true, id, patch: { rightRules: next } };
}

// 找不到或已在边上：什么都不写（patch: null）。position 从 1 起
export function moveRule(raw, id, delta) {
  const { rules } = base(raw);
  const i = rules.findIndex(r => r.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= rules.length) return { ok: true, patch: null };
  const next = rules.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return { ok: true, patch: { rightRules: next }, position: j + 1 };
}

// 删光时删键，存储回到全新安装的形状
export function removeRule(raw, id) {
  const { rules } = base(raw);
  if (!rules.some(r => r.id === id)) return { ok: true, patch: null };
  const next = rules.filter(r => r.id !== id);
  return next.length ? { ok: true, patch: { rightRules: next } } : { ok: true, patch: null, remove: ["rightRules"] };
}

// 删除自定义引擎时连带去掉指向它的规则（edits.js 的 deleteEngine）；keep 规则不指向任何引擎
export function dropRulesFor(raw, engineId) {
  const { rules } = base(raw);
  const kept = rules.filter(r => r.keep || r.engine !== engineId);
  return { rules: kept, dropped: rules.length - kept.length };
}

// 引擎对话框里的“有 N 条规则用到它”：raw 与 cfg 都能传
export function countRulesFor(src, engineId) {
  const rules = Array.isArray(src?.rightRules) ? src.rightRules : [];
  return rules.filter(r => r && r.keep !== true && r.engine === engineId).length;
}

const engineName = (cfg, id) => [...cfg.engines, ...cfg.hidden].find(e => e.id === id)?.name ?? null;

// 对话框 #rule-engine 的选项与选中值。新增时、原引擎是默认左侧或已删除时留空（占位项），必须选一个
export function engineChoices(cfg, rule) {
  const left = cfg.defaultPair[0];
  const options = [
    { value: "", label: { key: "options_rules_engine_pick", args: [] } },
    { value: KEEP, label: { key: "options_rules_engine_keep", args: [] } },
    ...cfg.engines.filter(e => e.id !== left).map(e => ({ value: e.id, label: { text: e.name } })),
  ];
  let selected = "";
  if (rule?.keep) selected = KEEP;
  else if (rule && !rule.off) selected = rule.engine;
  else if (rule?.off === "hidden") {
    options.push({ value: rule.engine, label: { key: "options_rules_engine_hidden", args: [engineName(cfg, rule.engine) ?? rule.engine] } });
    selected = rule.engine;
  }
  return { options, selected };
}

// 规则行的目标文字；engineName 为 null（引擎已删除）时由页面代入“已删除的引擎”
export function targetLabel(cfg, rule) {
  const right = cfg.defaultPair[1];
  if (rule.keep) return { key: "options_rules_target_keep", engineName: engineName(cfg, right) };
  if (rule.off === "missing") return { key: "options_rules_target", engineName: null };
  if (rule.engine === right) return { key: "options_rules_target_default", engineName: engineName(cfg, right) };
  return { key: "options_rules_target", engineName: engineName(cfg, rule.engine) };
}

// 真的写了才提示：另一页已删掉这条时什么都没写，不说“已移到”“规则已删除”
export const moveNotice = (r) => (r.patch ? ["notice_rule_moved", r.position] : null);
export const removeNotice = (r) => (r.patch || r.remove ? ["notice_rule_deleted"] : null);
