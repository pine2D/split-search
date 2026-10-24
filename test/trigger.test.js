import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, mergeConfig } from "../src/lib/engines.js";
import { TRIGGER_REGEX } from "../src/lib/rules.js";
import { buildTriggerTemplate, extractOriginalUrl, stripMarker, parseTrigger, expandTemplate } from "../src/lib/trigger.js";

const kagi = PRESETS.find(e => e.id === "kagi");
const wiki = { id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" };
const E = [...mergeConfig({}).engines, { id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" }];
const withWiki = [...E, wiki];

test("buildTriggerTemplate", () => {
  assert.equal(buildTriggerTemplate(kagi, "google"), "https://kagi.com/search?q=%s&_ss=kagi,google");
  assert.equal(buildTriggerTemplate({ id: "x", name: "X", url: "https://x.com/s?q=%s" }, "bing"), "https://x.com/s?q=%s&_ss=x,bing");
  assert.throws(() => buildTriggerTemplate({ id: "w", name: "W", url: "https://w.org/wiki/%s" }, "google"),
    { message: "not_left", code: "not_left", args: ["W"] });
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
test("parseTrigger: 出错时返回错误码", () => {
  const unknown = parseTrigger("https://kagi.com/search?q=x&_ss=kagi,nope", E);
  assert.equal(unknown.ok, false); assert.deepEqual(unknown.error, { code: "unknown_engine", args: ["nope"] });
  const bad = parseTrigger("https://kagi.com/search?q=x&_ss=kagi", E);
  assert.equal(bad.ok, false); assert.equal(bad.error.code, "marker_format");
  const notLeft = parseTrigger("https://kagi.com/search?q=x&_ss=wiki,google", withWiki); // 左侧不能作左
  assert.equal(notLeft.ok, false); assert.deepEqual(notLeft.error, { code: "not_left", args: ["Wiki"] });
  const m = parseTrigger("https://kagi.com/search?query=x&_ss=kagi,google", E);  // 模板已改、参数名对不上
  assert.equal(m.ok, false); assert.equal(m.error.code, "template_mismatch");
});
test("parseTrigger: 右侧引擎已隐藏时报未知引擎", () => {
  const { engines } = mergeConfig({ presetOverrides: { bing: { hidden: true } } });
  const r = parseTrigger("https://kagi.com/search?q=x&_ss=kagi,bing", engines);
  assert.equal(r.ok, false); assert.deepEqual(r.error, { code: "unknown_engine", args: ["bing"] });
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
test("stripMarker 删除全部 _ss，其余参数逐字节保留", () => {
  assert.equal(stripMarker("https://kagi.com/search?q=a&_ss=kagi,google&_ss=kagi,bing"), "https://kagi.com/search?q=a");
  assert.equal(stripMarker("https://x.com/s?_ss=a,b&q=a%20b+c&_ss&r=%2C&_ss=c,d#f"), "https://x.com/s?q=a%20b+c&r=%2C#f");
  assert.equal(stripMarker("https://x.com/s?_ss=a,b&_ss=c,d"), "https://x.com/s");
});
test("stripMarker 边界：仅有 _ss、不误伤 x_ss、无标记原样", () => {
  assert.equal(stripMarker("https://x.com/s?_ss=a,b"), "https://x.com/s");
  assert.equal(stripMarker("https://x.com/s?x_ss=1&q=2"), "https://x.com/s?x_ss=1&q=2");
  assert.equal(stripMarker("https://x.com/s?q=2"), "https://x.com/s?q=2");
});

// spec 第 6 节关键词：触发网址模板 → Chrome 展开 %s → DNR 重定向到 go.html → 解析 → 左侧网址
test("关键词全链路往返：buildTriggerTemplate → Chrome 展开 → DNR → parseTrigger → stripMarker", () => {
  const re = new RegExp(TRIGGER_REGEX);
  const template = buildTriggerTemplate(kagi, "google");
  for (const q of ["hello world", "+", "c++", "a&b", "100%", "a#b", "中文 搜索", "😀", "a&_ss=x"]) {
    const expanded = template.replace("%s", encodeURIComponent(q).replace(/%20/g, "+"));
    assert.ok(re.test(expanded), q);
    const redirected = expanded.replace(re, "chrome-extension://id/go.html?u=$&");
    const original = extractOriginalUrl(new URL(redirected).search);
    assert.equal(original, expanded, q);
    const r = parseTrigger(original, E);
    assert.equal(r.ok, true, q);
    assert.equal(r.query, q);
    const left = stripMarker(original);
    const lu = new URL(left);
    assert.equal(lu.searchParams.get("q"), q);
    assert.equal(lu.searchParams.has("_ss"), false, q);
    assert.ok(!left.includes("_ss=kagi"), q);
  }
});
