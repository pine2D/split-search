import { test } from "node:test";
import assert from "node:assert/strict";
import { decideLookup, besideIndex } from "../src/lib/lookup-decision.js";

const base = { hasTab: true, inputOk: true, windowType: "normal", splitViewId: 7, ownership: "none", narrow: false };
const cases = [
  [{ hasTab: false }, "ignore"], [{ inputOk: false }, "ignore"],
  [{ hasTab: false, windowType: "popup" }, "ignore"],
  [{ windowType: "popup" }, "other-window"], [{ windowType: "pip", ownership: "own", role: "page" }, "other-window"],
  [{ windowType: "none" }, "other-window"],
  [{ ownership: "own", role: "page" }, "reuse-split"],
  [{ ownership: "own", role: "search" }, "beside-split"], [{ ownership: "own", role: "lookup" }, "beside-split"],
  [{ ownership: "own" }, "beside-split"],
  [{ ownership: "fallback-own" }, "beside-split"], [{ ownership: "stale" }, "beside-split"],
  [{ ownership: "fallback-own", role: "page" }, "beside-split"],
  [{ splitViewId: -1, ownership: "own", role: "page", narrow: true }, "reuse-adjacent"],
  [{ splitViewId: -1, ownership: "own", role: "page", narrow: false }, "join"],
  [{ splitViewId: -1, ownership: "own", role: "lookup" }, "beside-pair"],
  [{ splitViewId: -1, ownership: "own", role: "lookup", narrow: true }, "beside-pair"],
  [{ splitViewId: -1, ownership: "own", role: "search" }, "new"], [{ splitViewId: -1, ownership: "stale" }, "new"],
  [{ splitViewId: -1, ownership: "stale", role: "page" }, "new"],
  [{ splitViewId: -1 }, "new"],
];
for (const [over, want] of cases) test(`decideLookup ${JSON.stringify(over)} → ${want}`, () => assert.equal(decideLookup({ ...base, ...over }), want));
test("besideIndex：分屏右边；相邻对取两者较大 index", () => {
  assert.equal(besideIndex("beside-split", { tab: { index: 3 }, splitTabs: [{ index: 3 }, { index: 4 }] }), 5);
  assert.equal(besideIndex("beside-pair", { tab: { index: 6 }, peer: { index: 2 } }), 7);
});
test("besideIndex：T 在分屏右侧、相邻对里 peer 在右", () => {
  assert.equal(besideIndex("beside-split", { tab: { index: 9 }, splitTabs: [{ index: 8 }, { index: 9 }] }), 10);
  assert.equal(besideIndex("beside-pair", { tab: { index: 2 }, peer: { index: 4 } }), 5);
});
test("besideIndex：其他动作不算位置", () => assert.throws(() => besideIndex("new", { tab: { index: 1 } })));
