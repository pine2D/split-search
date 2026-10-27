import { test } from "node:test";
import assert from "node:assert/strict";
import { TAB_KEYS, tabHash, routeFromHash, initialTab, stepTab } from "../src/lib/options-route.js";

test("TAB_KEYS 与 tabHash", () => {
  assert.deepEqual(TAB_KEYS, ["add", "pair", "engines", "lookup"]);
  assert.equal(tabHash("engines"), "#tab-engines");
});
test("routeFromHash：认得出的三类", () => {
  for (const k of TAB_KEYS) assert.deepEqual(routeFromHash(`#tab-${k}`), { tab: k });
  assert.deepEqual(routeFromHash("#setup"), { reveal: "setup" });
  assert.deepEqual(routeFromHash("#guide-steps"), { reveal: "guide-steps" });
});
test("routeFromHash：认不出的一律 {}（含元素 id 与 Review Focus 1 的怪 hash）", () => {
  for (const h of ["#tab-foo", "#guide", "#engines", "#triggers", "#cycle", "#rules-card", "#shortcut",
    "", "#", null, undefined, "#TAB-pair", "#tab-pair/", "#tab-%70air", "tab-pair", "#Setup"]) {
    assert.deepEqual(routeFromHash(h), {}, String(h));
  }
});
test("initialTab：有效 #tab-* 优先", () => {
  for (const mode of ["steps", "regrant", "done", "hidden"]) assert.equal(initialTab("#tab-lookup", { mode }), "lookup");
});
test("initialTab：#setup 按卡片是否显示；#guide-steps 总是 ①", () => {
  assert.equal(initialTab("#setup", { mode: "steps" }), "add");
  assert.equal(initialTab("#setup", { mode: "regrant" }), "add");
  assert.equal(initialTab("#setup", { mode: "done" }), "pair");
  assert.equal(initialTab("#setup", { mode: "hidden" }), "pair");
  for (const mode of ["steps", "hidden"]) assert.equal(initialTab("#guide-steps", { mode }), "add");
});
test("initialTab：无 hash 或认不出时 steps/regrant 进 ①，其余进 ②", () => {
  for (const h of ["", "#tab-foo", "#engines", "#guide", undefined, "#"]) {
    assert.equal(initialTab(h, { mode: "steps" }), "add", String(h));
    assert.equal(initialTab(h, { mode: "regrant" }), "add", String(h));
    assert.equal(initialTab(h, { mode: "done" }), "pair", String(h));
    assert.equal(initialTab(h, { mode: "hidden" }), "pair", String(h));
  }
  assert.equal(initialTab("", { mode: undefined }), "pair");
  assert.equal(initialTab("", {}), "pair");
});
test("stepTab：←/→ 循环，Home/End 到首尾，其他键 null（Review Focus 2）", () => {
  assert.equal(stepTab(TAB_KEYS, "add", "ArrowRight"), "pair");
  assert.equal(stepTab(TAB_KEYS, "lookup", "ArrowRight"), "add");
  assert.equal(stepTab(TAB_KEYS, "add", "ArrowLeft"), "lookup");
  assert.equal(stepTab(TAB_KEYS, "engines", "Home"), "add");
  assert.equal(stepTab(TAB_KEYS, "pair", "End"), "lookup");
  for (const k of ["ArrowUp", "ArrowDown", "Enter", " ", "PageUp", "Tab"]) assert.equal(stepTab(TAB_KEYS, "pair", k), null, k);
  assert.equal(stepTab(TAB_KEYS, "nope", "ArrowRight"), null);
  assert.equal(stepTab(TAB_KEYS, "nope", "Home"), "add");
});
