import { test } from "node:test";
import assert from "node:assert/strict";
import { matchResultPage } from "../src/lib/result-match.js";
import { mergeConfig } from "../src/lib/engines.js";

const cfg = mergeConfig({ customEngines: [
  { id: "gh", name: "GitHub", url: "https://github.com/search?q=%s&type=repositories" },
  { id: "gimg", name: "Google Images", url: "https://www.google.com/search?q=%s&tbm=isch" },
  { id: "maps", name: "Maps", url: "https://www.google.com/maps/search/%s" } ] });
const m = url => matchResultPage(url, cfg);
const pick = r => r && { engine: r.engine.id, query: r.query, suggestedId: r.suggestedId };

test("识别普通结果页，+ 还原成空格", () => assert.deepEqual(
  pick(m("https://www.google.com/search?q=hello+world&hl=en")), { engine: "google", query: "hello world", suggestedId: "bing" }));
test("默认组合右侧就是识别出的引擎时建议左侧", () => assert.equal(m("https://www.bing.com/search?q=x").suggestedId, "google"));
test("重复参数取第一个，fragment 不进关键词", () => {
  assert.equal(m("https://www.google.com/search?q=a&q=b").query, "a");
  assert.equal(m("https://www.google.com/search?q=a#frag").query, "a");
});
test("关键词去掉首尾空白", () => assert.equal(m("https://www.google.com/search?q=%20a%20b%20").query, "a b"));
test("空关键词、路径不同、坏网址 → null", () => {
  for (const u of ["https://www.google.com/search?q=%20%20", "https://www.google.com/search?q=",
    "https://www.google.com/search", "https://www.google.com/webhp?q=x", "not a url"]) assert.equal(m(u), null, u);
});
test("origin 必须完全相同", () => {
  assert.equal(m("http://www.google.com/search?q=x"), null);
  assert.equal(m("https://google.com/search?q=x"), null);
  assert.equal(m("https://www.google.com:8443/search?q=x"), null);
});
test("固定参数必须一致；多出的参数不影响", () => {
  assert.equal(m("https://github.com/search?q=x"), null);
  assert.equal(m("https://github.com/search?q=x&type=code"), null);
  assert.equal(m("https://github.com/search?type=repositories&q=x&p=2").engine.id, "gh");
});
test("固定参数多的优先", () => {
  assert.equal(m("https://www.google.com/search?q=x&tbm=isch").engine.id, "gimg");
  assert.equal(m("https://www.google.com/search?q=x").engine.id, "google");
});
test("固定参数一样多时 pathname 长的优先，再按显示顺序", () => {
  const two = (order) => mergeConfig({ order, customEngines: [
    { id: "a", name: "A", url: "https://s.example/find?q=%s" },
    { id: "b", name: "B", url: "https://s.example/find?q=%s" },
    { id: "c", name: "C", url: "https://s.example/?q=%s" } ] });
  assert.equal(matchResultPage("https://s.example/find?q=x", two(["b", "a"])).engine.id, "b");
  assert.equal(matchResultPage("https://s.example/find?q=x", two(["a", "b"])).engine.id, "a");
  assert.equal(matchResultPage("https://s.example/?q=x", two([])).engine.id, "c");
});
test("%s 在路径里不支持", () => assert.equal(m("https://www.google.com/maps/search/tokyo"), null));
test("%s 只是参数值的一部分（leftParam 为空）不支持", () => {
  const c = mergeConfig({ customEngines: [{ id: "so", name: "SO", url: "https://www.google.com/search?q=%s+site%3Astackoverflow.com" }],
    presetOverrides: { google: { hidden: true } } });
  assert.equal(matchResultPage("https://www.google.com/search?q=x+site%3Astackoverflow.com", c), null);
});
test("带 _ss：只按 _ss 声明的左侧引擎识别", () => {
  assert.equal(m("https://evil.example/?q=x&_ss=google,bing"), null);
  assert.equal(m("https://www.google.com/search?q=x&_ss=google,ddg").suggestedId, "ddg");
  assert.equal(m("https://www.google.com/search?q=x&_ss=google,google").suggestedId, "bing");
  assert.equal(m("https://www.bing.com/search?q=x&_ss=google,bing"), null);
});
test("带 _ss：%2C 照样认，关键词为空 → null，固定参数不对 → null（不再逐个比对）", () => {
  assert.equal(m("https://www.google.com/search?q=x&_ss=google%2Cddg").suggestedId, "ddg");
  assert.equal(m("https://www.google.com/search?q=%20&_ss=google,ddg"), null);
  assert.equal(m("https://github.com/search?q=x&_ss=gh,bing"), null);
  // 网址也像 Google 结果页，但 _ss 声明的是 gimg 且缺 tbm=isch：不退回认成 google
  assert.equal(m("https://www.google.com/search?q=x&_ss=gimg,bing"), null);
});
test("parseTrigger 失败（未知右侧 id、_ss 格式不对）→ 照常逐个比对", () => {
  assert.deepEqual(pick(m("https://www.google.com/search?q=x&_ss=google,gone")), { engine: "google", query: "x", suggestedId: "bing" });
  assert.deepEqual(pick(m("https://www.google.com/search?q=x&_ss=bad")), { engine: "google", query: "x", suggestedId: "bing" });
});
test("隐藏的引擎不参与识别", () => {
  const c = mergeConfig({ presetOverrides: { ddg: { hidden: true } } });
  assert.equal(matchResultPage("https://duckduckgo.com/?q=x", c), null);
});
test("默认组合换过时按它建议", () => {
  const c = mergeConfig({ defaultPair: ["ddg", "kagi"] });
  assert.equal(matchResultPage("https://www.google.com/search?q=x", c).suggestedId, "kagi");
  assert.equal(matchResultPage("https://kagi.com/search?q=x", c).suggestedId, "ddg");
});
test("非字符串网址 → null", () => {
  assert.equal(matchResultPage(undefined, cfg), null);
  assert.equal(matchResultPage(null, cfg), null);
});

// v0.5：⑦ 的建议右侧与 go.html 按关键词选的右侧一致（只在默认组合下）
const RE = (id) => ({ id, name: id.toUpperCase(), url: `https://${id}.test/s?q=%s` });
const ruleCfg = (x = {}) => ({ engines: ["ea", "eb", "ec", "ed"].map(RE), hidden: [], defaultPair: ["ea", "eb"],
  rightRules: [{ id: "r1", when: "words", words: ["wiki"], off: null, engine: "ec" }], ...x });
test("规则：没有 _ss、识别出默认左侧、规则命中 → suggestedId 是规则引擎", () => {
  assert.equal(matchResultPage("https://ea.test/s?q=wiki+apple", ruleCfg()).suggestedId, "ec");
  // 没命中照旧建议默认右侧
  assert.equal(matchResultPage("https://ea.test/s?q=apple", ruleCfg()).suggestedId, "eb");
});
test("规则：_ss 等于默认组合 → 规则引擎；_ss 是显式组合 → 按 _ss", () => {
  assert.equal(matchResultPage("https://ea.test/s?q=wiki&_ss=ea,eb", ruleCfg()).suggestedId, "ec");
  assert.equal(matchResultPage("https://ea.test/s?q=wiki&_ss=ea%2Ceb", ruleCfg()).suggestedId, "ec");
  assert.equal(matchResultPage("https://ea.test/s?q=wiki&_ss=ea,ed", ruleCfg()).suggestedId, "ed");
});
test("规则：识别出的不是默认左侧 → 沿用原来的建议", () => {
  assert.equal(matchResultPage("https://ed.test/s?q=wiki", ruleCfg()).suggestedId, "eb");
  assert.equal(matchResultPage("https://eb.test/s?q=wiki", ruleCfg()).suggestedId, "ea");
  assert.equal(matchResultPage("https://eb.test/s?q=wiki&_ss=eb,ec", ruleCfg()).suggestedId, "ec");
});
test("规则：cfg 没有 rightRules → 不抛，沿用原逻辑", () => {
  const { rightRules, ...c } = ruleCfg();
  assert.equal(matchResultPage("https://ea.test/s?q=wiki", c).suggestedId, "eb");
  assert.equal(matchResultPage("https://ea.test/s?q=wiki&_ss=ea,eb", c).suggestedId, "eb");
});
