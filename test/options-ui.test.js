import { test } from "node:test";
import assert from "node:assert/strict";
import { originPattern, ht, joinSentences } from "../src/options/ui.js";
import { setLocale } from "../src/chrome/i18n.js";

test("originPattern：精确 origin + /*", () => {
  assert.equal(originPattern({ url: "https://kagi.com/search?q=%s" }), "https://kagi.com/*");
  assert.equal(originPattern({ url: "http://127.0.0.1:8080/?q=%s" }), "http://127.0.0.1:8080/*");
});
test("originPattern：含 * 或无法解析时不生成（不会申请宽泛权限）", () => {
  assert.equal(originPattern({ url: "https://*/?q=%s" }), null);
  assert.equal(originPattern({ url: "https://*.example.com/?q=%s" }), null);
  assert.equal(originPattern({ url: "not a url" }), null);
});

// ---- ht / joinSentences：用最小的假 DOM 和假目录 ----

const CATALOGS = {
  en: {
    greet: { message: "Hi $NAME$", placeholders: { name: { content: "$1", example: "Ann" } } },
    plain: { message: "Plain" },
  },
  zh_CN: { greet: { message: "你好 $NAME$", placeholders: { name: { content: "$1", example: "Ann" } } } },
};

function installFakes() {
  class FakeNode {}
  class FakeEl extends FakeNode {
    constructor(tag) { super(); this.tag = tag; this.attrs = new Map(); this.children = []; }
    setAttribute(k, v) { this.attrs.set(k, v); }
    append(c) { this.children.push(c); }
    get textContent() { return this.children.map((c) => c.text ?? c.textContent).join(""); }
  }
  globalThis.Node = FakeNode;
  globalThis.document = {
    documentElement: { lang: "", classList: { remove() {} } },
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (text) => ({ text }),
  };
  globalThis.chrome = {
    runtime: { getURL: (p) => `chrome-extension://test-id/${p}` },
    i18n: { getUILanguage: () => "en-US", getMessage: () => "" },
  };
  globalThis.fetch = async (url) => {
    const l = /_locales\/([^/]+)\//.exec(url)[1];
    return { ok: true, json: async () => structuredClone(CATALOGS[l] ?? {}) };
  };
}

test("ht：写入译文和 data-i18n / data-i18n-args；没有参数时不写 data-i18n-args", async () => {
  installFakes();
  await setLocale("en");
  const el = ht("button", { class: "btn" }, "greet", "Ann");
  assert.equal(el.textContent, "Hi Ann");
  assert.equal(el.attrs.get("data-i18n"), "greet");
  assert.equal(el.attrs.get("data-i18n-args"), JSON.stringify(["Ann"]));
  const plain = ht("span", null, "plain");
  assert.equal(plain.textContent, "Plain");
  assert.equal(plain.attrs.has("data-i18n-args"), false);
});

test("joinSentences：中文句间不加空格，其他语言加一个空格", async () => {
  installFakes();
  await setLocale("zh_CN");
  assert.equal(joinSentences("已新增“X”。", "它的网站还没授权。"), "已新增“X”。它的网站还没授权。");
  await setLocale("en");
  assert.equal(joinSentences("Added X.", "Grant access."), "Added X. Grant access.");
});
