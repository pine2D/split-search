import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 整个 SW 只导入一次：监听器在导入时注册，之后各测试改 state 再触发监听器。
const listeners = {};
const event = (name) => ({ addListener: (fn) => { (listeners[name] ||= []).push(fn); } });
let state;
import { expandTemplate } from "../src/lib/trigger.js";
import { IMAGE_CATALOG } from "../src/lib/image-engines.js";
const QUERY = "a&b #c+d 中文 😀";
const rec = (peer, engine) => ({ peer, splitViewId: 7, mode: "split", role: "search", engine, query: QUERY });
const L = { id: 10, index: 0, windowId: 1, splitViewId: 7, active: false };
const R = { id: 11, index: 1, windowId: 1, splitViewId: 7, active: true };

function reset(over = {}) {
  state = {
    calls: [],
    menus: [],
    sync: {},
    session: new Map(Object.entries({ "split:10": rec(11, "google"), "split:11": rec(10, "bing") })),
    tabs: { 10: L, 11: R },
    win: { id: 1, type: "normal" },
    nextId: 100,
    ...over,
  };
}

// rebuildMenus 经 initI18n 读包内 _locales：返回仓库里真实的目录
globalThis.fetch = async (url) => {
  const m = /^chrome-extension:\/\/x\/_locales\/([^/]+)\/messages\.json$/.exec(url);
  if (!m) throw new TypeError("Failed to fetch " + url);
  const data = JSON.parse(readFileSync(new URL(`../src/_locales/${m[1]}/messages.json`, import.meta.url), "utf8"));
  return { ok: true, json: async () => data };
};
globalThis.chrome = {
  runtime: {
    id: "x", onInstalled: event("onInstalled"), onStartup: event("onStartup"), openOptionsPage() {},
    onMessage: event("runtime.onMessage"), getURL: (p) => `chrome-extension://x/${p}`,
  },
  i18n: { getUILanguage: () => "en-US", getMessage: () => "" },
  contextMenus: {
    onClicked: event("contextMenus.onClicked"),
    async removeAll() { state.menus.push("removeAll"); },
    create(props, cb) { state.menus.push(["create", props.id]); setTimeout(() => cb?.(), 0); return props.id; },
    async update() {},
  },
  storage: {
    onChanged: event("storage.onChanged"),
    sync: { async get() { return state.sync; } },
    session: {
      async get(key) {
        const keys = [].concat(key);
        return Object.fromEntries(keys.filter(k => state.session.has(k)).map(k => [k, state.session.get(k)]));
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) state.session.set(k, v); },
      async remove(keys) { for (const k of [].concat(keys)) state.session.delete(k); },
    },
  },
  permissions: { onAdded: event("permissions.onAdded"), onRemoved: event("permissions.onRemoved") },
  action: { onClicked: event("action.onClicked") },
  declarativeNetRequest: { async updateDynamicRules() {} },
  commands: { onCommand: event("commands.onCommand") },
  windows: {
    // windows.get 返回 state.win（带 populate 时附上它的标签）
    async get(id, opts) {
      state.calls.push(["windows.get", id, opts]);
      const tabs = opts?.populate ? Object.values(state.tabs).filter(t => t.windowId === id) : undefined;
      return { ...state.win, id, tabs };
    },
    async getLastFocused(opts) {
      state.calls.push(["windows.getLastFocused", opts]);
      if (state.win instanceof Error) throw state.win;
      return state.win;
    },
    // state.all：windows.getAll 的结果；缺省只有 state.win（它是 Error 或缺失时为空）
    async getAll(opts) {
      state.calls.push(["windows.getAll", opts]);
      if (state.all) return state.all;
      return state.win && !(state.win instanceof Error) ? [state.win] : [];
    },
  },
  tabs: {
    onRemoved: event("tabs.onRemoved"),
    async get(id) {
      if (!state.tabs[id]) throw new Error(`No tab with id: ${id}.`);
      return state.tabs[id];
    },
    async query(q) {
      state.calls.push(["tabs.query", q]);
      return Object.values(state.tabs).filter(t =>
        q.splitViewId !== undefined ? t.splitViewId === q.splitViewId : t.active === q.active && t.windowId === q.windowId);
    },
    async update(id, props) {
      state.calls.push(["tabs.update", id, props]);
      if (state.updateFails) throw new Error("No tab with id: 11.");
      return { id, ...props };
    },
    // 有状态：带 splitWithTabId 时两个标签拿到同一个新 splitViewId，之后 tabs.get / tabs.query 都读得到
    async create(props) {
      state.calls.push(["tabs.create", props]);
      const tab = { id: state.nextId++, index: props.index, windowId: props.windowId, splitViewId: -1, active: props.active };
      if (props.splitWithTabId !== undefined) {
        tab.splitViewId = 42;
        state.tabs[props.splitWithTabId] = { ...state.tabs[props.splitWithTabId], splitViewId: 42 };
      }
      state.tabs[tab.id] = tab;
      return tab;
    },
  },
};
reset();
await import("../src/background.js");

// 监听器返回处理完成的 promise（其他命令名返回 undefined），直接等它
async function press(name = "cycle-right") {
  assert.equal(listeners["commands.onCommand"].length, 1);
  await listeners["commands.onCommand"][0](name);
}
const updates = () => state.calls.filter(c => c[0] === "tabs.update");

beforeEach((t) => {
  reset();
  t.mock.method(console, "error", () => {});
});

test("cycle-right：在本扩展分屏里把右侧换成下一个引擎（Bing 之后是 DuckDuckGo），记录跟着改", async () => {
  await press();
  assert.deepEqual(state.calls[0], ["windows.getLastFocused", { windowTypes: ["normal"], populate: true }]);
  assert.deepEqual(updates(), [["tabs.update", 11, { url: "https://duckduckgo.com/?q=" + encodeURIComponent(QUERY) }]]);
  assert.equal(state.session.get("split:11").engine, "ddg");
  assert.equal(state.session.get("split:10").engine, "google");
});

test("cycle-right：跳过 cycleExclude 里的引擎和当前左侧", async () => {
  state.sync = { cycleExclude: ["ddg", "perplexity"] };
  await press();
  assert.equal(updates()[0][2].url, "https://kagi.com/search?q=" + encodeURIComponent(QUERY));
});

test("cycle-right：除了右侧只剩当前左侧可轮换时什么都不做（不把右侧换成和左侧一样）", async () => {
  state.sync = { cycleExclude: ["ddg", "perplexity", "kagi"] };
  await press();
  assert.deepEqual(updates(), []);
  assert.equal(console.error.mock.callCount(), 0);
});

test("cycle-right：全部被排除时什么都不做，不报错", async () => {
  state.sync = { cycleExclude: ["google", "ddg", "perplexity", "kagi"] };
  await press();
  assert.deepEqual(updates(), []);
  assert.equal(console.error.mock.callCount(), 0);
});

test("cycle-right：记录里的右侧引擎已删除 → 第一个参与轮换的引擎", async () => {
  state.session.set("split:11", rec(10, "gone"));
  state.sync = { cycleExclude: ["google"] };
  await press();
  assert.equal(updates()[0][2].url, "https://www.bing.com/search?q=" + encodeURIComponent(QUERY));
});

test("cycle-right：不是本扩展的分屏（没有记录）什么都不做", async () => {
  state.session.clear();
  await press();
  assert.deepEqual(updates(), []);
  assert.equal(console.error.mock.callCount(), 0);
});

test("cycle-right：没有 normal 窗口或没有活动标签时直接返回", async () => {
  state.win = undefined;
  await press();
  reset({ tabs: {} });
  await press();
  assert.deepEqual(updates(), []);
  assert.equal(console.error.mock.callCount(), 0);
});

test("cycle-right：扩展 API 抛错时只记 [split-search] 日志，不抛出监听器", async () => {
  state.win = new Error("No last-focused window");
  await press();
  assert.equal(console.error.mock.callCount(), 1);
  assert.equal(console.error.mock.calls[0].arguments[0], "[split-search]");
});

test("其他命令名被忽略", async () => {
  await press("something-else");
  assert.deepEqual(state.calls, []);
});

test("有 action.default_popup 时 SW 不再监听 action.onClicked（点图标打开弹窗，设置页从弹窗进入）", () => {
  assert.equal(listeners["action.onClicked"], undefined);
});

test("cycle-right：换右侧时 tabs.update 抛错 → 只记 [split-search] 日志，不抛出监听器，记录不改", async () => {
  state.updateFails = true;
  await press();
  assert.equal(updates().length, 1);
  assert.equal(console.error.mock.callCount(), 1);
  assert.equal(console.error.mock.calls[0].arguments[0], "[split-search]");
  assert.equal(state.session.get("split:11").engine, "bing");
});

test("cycle-right：最后聚焦的是 PiP 时什么都不做：不读 PiP 的标签，也不去改看不见的其他窗口", async () => {
  const pip = { id: 9, type: "normal", alwaysOnTop: true, focused: true };
  state.win = pip;
  state.all = [pip, { id: 1, type: "normal", alwaysOnTop: false }];
  state.tabs[90] = { id: 90, index: 0, windowId: 9, splitViewId: -1, active: true };
  await press();
  assert.ok(!state.calls.some(c => c[0] === "tabs.query"));
  assert.ok(!state.calls.some(c => c[0] === "windows.getAll"));
  assert.deepEqual(updates(), []);
});

test("cycle-right：窗口管理器置顶的普通窗口（alwaysOnTop 但有两个标签）照常换右侧", async () => {
  state.win = { id: 1, type: "normal", alwaysOnTop: true, tabs: [L, R] };
  await press();
  assert.deepEqual(updates(), [["tabs.update", 11, { url: "https://duckduckgo.com/?q=" + encodeURIComponent(QUERY) }]]);
});

test("cycle-right：只有 PiP 时什么都不做", async () => {
  const pip = { id: 9, type: "normal", alwaysOnTop: true, focused: true };
  state.win = pip;
  state.all = [pip];
  state.tabs[90] = { id: 90, index: 0, windowId: 9, splitViewId: -1, active: true };
  await press();
  assert.ok(!state.calls.some(c => c[0] === "tabs.query"));
  assert.deepEqual(updates(), []);
});

test("cycle-right：图片查询对按以图搜图引擎轮换，不看 cycleExclude（含 bing-img 也照样换成它）", async () => {
  const IMG = "https://img.example.com/a%20b.png?x=1&y=2#f";
  const lookup = (peer, role, engine) => ({ peer, splitViewId: 7, mode: "split", role, input: "image", engine, query: IMG });
  const bingImg = IMAGE_CATALOG.find(e => e.id === "bing-img");
  state.session = new Map(Object.entries({ "split:10": lookup(11, "page", ""), "split:11": lookup(10, "lookup", "lens") }));
  state.sync = { imageEngines: [bingImg], cycleExclude: ["bing-img"] };
  await press();
  assert.deepEqual(updates(), [["tabs.update", 11, { url: expandTemplate(bingImg.url, IMG) }]]);
  assert.equal(state.session.get("split:11").engine, "bing-img");
  assert.equal(state.session.get("split:11").role, "lookup");
  assert.deepEqual(state.session.get("split:10"), lookup(11, "page", ""));
});

test("storage.onChanged（sync）任何变化都完整重建右键菜单", async () => {
  const done = () => state.menus.filter(c => c[0] === "create").length === 2;
  for (const fn of listeners["storage.onChanged"]) fn({ cycleExclude: { newValue: [] } }, "sync");
  for (let i = 0; i < 200 && !done(); i++) await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(state.menus, ["removeAll", ["create", "ss-lookup-text"], ["create", "ss-lookup-image"]]);
  assert.equal(console.error.mock.callCount(), 0);
});

test("storage.onChanged（session/local）不重建右键菜单", async () => {
  for (const fn of listeners["storage.onChanged"]) fn({ "split:10": { newValue: {} } }, "session");
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(state.menus, []);
});

test("onInstalled、onStartup 都重建右键菜单", async () => {
  const done = (n) => state.menus.filter(c => c === "removeAll").length === n
    && state.menus.filter(c => c[0] === "create").length === 2 * n;
  for (const fn of listeners["onInstalled"]) fn({ reason: "update" });
  for (let i = 0; i < 200 && !done(1); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(done(1), JSON.stringify(state.menus));
  for (const fn of listeners["onStartup"]) fn();
  for (let i = 0; i < 200 && !done(2); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(done(2), JSON.stringify(state.menus));
});

test("并发右键只建一对：同一个无记录标签连点两次，第二次在串行链上重新判定、就地更新查询标签", async () => {
  state.session.clear();
  state.win = { id: 1, type: "normal", width: 1200 };
  state.tabs[5] = { id: 5, index: 2, windowId: 1, splitViewId: -1 };
  const click = (text) => listeners["contextMenus.onClicked"][0]({ menuItemId: "ss-lookup-text", selectionText: text }, { ...state.tabs[5] });
  assert.equal(listeners["contextMenus.onClicked"].length, 1);
  const first = click("one");
  const second = click("two");
  await Promise.all([first, second]);
  const splits = state.calls.filter(c => c[0] === "tabs.create" && c[1].splitWithTabId !== undefined);
  assert.equal(splits.length, 1);
  assert.equal(state.calls.filter(c => c[0] === "tabs.create").length, 1);
  assert.deepEqual(updates(), [["tabs.update", 100, { url: "https://www.bing.com/search?q=two" }]]);
  assert.equal(state.session.get("split:5").query, "two");
  assert.equal(state.session.get("split:100").query, "two");
  assert.equal(console.error.mock.callCount(), 0);
});

test("右键处理抛错时只记 [split-search] 日志，不抛出监听器", async () => {
  state.tabs[5] = { id: 5, index: 2, windowId: 1, splitViewId: -1 };
  state.sync = null;
  await listeners["contextMenus.onClicked"][0]({ menuItemId: "ss-lookup-text", selectionText: "x" }, { ...state.tabs[5] });
  assert.equal(console.error.mock.callCount(), 1);
  assert.deepEqual(console.error.mock.calls[0].arguments.slice(0, 2), ["[split-search]", "lookup failed"]);
});

// runtime.onMessage：监听器返回 true，经 sendResponse 异步回复；回复在 sendResponse 被调用时才到
function message(msg, sender = { id: "x", url: "chrome-extension://x/popup/popup.html" }) {
  assert.equal(listeners["runtime.onMessage"].length, 1);
  let returned;
  const reply = new Promise((resolve) => { returned = listeners["runtime.onMessage"][0](msg, sender, resolve); });
  return { returned, reply };
}

test("complete-split：监听器返回 true，sendResponse 收到 handleCompleteMessage 的回复（建成分屏）", async () => {
  state.session.clear();
  state.win = { id: 1, type: "normal", width: 1200 };
  state.tabs[5] = { id: 5, index: 2, windowId: 1, splitViewId: -1, url: "https://www.google.com/search?q=hello" };
  const { returned, reply } = message({ type: "complete-split", tabId: 5, engineId: "bing" });
  assert.equal(returned, true);
  assert.deepEqual(await reply, { ok: true, mode: "split" });
  assert.deepEqual(state.calls.filter(c => c[0] === "tabs.create"), [["tabs.create",
    { url: "https://www.bing.com/search?q=hello", index: 3, windowId: 1, active: false, splitWithTabId: 5 }]]);
  assert.equal(state.session.get("split:5").engine, "google");
  assert.equal(state.session.get("split:100").engine, "bing");
  assert.deepEqual(updates(), []);
});

test("complete-split：被拒的消息照样经 sendResponse 回复错误码", async (t) => {
  t.mock.method(console, "info", () => {});
  const { returned, reply } = message({ type: "complete-split", tabId: 5, engineId: "bing" }, { id: "evil", url: "https://evil.example/" });
  assert.equal(returned, true);
  assert.deepEqual(await reply, { ok: false, code: "message_rejected" });
  assert.equal(console.error.mock.callCount(), 0);
});

test("complete-split：处理抛错时回 split_failed，并记 [split-search] 日志", async () => {
  state.sync = null;
  const { returned, reply } = message({ type: "complete-split", tabId: 5, engineId: "bing" });
  assert.equal(returned, true);
  assert.deepEqual(await reply, { ok: false, code: "split_failed" });
  assert.equal(console.error.mock.callCount(), 1);
  assert.equal(console.error.mock.calls[0].arguments[0], "[split-search]");
});
