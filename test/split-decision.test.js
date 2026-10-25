import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSplit, sideOf } from "../src/lib/split-decision.js";

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
test("无记录兜底判为本扩展 → reuse", () => assert.equal(decideSplit({ ...base, ownership: "fallback-own" }), "reuse"));
test("记录失效 → foreign", () => assert.equal(decideSplit({ ...base, ownership: "stale" }), "foreign"));
test("无记录且不像搜索页 → foreign", () => assert.equal(decideSplit({ ...base, ownership: "none" }), "foreign"));
test("在分屏中却找不到另一侧", () => {
  assert.equal(decideSplit({ ...base, peer: null }), "foreign");
  assert.equal(decideSplit({ ...base, peer: undefined }), "foreign");
});
