import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, mergeConfig } from "../src/lib/engines.js";
import { buildTriggerTemplate, extractOriginalUrl, stripMarker, parseTrigger, expandTemplate } from "../src/lib/trigger.js";

const kagi = PRESETS.find(e => e.id === "kagi");
const wiki = { id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" };
const E = [...mergeConfig({}).engines, { id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" }];
const withWiki = [...E, wiki];

test("buildTriggerTemplate", () => {
  assert.equal(buildTriggerTemplate(kagi, "google"), "https://kagi.com/search?q=%s&_ss=kagi,google");
  assert.equal(buildTriggerTemplate({ id: "x", name: "X", url: "https://x.com/s?q=%s" }, "bing"), "https://x.com/s?q=%s&_ss=x,bing");
  assert.throws(() => buildTriggerTemplate({ id: "w", name: "W", url: "https://w.org/wiki/%s" }, "google"));
});
test("extractOriginalUrl 保留原始网址里的 & 和 +", () => {
  assert.equal(extractOriginalUrl("?u=https://kagi.com/search?q=a+b&_ss=kagi,google"), "https://kagi.com/search?q=a+b&_ss=kagi,google");
  assert.equal(extractOriginalUrl("?x=1"), null);
});
test("parseTrigger: 空格编码为 + 时还原成空格", () => {
  const r = parseTrigger("https://kagi.com/search?q=hello+world&_ss=kagi,google", E);
  assert.equal(r.ok, true); assert.equal(r.query, "hello world");
  assert.equal(r.left.id, "kagi"); assert.equal(r.right.id, "google");
});
test("parseTrigger: 特殊字符往返", () => {
  for (const q of ["c++", "a&_ss=x", "100%", "中文 搜索", "😀", "a#b"]) {
    const u = "https://kagi.com/search?q=" + encodeURIComponent(q).replace(/%20/g, "+") + "&_ss=kagi,google";
    assert.equal(parseTrigger(u, E).query, q);
  }
});
test("parseTrigger: 兼容 Kagi 把逗号改写成 %2C", () => {
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=kagi%2Cgoogle", E).right.id, "google");
});
test("parseTrigger: 左右可以是同一个引擎", () => {
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=kagi,kagi", E).ok, true);
});
test("parseTrigger: 出错时返回中文说明", () => {
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=kagi,nope", E).ok, false);
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=kagi", E).ok, false);
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=wiki,google", withWiki).ok, false); // 左侧不能作左
  const m = parseTrigger("https://kagi.com/search?query=x&_ss=kagi,google", E);  // 模板已改、参数名对不上
  assert.equal(m.ok, false); assert.match(m.error, /重新复制/);
});
test("parseTrigger: 参数存在但值为空时 query 为空串", () => {
  assert.equal(parseTrigger("https://kagi.com/search?q=&_ss=kagi,google", E).query, "");
});
test("parseTrigger: _ss 格式不对（能被宽松的 DNR 正则命中）时返回错误", () => {
  for (const ss of ["kagi", "Kagi,google", "kagi,google,bing", ""]) assert.equal(parseTrigger(`https://kagi.com/search?q=x&_ss=${ss}`, E).ok, false, ss);
});
test("expandTemplate", () => {
  assert.equal(expandTemplate("https://www.google.com/search?q=%s", "a b&c"), "https://www.google.com/search?q=a%20b%26c");
  assert.equal(expandTemplate("https://www.google.com/search?q=%s", ""), "https://www.google.com/");
  assert.equal(expandTemplate("https://x.com/%s?q=%s", "a"), "https://x.com/a?q=a");
});
test("stripMarker 只删 _ss，其余原样保留", () => {
  assert.equal(stripMarker("https://kagi.com/search?q=a+b&_ss=kagi,google"), "https://kagi.com/search?q=a+b");
  assert.equal(stripMarker("https://kagi.com/search?_ss=kagi%2Cgoogle&q=a%20b&page=2"), "https://kagi.com/search?q=a%20b&page=2");
  assert.equal(stripMarker("https://x.com/s?q=a&_ss=x,y&r=1"), "https://x.com/s?q=a&r=1");
});
test("stripMarker 边界：仅有 _ss、不误伤 x_ss、无标记原样", () => {
  assert.equal(stripMarker("https://x.com/s?_ss=a,b"), "https://x.com/s");
  assert.equal(stripMarker("https://x.com/s?x_ss=1&q=2"), "https://x.com/s?x_ss=1&q=2");
  assert.equal(stripMarker("https://x.com/s?q=2"), "https://x.com/s?q=2");
});
