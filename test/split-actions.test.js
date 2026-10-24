import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS, createPaired, openNew, reuse, openForeign, openInOtherWindow, leaveTab,
} from "../src/chrome/split-actions.js";

// 最小 chrome 桩：按顺序记录调用。fail.<name> 为 true 时对应调用抛错；
// fail.create 也可以是 (props, n) => boolean，n 为第几次 tabs.create（从 1 开始）。
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
        if (props.splitWithTabId !== undefined) check("createSplit");
        return { id: nextId++, index: props.index ?? 0, windowId: props.windowId };
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

beforeEach((t) => {
  installChrome();
  t.mock.method(console, "error", () => {});
});

test("ACTIONS 覆盖 decideSplit 的四种结果", () => {
  assert.deepEqual(Object.keys(ACTIONS).sort(), ["foreign", "new", "other-window", "reuse"]);
});

test("new：右侧新建并与当前标签分屏，记录标签对，当前标签打开左侧", async () => {
  const out = await openNew({ tab: { id: 1, index: 3, windowId: 9 }, leftUrl: L, rightUrl: R });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["tabs.create", { url: R, index: 4, windowId: 9, active: false, splitWithTabId: 1 }],
    ["session.set", { "split:1": 100, "split:100": 1 }],
  ]);
});

test("reuse：当前在左侧时另一侧更新为右侧，左右不对调", async () => {
  const out = await reuse({ tab: { id: 1, index: 3 }, peer: { id: 2, index: 4 }, leftUrl: L, rightUrl: R });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls[0], ["tabs.update", 2, { url: R }]);
  assert.ok(!names().includes("tabs.create"));
});

test("reuse：当前在右侧时另一侧更新为左侧，当前标签打开右侧", async () => {
  const out = await reuse({ tab: { id: 1, index: 5 }, peer: { id: 2, index: 4 }, leftUrl: L, rightUrl: R });
  assert.deepEqual(out, { replaceWith: R });
  assert.deepEqual(calls[0], ["tabs.update", 2, { url: L }]);
  assert.deepEqual(calls[1], ["session.set", { "split:1": 2, "split:2": 1 }]);
});

test("foreign：在原分屏右侧新建一对，再离开当前标签（history.back）", async () => {
  const tab = { id: 1, index: 2, windowId: 9 };
  const splitTabs = [tab, { id: 2, index: 3, windowId: 9 }];
  const out = await openForeign({ tab, splitTabs, leftUrl: L, rightUrl: R });
  assert.deepEqual(out, { leave: true });
  const hist = { length: 2, back: () => calls.push(["history.back"]) };
  assert.equal(await leaveTab(tab, hist), "back");
  assert.deepEqual(calls, [
    ["tabs.create", { url: L, index: 4, windowId: 9, active: true }],
    ["tabs.create", { url: R, index: 5, windowId: 9, active: false, splitWithTabId: 100 }],
    ["session.set", { "split:100": 101, "split:101": 100 }],
    ["history.back"],
  ]);
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
  const out = await openForeign({ tab, splitTabs: [tab, { id: 2, index: 3 }], leftUrl: L, rightUrl: R });
  assert.deepEqual(out, { leave: true });
  const creates = calls.filter(c => c[0] === "tabs.create");
  assert.equal(creates.length, 3);
  assert.equal(creates.filter(c => c[1].url === L).length, 1);
  assert.ok(!names().includes("session.set"));
});

test("createPaired：splitWithTabId 抛错时退化为相邻的普通标签", async () => {
  installChrome({ createSplit: true });
  const right = await createPaired(R, { id: 1, index: 3, windowId: 9 });
  assert.equal(right.id, 100);
  assert.deepEqual(calls, [
    ["tabs.create", { url: R, index: 4, windowId: 9, active: false, splitWithTabId: 1 }],
    ["tabs.create", { url: R, index: 4, windowId: 9, active: false }],
  ]);
});

test("other-window：在已有的普通窗口建一对后把该窗口切到前台", async () => {
  installChrome({}, { lastFocused: { id: 7 } });
  const out = await openInOtherWindow({ leftUrl: L, rightUrl: R });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["windows.getLastFocused", { windowTypes: ["normal"] }],
    ["tabs.create", { url: L, windowId: 7, active: true }],
    ["tabs.create", { url: R, index: 1, windowId: 7, active: false, splitWithTabId: 100 }],
    ["session.set", { "split:100": 101, "split:101": 100 }],
    ["windows.update", 7, { focused: true }],
  ]);
});

test("other-window：切前台失败只记录，不影响结果", async () => {
  installChrome({ focus: true }, { lastFocused: { id: 7 } });
  assert.deepEqual(await openInOtherWindow({ leftUrl: L, rightUrl: R }), { replaceWith: L });
  assert.ok(names().includes("windows.update"));
});

test("other-window：没有普通窗口时新建窗口，不再额外切前台", async () => {
  installChrome({ getLastFocused: true });
  const out = await openInOtherWindow({ leftUrl: L, rightUrl: R });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["windows.getLastFocused", { windowTypes: ["normal"] }],
    ["windows.create", { type: "normal", url: L }],
    ["tabs.create", { url: R, index: 1, windowId: 8, active: false, splitWithTabId: 50 }],
    ["session.set", { "split:50": 100, "split:100": 50 }],
  ]);
});
