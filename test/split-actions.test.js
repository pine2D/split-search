import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS, createPaired, openNew, reuse, openForeign, openInOtherWindow, leaveTab,
} from "../src/chrome/split-actions.js";

// 最小 chrome 桩：按顺序记录调用。fail.<name> 为 true 时对应调用抛错；
// fail.create 也可以是 (props, n) => boolean，n 为第几次 tabs.create（从 1 开始）。
// extra.newSplitViewId / extra.getSplitViewId：新分屏标签与复核时读到的 splitViewId（默认都是 55）。
let calls;
function installChrome(fail = {}, extra = {}) {
  calls = [];
  let nextId = 100;
  let creates = 0;
  const check = (name) => { if (fail[name] === true) throw new Error(`${name} failed`); };
  globalThis.chrome = {
    tabs: {
      async create(props) {
        calls.push(["tabs.create", props]);
        creates++;
        if (typeof fail.create === "function" && fail.create(props, creates)) throw new Error("create failed");
        if (props.splitWithTabId === undefined) return { id: nextId++, index: props.index ?? 0, windowId: props.windowId, splitViewId: -1 };
        check("createSplit");
        return { id: nextId++, index: props.index ?? 0, windowId: props.windowId, splitViewId: extra.newSplitViewId ?? 55 };
      },
      // 复核用：返回 withTab 当前的 splitViewId，默认与新标签一致
      async get(id) {
        calls.push(["tabs.get", id]);
        check("get");
        return { id, splitViewId: extra.getSplitViewId ?? 55 };
      },
      async update(id, props) { calls.push(["tabs.update", id, props]); check("update"); },
      async remove(id) { calls.push(["tabs.remove", id]); check("remove"); },
    },
    windows: {
      async getLastFocused(opts) {
        calls.push(["windows.getLastFocused", opts]);
        check("getLastFocused");
        return extra.lastFocused ?? { id: 7 };
      },
      async create(props) {
        calls.push(["windows.create", props]);
        return { id: 8, tabs: [{ id: 50, index: 0, windowId: 8 }] };
      },
      async update(id, props) { calls.push(["windows.update", id, props]); check("focus"); },
    },
    storage: { session: { async set(obj) { calls.push(["session.set", obj]); check("session"); } } },
  };
}
const names = () => calls.map(c => c[0]);
const L = "https://kagi.com/search?q=x";
const R = "https://www.google.com/search?q=x";
const ids = { leftId: "kagi", rightId: "google", query: "x", narrowEnabled: false };
const rec = (peer, engine, over = {}) => ({ peer, splitViewId: 55, mode: "split", engine, query: "x", ...over });

beforeEach((t) => {
  installChrome();
  t.mock.method(console, "error", () => {});
});

test("ACTIONS 覆盖 decideSplit 的四种结果", () => {
  assert.deepEqual(Object.keys(ACTIONS).sort(), ["foreign", "new", "other-window", "reuse"]);
});

test("new：右侧新建并与当前标签分屏，复核后写两条 split 记录，当前标签打开左侧", async () => {
  const out = await openNew({ tab: { id: 1, index: 3, windowId: 9 }, leftUrl: L, rightUrl: R, ...ids });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["tabs.create", { url: R, index: 4, windowId: 9, active: false, splitWithTabId: 1 }],
    ["tabs.get", 1],
    ["session.set", { "split:1": rec(100, "kagi"), "split:100": rec(1, "google") }],
  ]);
});

test("new：splitWithTabId 抛错退化为普通标签时不写记录", async () => {
  installChrome({ createSplit: true });
  const out = await openNew({ tab: { id: 1, index: 3, windowId: 9 }, leftUrl: L, rightUrl: R, ...ids });
  assert.deepEqual(out, { replaceWith: L });
  assert.equal(names().filter(n => n === "tabs.create").length, 2);
  assert.ok(!names().includes("session.set"));
});

test("new：复核读到当前标签不在分屏中（-1）时不写记录", async () => {
  installChrome({}, { getSplitViewId: -1 });
  await openNew({ tab: { id: 1, index: 3, windowId: 9 }, leftUrl: L, rightUrl: R, ...ids });
  assert.ok(!names().includes("session.set"));
});

test("createPaired：复核时 tabs.get 返回 splitViewId -1 → 返回 splitViewId -1", async () => {
  installChrome({}, { getSplitViewId: -1 });
  const res = await createPaired(R, { id: 1, index: 3, windowId: 9 });
  assert.equal(res.tab.id, 100);
  assert.equal(res.splitViewId, -1);
});

test("createPaired：新标签与当前标签 splitViewId 不同、或新标签为 -1 → 返回 -1", async () => {
  installChrome({}, { newSplitViewId: 55, getSplitViewId: 56 });
  assert.equal((await createPaired(R, { id: 1, index: 3, windowId: 9 })).splitViewId, -1);
  installChrome({}, { newSplitViewId: -1, getSplitViewId: -1 });
  assert.equal((await createPaired(R, { id: 1, index: 3, windowId: 9 })).splitViewId, -1);
});

test("createPaired：复核时 tabs.get 抛错 → 返回 -1，不抛", async () => {
  installChrome({ get: true });
  const res = await createPaired(R, { id: 1, index: 3, windowId: 9 });
  assert.equal(res.tab.id, 100);
  assert.equal(res.splitViewId, -1);
});

test("createPaired：复核一致时返回该 splitViewId", async () => {
  assert.deepEqual(await createPaired(R, { id: 1, index: 3, windowId: 9 }), {
    tab: { id: 100, index: 4, windowId: 9, splitViewId: 55 }, splitViewId: 55,
  });
});

test("createPaired：split 为 false 时不传 splitWithTabId，也不复核", async () => {
  const res = await createPaired(R, { id: 1, index: 3, windowId: 9 }, { split: false });
  assert.equal(res.splitViewId, -1);
  assert.deepEqual(calls, [["tabs.create", { url: R, index: 4, windowId: 9, active: false }]]);
});

test("createPaired：splitWithTabId 抛错时退化为相邻的普通标签", async () => {
  installChrome({ createSplit: true });
  const res = await createPaired(R, { id: 1, index: 3, windowId: 9 });
  assert.equal(res.tab.id, 100);
  assert.equal(res.splitViewId, -1);
  assert.deepEqual(calls, [
    ["tabs.create", { url: R, index: 4, windowId: 9, active: false, splitWithTabId: 1 }],
    ["tabs.create", { url: R, index: 4, windowId: 9, active: false }],
  ]);
});

test("reuse：当前在左侧时另一侧更新为右侧，左右不对调", async () => {
  const out = await reuse({
    tab: { id: 1, index: 3 }, peer: { id: 2, index: 4 }, splitViewId: 55, leftUrl: L, rightUrl: R, ...ids,
  });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["tabs.update", 2, { url: R }],
    ["session.set", { "split:1": rec(2, "kagi"), "split:2": rec(1, "google") }],
  ]);
  assert.ok(!names().includes("tabs.create"));
});

test("reuse：当前在右侧时另一侧拿左侧，记录里对侧是 leftId、当前是 rightId", async () => {
  const out = await reuse({
    tab: { id: 1, index: 5 }, peer: { id: 2, index: 4 }, splitViewId: 55, leftUrl: L, rightUrl: R, ...ids,
  });
  assert.deepEqual(out, { replaceWith: R });
  assert.deepEqual(calls, [
    ["tabs.update", 2, { url: L }],
    ["session.set", { "split:1": rec(2, "google"), "split:2": rec(1, "kagi") }],
  ]);
});

test("reuse：相邻对（不在分屏中）写 adjacent 记录，splitViewId 为 -1", async () => {
  await reuse({
    tab: { id: 1, index: 3 }, peer: { id: 2, index: 4 }, splitViewId: -1, leftUrl: L, rightUrl: R, ...ids,
  });
  const adj = { mode: "adjacent", splitViewId: -1 };
  assert.deepEqual(calls[1], ["session.set", { "split:1": rec(2, "kagi", adj), "split:2": rec(1, "google", adj) }]);
});

test("foreign：在原分屏右侧新建一对并记录，再离开当前标签（history.back）", async () => {
  const tab = { id: 1, index: 2, windowId: 9 };
  const splitTabs = [tab, { id: 2, index: 3, windowId: 9 }];
  const out = await openForeign({ tab, splitTabs, leftUrl: L, rightUrl: R, ...ids });
  assert.deepEqual(out, { leave: true });
  const hist = { length: 2, back: () => calls.push(["history.back"]) };
  assert.equal(await leaveTab(tab, hist), "back");
  assert.deepEqual(calls, [
    ["tabs.create", { url: L, index: 4, windowId: 9, active: true }],
    ["tabs.create", { url: R, index: 5, windowId: 9, active: false, splitWithTabId: 100 }],
    ["tabs.get", 100],
    ["session.set", { "split:100": rec(101, "kagi"), "split:101": rec(100, "google") }],
    ["history.back"],
  ]);
});

test("foreign：右侧退化为普通标签时不写记录", async () => {
  installChrome({ createSplit: true });
  const tab = { id: 1, index: 2, windowId: 9 };
  await openForeign({ tab, splitTabs: [tab, { id: 2, index: 3 }], leftUrl: L, rightUrl: R, ...ids });
  assert.ok(!names().includes("session.set"));
});

test("leaveTab：没有历史时关闭当前标签", async () => {
  const hist = { length: 1, back: () => assert.fail("不应后退") };
  assert.equal(await leaveTab({ id: 1 }, hist), "closed");
  assert.deepEqual(calls, [["tabs.remove", 1]]);
});

test("leaveTab：关闭失败时保留本页", async () => {
  installChrome({ remove: true });
  assert.equal(await leaveTab({ id: 1 }, { length: 1, back() {} }), "kept");
});

test("foreign：右侧两次创建都失败时不抛错，也不再打开第二个左侧", async () => {
  // 第一次（左侧）成功；之后带 splitWithTabId 的创建和降级的普通创建都失败
  installChrome({ create: (_props, n) => n >= 2 });
  const tab = { id: 1, index: 2, windowId: 9 };
  const out = await openForeign({ tab, splitTabs: [tab, { id: 2, index: 3 }], leftUrl: L, rightUrl: R, ...ids });
  assert.deepEqual(out, { leave: true });
  const creates = calls.filter(c => c[0] === "tabs.create");
  assert.equal(creates.length, 3);
  assert.equal(creates.filter(c => c[1].url === L).length, 1);
  assert.ok(!names().includes("session.set"));
});

test("other-window：在已有的普通窗口建一对、记录后把该窗口切到前台", async () => {
  installChrome({}, { lastFocused: { id: 7 } });
  const out = await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["windows.getLastFocused", { windowTypes: ["normal"] }],
    ["tabs.create", { url: L, windowId: 7, active: true }],
    ["tabs.create", { url: R, index: 1, windowId: 7, active: false, splitWithTabId: 100 }],
    ["tabs.get", 100],
    ["session.set", { "split:100": rec(101, "kagi"), "split:101": rec(100, "google") }],
    ["windows.update", 7, { focused: true }],
  ]);
});

test("other-window：切前台失败只记录，不影响结果", async () => {
  installChrome({ focus: true }, { lastFocused: { id: 7 } });
  assert.deepEqual(await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids }), { replaceWith: L });
  assert.ok(names().includes("windows.update"));
});

test("other-window：没有普通窗口时新建窗口，不再额外切前台", async () => {
  installChrome({ getLastFocused: true });
  const out = await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["windows.getLastFocused", { windowTypes: ["normal"] }],
    ["windows.create", { type: "normal", url: L }],
    ["tabs.create", { url: R, index: 1, windowId: 8, active: false, splitWithTabId: 50 }],
    ["tabs.get", 50],
    ["session.set", { "split:50": rec(100, "kagi"), "split:100": rec(50, "google") }],
  ]);
});

test("other-window：复核失败（-1）时不写记录", async () => {
  installChrome({}, { lastFocused: { id: 7 }, getSplitViewId: -1 });
  await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids });
  assert.ok(!names().includes("session.set"));
});
