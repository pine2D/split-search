import { test } from "node:test";
import assert from "node:assert/strict";
import { splitWindowType, canSplitIn } from "../src/lib/window-kind.js";

test("splitWindowType：普通窗口、PiP、popup、缺失", () => {
  assert.equal(splitWindowType({ type: "normal", alwaysOnTop: false }), "normal");
  assert.equal(splitWindowType({ type: "normal" }), "normal");
  assert.equal(splitWindowType({ type: "normal", alwaysOnTop: true }), "pip");
  assert.equal(splitWindowType({ type: "popup", alwaysOnTop: true }), "popup");
  assert.equal(splitWindowType(undefined), "none");
});
test("canSplitIn 只放行非置顶的 normal", () => {
  assert.equal(canSplitIn({ type: "normal", alwaysOnTop: false }), true);
  assert.equal(canSplitIn({ type: "normal", alwaysOnTop: true }), false);
  assert.equal(canSplitIn({ type: "app" }), false);
  assert.equal(canSplitIn(null), false);
});
