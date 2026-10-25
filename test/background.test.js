import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// 整个 SW 只导入一次：监听器在导入时注册，之后各测试改 state 再触发监听器。
const listeners = {};
const event = (name) => ({ addListener: (fn) => { (listeners[name] ||= []).push(fn); } });
let state;
const QUERY = "a&b #c+d 中文 😀";
const rec = (peer, engine) => ({ peer, splitViewId: 7, mode: "split", engine, query: QUERY });
const L = { id: 10, index: 0, windowId: 1, splitViewId: 7, active: false };
const R = { id: 11, index: 1, windowId: 1, splitViewId: 7, active: true };

function reset(over = {}) {
  state = {
    calls: [],
    sync: {},
    session: new Map(Object.entries({ "split:10": rec(11, "google"), "split:11": rec(10, "bing") })),
    tabs: { 10: L, 11: R },
    win: { id: 1, type: "normal" },
    ...over,
  };
}

globalThis.chrome = {
  runtime: { id: "x", onInstalled: event("onInstalled"), onStartup: event("onStartup"), openOptionsPage() {} },
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

test("cycle-right：跳过 cycleExclude 里的引擎；可以与左侧相同", async () => {
  state.sync = { cycleExclude: ["ddg", "perplexity", "kagi"] };
  await press();
  assert.equal(updates()[0][2].url, "https://www.google.com/search?q=" + encodeURIComponent(QUERY));
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
