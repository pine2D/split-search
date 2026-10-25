import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatMessage } from "../src/lib/i18n.js";

// 包内真实的 _locales：标题按真实目录格式化
const catalog = (l) => JSON.parse(readFileSync(new URL(`../src/_locales/${l}/messages.json`, import.meta.url), "utf8"));
const title = (l, key, name) => formatMessage(catalog(l)[key], [name]);

let state;
function reset() {
  state = { sync: {}, calls: [], createError: null, uiLanguageThrows: 0 };
}
reset();

globalThis.fetch = async (url) => {
  const m = /^chrome-extension:\/\/x\/_locales\/([^/]+)\/messages\.json$/.exec(url);
  if (!m) throw new TypeError("Failed to fetch " + url);
  return { ok: true, json: async () => catalog(m[1]) };
};
globalThis.chrome = {
  runtime: { id: "x", getURL: (p) => `chrome-extension://x/${p}` },
  i18n: {
    getUILanguage() {
      if (state.uiLanguageThrows > 0) { state.uiLanguageThrows--; throw new Error("i18n not ready"); }
      return "en-US";
    },
    getMessage: () => "",
  },
  storage: { sync: { async get(key) { return key === "uiLocale" ? { uiLocale: state.sync.uiLocale } : state.sync; } } },
  contextMenus: {
    async removeAll() { state.calls.push(["removeAll"]); },
    // 真实 Chrome 只在回调期间设 runtime.lastError
    create(props, cb) {
      state.calls.push(["create", props]);
      setTimeout(() => {
        if (state.createError) chrome.runtime.lastError = { message: state.createError };
        try { cb?.(); } finally { delete chrome.runtime.lastError; }
      }, 1);
      return props.id;
    },
  },
};

const { rebuildMenus } = await import("../src/chrome/menus.js");
const created = () => state.calls.filter(c => c[0] === "create").map(c => c[1]);
const textTitle = () => created().find(p => p.id === "ss-lookup-text").title;

beforeEach((t) => {
  reset();
  t.mock.method(console, "error", () => {});
});

test("隐藏查词引擎以后，标题退回默认组合右侧的引擎名", async () => {
  state.sync = { lookupEngine: "ddg", presetOverrides: { ddg: { hidden: true } }, uiLocale: "en" };
  await rebuildMenus();
  assert.equal(textTitle(), title("en", "menu_lookup_text", "Bing"));
  assert.match(textTitle(), /Bing/);
  assert.equal(created().find(p => p.id === "ss-lookup-image").title, title("en", "menu_lookup_image", "Google Lens"));
  assert.equal(console.error.mock.callCount(), 0);
});

test("查词引擎与以图搜图引擎按配置取名，引擎名里的 & 与 %s 先转义", async () => {
  state.sync = {
    uiLocale: "en", lookupEngine: "mine", imageEngine: "img1",
    customEngines: [{ id: "mine", name: "A&B %s", url: "https://a.example/?q=%s" }],
    imageEngines: [{ id: "img1", name: "C&D", url: "https://c.example/?u=%s" }],
  };
  await rebuildMenus();
  assert.equal(textTitle(), title("en", "menu_lookup_text", "A&&B % s"));
  assert.equal(created().find(p => p.id === "ss-lookup-image").title, title("en", "menu_lookup_image", "C&&D"));
});

test("改 uiLocale 后标题换语言", async () => {
  state.sync = { uiLocale: "zh_CN" };
  await rebuildMenus();
  assert.equal(textTitle(), title("zh_CN", "menu_lookup_text", "Bing"));
  assert.notEqual(title("zh_CN", "menu_lookup_text", "Bing"), title("en", "menu_lookup_text", "Bing"));
  state.calls = [];
  state.sync = { uiLocale: "en" };
  await rebuildMenus();
  assert.equal(textTitle(), title("en", "menu_lookup_text", "Bing"));
});

test("连续两次不 await 的重建串行执行，后一次在前一次的 create 完成后才 removeAll", async () => {
  state.sync = { uiLocale: "en" };
  await Promise.all([rebuildMenus(), rebuildMenus()]);
  assert.deepEqual(state.calls.map(c => c[0]), ["removeAll", "create", "create", "removeAll", "create", "create"]);
});

test("create 回调里有 runtime.lastError：只记 [split-search] 日志，照常 resolve", async () => {
  state.sync = { uiLocale: "en" };
  state.createError = "Cannot create item with duplicate id ss-lookup-text";
  await rebuildMenus();
  assert.equal(created().length, 2);
  assert.equal(console.error.mock.callCount(), 2);
  for (const c of console.error.mock.calls) assert.equal(c.arguments[0], "[split-search]");
});

test("文案初始化失败时不抛、不动菜单，并清掉缓存；下次重建重新初始化", async () => {
  // 新的模块实例：惰性初始化还没缓存过（失败的 Promise 若被缓存，第二次重建也会失败）
  const fresh = await import("../src/chrome/menus.js?init-fails");
  state.sync = { uiLocale: "en" };
  state.uiLanguageThrows = 1;
  await fresh.rebuildMenus();
  assert.deepEqual(state.calls, []);
  assert.equal(console.error.mock.callCount(), 1);
  assert.equal(console.error.mock.calls[0].arguments[0], "[split-search]");
  await fresh.rebuildMenus();
  assert.equal(textTitle(), title("en", "menu_lookup_text", "Bing"));
});

test("removeAll 抛错：只记日志，链不断", async () => {
  state.sync = { uiLocale: "en" };
  const orig = chrome.contextMenus.removeAll;
  chrome.contextMenus.removeAll = async () => { throw new Error("boom"); };
  try {
    await rebuildMenus();
  } finally {
    chrome.contextMenus.removeAll = orig;
  }
  assert.equal(created().length, 0);
  assert.equal(console.error.mock.callCount(), 1);
  await rebuildMenus();
  assert.equal(created().length, 2);
});
