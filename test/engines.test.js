import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, DEFAULT_PAIR, ID_PATTERN, validateTemplate, mergeConfig, isIdTaken, engineOrigin,
  enginesFor, engineById, cleanImageEngines } from "../src/lib/engines.js";
import { IMAGE_CATALOG } from "../src/lib/image-engines.js";

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
    assert.equal(r.error.code, "tpl_reserved_param");
  }
  assert.equal(validateTemplate("https://a.com/?q=%s&x_ss=1").ok, true);
});
test("validateTemplate: 域名不能含 *、不能是 IPv6 字面量", () => {
  for (const url of ["https://*/?q=%s", "https://*.example.com/?q=%s", "https://a*b.com/wiki/%s"]) {
    const r = validateTemplate(url);
    assert.equal(r.ok, false, url);
    assert.equal(r.error.code, "tpl_wildcard_host");
  }
  for (const url of ["https://[::1]/?q=%s", "http://[2001:db8::1]:8080/s?q=%s"]) {
    const r = validateTemplate(url);
    assert.equal(r.ok, false, url);
    assert.equal(r.error.code, "tpl_ipv6");
  }
  assert.equal(validateTemplate("http://127.0.0.1:8080/?q=%s").ok, true);
});
test("validateTemplate: 不合格", () => {
  const cases = [
    ["ftp://a.com/?q=%s", "tpl_bad_scheme"],
    ["https://a.com/?q=", "tpl_no_placeholder"],
    ["https://a.com/?q=%S", "tpl_no_placeholder"],
    [undefined, "tpl_no_placeholder"],
    ["not a url %s", "bad_url"],
  ];
  for (const [url, code] of cases) {
    assert.deepEqual(validateTemplate(url), { ok: false, error: { code, args: [] } }, url);
  }
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
test("mergeConfig 透传合法 uiLocale", () => {
  assert.equal(mergeConfig({ uiLocale: "es" }).uiLocale, "es");
  for (const v of ["auto", "en", "zh_CN", "zh_TW"]) assert.equal(mergeConfig({ uiLocale: v }).uiLocale, v);
});
test("mergeConfig 对缺省和非法 uiLocale 给 auto", () => {
  for (const stored of [{}, { uiLocale: "fr" }, { uiLocale: "zh-CN" }, { uiLocale: 42 }]) {
    assert.equal(mergeConfig(stored).uiLocale, "auto", JSON.stringify(stored));
  }
  assert.equal(mergeConfig().uiLocale, "auto");
});
test("uiLocale 不影响引擎合并", () => {
  const { uiLocale, ...rest } = mergeConfig({ uiLocale: "es", order: ["bing"] });
  const { uiLocale: base, ...expected } = mergeConfig({ order: ["bing"] });
  assert.equal(uiLocale, "es");
  assert.equal(base, "auto");
  assert.deepEqual(rest, expected);
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

test("mergeConfig：narrowFallback 缺省或非 false 都是 true", () => {
  assert.equal(mergeConfig({}).narrowFallback, true);
  assert.equal(mergeConfig({ narrowFallback: false }).narrowFallback, false);
  assert.equal(mergeConfig({ narrowFallback: "no" }).narrowFallback, true);
});

test("mergeConfig 清洗自定义引擎：leftDiscouraged 只认 true，丢掉其他字段", () => {
  const base = { id: "a", name: "A", url: "https://a.example/?q=%s" };
  const { engines } = mergeConfig({ customEngines: [
    { ...base, id: "a", leftDiscouraged: "yes", junk: 1 },
    { ...base, id: "b", leftDiscouraged: true },
    { ...base, id: "c" },
  ] });
  const get = id => engines.find(e => e.id === id);
  assert.deepEqual(get("a"), base);
  assert.deepEqual(get("b"), { ...base, id: "b", leftDiscouraged: true });
  assert.deepEqual(get("c"), { ...base, id: "c" });
});

test("mergeConfig：cycleExclude 缺省为 []，只留字符串并去重（保留首次出现的顺序）", () => {
  assert.deepEqual(mergeConfig({}).cycleExclude, []);
  assert.deepEqual(mergeConfig({ cycleExclude: "bing" }).cycleExclude, []);
  assert.deepEqual(mergeConfig({ cycleExclude: { 0: "bing" } }).cycleExclude, []);
  assert.deepEqual(mergeConfig({ cycleExclude: null }).cycleExclude, []);
  assert.deepEqual(mergeConfig({ cycleExclude: ["bing", 3, null, { id: "x" }, "kagi", "bing"] }).cycleExclude,
    ["bing", "kagi"]);
});

test("mergeConfig：lens 在前，自定义以图搜图引擎被清洗", () => {
  const cfg = mergeConfig({ imageEngines: [
    { id: "bing-img", name: "Bing", url: "https://www.bing.com/images/searchbyimage?cbir=sbi&imgurl=%s", extra: 1 },
    { id: "BAD", name: "x", url: "https://x.com/?u=%s" }, "nope",
    { id: "lens", name: "fake", url: "https://evil.example/?u=%s" } ] });
  assert.deepEqual(cfg.imageEngines.map(e => e.id), ["lens", "bing-img"]);
  assert.deepEqual(Object.keys(cfg.imageEngines[1]), ["id", "name", "url"]);
  assert.equal(cfg.imageEngine, "lens");
  assert.equal(mergeConfig({ imageEngine: "gone" }).imageEngine, "lens");
});

test("cleanImageEngines：模板不合法的、id 与文字引擎或 lens 撞车的都丢掉", () => {
  const good = { id: "bing-img", name: "Bing", url: "https://www.bing.com/images/searchbyimage?cbir=sbi&imgurl=%s" };
  const list = [
    good,
    { id: "no-ph", name: "x", url: "https://x.example/?u=" },              // 没有 %s
    { id: "ftp-img", name: "x", url: "ftp://x.example/?u=%s" },            // 不是 http(s)
    { id: "ss-img", name: "x", url: "https://x.example/?u=%s&_ss=a,b" },   // 带保留参数
    { id: "bad-url", name: "x", url: "nope %s" },                          // 不是网址
    { id: "wild-img", name: "x", url: "https://*.example/?u=%s" },         // 通配域名
    { id: "google", name: "x", url: "https://g.example/?u=%s" },           // 撞预置文字引擎
    { id: "my-wiki", name: "x", url: "https://w.example/?u=%s" },          // 撞自定义文字引擎
    { id: "lens", name: "fake", url: "https://evil.example/?u=%s" },       // 撞内置 lens
  ];
  const customEngines = [{ id: "my-wiki", name: "Wiki", url: "https://wiki.example/?search=%s" }];
  assert.deepEqual(cleanImageEngines(list, customEngines), [good]);
  // 不传文字引擎时仍挡住预置 id
  assert.deepEqual(cleanImageEngines(list).map(e => e.id), ["bing-img", "my-wiki"]);
  // customEngines 不是数组、元素不是对象时忽略
  assert.deepEqual(cleanImageEngines([good], "x"), [good]);
  assert.deepEqual(cleanImageEngines([good], [null, 3, { id: 5 }]), [good]);
});

test("mergeConfig：与自定义文字引擎同 id 的以图搜图引擎不进 imageEngines，选了它退回 lens", () => {
  const cfg = mergeConfig({
    customEngines: [{ id: "my-wiki", name: "Wiki", url: "https://wiki.example/?search=%s" }],
    imageEngines: [{ id: "my-wiki", name: "x", url: "https://w.example/?u=%s" }],
    imageEngine: "my-wiki",
  });
  assert.deepEqual(cfg.imageEngines.map(e => e.id), ["lens"]);
  assert.equal(cfg.imageEngine, "lens");
});

test("mergeConfig：lookupFollow 表示正在跟随默认组合右侧（存的 lookupEngine 缺失、隐藏或无效）", () => {
  assert.equal(mergeConfig({}).lookupFollow, true);
  assert.equal(mergeConfig({ lookupEngine: "ddg" }).lookupFollow, false);
  // 存的恰好就是默认组合右侧：用户选过，不算跟随
  assert.equal(mergeConfig({ lookupEngine: "bing" }).lookupFollow, false);
  assert.equal(mergeConfig({ lookupEngine: "ddg", presetOverrides: { ddg: { hidden: true } } }).lookupFollow, true);
  assert.equal(mergeConfig({ lookupEngine: "lens" }).lookupFollow, true);
  assert.equal(mergeConfig({ lookupEngine: 3 }).lookupFollow, true);
});

test("mergeConfig：imageEngine 是现存的自定义以图搜图引擎时原样返回", () => {
  const imageEngines = [{ id: "bing-img", name: "Bing", url: "https://www.bing.com/images/searchbyimage?cbir=sbi&imgurl=%s" }];
  assert.equal(mergeConfig({ imageEngines, imageEngine: "bing-img" }).imageEngine, "bing-img");
  assert.equal(mergeConfig({ imageEngines, imageEngine: "lens" }).imageEngine, "lens");
});

test("mergeConfig：lookupEngine 缺省跟随默认组合右侧，隐藏或无效时回退", () => {
  assert.equal(mergeConfig({}).lookupEngine, "bing");
  assert.equal(mergeConfig({ lookupEngine: "ddg" }).lookupEngine, "ddg");
  assert.equal(mergeConfig({ lookupEngine: "ddg", presetOverrides: { ddg: { hidden: true } } }).lookupEngine, "bing");
  assert.equal(mergeConfig({ lookupEngine: "lens" }).lookupEngine, "bing");
  assert.equal(mergeConfig({ defaultPair: ["google", "ddg"] }).lookupEngine, "ddg");
});

test("enginesFor / engineById 按 kind 取", () => {
  const cfg = mergeConfig({ presetOverrides: { ddg: { hidden: true } } });
  assert.equal(enginesFor(cfg, "image"), cfg.imageEngines);
  assert.equal(enginesFor(cfg, "text"), cfg.engines);
  assert.equal(enginesFor(cfg, "search"), cfg.engines);
  assert.equal(engineById(cfg, "image", "lens").name, "Google Lens");
  assert.equal(engineById(cfg, "text", "ddg").id, "ddg");
  assert.equal(engineById(cfg, "image", "google"), null);
  assert.equal(engineById(cfg, "text", "lens"), null);
});

test("isIdTaken 同时查两套引擎", () => {
  assert.equal(isIdTaken("lens", {}), true);
  assert.equal(isIdTaken("bing-img", { imageEngines: [IMAGE_CATALOG[0]] }), true);
  assert.equal(isIdTaken("bing-img", {}), false);
});
