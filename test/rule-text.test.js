import { test } from "node:test";
import assert from "node:assert/strict";
import { stripWords, findWord } from "../src/lib/rule-text.js";

const S = (q, w) => stripWords(q, w);

test("strips whole latin words, keeps the rest verbatim", () => {
  assert.equal(S("vd test", ["vd"]), "test");
  assert.equal(S("Vd Café", ["vd"]), "Café");
  assert.equal(S("test VD", ["vd"]), "test");
  assert.equal(S("vd, cats", ["vd"]), ", cats");
  assert.equal(S("vdeo avd vd", ["vd"]), "vdeo avd");
  assert.equal(S("vd a vd b", ["vd"]), "a b");
});

test("phrases and unspaced scripts", () => {
  assert.equal(S("how  to  cook", ["how to"]), "cook");
  assert.equal(S("猫视频", ["视频"]), "猫");
  assert.equal(S("ｖｄ 猫", ["vd"]), "猫");          // NFKC 全角
});

test("empty result keeps the original", () => {
  assert.equal(S("vd", ["vd"]), "vd");
  assert.equal(S("  vd  ", ["vd"]), "  vd  ");
  assert.equal(S("vd cats", ["cats", "vd"]), "vd cats");
});

test("longer word first, no overlap", () => {
  assert.equal(S("how to x", ["how", "how to"]), "x");
});

test("only scans the rule-matching prefix", () => {
  const tail = "x".repeat(1100) + " vd";
  assert.equal(S("a " + tail, ["vd"]), "a " + tail);
});

test("findWord returns every occurrence", () => {
  assert.deepEqual(findWord("vd a vd", "vd"), [[0, 2], [5, 7]]);
  assert.deepEqual(findWord("vdeo", "vd"), []);
});

test("findWord：边界与 matchWord 相同，返回不重叠的 UTF-16 区间", () => {
  assert.deepEqual(findWord("aaaa", "aa"), []);                    // 两端都挨着连写字符
  assert.deepEqual(findWord("猫猫猫猫", "猫猫"), [[0, 2], [2, 4]]);    // 子串，不重叠
  assert.deepEqual(findWord("😀ab 😀ab", "ab"), [[2, 4], [7, 9]]);
  assert.deepEqual(findWord("abc", ""), []);
});

test("没命中、原文空白与变音只在删到时才动", () => {
  assert.equal(S("cats  and   dogs", ["vd"]), "cats  and   dogs");   // 什么都没删：原样返回
  assert.equal(S("Cómo  vd hacer", ["vd"]), "Cómo hacer");
  assert.equal(S("CÓMO hacer", ["como"]), "hacer");                 // 变音只在比较时忽略
  assert.equal(S("éclair vd", ["vd"]), "éclair");       // 组合字符写法：变音留在原文里
});

test("并进字母的变音符跟着字母一起删（NFD 写法）", () => {
  assert.equal(S("cafe\u0301 x", ["cafe"]), "x");
  assert.equal(S("e\u0301clair vd", ["eclair"]), "vd");
  assert.equal(S("x cafe\u0301", ["cafe"]), "x");
  assert.equal(S("cafe\u0301 vd", ["vd"]), "cafe\u0301");          // 没删到的字母，变音符留着
});

test("规范化对不上时不删", () => {
  // 希腊文词尾 σ/ς：整串小写与逐字小写不同
  assert.equal(S("ΟΔΟΣ vd", ["vd"]), "ΟΔΟΣ vd");
});
