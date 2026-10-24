import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCALES, DEFAULT_LOCALE, MARK_OPEN, MARK_CLOSE,
  normalizeLocalePref, resolveLocale, formatMessage, splitMarked,
} from "../src/lib/i18n.js";

test("常量", () => {
  assert.deepEqual([...LOCALES], ["en", "zh_CN", "zh_TW", "es"]);
  assert.equal(DEFAULT_LOCALE, "en");
  assert.equal(MARK_OPEN, "\uE000");
  assert.equal(MARK_CLOSE, "\uE001");
});

test("resolveLocale 映射", () => {
  const cases = [
    ["zh-CN", "zh_CN"], ["zh-TW", "zh_TW"], ["zh-HK", "zh_TW"], ["zh-MO", "zh_TW"],
    ["zh-Hant-TW", "zh_TW"], ["zh-SG", "zh_CN"], ["zh", "zh_CN"], ["en-GB", "en"],
    ["es-419", "es"], ["fr", "en"], ["", "en"], [undefined, "en"],
  ];
  for (const [ui, want] of cases) assert.equal(resolveLocale("auto", ui), want, String(ui));
  assert.equal(resolveLocale("es", "zh-CN"), "es");
});

test("normalizeLocalePref", () => {
  for (const v of ["auto", "en", "zh_CN", "zh_TW", "es"]) assert.equal(normalizeLocalePref(v), v);
  for (const v of ["fr", "zh-CN", 42, null, undefined, {}]) assert.equal(normalizeLocalePref(v), "auto");
});

test("formatMessage 具名占位符", () => {
  const ph = (...c) => Object.fromEntries(c.map((x, i) => [["a", "b"][i], { content: x }]));
  assert.equal(formatMessage({ message: "$Engine$", placeholders: { engine: { content: "$1" } } }, ["Bing"]), "Bing");
  assert.equal(formatMessage({ message: "$B$ $A$", placeholders: ph("$1", "$2") }, ["x", "y"]), "y x");
  assert.equal(formatMessage({ message: "$A$-$A$", placeholders: ph("$1") }, ["x"]), "x-x");
  assert.equal(formatMessage({ message: "$1 and $2" }, ["x", "y"]), "x and y");
  assert.equal(formatMessage({ message: "[$1][$2]" }, ["x"]), "[x][]");
  assert.equal(formatMessage({ message: "[$A$][$B$]", placeholders: ph("$1", "$2") }, ["x"]), "[x][]");
  assert.equal(formatMessage({ message: "$A$", placeholders: ph("$$$1") }, ["x"]), "$x");
  assert.equal(formatMessage({ message: "$$5" }, []), "$5");
  assert.equal(formatMessage({ message: "$NOPE$" }, []), "$NOPE$");
});

test("formatMessage 替换值不再扫描", () => {
  const entry = { message: "“$NAME$”", placeholders: { name: { content: "$1" } } };
  assert.equal(formatMessage(entry, ["A$1B$$C"]), "“A$1B$$C”");
});

test("splitMarked", () => {
  assert.deepEqual(splitMarked("a\uE0000\uE001b\uE0001\uE001"), ["a", 0, "b", 1]);
  assert.deepEqual(splitMarked("abc"), ["abc"]);
  assert.deepEqual(splitMarked("\uE0000\uE001\uE0001\uE001"), [0, 1]);
});
