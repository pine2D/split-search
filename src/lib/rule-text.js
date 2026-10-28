// 关键词规则的文字处理：规范化、按词边界找词、从查询里去掉命中的词。纯逻辑，不 import 任何模块、不得引用 chrome。
// 去词结果不进日志、不进存储，只交给 ruleRight 的调用方。

// 规则匹配只看查询的这一部分：先粗截 QUERY_CUT 码点再规范化，规范化后只比前 QUERY_SCAN 码点
export const QUERY_CUT = 4000;
export const QUERY_SCAN = 1000;

// 连写字符：字母、数字、组合符，但不含不用空格分词的文字（这些文字按子串比）
const JOIN = /[\p{L}\p{N}\p{M}]/u;
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const LATIN = /\p{Script=Latin}/u;
const MN = /^\p{Mn}$/u;

const codePoints = (s) => [...s];
const isJoin = (ch) => JOIN.test(ch) && !UNSPACED.test(ch);

// 查询词和规则词共用：NFKC；只去掉拉丁字母上的变音符（日文浊点也是 Mn，不能去）；小写；空白并成一个空格
export function normalizeText(s) {
  return String(s ?? "").normalize("NFKC").normalize("NFD")
    .replace(/(\p{Script=Latin})\p{Mn}+/gu, "$1").normalize("NFC")
    .toLowerCase().replace(/\s+/gu, " ").trim();
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
// 端点不是连写字符（汉字等、标点、符号、空格）的那一端不查。不用正则，免得回溯。
// 返回全部不重叠出现的 UTF-16 区间 [start, end)，从左往右取
export function findWord(normQuery, word) {
  const out = [];
  if (!word) return out;
  const checkStart = isJoin(charAfter(word, 0));
  const checkEnd = isJoin(charBefore(word, word.length));
  let i = normQuery.indexOf(word);
  while (i !== -1) {
    const end = i + word.length;
    const ok = !(checkStart && isJoin(charBefore(normQuery, i))) && !(checkEnd && isJoin(charAfter(normQuery, end)));
    if (ok) out.push([i, end]);
    i = normQuery.indexOf(word, ok ? end : i + 1);
  }
  return out;
}

export function matchWord(normQuery, word) {
  return findWord(normQuery, word).length > 0;
}

// 单个码点按 normalizeText 的步骤规范化；prevLatin：原文里前一个码点是拉丁字母（单独的变音符跟在它后面时去掉）
function normalizeOne(c, prevLatin) {
  if (prevLatin && MN.test(c)) return "";
  return c.normalize("NFKC").normalize("NFD")
    .replace(/(\p{Script=Latin})\p{Mn}+/gu, "$1").normalize("NFC")
    .toLowerCase().replace(/\s+/gu, " ");
}

// 逐码点规范化 cps，得到与 normalizeText 同样的串 text，以及 text 每个 UTF-16 单元来自原文第几个码点（owner）
// 和每个原文码点产出的区间（spans，产出为空时是 null）；产出为空的非空白码点（被并进前一个拉丁字母的变音符）
// 记下它跟着哪个码点（attach，最近一个有产出的码点，没有时是 -1），删那个码点时一起删
function mapped(cps) {
  let text = "";
  const owner = [];
  const spans = [];
  const attach = [];
  let lastOut = -1;
  cps.forEach((c, k) => {
    let p = normalizeOne(c, k > 0 && LATIN.test(cps[k - 1]));
    if (p.startsWith(" ") && (text === "" || text.endsWith(" "))) p = p.slice(1);
    spans.push(p ? [text.length, text.length + p.length] : null);
    attach.push(p || /\s/u.test(c) ? -1 : lastOut);
    if (p) lastOut = k;
    text += p;
    for (let j = 0; j < p.length; j++) owner.push(k);
  });
  // 去掉末尾的空格（开头的空格上面已经不产出）
  while (text.endsWith(" ")) {
    text = text.slice(0, -1);
    const k = owner.pop();
    if (spans[k] && spans[k][1] > text.length) spans[k] = spans[k][0] >= text.length ? null : [spans[k][0], text.length];
  }
  return { text, owner, spans, attach };
}

// 区间正好由若干个原文码点的完整产出组成（不切开一个码点的产出，例如“½”规范化成的三个字符）
function aligned(map, start, end) {
  const first = map.owner[start];
  const last = map.owner[end - 1];
  return map.spans[first][0] === start && map.spans[last][1] === end;
}

// 从查询里去掉这些词（再规范化一次）的所有出现，判定与 findWord 相同；只看规则匹配看的那部分查询，
// 删的是原文里对应的那一段，没删到的原文保持原样。什么都没删、去完是空的、规范化对不上时返回原 query
export function stripWords(query, words) {
  const q = String(query ?? "");
  const all = codePoints(q);
  const cut = all.slice(0, QUERY_CUT);
  const rest = all.slice(QUERY_CUT).join("");
  const map = mapped(cut);
  if (map.text !== normalizeText(cut.join(""))) return q;
  const scan = codePoints(map.text).slice(0, QUERY_SCAN).join("");
  const taken = new Array(scan.length).fill(false);
  const removed = new Set();
  const sorted = [...new Set(words.map(normalizeText))].filter(Boolean).sort((a, b) => codePoints(b).length - codePoints(a).length);
  for (const word of sorted) {
    for (const [start, end] of findWord(scan, word)) {
      if (taken.slice(start, end).some(Boolean) || !aligned(map, start, end)) continue;
      for (let j = start; j < end; j++) { taken[j] = true; removed.add(map.owner[j]); }
    }
  }
  if (removed.size === 0) return q;
  map.attach.forEach((to, k) => { if (to >= 0 && removed.has(to)) removed.add(k); });
  const kept = cut.filter((_, k) => !removed.has(k)).join("") + rest;
  const out = kept.replace(/\s+/gu, " ").trim();
  return out === "" ? q : out;
}
