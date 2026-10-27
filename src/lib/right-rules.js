// 按关键词换右侧：规则清洗、匹配与设置页用的辅助。纯逻辑，不 import 任何模块、不得引用 chrome。
// 规则（清洗后）：{ id, when: "words" | "script", words? | script?, engine? | keep?: true, off }
//   off：null 生效；"hidden" 引擎已隐藏；"missing" 找不到这个文字引擎；"left" 等于默认左侧。
// 只作用于默认组合；命中的词只给弹窗和测试用，不进日志、不进记录。

export const RULE_LIMITS = Object.freeze({ rules: 20, wordsPerRule: 30, wordsTotal: 60, wordLength: 32,
  queryScan: 1000, bytes: 8000 });
// split-owner.js 本地另有一份，test/right-rules.test.js 比对两者相同
export const RULE_ID = /^r[1-9][0-9]{0,3}$/;
export const SCRIPTS = Object.freeze(["han", "kana", "hangul", "cyrillic"]);
// 每种文字的界面名（弹窗说明、设置页规则行）：字面量 key，i18n-catalog 靠它认出引用，不拼接 "script_" + id
export const SCRIPT_KEYS = Object.freeze({ han: "script_han", kana: "script_kana", hangul: "script_hangul",
  cyrillic: "script_cyrillic" });

const QUERY_CUT = 4000;
const SEPARATORS = /[,，、;；\r\n]/u;
// 连写字符：字母、数字、组合符，但不含不用空格分词的文字（这些文字按子串比）
const JOIN = /[\p{L}\p{N}\p{M}]/u;
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
// 用 Script 不用 Script_Extensions：后者会把“、。”这类共用标点也算成汉字
const SCRIPT_RE = {
  han: /\p{Script=Han}/u,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  hangul: /\p{Script=Hangul}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
};

const codePoints = (s) => [...s];
const isJoin = (ch) => JOIN.test(ch) && !UNSPACED.test(ch);

// 查询词和规则词共用：NFKC；只去掉拉丁字母上的变音符（日文浊点也是 Mn，不能去）；小写；空白并成一个空格
export function normalizeText(s) {
  return String(s ?? "").normalize("NFKC").normalize("NFD")
    .replace(/(\p{Script=Latin})\p{Mn}+/gu, "$1").normalize("NFC")
    .toLowerCase().replace(/\s+/gu, " ").trim();
}

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

// 按码点取 i 之前、之后的一个字符（遇到代理对取整个字符）；没有时返回 ""
function charBefore(s, i) {
  if (i <= 0) return "";
  const lowAt = s.charCodeAt(i - 1);
  const start = i >= 2 && lowAt >= 0xdc00 && lowAt <= 0xdfff && isHigh(s.charCodeAt(i - 2)) ? i - 2 : i - 1;
  return s.slice(start, i);
}
function charAfter(s, i) {
  return i < s.length ? String.fromCodePoint(s.codePointAt(i)) : "";
}
function isHigh(c) {
  return c >= 0xd800 && c <= 0xdbff;
}

// 两个参数都已规范化。词的端点是连写字符时，查询里紧挨它的字符不能也是连写字符；
// 端点不是连写字符（汉字等、标点、符号、空格）的那一端不查。不用正则，免得回溯
export function matchWord(normQuery, word) {
  if (!word) return false;
  const checkStart = isJoin(charAfter(word, 0));
  const checkEnd = isJoin(charBefore(word, word.length));
  for (let i = normQuery.indexOf(word); i !== -1; i = normQuery.indexOf(word, i + 1)) {
    const end = i + word.length;
    if (checkStart && isJoin(charBefore(normQuery, i))) continue;
    if (checkEnd && isJoin(charAfter(normQuery, end))) continue;
    return true;
  }
  return false;
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

// go.html 与 ⑦ 共用的唯一入口：只作用于默认组合。第一条生效且命中的规则决定结果；
// 它是 keep、或它的引擎就是当前右侧时保持默认（null），不再往下找
export function ruleRight(cfg, { leftId, rightId, query }) {
  const pair = cfg.defaultPair;
  if (!Array.isArray(pair) || leftId !== pair[0] || rightId !== pair[1]) return null;
  const q = scanQuery(query);
  if (!q) return null;
  for (const rule of cfg.rightRules ?? []) {
    if (rule.off) continue;
    if (!matchesRule(q, rule)) continue;
    if (rule.keep || rule.engine === rightId) return null;
    const engine = cfg.engines.find(e => e.id === rule.engine);
    if (engine) return { engine, ruleId: rule.id };
  }
  return null;
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
