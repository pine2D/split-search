import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// 每个用例都用 ?case=N 拿一份干净的模块实例，模块状态互不影响。
let caseNo = 0;
const fresh = () => import(`../src/chrome/i18n.js?case=${++caseNo}`);

const CATALOGS = {
  en: {
    a: { message: "A-en" },
    x: { message: "X-en" },
    greet: { message: "Hi $NAME$", placeholders: { name: { content: "$1", example: "Ann" } } },
  },
  zh_TW: { a: { message: "A-tw" } },
  zh_CN: {
    code: { message: "用 $CODE$ 代表关键词", placeholders: { code: { content: "$1", example: "%s" } } },
  },
};

const realError = console.error;
const realFetch = globalThis.fetch;
let errors, fetched, getMessageCalls;

function install({ catalogs = CATALOGS, uiLanguage = "en-US", storageGet, fetchImpl } = {}) {
  fetched = [];
  getMessageCalls = [];
  globalThis.chrome = {
    runtime: { getURL: (p) => `chrome-extension://test-id/${p}` },
    i18n: {
      getUILanguage: () => uiLanguage,
      getMessage: (key, subs) => { getMessageCalls.push([key, subs]); return "from-chrome"; },
    },
    storage: { sync: { get: storageGet ?? (async () => ({})) } },
  };
  globalThis.fetch = fetchImpl ?? (async (url) => {
    fetched.push(url);
    const m = /_locales\/([^/]+)\/messages\.json$/.exec(url);
    const data = m && catalogs[m[1]];
    if (!data) throw new TypeError("Failed to fetch");
    return { ok: true, json: async () => structuredClone(data) };
  });
  globalThis.document = { documentElement: { lang: "", classList: { remove() {} } } };
}

beforeEach(() => {
  errors = [];
  console.error = (...args) => errors.push(args);
  install();
});

afterEach(() => {
  console.error = realError;
  globalThis.fetch = realFetch;
  delete globalThis.chrome;
  delete globalThis.document;
});

const splitSearchErrors = () => errors.filter((a) => String(a[0]).startsWith("[split-search]"));

test("所选语言缺 key 时退回 en", async () => {
  const m = await fresh();
  await m.setLocale("zh_TW");
  assert.equal(m.t("a"), "A-tw");
  assert.equal(m.t("x"), "X-en");
  assert.equal(m.t("greet", "Ann"), "Hi Ann");
  assert.deepEqual(errors, []);
});

test("fetch 请求网址等于 chrome.runtime.getURL 的返回值", async () => {
  const m = await fresh();
  await m.setLocale("zh_TW");
  assert.deepEqual(fetched.sort(), [
    "chrome-extension://test-id/_locales/en/messages.json",
    "chrome-extension://test-id/_locales/zh_TW/messages.json",
  ]);
});

test("所选为 en 时只读一份", async () => {
  const m = await fresh();
  assert.equal(await m.setLocale("en"), "en");
  assert.deepEqual(fetched, ["chrome-extension://test-id/_locales/en/messages.json"]);
  assert.equal(m.t("a"), "A-en");
  assert.equal(document.documentElement.lang, "en");
});

test("zh_TW 读取失败时整体退回 en，不 reject", async () => {
  install({ catalogs: { en: CATALOGS.en } });
  const m = await fresh();
  assert.equal(await m.setLocale("zh_TW"), "zh_TW");
  assert.equal(m.t("a"), "A-en");
  assert.equal(document.documentElement.lang, "zh-TW");
  assert.equal(m.currentLocale(), "zh_TW");
  assert.equal(getMessageCalls.length, 0);
});

test("两份都读不到时用 chrome.i18n.getMessage", async () => {
  install({ catalogs: {} });
  const m = await fresh();
  await m.setLocale("zh_TW");
  errors.length = 0;
  assert.equal(m.t("greet", "Ann", 3), "from-chrome");
  assert.deepEqual(getMessageCalls, [["greet", ["Ann", "3"]]]);
  assert.equal(splitSearchErrors().length, 1);
});

test("两份都加载失败后 t() 走 getMessage 而不是抛错", async () => {
  install({ fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")) });
  const m = await fresh();
  await m.setLocale("zh_TW");
  assert.equal(m.t("a"), "from-chrome");
});

test("完全缺失时返回 key 并记 [split-search] 错误", async () => {
  install({ catalogs: CATALOGS });
  globalThis.chrome.i18n.getMessage = () => "";
  const m = await fresh();
  await m.setLocale("zh_TW");
  assert.equal(m.t("nope"), "nope");
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "[split-search] missing message");
  assert.equal(errors[0][1], "nope");
});

test("auto 跟随 chrome.i18n.getUILanguage()", async () => {
  install({ uiLanguage: "zh-HK" });
  const m = await fresh();
  await m.setLocale("auto");
  assert.equal(m.currentLocale(), "zh_TW");
  assert.equal(m.currentPref(), "auto");
  assert.equal(document.documentElement.lang, "zh-TW");
});

test("initI18n 读 storage 中的 uiLocale", async () => {
  const calls = [];
  install({ storageGet: async (k) => { calls.push(k); return { uiLocale: "es" }; }, catalogs: { ...CATALOGS, es: {} } });
  const m = await fresh();
  assert.equal(await m.initI18n(), "es");
  assert.deepEqual(calls, ["uiLocale"]);
  assert.equal(m.currentPref(), "es");
});

test("initI18n 遇到不认识的 uiLocale 按 auto", async () => {
  install({ storageGet: async () => ({ uiLocale: "fr" }), uiLanguage: "zh-CN" });
  const m = await fresh();
  await m.initI18n();
  assert.equal(m.currentPref(), "auto");
  assert.equal(m.currentLocale(), "zh_CN");
});

test("initI18n 读 storage 失败时按 auto", async () => {
  install({ storageGet: () => Promise.reject(new Error("boom")) });
  const m = await fresh();
  await m.initI18n();
  assert.equal(m.currentPref(), "auto");
  assert.equal(m.currentLocale(), "en");
});

test("tNodes 按顺序插回节点", async () => {
  const m = await fresh();
  await m.setLocale("zh_CN");
  const node = { tag: "code" };
  const out = m.tNodes("code", [node]);
  assert.equal(out.length, 3);
  assert.equal(out[0], "用 ");
  assert.equal(out[1], node);
  assert.equal(out[2], " 代表关键词");
});

test("setI18nText 写 key、参数和文字", async () => {
  const m = await fresh();
  await m.setLocale("en");
  const attrs = new Map([["data-i18n-args", "[\"old\"]"]]);
  const el = {
    textContent: "",
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
  };
  m.setI18nText(el, "greet", 7);
  assert.equal(el.textContent, "Hi 7");
  assert.equal(attrs.get("data-i18n"), "greet");
  assert.equal(attrs.get("data-i18n-args"), "[\"7\"]");
  m.setI18nText(el, "a");
  assert.equal(el.textContent, "A-en");
  assert.equal(attrs.get("data-i18n"), "a");
  assert.equal(attrs.has("data-i18n-args"), false);
});

test("setLocale 之前调用 t() 抛错", async () => {
  const m = await fresh();
  assert.equal(m.currentPref(), null);
  assert.equal(m.currentLocale(), null);
  assert.throws(() => m.t("a"), /before i18n loaded: a/);
  assert.deepEqual(splitSearchErrors(), []);
  assert.equal(getMessageCalls.length, 0);
});

test("setLocale 最后一次调用生效", async () => {
  const pending = [];
  install({
    fetchImpl: (url) => new Promise((resolve) => {
      const locale = /_locales\/([^/]+)\//.exec(url)[1];
      pending.push({ locale, go: () => resolve({ ok: true, json: async () => structuredClone(CATALOGS[locale]) }) });
    }),
  });
  const m = await fresh();
  const p1 = m.setLocale("en");
  const p2 = m.setLocale("zh_TW");
  assert.deepEqual(pending.map((p) => p.locale), ["en", "zh_TW", "en"]);
  pending[1].go();
  pending[2].go();
  await p2;
  pending[0].go();
  await p1;
  assert.equal(m.currentPref(), "zh_TW");
  assert.equal(m.currentLocale(), "zh_TW");
  assert.equal(m.t("a"), "A-tw");
  assert.equal(document.documentElement.lang, "zh-TW");
});

test("模块顶层无副作用", async () => {
  delete globalThis.chrome;
  delete globalThis.document;
  delete globalThis.fetch;
  try {
    const m = await import("../src/chrome/i18n.js?case=bare");
    assert.equal(typeof m.t, "function");
  } finally {
    globalThis.fetch = realFetch;
  }
});
