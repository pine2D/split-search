import { test } from "node:test";
import assert from "node:assert/strict";
import { formSnapshot, isBackdropClick } from "../src/options/dialogs.js";

test("formSnapshot sees changes and reverts", () => {
  const els = [{ type: "text", value: "a" }, { type: "checkbox", checked: false }, { type: "submit", value: "x" }];
  const s0 = formSnapshot(els);
  els[0].value = "b"; assert.notEqual(formSnapshot(els), s0);
  els[0].value = "a"; assert.equal(formSnapshot(els), s0);
  els[1].checked = true; assert.notEqual(formSnapshot(els), s0);
});

test("isBackdropClick needs both press and release outside", () => {
  const r = { left: 100, top: 100, right: 300, bottom: 300 };
  assert.equal(isBackdropClick(r, { x: 10, y: 10 }, { x: 12, y: 12 }), true);
  assert.equal(isBackdropClick(r, { x: 150, y: 150 }, { x: 10, y: 10 }), false); // 拖选文字到外面
  assert.equal(isBackdropClick(r, { x: 10, y: 10 }, { x: 150, y: 150 }), false);
  assert.equal(isBackdropClick(r, null, { x: 10, y: 10 }), false);
});

test("formSnapshot: select、单选的变化，按钮与 fieldset 不算", () => {
  const els = [
    { type: "fieldset", value: "" },
    { type: "radio", checked: true, value: "words" },
    { type: "radio", checked: false, value: "script" },
    { type: "select-one", value: "han" },
    { type: "button", value: "" },
  ];
  const s0 = formSnapshot(els);
  els[3].value = "kana"; assert.notEqual(formSnapshot(els), s0);
  els[3].value = "han"; assert.equal(formSnapshot(els), s0);
  els[1].checked = false; els[2].checked = true; assert.notEqual(formSnapshot(els), s0);
  els[1].checked = true; els[2].checked = false; assert.equal(formSnapshot(els), s0);
  els[4].value = "changed"; els[0].value = "changed"; assert.equal(formSnapshot(els), s0);
});

test("formSnapshot: 字段之间的分隔不会因值里带分隔符而撞车", () => {
  const a = formSnapshot([{ type: "text", value: "a,b" }, { type: "text", value: "" }]);
  const b = formSnapshot([{ type: "text", value: "a" }, { type: "text", value: "b" }]);
  assert.notEqual(a, b);
});

test("isBackdropClick: 边上算里面", () => {
  const r = { left: 100, top: 100, right: 300, bottom: 300 };
  assert.equal(isBackdropClick(r, { x: 100, y: 300 }, { x: 300, y: 100 }), false);
  assert.equal(isBackdropClick(r, { x: 99, y: 150 }, { x: 301, y: 150 }), true);
});
