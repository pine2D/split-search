import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSplit, decideFor, sideOf } from "../src/lib/split-decision.js";

const peer = { id: 2, index: 5 };
const base = { windowType: "normal", splitViewId: 7, peer, ownership: "own" };
test("sideOf", () => { assert.equal(sideOf(4, 5), "left"); assert.equal(sideOf(6, 5), "right"); });
test("非 normal 窗口", () => assert.equal(decideSplit({ ...base, windowType: "popup" }), "other-window"));
test("PiP 窗口 → other-window", () => assert.equal(decideSplit({ ...base, windowType: "pip", ownership: "own" }), "other-window"));
test("不在分屏中、没有相邻对", () => {
  assert.equal(decideSplit({ ...base, splitViewId: -1, peer: null, ownership: "none" }), "new");
  assert.equal(decideSplit({ ...base, splitViewId: -1, ownership: "stale" }), "new");
});
test("不在分屏中但是本扩展的相邻对、窗口仍窄 → reuse", () =>
  assert.equal(decideSplit({ ...base, splitViewId: -1, ownership: "own", narrow: true }), "reuse"));
test("本扩展的相邻对、窗口不窄或开关关闭（narrow 不为 true）→ join", () => {
  assert.equal(decideSplit({ ...base, splitViewId: -1, ownership: "own", narrow: false }), "join");
  assert.equal(decideSplit({ ...base, splitViewId: -1, ownership: "own" }), "join");
});
test("narrow 不影响其他结果", () => {
  for (const narrow of [true, false]) {
    assert.equal(decideSplit({ ...base, narrow }), "reuse");
    assert.equal(decideSplit({ ...base, splitViewId: -1, peer: null, ownership: "none", narrow }), "new");
    assert.equal(decideSplit({ ...base, ownership: "stale", narrow }), "foreign");
    assert.equal(decideSplit({ ...base, windowType: "popup", narrow }), "other-window");
  }
});
test("本扩展分屏 → reuse", () => assert.equal(decideSplit(base), "reuse"));
test("fallback-own 在分屏中 → foreign", () => assert.equal(decideSplit({ ...base, ownership: "fallback-own" }), "foreign"));
test("fallback-own 不在分屏中 → new", () =>
  assert.equal(decideSplit({ ...base, splitViewId: -1, ownership: "fallback-own", narrow: true }), "new"));
test("当前标签是 lookup：分屏中 foreign，相邻对 new", () => {
  assert.equal(decideSplit({ ...base, ownership: "own", role: "lookup" }), "foreign");
  assert.equal(decideSplit({ ...base, splitViewId: -1, ownership: "own", role: "lookup", narrow: true }), "new");
});
test("当前标签是 page：照常 reuse / join", () => {
  assert.equal(decideSplit({ ...base, ownership: "own", role: "page" }), "reuse");
  assert.equal(decideSplit({ ...base, splitViewId: -1, ownership: "own", role: "page", narrow: false }), "join");
});
test("没有 role（旧调用方）按 search", () => assert.equal(decideSplit({ ...base, ownership: "own" }), "reuse"));
test("记录失效 → foreign", () => assert.equal(decideSplit({ ...base, ownership: "stale" }), "foreign"));
test("无记录且不像搜索页 → foreign", () => assert.equal(decideSplit({ ...base, ownership: "none" }), "foreign"));
test("在分屏中却找不到另一侧", () => {
  assert.equal(decideSplit({ ...base, peer: null }), "foreign");
  assert.equal(decideSplit({ ...base, peer: undefined }), "foreign");
});

// go.js 经 decideFor 判定（窗口类型必须经 splitWindowType）。这几条守着 PiP 不被当成普通窗口：
// 回退成直接传 ctx.win.type 时，PiP 会判成 new，createPaired 在 PiP 上调分屏 API，Chrome 156 崩溃。
// v0.4 给判定加 role 时也要改在 decideFor 里，这几条用例必须保留。
const ctx = (win, over = {}) => ({ win, splitViewId: -1, peer: null, ownership: "none", ...over });
test("decideFor：PiP（normal 且 alwaysOnTop）→ other-window，不论有没有记录", () => {
  assert.equal(decideFor(ctx({ type: "normal", alwaysOnTop: true }), true), "other-window");
  assert.equal(decideFor(ctx({ type: "normal", alwaysOnTop: true, tabs: [{ id: 1 }] }), true), "other-window");
  assert.equal(decideFor(ctx({ type: "normal", alwaysOnTop: true }, { splitViewId: 7, peer, ownership: "own" }), true), "other-window");
});
test("decideFor：普通窗口、窗口管理器置顶且有多个标签的窗口照常判定", () => {
  assert.equal(decideFor(ctx({ type: "normal", alwaysOnTop: false, width: 1400 }), true), "new");
  assert.equal(decideFor(ctx({ type: "normal", alwaysOnTop: true, width: 1400, tabs: [{ id: 1 }, { id: 2 }] }), true), "new");
  assert.equal(decideFor(ctx({ type: "popup" }), true), "other-window");
});
test("decideFor：窄窗口判定用 ctx.win.width 和降级开关", () => {
  const own = { peer, ownership: "own" };
  assert.equal(decideFor(ctx({ type: "normal", width: 800 }, own), true), "reuse");
  assert.equal(decideFor(ctx({ type: "normal", width: 800 }, own), false), "join");
  assert.equal(decideFor(ctx({ type: "normal", width: 1400 }, own), true), "join");
});
test("decideFor：role 取自 ctx.record（lookup 一侧不改写对侧）", () => {
  const win = { type: "normal", width: 1400 };
  const own = (role) => ({ splitViewId: 7, peer, ownership: "own", record: { role } });
  assert.equal(decideFor(ctx(win, own("lookup")), true), "foreign");
  assert.equal(decideFor(ctx(win, own("page")), true), "reuse");
  assert.equal(decideFor(ctx(win, own("search")), true), "reuse");
  assert.equal(decideFor(ctx(win, { splitViewId: -1, peer, ownership: "own", record: { role: "lookup" } }), true), "new");
  assert.equal(decideFor(ctx(win, { splitViewId: 7, peer, ownership: "own", record: null }), true), "reuse");
});
