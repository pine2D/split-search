import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS, createPaired, openNew, reuse, join, openForeign, openInOtherWindow, leaveTab, lastSplitWindow,
} from "../src/chrome/split-actions.js";

// 最小 chrome 桩：按顺序记录调用。fail.<name> 为 true 时对应调用抛错；
// fail.create 也可以是 (props, n) => boolean，n 为第几次 tabs.create（从 1 开始）。
// extra.newSplitViewId / extra.getSplitViewId：新分屏标签与复核时读到的 splitViewId（默认都是 55）。
let calls;
function installChrome(fail = {}, extra = {}) {
  calls = [];
  let nextId = 100;
  let creates = 0;
  let gets = 0;
  const splitMade = new Set();
  const check = (name) => { if (fail[name] === true) throw new Error(`${name} failed`); };
  globalThis.chrome = {
    tabs: {
      async create(props) {
        calls.push(["tabs.create", props]);
        creates++;
        if (typeof fail.create === "function" && fail.create(props, creates)) throw new Error("create failed");
        if (props.splitWithTabId === undefined) return { id: nextId++, index: props.index ?? 0, windowId: props.windowId, splitViewId: -1 };
        check("createSplit");
        splitMade.add(nextId);
        return { id: nextId++, index: props.index ?? 0, windowId: props.windowId, splitViewId: extra.newSplitViewId ?? 55 };
      },
      // 复核用：返回 withTab 当前的 splitViewId，默认与新标签一致
      async get(id) {
        calls.push(["tabs.get", id]);
        gets++;
        check("get");
        // extra.getAt(id, n)：第 n 次 tabs.get（从 1 开始）读到的 splitViewId，用来模拟复核时状态还没稳定
        if (extra.getAt) return { id, splitViewId: extra.getAt(id, gets) };
        // 带 splitWithTabId 新建的标签：复核读到 newGetSplitViewId（默认等于创建时返回的值）
        if (splitMade.has(id)) return { id, splitViewId: extra.newGetSplitViewId ?? extra.newSplitViewId ?? 55 };
        return { id, splitViewId: extra.getSplitViewId ?? 55 };
      },
      async update(id, props) { calls.push(["tabs.update", id, props]); check("update"); },
      // 把相邻对拼成分屏：返回 extra.joinSplitViewId（默认 66）；复核读到的值由 getSplitViewId 决定
      async createSplit(tabIds) { calls.push(["tabs.createSplit", tabIds]); check("join"); return extra.joinSplitViewId ?? 66; },
      async remove(id) { calls.push(["tabs.remove", id]); check("remove"); },
    },
    windows: {
      async getLastFocused(opts) {
        calls.push(["windows.getLastFocused", opts]);
        check("getLastFocused");
        return extra.lastFocused ?? { id: 7, type: "normal", width: 1400 };
      },
      // extra.all：windows.getAll 的结果（默认只有最后聚焦的那个窗口）
      async getAll(opts) {
        calls.push(["windows.getAll", opts]);
        check("getAll");
        return extra.all ?? [extra.lastFocused ?? { id: 7, type: "normal", width: 1400 }];
      },
      async create(props) {
        calls.push(["windows.create", props]);
        return { id: 8, width: extra.createdWidth ?? 1400, tabs: [{ id: 50, index: 0, windowId: 8 }] };
      },
      async update(id, props) { calls.push(["windows.update", id, props]); check("focus"); },
    },
    storage: { session: {
      async set(obj) { calls.push(["session.set", obj]); check("session"); },
      async get(key) { calls.push(["session.get", key]); return {}; },
      async remove(keys) { calls.push(["session.remove", keys]); },
    } },
  };
}
const names = () => calls.map(c => c[0]);
const L = "https://kagi.com/search?q=x";
const R = "https://www.google.com/search?q=x";
const ids = { leftId: "kagi", rightId: "google", query: "x", narrowEnabled: false };
const rec = (peer, engine, over = {}) => ({ peer, splitViewId: 55, mode: "split", role: "search", engine, query: "x", ...over });

beforeEach((t) => {
  installChrome();
  t.mock.method(console, "error", () => {});
});

test("ACTIONS 覆盖 decideSplit 的五种结果", () => {
  assert.deepEqual(Object.keys(ACTIONS).sort(), ["foreign", "join", "new", "other-window", "reuse"]);
});

test("new：右侧新建并与当前标签分屏，复核后写两条 split 记录，当前标签打开左侧", async () => {
  const out = await openNew({ tab: { id: 1, index: 3, windowId: 9 }, leftUrl: L, rightUrl: R, ...ids });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["tabs.create", { url: R, index: 4, windowId: 9, active: false, splitWithTabId: 1 }],
    ["tabs.get", 1],
    ["tabs.get", 100],
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
    ["tabs.get", 101],
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
  installChrome({}, { lastFocused: { id: 7, type: "normal" } });
  const out = await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["windows.getLastFocused", { windowTypes: ["normal"], populate: true }],
    ["tabs.create", { url: L, windowId: 7, active: true }],
    ["tabs.create", { url: R, index: 1, windowId: 7, active: false, splitWithTabId: 100 }],
    ["tabs.get", 100],
    ["tabs.get", 101],
    ["session.set", { "split:100": rec(101, "kagi"), "split:101": rec(100, "google") }],
    ["windows.update", 7, { focused: true }],
  ]);
});

test("other-window：切前台失败只记录，不影响结果", async () => {
  installChrome({ focus: true }, { lastFocused: { id: 7, type: "normal" } });
  assert.deepEqual(await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids }), { replaceWith: L });
  assert.ok(names().includes("windows.update"));
});

test("other-window：没有普通窗口时新建窗口，不再额外切前台", async () => {
  installChrome({ getLastFocused: true });
  const out = await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["windows.getLastFocused", { windowTypes: ["normal"], populate: true }],
    ["windows.create", { type: "normal", url: L }],
    ["tabs.create", { url: R, index: 1, windowId: 8, active: false, splitWithTabId: 50 }],
    ["tabs.get", 50],
    ["tabs.get", 100],
    ["session.set", { "split:50": rec(100, "kagi"), "split:100": rec(50, "google") }],
  ]);
});

test("other-window：复核失败（-1）时不写记录", async () => {
  installChrome({}, { lastFocused: { id: 7, type: "normal" }, getSplitViewId: -1 });
  await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids });
  assert.ok(!names().includes("session.set"));
});

test("createPaired：新标签复核读到 -1（其他一致）→ 返回 -1", async () => {
  installChrome({}, { newGetSplitViewId: -1 });
  assert.equal((await createPaired(R, { id: 1, index: 3, windowId: 9 })).splitViewId, -1);
});

test("createPaired：新标签复核读到不同的 splitViewId → 返回 -1", async () => {
  installChrome({}, { newGetSplitViewId: 56 });
  assert.equal((await createPaired(R, { id: 1, index: 3, windowId: 9 })).splitViewId, -1);
});

test("createPaired：复核同时读两个标签", async () => {
  await createPaired(R, { id: 1, index: 3, windowId: 9 });
  assert.deepEqual(calls.filter(c => c[0] === "tabs.get"), [["tabs.get", 1], ["tabs.get", 100]]);
});

test("new：窄窗口右侧不带 splitWithTabId，在后台相邻位置，写 adjacent 记录", async () => {
  const out = await openNew({
    tab: { id: 1, index: 3, windowId: 9 }, win: { width: 800 }, leftUrl: L, rightUrl: R, ...ids, narrowEnabled: true,
  });
  assert.deepEqual(out, { replaceWith: L });
  const adj = { mode: "adjacent", splitViewId: -1 };
  assert.deepEqual(calls, [
    ["tabs.create", { url: R, index: 4, windowId: 9, active: false }],
    ["session.set", { "split:1": rec(100, "kagi", adj), "split:100": rec(1, "google", adj) }],
  ]);
});

test("new：窗口宽度 1200 或开关关闭时照常分屏", async () => {
  await openNew({ tab: { id: 1, index: 3, windowId: 9 }, win: { width: 1200 }, leftUrl: L, rightUrl: R, ...ids, narrowEnabled: true });
  assert.equal(calls[0][1].splitWithTabId, 1);
  installChrome();
  await openNew({ tab: { id: 1, index: 3, windowId: 9 }, win: { width: 500 }, leftUrl: L, rightUrl: R, ...ids, narrowEnabled: false });
  assert.equal(calls[0][1].splitWithTabId, 1);
});

test("foreign：窄窗口新左侧在 maxIndex+1，右侧紧挨其后且不分屏，记 adjacent", async () => {
  const tab = { id: 1, index: 2, windowId: 9 };
  const out = await openForeign({
    tab, win: { width: 700 }, splitTabs: [tab, { id: 2, index: 3, windowId: 9 }], leftUrl: L, rightUrl: R, ...ids, narrowEnabled: true,
  });
  assert.deepEqual(out, { leave: true });
  const adj = { mode: "adjacent", splitViewId: -1 };
  assert.deepEqual(calls, [
    ["tabs.create", { url: L, index: 4, windowId: 9, active: true }],
    ["tabs.create", { url: R, index: 5, windowId: 9, active: false }],
    ["session.set", { "split:100": rec(101, "kagi", adj), "split:101": rec(100, "google", adj) }],
  ]);
});

test("other-window：看目标窗口的宽度，窄则不分屏", async () => {
  installChrome({}, { lastFocused: { id: 7, type: "normal", width: 800 } });
  await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids, narrowEnabled: true });
  const adj = { mode: "adjacent", splitViewId: -1 };
  assert.deepEqual(calls[2], ["tabs.create", { url: R, index: 1, windowId: 7, active: false }]);
  assert.deepEqual(calls[3], ["session.set", { "split:100": rec(101, "kagi", adj), "split:101": rec(100, "google", adj) }]);
});

test("other-window：新建窗口时看 windows.create 返回的宽度", async () => {
  installChrome({ getLastFocused: true }, { createdWidth: 600 });
  await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids, narrowEnabled: true });
  assert.deepEqual(calls[2], ["tabs.create", { url: R, index: 1, windowId: 8, active: false }]);
});

test("other-window：目标窗口宽度读不到时照常分屏", async () => {
  installChrome({}, { lastFocused: { id: 7, type: "normal" } });
  await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids, narrowEnabled: true });
  assert.equal(calls[2][1].splitWithTabId, 100);
});

test("join：当前在左侧，先更新右侧，再把两个标签拼成分屏（左在前），复核后写 split 记录", async () => {
  installChrome({}, { getSplitViewId: 66 });
  const out = await join({
    tab: { id: 1, index: 3, windowId: 9 }, peer: { id: 2, index: 4, windowId: 9 }, splitViewId: -1, leftUrl: L, rightUrl: R, ...ids,
  });
  assert.deepEqual(out, { replaceWith: L });
  assert.deepEqual(calls, [
    ["tabs.update", 2, { url: R }],
    ["tabs.createSplit", [1, 2]],
    ["tabs.get", 1],
    ["tabs.get", 2],
    ["session.set", { "split:1": rec(2, "kagi", { splitViewId: 66 }), "split:2": rec(1, "google", { splitViewId: 66 }) }],
  ]);
  assert.ok(!names().includes("tabs.create"));
});

test("join：当前在右侧时对侧拿左侧，createSplit 仍按标签顺序传 [左, 右]", async () => {
  installChrome({}, { getSplitViewId: 66 });
  const out = await join({
    tab: { id: 1, index: 5, windowId: 9 }, peer: { id: 2, index: 4, windowId: 9 }, splitViewId: -1, leftUrl: L, rightUrl: R, ...ids,
  });
  assert.deepEqual(out, { replaceWith: R });
  assert.deepEqual(calls[0], ["tabs.update", 2, { url: L }]);
  assert.deepEqual(calls[1], ["tabs.createSplit", [2, 1]]);
  assert.deepEqual(calls.at(-1), ["session.set", {
    "split:1": rec(2, "google", { splitViewId: 66 }), "split:2": rec(1, "kagi", { splitViewId: 66 }),
  }]);
});

test("join：createSplit 抛错 → 不抛，退回相邻对的复用（adjacent 记录），左侧照常打开", async () => {
  installChrome({ join: true });
  const out = await join({
    tab: { id: 1, index: 3, windowId: 9 }, peer: { id: 2, index: 4, windowId: 9 }, splitViewId: -1, leftUrl: L, rightUrl: R, ...ids,
  });
  assert.deepEqual(out, { replaceWith: L });
  const adj = { mode: "adjacent", splitViewId: -1 };
  assert.deepEqual(calls.at(-1), ["session.set", { "split:1": rec(2, "kagi", adj), "split:2": rec(1, "google", adj) }]);
  assert.ok(names().includes("tabs.update"));
  assert.ok(console.error.mock.callCount() >= 1);
});

const pairCtx = { tab: { id: 1, index: 3, windowId: 9 }, peer: { id: 2, index: 4, windowId: 9 }, splitViewId: -1, leftUrl: L, rightUrl: R, ...ids };

test("join：createSplit 成功但两次复核都不一致 → 不写任何记录（两个标签可能已在分屏里），清掉旧的相邻记录", async () => {
  installChrome({}, { getSplitViewId: -1 });
  const out = await join(pairCtx);
  assert.deepEqual(out, { replaceWith: L });
  assert.ok(!names().includes("session.set"));
  assert.equal(names().filter(n => n === "tabs.get").length, 4); // 复核两轮
  assert.deepEqual(calls.at(-1), ["session.remove", ["split:1"]]);
});

test("join：复核时 tabs.get 一直抛错 → 不写记录，不抛", async () => {
  installChrome({ get: true });
  const out = await join(pairCtx);
  assert.deepEqual(out, { replaceWith: L });
  assert.ok(!names().includes("session.set"));
});

test("join：第一轮复核还没稳定、稍等再读一致 → 写 split 记录", async () => {
  installChrome({}, { getAt: (id, n) => (n <= 2 ? -1 : 66) });
  const t0 = Date.now();
  await join(pairCtx);
  assert.ok(Date.now() - t0 <= 1000);
  assert.deepEqual(calls.at(-1), ["session.set", { "split:1": rec(2, "kagi", { splitViewId: 66 }), "split:2": rec(1, "google", { splitViewId: 66 }) }]);
});

test("createPaired：第一轮复核不一致、第二轮一致 → 返回该 splitViewId", async () => {
  installChrome({}, { getAt: (id, n) => (n === 1 ? -1 : 55) });
  const res = await createPaired(R, { id: 1, index: 3, windowId: 9 });
  assert.equal(res.splitViewId, 55);
  assert.equal(names().filter(n => n === "tabs.get").length, 4);
});

test("new：窄窗口下 tabs.create 抛错 → openNew 照常抛出，由 go.js 兜底打开左侧", async () => {
  installChrome({ create: () => true });
  await assert.rejects(openNew({ tab: { id: 1, index: 3, windowId: 9 }, win: { width: 800 }, leftUrl: L, rightUrl: R, ...ids, narrowEnabled: true }),
    /create failed/);
  assert.ok(!names().includes("session.set"));
  await assert.rejects(createPaired(R, { id: 1, index: 3, windowId: 9 }, { split: false }), /create failed/);
});

test("join：更新右侧失败时照常抛出（由 go.js 兜底打开左侧），不拼分屏", async () => {
  installChrome({ update: true });
  await assert.rejects(join({
    tab: { id: 1, index: 3, windowId: 9 }, peer: { id: 2, index: 4, windowId: 9 }, splitViewId: -1, leftUrl: L, rightUrl: R, ...ids,
  }));
  assert.ok(!names().includes("tabs.createSplit"));
});

// Document PiP 窗口：type 报 normal、alwaysOnTop 为 true（spike S5）。在它上面调分屏 API 会让 Chrome 156 崩溃。
const PIP = { id: 9, type: "normal", alwaysOnTop: true, focused: true, width: 524 };
const W1 = { id: 1, type: "normal", alwaysOnTop: false, width: 1200 };

test("lastSplitWindow：最后聚焦的是普通窗口 → 直接用它，不读 getAll", async () => {
  installChrome({}, { lastFocused: W1 });
  assert.equal(await lastSplitWindow(), W1);
  assert.deepEqual(names(), ["windows.getLastFocused"]);
});

test("lastSplitWindow：最后聚焦的是 PiP → 在 getAll（带 populate）里挑可分屏的窗口", async () => {
  installChrome({}, { lastFocused: PIP, all: [PIP, W1] });
  assert.equal(await lastSplitWindow(), W1);
  assert.deepEqual(calls[1], ["windows.getAll", { windowTypes: ["normal"], populate: true }]);
});

test("lastSplitWindow：可分屏的窗口里优先取 focused 的，否则取第一个", async () => {
  const W2 = { id: 2, type: "normal", alwaysOnTop: false, focused: true };
  installChrome({}, { lastFocused: PIP, all: [PIP, W1, W2] });
  assert.equal(await lastSplitWindow(), W2);
});

test("lastSplitWindow：最后聚焦的是 PiP → 取打开 PiP 的那个窗口，不取 getAll 里的第一个", async () => {
  const pip = { ...PIP, tabs: [{ id: 90, openerTabId: 21 }] };
  const A = { id: 1, type: "normal", alwaysOnTop: false, tabs: [{ id: 11 }] };
  const B = { id: 2, type: "normal", alwaysOnTop: false, tabs: [{ id: 21 }, { id: 22 }] };
  installChrome({}, { lastFocused: pip, all: [A, B, pip] });
  assert.equal(await lastSplitWindow(), B);
});

test("lastSplitWindow({ fallback: false })：最后聚焦的不能分屏 → null，不读 getAll", async () => {
  installChrome({}, { lastFocused: PIP, all: [PIP, W1] });
  assert.equal(await lastSplitWindow({ fallback: false }), null);
  assert.deepEqual(names(), ["windows.getLastFocused"]);
  installChrome({}, { lastFocused: W1 });
  assert.equal(await lastSplitWindow({ fallback: false }), W1);
});

test("lastSplitWindow：只有 PiP、getLastFocused 抛错、getAll 抛错 → null", async () => {
  installChrome({}, { lastFocused: PIP, all: [PIP] });
  assert.equal(await lastSplitWindow(), null);
  installChrome({ getLastFocused: true });
  assert.equal(await lastSplitWindow(), null);
  installChrome({ getAll: true }, { lastFocused: PIP });
  assert.equal(await lastSplitWindow(), null);
});

test("other-window：最后聚焦的是 PiP → 一对建在普通窗口 1，窄窗口判定用 1200，从不拿 PiP 的窗口或标签", async () => {
  installChrome({}, { lastFocused: PIP, all: [PIP, W1] });
  await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids, narrowEnabled: true });
  const creates = calls.filter(c => c[0] === "tabs.create");
  assert.deepEqual(creates, [
    ["tabs.create", { url: L, windowId: 1, active: true }],
    ["tabs.create", { url: R, index: 1, windowId: 1, active: false, splitWithTabId: 100 }],
  ]);
  assert.ok(!calls.some(c => c[0] === "tabs.createSplit"));
  assert.deepEqual(calls.at(-1), ["windows.update", 1, { focused: true }]);
});

test("other-window：只有 PiP → 新建普通窗口，不在 PiP 里建标签", async () => {
  installChrome({}, { lastFocused: PIP, all: [PIP] });
  await openInOtherWindow({ leftUrl: L, rightUrl: R, ...ids });
  assert.ok(names().includes("windows.create"));
  assert.ok(!calls.some(c => c[0] === "tabs.create" && c[1].windowId === PIP.id));
  assert.ok(!calls.some(c => c[0] === "windows.update"));
});
