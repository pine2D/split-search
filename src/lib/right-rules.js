// 按关键词换右侧：规则清洗、匹配与设置页用的辅助。纯逻辑，只 import rule-text.js、不得引用 chrome。
// 规则（清洗后）：{ id, when: "words" | "script", words? | script?, strip?: true, engine? | keep?: true, off }
//   strip：只在 words 规则上，命中时从查询里去掉这条规则的词（rule-text.js 的 stripWords）。
//   off：null 生效；"hidden" 引擎已隐藏；"missing" 找不到这个文字引擎；"left" 等于默认左侧。
// 只作用于默认组合；命中的词只给弹窗和测试用，不进日志、不进记录。
import { normalizeText, matchWord, stripWords, QUERY_CUT, QUERY_SCAN } from "./rule-text.js";

// 其他模块和测试原来从这里取这两个函数，照旧可以
export { normalizeText, matchWord };

export const RULE_LIMITS = Object.freeze({ rules: 20, wordsPerRule: 30, wordsTotal: 60, wordLength: 32,
  queryScan: QUERY_SCAN, bytes: 8000 });
// split-owner.js 本地另有一份，test/right-rules.test.js 比对两者相同
export const RULE_ID = /^r[1-9][0-9]{0,3}$/;
export const SCRIPTS = Object.freeze(["han", "kana", "hangul", "cyrillic"]);
// 每种文字的界面名（弹窗说明、设置页规则行）：字面量 key，i18n-catalog 靠它认出引用，不拼接 "script_" + id
export const SCRIPT_KEYS = Object.freeze({ han: "script_han", kana: "script_kana", hangul: "script_hangul",
  cyrillic: "script_cyrillic" });
// 规则对话框下拉框里的选项：单独成行，要按列表项的大小写（es 首字母大写），所以与句中用的 SCRIPT_KEYS 分开
export const SCRIPT_OPTION_KEYS = Object.freeze({ han: "script_option_han", kana: "script_option_kana",
  hangul: "script_option_hangul", cyrillic: "script_option_cyrillic" });

const SEPARATORS = /[,，、;；\r\n]/u;
// 用 Script 不用 Script_Extensions：后者会把“、。”这类共用标点也算成汉字
const SCRIPT_RE = {
  han: /\p{Script=Han}/u,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  hangul: /\p{Script=Hangul}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
};

const codePoints = (s) => [...s];

// 按 , ， 、 ; ； 和换行切开；词内空格保留；规范化、去空、去重（保留首次）
export function parseWords(text) {
  const words = [];
  for (const piece of String(text ?? "").normalize("NFKC").split(SEPARATORS)) {
    const w = normalizeText(piece);
    if (w && !words.includes(w)) words.push(w);
  }
  if (words.length === 0) return wordsError("rule_no_words");
  if (words.length > RULE_LIMITS.wordsPerRule) return wordsError("rule_too_many_words");
  const long = words.find(w => codePoints(w).length > RULE_LIMITS.wordLength);
  // 只给前 12 个字；词总比 12 个字长，省略号写在文案里（err_rule_word_long）
  if (long) return wordsError("rule_word_long", codePoints(long).slice(0, 12).join(""));
  return { ok: true, words };
}

// 与 lib/errors.js 的 fail() 同形（本文件不 import）
function wordsError(code, ...args) {
  return { ok: false, error: { code, args } };
}

// 读时清洗：丢掉坏的条目，截到上限，标出暂不生效的原因。不改入参、不删存储
export function cleanRules(raw, { engines, hidden, defaultPair, isEngineId }) {
  if (!Array.isArray(raw)) return [];
  const visible = new Set(engines.map(e => e.id));
  const hiddenIds = new Set(hidden.map(e => e.id));
  const out = [];
  const seen = new Set();
  let total = 0;
  for (const r of raw) {
    if (out.length >= RULE_LIMITS.rules) break;
    if (!r || typeof r !== "object") continue;
    const { id, when } = r;
    if (typeof id !== "string" || !RULE_ID.test(id) || seen.has(id)) continue;
    const keep = r.keep === true;
    if (!keep && (typeof r.engine !== "string" || !isEngineId(r.engine))) continue;
    let rule;
    if (when === "words") {
      const words = cleanWords(r.words, Math.min(RULE_LIMITS.wordsPerRule, RULE_LIMITS.wordsTotal - total));
      if (words.length === 0) continue;
      total += words.length;
      rule = { id, when, words };
      if (r.strip === true) rule.strip = true;
    } else if (when === "script" && SCRIPTS.includes(r.script)) {
      rule = { id, when, script: r.script };
    } else {
      continue;
    }
    if (keep) Object.assign(rule, { keep: true, off: null });
    else Object.assign(rule, { engine: r.engine, off: offReason(r.engine, visible, hiddenIds, defaultPair) });
    seen.add(id);
    out.push(rule);
  }
  return out;
}

function cleanWords(value, max) {
  const words = [];
  if (!Array.isArray(value)) return words;
  for (const x of value) {
    if (words.length >= max) break;
    if (typeof x !== "string") continue;
    const w = normalizeText(x);
    if (w && !words.includes(w) && codePoints(w).length <= RULE_LIMITS.wordLength) words.push(w);
  }
  return words;
}

function offReason(engine, visible, hiddenIds, defaultPair) {
  if (!visible.has(engine) && !hiddenIds.has(engine)) return "missing";
  if (hiddenIds.has(engine)) return "hidden";
  if (engine === defaultPair?.[0]) return "left";
  return null;
}

// 有一个这种字符就算
export function hasScript(normQuery, script) {
  return Object.hasOwn(SCRIPT_RE, script) && SCRIPT_RE[script].test(normQuery);
}

export function matchesRule(normQuery, rule) {
  if (rule.when === "words") {
    const word = rule.words.find(w => matchWord(normQuery, w));
    return word === undefined ? null : { by: "word", word };
  }
  if (rule.when === "script" && hasScript(normQuery, rule.script)) return { by: "script", script: rule.script };
  return null;
}

// 先粗截 4000 码点再规范化，规范化后只比前 1000 码点：地址栏塞再长的文字也不卡
export function scanQuery(query) {
  const cut = codePoints(String(query ?? "")).slice(0, QUERY_CUT).join("");
  return codePoints(normalizeText(cut)).slice(0, RULE_LIMITS.queryScan).join("");
}

// go.html 与 ⑦ 共用的唯一入口：只作用于默认组合。第一条生效且命中的规则决定结果，返回 { ruleId, engine, query }：
// engine 为 null 表示右侧不换（规则是 keep、或它的引擎就是当前右侧，不再往下找）；
// query 在规则带 strip 时是去词后的查询，否则就是入参。没有命中、不是默认组合、查询为空返回 null
export function ruleRight(cfg, { leftId, rightId, query }) {
  const pair = cfg.defaultPair;
  if (!Array.isArray(pair) || leftId !== pair[0] || rightId !== pair[1]) return null;
  const q = scanQuery(query);
  if (!q) return null;
  for (const rule of cfg.rightRules ?? []) {
    if (rule.off) continue;
    if (!matchesRule(q, rule)) continue;
    const keep = rule.keep || rule.engine === rightId;
    const engine = keep ? null : cfg.engines.find(e => e.id === rule.engine);
    if (keep || engine) return { ruleId: rule.id, engine, query: ruleQuery(rule, query) };
  }
  return null;
}

function ruleQuery(rule, query) {
  return rule.strip === true && rule.when === "words" ? stripWords(query, rule.words) : query;
}

// 弹窗用：记录里的规则仍在、生效、指向记录里的引擎，并且仍命中记录的查询，才说得出“为什么”
export function explainRule(cfg, record) {
  const rule = (cfg.rightRules ?? []).find(r => r.id === record?.rule);
  if (!rule || rule.off || rule.keep || rule.engine !== record.engine) return null;
  const hit = matchesRule(scanQuery(record.query), rule);
  return hit ? { ruleId: rule.id, hit } : null;
}

// 设置页用：后面生效规则里永远轮不到的词（被前面生效规则命中）；script 规则被前面同种 script 规则挡住时报整条（word: null）
export function shadowedWords(rules) {
  const out = [];
  rules.forEach((rule, i) => {
    if (rule.off) return;
    const earlier = rules.slice(0, i).filter(r => !r.off);
    if (rule.when === "script") {
      const by = earlier.find(r => r.when === "script" && r.script === rule.script);
      if (by) out.push({ ruleId: rule.id, word: null, byRuleId: by.id });
      return;
    }
    for (const word of rule.words) {
      const by = earlier.find(r => matchesRule(word, r));
      if (by) out.push({ ruleId: rule.id, word, byRuleId: by.id });
    }
  });
  return out;
}

// 现有最大序号 + 1；最大已是 r9999 时取最小空位
export function nextRuleId(rules) {
  const used = new Set(rules.map(r => r.id).filter(id => RULE_ID.test(id)).map(id => Number(id.slice(1))));
  const max = Math.max(0, ...used);
  if (max < 9999) return "r" + (max + 1);
  let k = 1;
  while (used.has(k)) k++;
  return "r" + k;
}

// 与 chrome/config-store.js 的 MAX_ITEM_BYTES 检查同一算法：键名 + JSON 的 UTF-8 字节数
export function rulesBytes(rules) {
  return new TextEncoder().encode(JSON.stringify(rules)).length + "rightRules".length;
}
