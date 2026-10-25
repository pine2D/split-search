import { test } from "node:test";
import assert from "node:assert/strict";
import { NARROW_WIDTH, isNarrow } from "../src/lib/narrow.js";

test("阈值是 960", () => assert.equal(NARROW_WIDTH, 960));
test("isNarrow：低于 960 且开启才算窄", () => {
  assert.equal(isNarrow(959, true), true);
  assert.equal(isNarrow(960, true), false);
  assert.equal(isNarrow(500, false), false);
});
test("isNarrow：宽度不是有限数字时不判窄", () => {
  assert.equal(isNarrow(undefined, true), false);
  assert.equal(isNarrow(NaN, true), false);
  assert.equal(isNarrow("500", true), false);
  assert.equal(isNarrow(-Infinity, true), false);
});
