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
});
test("validateTemplate: %s 所在参数名重复出现时不能作左侧", () => {
  assert.deepEqual(validateTemplate("https://a.com/?q=%s&q=x"), { ok: true, canBeLeft: false, leftParam: null });
  assert.equal(validateTemplate("https://a.com/?q=x&q=%s").canBeLeft, false);
  assert.equal(validateTemplate("https://a.com/?q=%s&r=1&r=2").canBeLeft, true);
});
test("validateTemplate: leftParam 不在第一个参数也能识别", () => {
  assert.deepEqual(validateTemplate("https://duckduckgo.com/?ia=web&q=%s"), { ok: true, canBeLeft: true, leftParam: "q" });
});
test("validateTemplate: _ss 是保留参数，左右侧模板都拒绝", () => {
  for (const url of ["https://a.com/?q=%s&_ss=a,b", "https://a.com/wiki/%s?_ss=a,b", "https://a.com/?_ss=%s", "https://a.com/?q=%s&_ss"]) {
    const r = validateTemplate(url);
    assert.equal(r.ok, false, url);
    assert.match(r.error, /_ss.*保留参数/);
  }
  assert.equal(validateTemplate("https://a.com/?q=%s&x_ss=1").ok, true);
});
test("validateTemplate: 域名不能含 *、不能是 IPv6 字面量", () => {
  for (const url of ["https://*/?q=%s", "https://*.example.com/?q=%s", "https://a*b.com/wiki/%s"]) {
    const r = validateTemplate(url);
    assert.equal(r.ok, false, url);
    assert.match(r.error, /\*/);
  }
  for (const url of ["https://[::1]/?q=%s", "http://[2001:db8::1]:8080/s?q=%s"]) {
    const r = validateTemplate(url);
    assert.equal(r.ok, false, url);
    assert.match(r.error, /IPv6/);
  }
  assert.equal(validateTemplate("http://127.0.0.1:8080/?q=%s").ok, true);
});
test("validateTemplate: 不合格", () => {
  assert.equal(validateTemplate("ftp://a.com/?q=%s").ok, false);
  assert.equal(validateTemplate("https://a.com/?q=").ok, false);
  assert.equal(validateTemplate("https://a.com/?q=%S").ok, false);
  assert.equal(validateTemplate("not a url %s").ok, false);
});
test("mergeConfig: 空存储返回预置引擎和默认组合", () => {
  const c = mergeConfig({});
  assert.deepEqual(c.engines.map(e => e.id), ["google", "bing", "ddg", "perplexity", "kagi"]);
  assert.deepEqual(c.defaultPair, ["google", "bing"]);
});
test("mergeConfig: 覆盖、隐藏、自定义、排序", () => {
  const c = mergeConfig({
    presetOverrides: { bing: { hidden: true }, google: { name: "G" } },
    customEngines: [{ id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" }],
    order: ["baidu", "google"],
  });
  assert.deepEqual(c.engines.map(e => e.id), ["baidu", "google", "ddg", "perplexity", "kagi"]);
  assert.equal(c.engines.find(e => e.id === "google").name, "G");
});
test("mergeConfig: defaultPair 引用了不存在、隐藏的引擎，或左侧不能作左侧时，回退到 DEFAULT_PAIR", () => {
  assert.deepEqual(mergeConfig({ defaultPair: ["kagi", "nope"] }).defaultPair, ["google", "bing"]);
  assert.deepEqual(mergeConfig({ presetOverrides: { ddg: { hidden: true } }, defaultPair: ["ddg", "kagi"] }).defaultPair, ["google", "bing"]);
  assert.deepEqual(mergeConfig({ customEngines: [{ id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" }], defaultPair: ["wiki", "kagi"] }).defaultPair, ["google", "bing"]);
});
test("mergeConfig: 无存储组合且默认组合不可用时，回退到第一个可见且可作左侧的引擎", () => {
  assert.deepEqual(mergeConfig({ presetOverrides: { bing: { hidden: true } } }).defaultPair, ["google", "ddg"]);
  const rightOnly = "https://www.google.com/search/%s";
  assert.deepEqual(mergeConfig({ presetOverrides: { google: { url: rightOnly } } }).defaultPair, ["bing", "google"]);
  assert.deepEqual(mergeConfig({ presetOverrides: { bing: { hidden: true } }, defaultPair: ["nope", "x"] }).defaultPair, ["google", "ddg"]);
  assert.deepEqual(mergeConfig({}).defaultPair, ["google", "bing"]);
});
test("mergeConfig: 合法的 defaultPair 原样保留", () => {
  assert.deepEqual(mergeConfig({ defaultPair: ["google", "kagi"] }).defaultPair, ["google", "kagi"]);
  assert.deepEqual(mergeConfig({ defaultPair: ["kagi", "kagi"] }).defaultPair, ["kagi", "kagi"]);
});
test("mergeConfig: presetOverrides.url 覆盖预置网址", () => {
  const url = "https://www.google.com/search?q=%s&hl=en";
  assert.equal(mergeConfig({ presetOverrides: { google: { url } } }).engines.find(e => e.id === "google").url, url);
});
test("mergeConfig: order 中未知、隐藏、重复的 id 被忽略，未列出的按默认顺序补在后面", () => {
  const c = mergeConfig({
    presetOverrides: { bing: { hidden: true } },
    order: ["nope", "bing", "ddg", "ddg", "kagi"],
  });
  assert.deepEqual(c.engines.map(e => e.id), ["ddg", "kagi", "google", "perplexity"]);
  assert.deepEqual(c.hidden.map(e => e.id), ["bing"]);
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
  assert.equal(engineOrigin(PRESETS[0]), "https://www.google.com");
});
test("常量", () => {
  assert.deepEqual(DEFAULT_PAIR, ["google", "bing"]);
  assert.ok(ID_PATTERN.test("a-1") && !ID_PATTERN.test("A") && !ID_PATTERN.test("a".repeat(21)));
});

test("PRESETS: 只有 Perplexity 标了 leftDiscouraged（站点 SW 接管导航），合并配置后仍保留", () => {
  assert.deepEqual(PRESETS.filter(p => p.leftDiscouraged).map(p => p.id), ["perplexity"]);
  const cfg = mergeConfig({});
  assert.equal(cfg.engines.find(e => e.id === "perplexity").leftDiscouraged, true);
  assert.equal(cfg.engines.find(e => e.id === "google").leftDiscouraged, undefined);
});
