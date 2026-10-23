import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, DEFAULT_PAIR, ID_PATTERN, validateTemplate, mergeConfig, isIdTaken, engineOrigin } from "../src/lib/engines.js";

test("validateTemplate: 合格的左侧模板", () => {
  assert.deepEqual(validateTemplate("https://kagi.com/search?q=%s"), { ok: true, canBeLeft: true, leftParam: "q" });
  assert.deepEqual(validateTemplate("https://duckduckgo.com/?q=%s&ia=web"), { ok: true, canBeLeft: true, leftParam: "q" });
});
test("validateTemplate: 只能作右侧", () => {
  assert.deepEqual(validateTemplate("https://en.wikipedia.org/wiki/%s"), { ok: true, canBeLeft: false, leftParam: null });
  assert.equal(validateTemplate("https://a.com/?q=%s#x").canBeLeft, false);
  assert.equal(validateTemplate("https://a.com/?q=%s&r=%s").canBeLeft, false);
  assert.equal(validateTemplate("https://a.com/?q=pre%s").canBeLeft, false);
  assert.equal(validateTemplate("https://a.com/?q=%s&_ss=a,b").canBeLeft, false);
});
test("validateTemplate: 不合格", () => {
  assert.equal(validateTemplate("ftp://a.com/?q=%s").ok, false);
  assert.equal(validateTemplate("https://a.com/?q=").ok, false);
  assert.equal(validateTemplate("https://a.com/?q=%S").ok, false);
  assert.equal(validateTemplate("not a url %s").ok, false);
});
test("mergeConfig: 空存储返回预置引擎和默认组合", () => {
  const c = mergeConfig({});
  assert.deepEqual(c.engines.map(e => e.id), ["kagi", "google", "bing", "ddg", "perplexity"]);
  assert.deepEqual(c.defaultPair, ["kagi", "google"]);
});
test("mergeConfig: 覆盖、隐藏、自定义、排序", () => {
  const c = mergeConfig({
    presetOverrides: { bing: { hidden: true }, google: { name: "G" } },
    customEngines: [{ id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" }],
    order: ["baidu", "google"],
  });
  assert.deepEqual(c.engines.map(e => e.id), ["baidu", "google", "kagi", "ddg", "perplexity"]);
  assert.equal(c.engines.find(e => e.id === "google").name, "G");
});
test("mergeConfig: defaultPair 引用了不存在、隐藏的引擎，或左侧不能作左侧时，回退到 DEFAULT_PAIR", () => {
  assert.deepEqual(mergeConfig({ defaultPair: ["kagi", "nope"] }).defaultPair, ["kagi", "google"]);
  assert.deepEqual(mergeConfig({ presetOverrides: { bing: { hidden: true } }, defaultPair: ["bing", "kagi"] }).defaultPair, ["kagi", "google"]);
  assert.deepEqual(mergeConfig({ customEngines: [{ id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" }], defaultPair: ["wiki", "kagi"] }).defaultPair, ["kagi", "google"]);
});
test("mergeConfig: 隐藏的预置引擎出现在 hidden 中", () => {
  assert.deepEqual(mergeConfig({ presetOverrides: { bing: { hidden: true } } }).hidden.map(e => e.id), ["bing"]);
});
test("isIdTaken: 已隐藏的预置引擎 id 也算已占用", () => {
  assert.equal(isIdTaken("bing", { presetOverrides: { bing: { hidden: true } } }), true);
  assert.equal(isIdTaken("baidu", { customEngines: [{ id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" }] }), true);
  assert.equal(isIdTaken("sogou", {}), false);
});
test("engineOrigin", () => {
  assert.equal(engineOrigin(PRESETS[0]), "https://kagi.com");
});
test("常量", () => {
  assert.deepEqual(DEFAULT_PAIR, ["kagi", "google"]);
  assert.ok(ID_PATTERN.test("a-1") && !ID_PATTERN.test("A") && !ID_PATTERN.test("a".repeat(21)));
});
