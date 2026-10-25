import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleCompleteMessage } from "../src/chrome/complete-actions.js";
import { expandTemplate } from "../src/lib/trigger.js";
import { PRESETS } from "../src/lib/engines.js";

// 有状态的 chrome 桩：tabs、windows、storage.session 都在 state 里，调用按顺序记进 state.calls。
// tabs.create 带 splitWithTabId 时给两个标签同一个新 splitViewId（tabs.get / tabs.query 都读得到）。
// state.fail.splitWith 为 true 时带 splitWithTabId 的 tabs.create 抛错；state.getFails 为 true 时 tabs.get 抛 No tab with id。
let state;
const BING = PRESETS.find(e => e.id === "bing");
const RIGHT_URL = expandTemplate(BING.url, "hello");
const T = { id: 5, index: 1, windowId: 1, splitViewId: -1, url: "https://www.google.com/search?q=hello" };
const SENDER = { id: "x", url: "chrome-extension://x/popup/popup.html" };
const MSG = { type: "complete-split", tabId: 5, engineId: "bing" };

function reset({ tabs = [T], win = { type: "normal", width: 1200 }, session = {}, sync = {} } = {}) {
  state = {
    calls: [], fail: {}, sync, nextId: 100, nextSv: 50,
    session: new Map(Object.entries(session)),
    tabs: Object.fromEntries(tabs.map(t => [t.id, { ...t }])),
    windows: { 1: { id: 1, ...win } },
  };
}

globalThis.chrome = {
  runtime: { id: "x", getURL: (p) => `chrome-extension://x/${p}` },
  tabs: {
    async get(id) {
      state.calls.push(["tabs.get", id]);
      if (state.getFails || !state.tabs[id]) throw new Error(`No tab with id: ${id}.`);
      return { ...state.tabs[id] };
    },
    async query(q) {
      state.calls.push(["tabs.query", q]);
      return Object.values(state.tabs).filter(t => t.splitViewId === q.splitViewId).map(t => ({ ...t }));
    },
    async create(props) {
      state.calls.push(["tabs.create", props]);
      const tab = { id: state.nextId++, index: props.index ?? 0, windowId: props.windowId, splitViewId: -1, url: props.url };
      if (props.splitWithTabId !== undefined) {
        if (state.fail.splitWith) throw new Error("splitWithTabId failed");
        tab.splitViewId = state.nextSv;
        state.tabs[props.splitWithTabId].splitViewId = state.nextSv++;
      }
      state.tabs[tab.id] = tab;
      return { ...tab };
    },
    async update(id, props) {
      state.calls.push(["tabs.update", id, props]);
      return { ...state.tabs[id], ...props };
    },
  },
  windows: {
    async get(id, opts) {
      state.calls.push(["windows.get", id, opts]);
      const w = state.windows[id];
      if (!w) throw new Error(`No window with id: ${id}.`);
      return { ...w, tabs: opts?.populate ? Object.values(state.tabs).filter(t => t.windowId === id) : undefined };
    },
  },
  storage: {
    sync: { async get() { return state.sync; } },
    session: {
      async get(key) {
        const keys = [].concat(key);
        return Object.fromEntries(keys.filter(k => state.session.has(k)).map(k => [k, state.session.get(k)]));
      },
      async set(obj) { state.calls.push(["session.set", obj]); for (const [k, v] of Object.entries(obj)) state.session.set(k, v); },
      async remove(keys) { state.calls.push(["session.remove", keys]); for (const k of [].concat(keys)) state.session.delete(k); },
    },
  },
};

const named = (name) => state.calls.filter(c => c[0] === name);
const rec = (peer, engine, over = {}) => ({
  peer, splitViewId: 50, mode: "split", role: "search", engine, query: "hello", ...over,
});
// 拒绝时什么都不建、不写记录、不导航
function assertNothingDone() {
  assert.deepEqual(named("tabs.create"), []);
  assert.deepEqual(named("tabs.update"), []);
  assert.deepEqual(named("session.set"), []);
}

beforeEach((t) => {
  reset();
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "info", () => {});
});

test("合法消息 → 右侧在后台与当前标签组成分屏，两条 search 记录，当前标签不导航", async () => {
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: true, mode: "split" });
  assert.deepEqual(named("tabs.create"), [["tabs.create",
    { url: RIGHT_URL, index: 2, windowId: 1, active: false, splitWithTabId: 5 }]]);
  assert.deepEqual(state.session.get("split:5"), rec(100, "google"));
  assert.deepEqual(state.session.get("split:100"), rec(5, "bing"));
  assert.ok(!named("tabs.update").some(c => c[1] === 5));
  assert.deepEqual(named("windows.get")[0], ["windows.get", 1, { populate: true }]);
  assert.equal(console.error.mock.callCount(), 0);
  assert.equal(console.info.mock.callCount(), 0);
});

test("engineId 与识别出的引擎相同 → message_rejected，什么都不建", async () => {
  assert.deepEqual(await handleCompleteMessage({ ...MSG, engineId: "google" }, SENDER), { ok: false, code: "message_rejected" });
  assertNothingDone();
});

test("点按钮前标签已关掉或跨 origin 导航 → not_results_page，不建标签、不写记录", async () => {
  state.getFails = true;
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: false, code: "not_results_page" });
  assertNothingDone();

  reset({ tabs: [{ ...T, url: undefined }] });
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: false, code: "not_results_page" });
  assertNothingDone();

  reset({ tabs: [{ ...T, url: "https://example.com/" }] });
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: false, code: "not_results_page" });
  assertNothingDone();
});

test("标签已进了分屏 → not_results_page", async () => {
  reset({ tabs: [{ ...T, splitViewId: 3 }, { id: 6, index: 2, windowId: 1, splitViewId: 3 }] });
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: false, code: "not_results_page" });
  assertNothingDone();
});

test("当前标签已是本扩展的相邻对（own）→ not_results_page", async () => {
  reset({
    tabs: [T, { id: 6, index: 2, windowId: 1, splitViewId: -1 }],
    session: {
      "split:5": rec(6, "google", { splitViewId: -1, mode: "adjacent" }),
      "split:6": rec(5, "bing", { splitViewId: -1, mode: "adjacent" }),
    },
  });
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: false, code: "not_results_page" });
  assertNothingDone();
});

test("窗口是 popup 或 PiP（normal、alwaysOnTop、只有一个标签）→ window_unsupported", async () => {
  reset({ win: { type: "popup", width: 1200 } });
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: false, code: "window_unsupported" });
  assertNothingDone();

  reset({ win: { type: "normal", alwaysOnTop: true, width: 1200 } });
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: false, code: "window_unsupported" });
  assertNothingDone();
  assert.deepEqual(named("windows.get")[0], ["windows.get", 1, { populate: true }]);
});

test("窄窗口（宽 800，narrowFallback 缺省）→ adjacent：后台相邻标签，不带 splitWithTabId", async () => {
  reset({ win: { type: "normal", width: 800 } });
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: true, mode: "adjacent" });
  assert.deepEqual(named("tabs.create"), [["tabs.create", { url: RIGHT_URL, index: 2, windowId: 1, active: false }]]);
  assert.deepEqual(state.session.get("split:5"), rec(100, "google", { splitViewId: -1, mode: "adjacent" }));
  assert.deepEqual(state.session.get("split:100"), rec(5, "bing", { splitViewId: -1, mode: "adjacent" }));
});

test("splitWithTabId 抛错 → plain：留下普通相邻标签，不写记录", async () => {
  state.fail.splitWith = true;
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: true, mode: "plain" });
  assert.equal(named("tabs.create").length, 2);
  assert.deepEqual(named("tabs.create")[1], ["tabs.create", { url: RIGHT_URL, index: 2, windowId: 1, active: false }]);
  assert.deepEqual(named("session.set"), []);
});

test("右侧标签建不出来（tabs.create 都抛错）→ split_failed，记 error 日志", async () => {
  const orig = chrome.tabs.create;
  chrome.tabs.create = async (props) => { state.calls.push(["tabs.create", props]); throw new Error("boom"); };
  try {
    assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: false, code: "split_failed" });
    assert.deepEqual(named("session.set"), []);
    assert.ok(console.error.mock.callCount() >= 1);
    assert.equal(console.error.mock.calls.at(-1).arguments[0], "[split-search]");
  } finally {
    chrome.tabs.create = orig;
  }
});

test("发送方是设置页 → message_rejected，只记 info 级日志（不带网址和关键词）", async () => {
  const out = await handleCompleteMessage(MSG, { id: "x", url: "chrome-extension://x/options/options.html" });
  assert.deepEqual(out, { ok: false, code: "message_rejected" });
  assertNothingDone();
  assert.deepEqual(named("tabs.get"), []);
  assert.equal(console.error.mock.callCount(), 0);
  assert.deepEqual(console.info.mock.calls.map(c => c.arguments), [["[split-search]", "complete rejected", "message_rejected"]]);
});

test("预期的拒绝都只记一条 info，不带标签网址和关键词", async () => {
  reset({ tabs: [{ ...T, url: "https://example.com/" }] });
  await handleCompleteMessage(MSG, SENDER);
  reset({ win: { type: "popup", width: 1200 } });
  await handleCompleteMessage(MSG, SENDER);
  assert.deepEqual(console.info.mock.calls.map(c => c.arguments), [
    ["[split-search]", "complete rejected", "not_results_page"],
    ["[split-search]", "complete rejected", "window_unsupported"],
  ]);
  assert.equal(console.error.mock.callCount(), 0);
});

test("日志不带网址和关键词：tabs.create 抛出含网址的 Chrome 错误时，console.error 只收到清理过的文字", async (t) => {
  t.mock.method(chrome.tabs, "create", async (props) => {
    state.calls.push(["tabs.create", props]);
    throw new Error(`Invalid url: "${props.url}" hello`);
  });
  assert.deepEqual(await handleCompleteMessage(MSG, SENDER), { ok: false, code: "split_failed" });
  const logged = JSON.stringify(console.error.mock.calls.map(c => c.arguments));
  assert.ok(console.error.mock.callCount() >= 1);
  for (const leak of ["bing.com", "q=hello", RIGHT_URL]) assert.ok(!logged.includes(leak), leak);
  for (const c of console.error.mock.calls) assert.ok(c.arguments.every(a => typeof a !== "object"));
});
