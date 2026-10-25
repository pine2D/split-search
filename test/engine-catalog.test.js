import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, CATEGORIES, catalogUrl, uniqueId, isAdded } from "../src/lib/engine-catalog.js";
import { PRESETS, ID_PATTERN, validateTemplate } from "../src/lib/engines.js";

for (const locale of ["en", "zh_CN", "zh_TW", "es"]) {
  for (const e of CATALOG) {
    test(`${e.id} @${locale} 模板合法`, () => {
      const url = catalogUrl(e, locale);
      assert.ok(!url.includes("<"), url);
      assert.equal(validateTemplate(url).ok, true);
      assert.ok(ID_PATTERN.test(e.id));
      assert.ok(!PRESETS.some(p => p.id === e.id));
      assert.ok(CATEGORIES.some(c => c.id === e.category));
    });
  }
}

test("目录 id 互不重复", () => assert.equal(new Set(CATALOG.map(e => e.id)).size, CATALOG.length));

test("目录恰好收录附录 A 的 12 个条目，leftDiscouraged 只有 3 个", () => {
  assert.deepEqual(CATALOG.map(e => e.name).sort(), [
    "Amazon", "Baidu", "Bilibili", "Bing Translator", "Cambridge Dictionary", "GitHub",
    "Google Maps", "Google Scholar", "Google Translate", "MDN", "Wikipedia", "YouTube",
  ]);
  assert.deepEqual(CATALOG.filter(e => e.leftDiscouraged).map(e => e.name).sort(), ["Amazon", "Google Maps", "YouTube"]);
  assert.ok(CATALOG.every(e => !e.ai));
});

test("分类 key 是字面量且按 catalog_cat_ 命名", () => {
  for (const c of CATEGORIES) assert.equal(c.key, "catalog_cat_" + c.id);
});

test("语言代码照附录 A", () => {
  const by = Object.fromEntries(CATALOG.map(e => [e.name, e]));
  const g = l => catalogUrl(by["Google Translate"], l);
  assert.equal(g("zh_CN"), "https://translate.google.com/?sl=auto&tl=zh-CN&text=%s&op=translate");
  assert.equal(g("zh_TW"), "https://translate.google.com/?sl=auto&tl=zh-TW&text=%s&op=translate");
  assert.equal(catalogUrl(by["Bing Translator"], "zh_CN"), "https://www.bing.com/translator?text=%s&from=auto&to=zh-Hans");
  assert.equal(catalogUrl(by["Bing Translator"], "zh_TW"), "https://www.bing.com/translator?text=%s&from=auto&to=zh-Hant");
  const w = l => catalogUrl(by.Wikipedia, l);
  assert.equal(w("en"), "https://en.wikipedia.org/w/index.php?search=%s&title=Special:Search");
  assert.equal(w("zh_CN"), "https://zh.wikipedia.org/w/index.php?search=%s&title=Special:Search");
  assert.equal(w("zh_TW"), "https://zh.wikipedia.org/w/index.php?search=%s&title=Special:Search&variant=zh-tw");
  assert.equal(w("es"), "https://es.wikipedia.org/w/index.php?search=%s&title=Special:Search");
});

test("uniqueId 加后缀且不超过 20 字符", () => {
  assert.equal(uniqueId("youtube", id => id === "youtube"), "youtube-2");
  assert.equal(uniqueId("youtube", id => id === "youtube" || id === "youtube-2"), "youtube-3");
  assert.equal(uniqueId("github", () => false), "github");
  const long = "a".repeat(20);
  const got = uniqueId(long, id => id === long);
  assert.ok(got.length <= 20 && ID_PATTERN.test(got) && got !== long);
});

test("isAdded 按展开后的模板比较", () => {
  const yt = CATALOG.find(e => e.id === "youtube");
  const url = catalogUrl(yt, "en");
  assert.equal(isAdded(yt, "en", [{ id: "x", url }]), true);
  assert.equal(isAdded(yt, "en", [{ id: "x", url: "https://example.com/?q=%s" }]), false);
  const wiki = CATALOG.find(e => e.id === "wikipedia");
  assert.equal(isAdded(wiki, "es", [{ url: catalogUrl(wiki, "en") }]), false);
});
