import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/lib/right-rules.js";
import { RULE_ID as OWNER_RULE_ID } from "../src/lib/split-owner.js";

const n = R.normalizeText;
const E = (id, url) => ({ id, name: id.toUpperCase(), url });
const ENGINES = [E("ea", "https://a.test/s?q=%s"), E("eb", "https://b.test/s?q=%s"), E("ec", "https://c.test/wiki/%s"), E("ed", "https://d.test/s?q=%s")];
const W = (id, words, x) => ({ id, when: "words", words, off: null, ...x });   // x: { engine } 或 { keep: true }
const S = (id, script, x) => ({ id, when: "script", script, off: null, ...x });
const cfg = (rightRules, defaultPair = ["ea", "eb"]) => ({ engines: ENGINES, hidden: [], defaultPair, rightRules });
const pick = (rules, query, ids = ["ea", "eb"]) => R.ruleRight(cfg(rules), { leftId: ids[0], rightId: ids[1], query });

test("normalizeText", () => {
  assert.equal(n("ＷＩＫＩ"), "wiki"); assert.equal(n("  How　\t to  "), "how to"); assert.equal(n("cómo"), "como");
  assert.equal(n("Wiki"), "wiki");
  assert.equal(n("が"), "が"); assert.equal(n(""), ""); assert.doesNotThrow(() => n("İ"));
  assert.equal(n("天氣"), "天氣");                                                  // 繁简不合并
});

test("parseWords：五种分隔符和换行、词内空格、去重、上限", () => {
  assert.deepEqual(R.parseWords("天气, weather，Why、why;x；y\nz").words, ["天气", "weather", "why", "x", "y", "z"]);
  assert.deepEqual(R.parseWords("  how   to ").words, ["how to"]);                       // Review Focus 1
  assert.deepEqual(R.parseWords("a\r\nb"), { ok: true, words: ["a", "b"] });
  assert.equal(R.parseWords(" ,，、").error.code, "rule_no_words");
  assert.deepEqual(R.parseWords(""), { ok: false, error: { code: "rule_no_words", args: [] } });
  assert.equal(R.parseWords(Array.from({ length: 31 }, (_, i) => `w${i}`).join(",")).error.code, "rule_too_many_words");
  assert.ok(R.parseWords(Array.from({ length: 30 }, (_, i) => `w${i}`).join(",")).ok);
  assert.deepEqual(R.parseWords("😀".repeat(33)).error, { code: "rule_word_long", args: ["😀".repeat(12)] });
  assert.deepEqual(R.parseWords("汉".repeat(33)).error, { code: "rule_word_long", args: ["汉".repeat(12)] });
  assert.ok(R.parseWords("汉".repeat(32)).ok);
  assert.ok(R.parseWords("😀".repeat(32)).ok);
});

test("matchWord 拉丁", () => {
  for (const s of ["css grid", "(css)", "css,html"]) assert.ok(R.matchWord(n(s), "css"), s);
  for (const s of ["scss", "cssom"]) assert.ok(!R.matchWord(n(s), "css"), s);
  assert.ok(R.matchWord(n("js教程"), "js")); assert.ok(R.matchWord(n("学js"), "js")); assert.ok(!R.matchWord(n("jsonl"), "js"));
  assert.ok(!R.matchWord(n("however to"), "how to")); assert.ok(R.matchWord(n("How　to center"), "how to"));  // RF1
  assert.ok(R.matchWord(n("CÓMO hacer"), n("cómo")));
});

test("matchWord 中日韩泰与混排", () => {
  assert.ok(R.matchWord(n("苏轼百科"), "百科")); assert.ok(R.matchWord(n("서울에서"), "서울"));
  // 词也先规范化（progress.md F1：NFKC 会把 U+0E33 拆成两个码点）
  assert.ok(R.matchWord(n("วิธีทำอาหาร"), n("ทำอาหาร"))); assert.ok(R.matchWord(n("python教程"), "python"));
  assert.ok(!R.matchWord(n("abc语言"), "c语言")); assert.ok(R.matchWord(n("学c语言"), "c语言"));
});

test("数字、重复出现、符号（RF2）", () => {
  assert.ok(!R.matchWord(n("13d"), "3d")); assert.ok(R.matchWord(n("2026年"), "2026")); assert.ok(R.matchWord(n("happy py"), "py"));
  assert.ok(!R.matchWord(n("happy"), "py"));
  assert.ok(R.matchWord(n("objective-c++ 模板"), "c++")); assert.ok(R.matchWord(n("c# 入门"), "c#"));
  assert.ok(R.matchWord(n("node.js 教程"), "node.js")); assert.ok(!R.matchWord(n("node.jsx"), "node.js"));
  assert.ok(!R.matchWord("abc", ""));
});

test("代理对与非 JOIN 端点", () => {
  assert.ok(!R.matchWord("𐌰ab", "ab")); assert.ok(R.matchWord("𠀀ab", "ab")); assert.ok(R.matchWord("😀ab", "ab"));
  assert.ok(!R.matchWord("ab𐌰", "ab")); assert.ok(R.matchWord("ab𠀀", "ab"));
  assert.ok(R.matchWord("x$5", "$5")); assert.ok(R.matchWord("a#css", "#css"));
});

test("hasScript", () => {
  assert.ok(R.hasScript(n("天气"), "han")); assert.ok(!R.hasScript(n("、。"), "han")); assert.ok(R.hasScript(n("ｶﾀｶﾅ"), "kana"));
  assert.ok(R.hasScript(n("ひらがな"), "kana")); assert.ok(!R.hasScript(n("wiki"), "kana"));
  assert.ok(R.hasScript(n("東京"), "han")); assert.ok(!R.hasScript(n("東京"), "kana"));
  assert.ok(R.hasScript("서울", "hangul")); assert.ok(!R.hasScript("seoul", "hangul"));
  assert.ok(R.hasScript("москва", "cyrillic")); assert.ok(!R.hasScript("moskva", "cyrillic"));
  assert.ok(!R.hasScript("天气", "latin"));
});

test("matchesRule", () => {
  assert.deepEqual(R.matchesRule("css grid", W("r1", ["html", "css"], { engine: "ec" })), { by: "word", word: "css" });
  assert.deepEqual(R.matchesRule("天气", S("r1", "han", { engine: "ec" })), { by: "script", script: "han" });
  assert.equal(R.matchesRule("wiki", S("r1", "han", { engine: "ec" })), null);
  assert.equal(R.matchesRule("wiki", W("r1", ["css"], { engine: "ec" })), null);
});

test("scanQuery", () => {
  assert.equal(R.scanQuery("  ＣＳＳ　Grid "), "css grid");
  assert.equal([...R.scanQuery("汉".repeat(5000))].length, 1000);
  assert.equal(R.scanQuery(""), "");
});

test("ruleRight", () => {
  assert.equal(pick([W("r1", ["wiki"], { engine: "ec" })], "wiki x", ["ea", "ed"]), null);       // 显式组合（右不同）
  assert.equal(pick([W("r1", ["wiki"], { engine: "ec" })], "wiki x", ["ed", "eb"]), null);       // 显式组合（左不同）
  assert.equal(pick([W("r1", ["wiki"], { engine: "ec" })], ""), null);
  assert.equal(pick([W("r1", ["wiki"], { engine: "ec" })], "   "), null);
  assert.equal(pick([], "wiki"), null);
  assert.equal(R.ruleRight({ engines: ENGINES, defaultPair: ["ea", "eb"] }, { leftId: "ea", rightId: "eb", query: "wiki" }), null); // 没有 rightRules 字段
  assert.deepEqual(pick([W("r1", ["wiki"], { engine: "ec" }), S("r2", "han", { engine: "ed" })], "wiki 百科"), { engine: ENGINES[2], ruleId: "r1" });
  assert.equal(pick([W("r1", ["wiki"], { engine: "ec" }), W("r2", ["wiki"], { engine: "ed" })], "wiki").ruleId, "r1");
  assert.equal(pick([W("r1", ["wiki"], { engine: "ec", off: "hidden" }), W("r2", ["wiki"], { engine: "ed" })], "wiki").ruleId, "r2");
  assert.equal(pick([W("r1", ["keep"], { keep: true }), W("r2", ["wiki"], { engine: "ec" })], "keep wiki"), null);
  assert.equal(pick([W("r1", ["wiki"], { engine: "eb" }), W("r2", ["wiki"], { engine: "ec" })], "wiki"), null);
  assert.equal(pick([W("r1", ["zz"], { engine: "ec" })], "a ".repeat(500) + "zz"), null);        // 第 1001 码点之后
  assert.equal(pick([W("r1", ["zz"], { engine: "ec" })], "a ".repeat(499) + "zz").ruleId, "r1");
  assert.equal(pick([S("r1", "han", { engine: "ed" }), W("r2", ["wiki"], { engine: "ec" })], "wiki 百科").ruleId, "r1");
  assert.equal(pick([W("r1", ["c++"], { engine: "ec" })], "objective-c++ 模板").ruleId, "r1");   // RF2
  assert.equal(pick([W("r1", ["c++"], { engine: "ec" })], "Objective-C++ 模板").engine.url, "https://c.test/wiki/%s");
});

test("explainRule（RF5）", () => {
  const rec = { engine: "ec", rule: "r1", base: "eb", query: "wiki x" };
  assert.deepEqual(R.explainRule(cfg([W("r1", ["wiki"], { engine: "ec" })]), rec), { ruleId: "r1", hit: { by: "word", word: "wiki" } });
  for (const rules of [[], [W("r1", ["other"], { engine: "ec" })], [W("r1", ["wiki"], { engine: "ed" })],
    [W("r1", ["wiki"], { engine: "ec", off: "hidden" })], [W("r1", ["wiki"], { keep: true })], [S("r1", "han", { engine: "ec" })]])
    assert.equal(R.explainRule(cfg(rules), rec), null);
  assert.equal(R.explainRule(cfg([W("r1", ["wiki"], { engine: "ec" })]), { engine: "ec", query: "wiki" }), null);   // 记录没有 rule
  assert.equal(R.explainRule({ engines: ENGINES, defaultPair: ["ea", "eb"] }, rec), null);                          // 没有 rightRules 字段
});

test("cleanRules", () => {
  const ctx = { engines: ENGINES, hidden: [E("ddg", "https://ddg.test/?q=%s")], defaultPair: ["ea", "eb"], isEngineId: id => /^[a-z0-9-]{1,20}$/.test(id) };
  const clean = (raw) => R.cleanRules(raw, ctx);
  const w = (id, words, x = { engine: "ec" }) => ({ id, when: "words", words, ...x });
  for (const raw of [undefined, null, "x", {}, 3]) assert.deepEqual(clean(raw), []);
  // 坏元素丢掉
  assert.deepEqual(clean([null, "r1", w("x1", ["a"]), w("r1", ["a"]), w("r1", ["b"]), { id: "r2", when: "regex", words: ["a"], engine: "ec" },
    { id: "r3", when: "script", script: "latin", engine: "ec" }, w("r4", ["a"], { engine: "Bad!" }), w("r5", ["a"], {}), w("r6", [" ", 3, null])]),
  [{ id: "r1", when: "words", words: ["a"], engine: "ec", off: null }]);
  // keep
  assert.deepEqual(clean([w("r1", ["a"], { keep: true, engine: "ec" })]), [{ id: "r1", when: "words", words: ["a"], keep: true, off: null }]);
  assert.deepEqual(clean([w("r1", ["a"], { keep: "yes" })]), []);
  assert.deepEqual(clean([w("r1", ["a"], { keep: "yes", engine: "ec" })]), [{ id: "r1", when: "words", words: ["a"], engine: "ec", off: null }]);
  assert.deepEqual(clean([{ id: "r1", when: "script", script: "kana", keep: true }]), [{ id: "r1", when: "script", script: "kana", keep: true, off: null }]);
  // 条数上限
  const many = Array.from({ length: 21 }, (_, i) => w(`r${i + 1}`, ["a"]));
  assert.deepEqual(clean(many).map(r => r.id), many.slice(0, 20).map(r => r.id));
  // 每条 30、合计 60 词（前面优先）
  const words = (k, p) => Array.from({ length: k }, (_, i) => `${p}${i}`);
  const three = clean([w("r1", words(35, "a")), w("r2", words(20, "b")), w("r3", words(15, "c"))]);
  assert.deepEqual(three.map(r => r.words.length), [30, 20, 10]);
  assert.deepEqual(three[2].words, words(10, "c"));
  assert.deepEqual(clean([w("r1", words(30, "a")), w("r2", words(20, "b")), w("r3", words(15, "c")), w("r4", words(5, "d"))]).map(r => r.id), ["r1", "r2", "r3"]);
  // 超长词丢掉、其余保留
  assert.deepEqual(clean([w("r1", ["x".repeat(33), "ok"])])[0].words, ["ok"]);
  // off
  const off = (engine) => clean([w("r1", ["a"], { engine })])[0].off;
  assert.equal(off("ddg"), "hidden"); assert.equal(off("zz-gone"), "missing"); assert.equal(off("lens"), "missing");
  assert.equal(off("ea"), "left"); assert.equal(off("eb"), null); assert.equal(off("ec"), null);
  // 重新规范化、不改入参
  const raw = [w("r1", ["CSS", "css", " "]), { id: "r2", when: "script", script: "han", engine: "ed", words: ["x"] }];
  const before = structuredClone(raw);
  assert.deepEqual(clean(raw), [{ id: "r1", when: "words", words: ["css"], engine: "ec", off: null },
    { id: "r2", when: "script", script: "han", engine: "ed", off: null }]);
  assert.deepEqual(raw, before);
});

test("shadowedWords", () => {
  assert.deepEqual(R.shadowedWords([W("r1", ["js"], { engine: "ec" }), W("r2", ["js", "css"], { engine: "ed" })]), [{ ruleId: "r2", word: "js", byRuleId: "r1" }]);
  assert.deepEqual(R.shadowedWords([S("r1", "han", { engine: "ed" }), W("r2", ["百科全书"], { engine: "ec" })]), [{ ruleId: "r2", word: "百科全书", byRuleId: "r1" }]);
  assert.deepEqual(R.shadowedWords([S("r1", "han", { engine: "ed" }), S("r2", "han", { engine: "ec" })]), [{ ruleId: "r2", word: null, byRuleId: "r1" }]);
  assert.deepEqual(R.shadowedWords([S("r1", "han", { engine: "ed" }), S("r2", "kana", { engine: "ec" })]), []);
  assert.deepEqual(R.shadowedWords([W("r1", ["js"], { engine: "ec", off: "left" }), W("r2", ["js"], { engine: "ed" })]), []);
  assert.deepEqual(R.shadowedWords([W("r1", ["py"], { engine: "ec" }), W("r2", ["happy"], { engine: "ed" })]), []);
  assert.deepEqual(R.shadowedWords([W("r1", ["js"], { keep: true }), W("r2", ["js"], { engine: "ed" })]), [{ ruleId: "r2", word: "js", byRuleId: "r1" }]);
  // 暂不生效的后面规则不报（计划“开放项”）
  assert.deepEqual(R.shadowedWords([W("r1", ["js"], { engine: "ec" }), W("r2", ["js"], { engine: "ed", off: "hidden" })]), []);
  assert.deepEqual(R.shadowedWords([]), []);
});

test("nextRuleId / rulesBytes / 常量", () => {
  assert.equal(R.nextRuleId([]), "r1"); assert.equal(R.nextRuleId([{ id: "r1" }, { id: "r3" }]), "r4");
  assert.equal(R.nextRuleId([{ id: "r1" }, { id: "r3" }, { id: "r9999" }]), "r2");
  assert.equal(R.rulesBytes([{ id: "r1", when: "words", words: ["百科"], engine: "ec" }]), new TextEncoder().encode(JSON.stringify([{ id: "r1", when: "words", words: ["百科"], engine: "ec" }])).length + 10);
  assert.equal(R.rulesBytes([{ id: "r1", when: "words", words: ["百科"], engine: "ec" }]) - R.rulesBytes([{ id: "r1", when: "words", words: ["ab"], engine: "ec" }]), 4);  // 中文 3 字节
  assert.ok(R.rulesBytes([{ id: "r1", when: "words", words: ["a"], engine: "ec" }]) < R.RULE_LIMITS.bytes);
  assert.deepEqual(R.RULE_LIMITS, { rules: 20, wordsPerRule: 30, wordsTotal: 60, wordLength: 32, queryScan: 1000, bytes: 8000 });
  assert.deepEqual(R.SCRIPTS, ["han", "kana", "hangul", "cyrillic"]);
  // 句中用的名称（SCRIPT_KEYS）与对话框下拉选项（SCRIPT_OPTION_KEYS，es 等语言要首字母大写）各一套，都覆盖全部文字
  assert.deepEqual(Object.keys(R.SCRIPT_KEYS), R.SCRIPTS);
  assert.deepEqual(Object.entries(R.SCRIPT_OPTION_KEYS), R.SCRIPTS.map(s => [s, `script_option_${s}`]));
  assert.equal(R.RULE_ID.source, "^r[1-9][0-9]{0,3}$");
  assert.equal(OWNER_RULE_ID.source, R.RULE_ID.source);
});

test("性能守门：2000 码点查询 × 20 条规则（合计 60 词），ruleRight 20 次取中位数 < 5 ms", () => {
  // 每个词在查询里反复出现、边界都不合格，逼 indexOf 循环走到底
  const query = "xab".repeat(667).slice(0, 2000);
  const rules = Array.from({ length: 20 }, (_, i) => W(`r${i + 1}`, ["ab", `ab${i}`, "xa"], { engine: "ec" }));
  assert.equal(rules.flatMap(r => r.words).length, 60);
  const times = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    assert.equal(pick(rules, query), null);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[10] < 5, `median ${times[10]} ms`);
});
