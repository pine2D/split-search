import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, CATEGORIES, catalogUrl, uniqueId, isAdded } from "../src/lib/engine-catalog.js";
import { PRESETS, ID_PATTERN, validateTemplate } from "../src/lib/engines.js";
import { errorKey } from "../src/lib/errors.js";

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

test("引擎库的 13 个条目（v0.7 起去掉百度），leftDiscouraged 有 5 个，AI 只有 ChatGPT 和 Claude", () => {
  assert.deepEqual(CATALOG.map(e => e.name).sort(), [
    "Amazon", "Bilibili", "Bing Translator", "Cambridge Dictionary", "ChatGPT", "Claude", "GitHub",
    "Google Maps", "Google Scholar", "Google Translate", "MDN", "Wikipedia", "YouTube",
  ]);
  assert.deepEqual(CATALOG.filter(e => e.leftDiscouraged).map(e => e.name).sort(),
    ["Amazon", "ChatGPT", "Claude", "Google Maps", "YouTube"]);
  assert.deepEqual(CATALOG.filter(e => e.ai).map(e => e.name).sort(), ["ChatGPT", "Claude"]);
  assert.ok(CATALOG.every(e => (e.category === "ai") === (e.ai === true)));
  assert.ok(!CATALOG.some(e => /gemini/i.test(e.name + e.url)), "Gemini 不预填，不收录");
});

test("AI 条目的模板照用户实测", () => {
  const by = Object.fromEntries(CATALOG.map(e => [e.id, e]));
  assert.equal(catalogUrl(by.chatgpt, "zh_CN"), "https://chatgpt.com/?q=%s");
  assert.equal(catalogUrl(by.claude, "es"), "https://claude.ai/new?q=%s");
  assert.equal(CATEGORIES.at(-1).id, "ai");
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

test("uniqueId 的基础 id 不合法时抛错", () => {
  assert.throws(() => uniqueId("Bad_Id", () => false));
  assert.throws(() => uniqueId("x".repeat(21), () => false));
});

test("uniqueId 尝试次数有上限：抛带错误码 id_exhausted 的错误，界面按 err_id_exhausted 显示", () => {
  assert.throws(() => uniqueId("abc", () => true), e => e.code === "id_exhausted" && e.args[0] === "abc");
  assert.deepEqual(errorKey(captured(() => uniqueId("abc", () => true))), ["err_id_exhausted", "abc"]);
});
const captured = fn => { try { fn(); } catch (e) { return e; } return null; };

test("catalogUrl 遇到未知界面语言时 <target> 和 <lang> 都退回 en", () => {
  const by = Object.fromEntries(CATALOG.map(e => [e.id, e]));
  assert.equal(catalogUrl(by.gtranslate, "fr"), "https://translate.google.com/?sl=auto&tl=en&text=%s&op=translate");
  assert.equal(catalogUrl(by.wikipedia, "fr"), "https://en.wikipedia.org/w/index.php?search=%s&title=Special:Search");
});

test("每个条目在每种界面语言下恰好一个 %s", () => {
  for (const locale of ["en", "zh_CN", "zh_TW", "es"]) {
    for (const e of CATALOG) assert.equal(catalogUrl(e, locale).split("%s").length - 1, 1, `${e.id}@${locale}`);
  }
});

test("catalog has no baidu and no empty category", () => {
  assert.equal(CATALOG.some(e => e.id === "baidu" || /baidu\./.test(e.url)), false);
  for (const c of CATEGORIES) assert.ok(CATALOG.some(e => e.category === c.id), `empty category ${c.id}`);
  assert.equal(CATEGORIES.some(c => c.id === "chinese"), false);
});
