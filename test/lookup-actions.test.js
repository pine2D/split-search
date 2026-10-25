import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleMenuClick } from "../src/chrome/lookup-actions.js";
import { expandTemplate } from "../src/lib/trigger.js";
import { PRESETS } from "../src/lib/engines.js";
import { IMAGE_PRESET } from "../src/lib/image-engines.js";

// 有状态的 chrome 桩：tabs、windows、storage.session 都在 state 里，调用按顺序记进 state.calls。
// tabs.create 带 splitWithTabId 时给两个标签同一个新 splitViewId（tabs.query 查得到）；createSplit 同样。
// state.fail.<name> 为 true 时对应调用抛错；fail.confirm 为 true 时 createSplit 成功但不改 splitViewId（复核不一致）。
let state;
const BING = PRESETS.find(e => e.id === "bing");
const TEXT = "hi there";
const TEXT_URL = expandTemplate(BING.url, TEXT);
const SRC = "https://img.example.com/a%20b.png?x=1&y=2#f";
const LENS_URL = expandTemplate(IMAGE_PRESET.url, SRC);
const textInfo = { menuItemId: "ss-lookup-text", selectionText: "  hi\n there " };
const imageInfo = { menuItemId: "ss-lookup-image", mediaType: "image", srcUrl: SRC };
const T = { id: 5, index: 2, windowId: 1, splitViewId: -1 };

function reset({ tabs = [T], width = 1200, session = {}, sync = {} } = {}) {
  state = {
    calls: [], fail: {}, sync, nextId: 100, nextSv: 50,
    session: new Map(Object.entries(session)),
    tabs: Object.fromEntries(tabs.map(t => [t.id, { ...t }])),
    windows: { 1: { id: 1, type: "normal", width } },
    lastFocused: undefined, all: undefined,
  };
}
const boom = (name, msg = `${name} failed`) => { if (state.fail[name]) throw new Error(msg); };
const winTabs = (wid) => Object.values(state.tabs).filter(t => t.windowId === wid);

globalThis.chrome = {
  tabs: {
    async get(id) {
      state.calls.push(["tabs.get", id]);
      if (!state.tabs[id]) throw new Error(`No tab with id: ${id}.`);
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
        boom("splitWith");
        tab.splitViewId = state.nextSv;
        state.tabs[props.splitWithTabId].splitViewId = state.nextSv++;
      }
      state.tabs[tab.id] = tab;
      return { ...tab };
    },
    async update(id, props) {
      state.calls.push(["tabs.update", id, props]);
      boom("update", `No tab with id: ${id}.`);
      if (!state.tabs[id]) throw new Error(`No tab with id: ${id}.`);
      Object.assign(state.tabs[id], props.url === undefined ? {} : { url: props.url });
      return { ...state.tabs[id] };
    },
    async createSplit(ids) {
      state.calls.push(["tabs.createSplit", ids]);
      boom("createSplit");
      if (!state.fail.confirm) for (const id of ids) state.tabs[id].splitViewId = state.nextSv;
      return state.nextSv++;
    },
  },
  windows: {
    async get(id, opts) {
      state.calls.push(["windows.get", id, opts]);
      const w = state.windows[id];
      if (!w) throw new Error(`No window with id: ${id}.`);
      return { ...w, tabs: opts?.populate ? winTabs(id) : undefined };
    },
    async getLastFocused(opts) {
      state.calls.push(["windows.getLastFocused", opts]);
      return state.lastFocused;
    },
    async getAll(opts) {
      state.calls.push(["windows.getAll", opts]);
      return state.all ?? [];
    },
    async create(props) {
      state.calls.push(["windows.create", props]);
      return { id: 8, width: 1400, tabs: [{ id: 80, index: 0, windowId: 8 }] };
    },
    async update(id, props) { state.calls.push(["windows.update", id, props]); },
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
const writes = () => state.calls.filter(c => ["tabs.create", "tabs.update", "tabs.createSplit", "windows.create",
  "windows.update", "session.set", "session.remove"].includes(c[0]));
const rec = (peer, role, over = {}) => ({
  peer, splitViewId: 9, mode: "split", role, input: "text", engine: role === "page" ? "" : "bing", query: TEXT, ...over,
});

beforeEach((t) => {
  reset();
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "info", () => {});
});

test("无记录、宽窗口 → 新标签与 T 组成分屏（后台），写 page/lookup 记录", async () => {
  const out = await handleMenuClick(textInfo, T);
  assert.deepEqual(out, { action: "new" });
  assert.deepEqual(named("tabs.create"), [["tabs.create",
    { url: TEXT_URL, index: 3, windowId: 1, active: false, splitWithTabId: 5 }]]);
  assert.deepEqual(state.session.get("split:5"), rec(100, "page", { splitViewId: 50 }));
  assert.deepEqual(state.session.get("split:100"), rec(5, "lookup", { splitViewId: 50 }));
  assert.deepEqual(named("windows.get")[0], ["windows.get", 1, { populate: true }]);
  assert.equal(console.error.mock.callCount(), 0);
});

test("窄窗口 → 相邻标签并激活，不带 splitWithTabId，记 adjacent", async () => {
  reset({ width: 800 });
  await handleMenuClick(textInfo, T);
  assert.deepEqual(named("tabs.create"), [["tabs.create", { url: TEXT_URL, index: 3, windowId: 1, active: true }]]);
  assert.deepEqual(state.session.get("split:5"), rec(100, "page", { splitViewId: -1, mode: "adjacent" }));
  assert.deepEqual(state.session.get("split:100"), rec(5, "lookup", { splitViewId: -1, mode: "adjacent" }));
});

const splitPair = () => reset({
  tabs: [{ ...T, splitViewId: 9 }, { id: 6, index: 3, windowId: 1, splitViewId: 9 }],
  session: { "split:5": rec(6, "page"), "split:6": rec(5, "lookup") },
});

test("第 3 行：page/lookup 分屏里再点图片 → 就地更新查询标签（不传 active），整对改成 image", async () => {
  splitPair();
  const out = await handleMenuClick(imageInfo, { ...T, splitViewId: 9 });
  assert.deepEqual(out, { action: "reuse-split" });
  assert.deepEqual(named("tabs.update"), [["tabs.update", 6, { url: LENS_URL }]]);
  assert.ok(!("active" in named("tabs.update")[0][2]));
  assert.equal(named("tabs.create").length, 0);
  const img = { input: "image", query: SRC };
  assert.deepEqual(state.session.get("split:5"), rec(6, "page", img));
  assert.deepEqual(state.session.get("split:6"), rec(5, "lookup", { ...img, engine: "lens" }));
});

test("第 3 行：tabs.update 抛 No tab with id → 退回新建", async () => {
  splitPair();
  state.fail.update = true;
  const out = await handleMenuClick(imageInfo, { ...T, splitViewId: 9 });
  assert.equal(out.action, "reuse-split");
  assert.equal(named("tabs.create").length, 1);
  assert.equal(named("tabs.create")[0][1].url, LENS_URL);
  // 新的一对写成 page ↔ lookup，旧查询标签的记录一并清掉，不留指向 T 的孤立记录
  const img = { splitViewId: 50, input: "image", query: SRC };
  assert.deepEqual(state.session.get("split:5"), rec(100, "page", img));
  assert.deepEqual(state.session.get("split:100"), rec(5, "lookup", { ...img, engine: "lens" }));
  assert.equal(state.session.has("split:6"), false);
});

test("第 4 行：T 是搜索对的左侧（分屏中、own、search）→ 分屏右边开普通标签，不改任何标签和记录", async () => {
  const search = (peer, engine) => ({ peer, splitViewId: 9, mode: "split", role: "search", engine, query: "q" });
  reset({
    tabs: [{ ...T, splitViewId: 9 }, { id: 6, index: 3, windowId: 1, splitViewId: 9 }],
    session: { "split:5": search(6, "google"), "split:6": search(5, "bing") },
  });
  const before = new Map(state.session);
  const out = await handleMenuClick(textInfo, { ...T, splitViewId: 9 });
  assert.deepEqual(out, { action: "beside-split" });
  assert.deepEqual(writes(), [["tabs.create", { url: TEXT_URL, index: 4, windowId: 1, active: true }]]);
  assert.deepEqual(state.session, before);
});

test("窗口是 popup → 最后聚焦的 normal 窗口里开普通标签并聚焦，不写记录、不调分屏 API", async () => {
  state.windows[1].type = "popup";
  state.lastFocused = { id: 3, type: "normal", tabs: [{ id: 30 }, { id: 31 }] };
  const out = await handleMenuClick(textInfo, T);
  assert.deepEqual(out, { action: "other-window" });
  assert.deepEqual(writes(), [
    ["tabs.create", { url: TEXT_URL, windowId: 3, active: true }],
    ["windows.update", 3, { focused: true }],
  ]);
});

test("窗口是 popup、没有能分屏的窗口 → 新建 normal 窗口打开结果", async () => {
  state.windows[1].type = "popup";
  const out = await handleMenuClick(textInfo, T);
  assert.deepEqual(out, { action: "other-window" });
  assert.deepEqual(writes(), [["windows.create", { type: "normal", url: TEXT_URL }]]);
});

test("PiP（normal + alwaysOnTop、只有一个标签）且最后聚焦的也是它 → 开到普通窗口 1，全程不调分屏 API", async () => {
  const pipTab = { id: 90, index: 0, windowId: 9, splitViewId: -1 };
  reset({ tabs: [pipTab, { id: 20, index: 0, windowId: 1, splitViewId: -1 }, { id: 21, index: 1, windowId: 1, splitViewId: -1 }] });
  const pip = { id: 9, type: "normal", alwaysOnTop: true, tabs: [pipTab] };
  state.windows[9] = { id: 9, type: "normal", alwaysOnTop: true };
  state.lastFocused = pip;
  state.all = [pip, { id: 1, type: "normal", width: 1200, tabs: winTabs(1) }];
  const out = await handleMenuClick(textInfo, pipTab);
  assert.deepEqual(out, { action: "other-window" });
  assert.deepEqual(named("tabs.create"), [["tabs.create", { url: TEXT_URL, windowId: 1, active: true }]]);
  assert.equal(named("tabs.createSplit").length, 0);
  assert.equal(state.session.size, 0);
});

const adjacentPair = (width) => reset({
  width,
  tabs: [T, { id: 6, index: 3, windowId: 1, splitViewId: -1 }],
  session: {
    "split:5": rec(6, "page", { splitViewId: -1, mode: "adjacent" }),
    "split:6": rec(5, "lookup", { splitViewId: -1, mode: "adjacent" }),
  },
});
const NEW = "new words";
const NEW_URL = expandTemplate(BING.url, NEW);
const newInfo = { menuItemId: "ss-lookup-text", selectionText: NEW };

test("第 5 行：相邻 page/lookup、窗口仍窄 → 更新查询标签并激活，记 adjacent，不拼分屏", async () => {
  adjacentPair(800);
  const out = await handleMenuClick(newInfo, T);
  assert.deepEqual(out, { action: "reuse-adjacent" });
  assert.deepEqual(named("tabs.update"), [["tabs.update", 6, { url: NEW_URL, active: true }]]);
  assert.equal(named("tabs.createSplit").length, 0);
  const adj = { splitViewId: -1, mode: "adjacent", query: NEW };
  assert.deepEqual(state.session.get("split:5"), rec(6, "page", adj));
  assert.deepEqual(state.session.get("split:6"), rec(5, "lookup", adj));
});

test("第 5 行：tabs.update 抛错 → 退回新建", async () => {
  adjacentPair(800);
  state.fail.update = true;
  await handleMenuClick(newInfo, T);
  assert.deepEqual(named("tabs.create"), [["tabs.create", { url: NEW_URL, index: 3, windowId: 1, active: true }]]);
});

test("第 6 行 join：相邻 page/lookup、窗口变宽 → createSplit([左, 右])，复核一致后记 split", async () => {
  adjacentPair(1200);
  const out = await handleMenuClick(newInfo, T);
  assert.deepEqual(out, { action: "join" });
  assert.deepEqual(named("tabs.update"), [["tabs.update", 6, { url: NEW_URL }]]);
  assert.deepEqual(named("tabs.createSplit"), [["tabs.createSplit", [5, 6]]]);
  assert.deepEqual(state.session.get("split:5"), rec(6, "page", { splitViewId: 50, query: NEW }));
  assert.deepEqual(state.session.get("split:6"), rec(5, "lookup", { splitViewId: 50, query: NEW }));
});

test("第 6 行 join：第一次 tabs.update 抛错 → 退回新建（宽窗口拼成分屏），不调 createSplit，不留孤立记录", async () => {
  adjacentPair(1200);
  state.fail.update = true;
  const out = await handleMenuClick(newInfo, T);
  assert.deepEqual(out, { action: "join" });
  assert.deepEqual(named("tabs.create"), [["tabs.create",
    { url: NEW_URL, index: 3, windowId: 1, active: false, splitWithTabId: 5 }]]);
  assert.equal(named("tabs.createSplit").length, 0);
  assert.deepEqual(state.session.get("split:5"), rec(100, "page", { splitViewId: 50, query: NEW }));
  assert.deepEqual(state.session.get("split:100"), rec(5, "lookup", { splitViewId: 50, query: NEW }));
  assert.equal(state.session.has("split:6"), false);
});

test("第 6 行 join：T 在右边时 createSplit 仍按 [左, 右] 传", async () => {
  reset({
    tabs: [{ ...T, index: 4 }, { id: 6, index: 3, windowId: 1, splitViewId: -1 }],
    session: {
      "split:5": rec(6, "page", { splitViewId: -1, mode: "adjacent" }),
      "split:6": rec(5, "lookup", { splitViewId: -1, mode: "adjacent" }),
    },
  });
  await handleMenuClick(newInfo, { ...T, index: 4 });
  assert.deepEqual(named("tabs.createSplit"), [["tabs.createSplit", [6, 5]]]);
});

test("第 6 行 join：createSplit 抛错 → 激活查询标签、记 adjacent", async () => {
  adjacentPair(1200);
  state.fail.createSplit = true;
  await handleMenuClick(newInfo, T);
  assert.deepEqual(named("tabs.update"), [
    ["tabs.update", 6, { url: NEW_URL }],
    ["tabs.update", 6, { active: true }],
  ]);
  const adj = { splitViewId: -1, mode: "adjacent", query: NEW };
  assert.deepEqual(state.session.get("split:5"), rec(6, "page", adj));
  assert.deepEqual(state.session.get("split:6"), rec(5, "lookup", adj));
});

test("第 6 行 join：createSplit 成功但复核两次都不一致 → 清掉这一对的记录，不写 adjacent", async () => {
  adjacentPair(1200);
  state.fail.confirm = true;
  await handleMenuClick(newInfo, T);
  assert.equal(state.session.has("split:5"), false);
  assert.equal(state.session.has("split:6"), false);
  assert.equal(named("session.set").length, 0);
});

test("第 7 行：T 是相邻对的 lookup 一侧 → 这一对右边开普通标签，不改记录", async () => {
  reset({
    tabs: [T, { id: 6, index: 3, windowId: 1, splitViewId: -1 }],
    session: {
      "split:6": rec(5, "page", { splitViewId: -1, mode: "adjacent" }),
      "split:5": rec(6, "lookup", { splitViewId: -1, mode: "adjacent" }),
    },
  });
  const before = new Map(state.session);
  const out = await handleMenuClick(textInfo, T);
  assert.deepEqual(out, { action: "beside-pair" });
  assert.deepEqual(writes(), [["tabs.create", { url: TEXT_URL, index: 4, windowId: 1, active: true }]]);
  assert.deepEqual(state.session, before);
});

test("editable、tab 缺失、标签已关闭 → ignore，不写任何东西；console.info 只收到 reason", async () => {
  const cases = [
    [{ ...textInfo, editable: true }, T, "editable"],
    [textInfo, undefined, "no_tab"],
    [textInfo, { ...T, id: -1 }, "no_tab"],
    [textInfo, { ...T, id: 77 }, "tab_gone"],
  ];
  for (const [info, tab, reason] of cases) {
    reset();
    console.info.mock.resetCalls();
    assert.deepEqual(await handleMenuClick(info, tab), { action: "ignore" });
    assert.deepEqual(writes(), []);
    assert.deepEqual(console.info.mock.calls.map(c => c.arguments), [["[split-search]", "lookup ignored", reason]]);
    assert.ok(!JSON.stringify(console.info.mock.calls.map(c => c.arguments)).includes("there"));
  }
  assert.equal(console.error.mock.callCount(), 0);
});

test("读 pageUrl/frameUrl 就抛的 info 照样走完 new 路径", async () => {
  const info = new Proxy(textInfo, {
    get(t, k) { if (k === "pageUrl" || k === "frameUrl") throw new Error(String(k)); return t[k]; },
  });
  assert.deepEqual(await handleMenuClick(info, T), { action: "new" });
  assert.equal(named("tabs.create").length, 1);
});

