import { test } from "node:test";
import assert from "node:assert/strict";
import { splitWindowType, canSplitIn, pickSplitWindow } from "../src/lib/window-kind.js";

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

// 窗口管理器“置顶”的普通窗口同样报 alwaysOnTop: true（Linux X11，Chrome 156 实测），靠标签数与 PiP 区分：
// PiP 只有一个标签、也加不进去；带 populate 读到多于一个标签的置顶窗口按普通窗口处理。
test("splitWindowType：置顶窗口有两个以上标签 → normal；只有一个或读不到标签列表 → pip", () => {
  assert.equal(splitWindowType({ type: "normal", alwaysOnTop: true, tabs: [{ id: 1 }, { id: 2 }] }), "normal");
  assert.equal(splitWindowType({ type: "normal", alwaysOnTop: true, tabs: [{ id: 1 }] }), "pip");
  assert.equal(splitWindowType({ type: "normal", alwaysOnTop: true, tabs: [] }), "pip");
  assert.equal(splitWindowType({ type: "normal", alwaysOnTop: true }), "pip");
  assert.equal(canSplitIn({ type: "normal", alwaysOnTop: true, tabs: [{ id: 1 }, { id: 2 }] }), true);
});

const tab = (id, lastAccessed) => ({ id, lastAccessed });
const PIP = { id: 9, type: "normal", alwaysOnTop: true, focused: true, tabs: [{ id: 90, openerTabId: 21 }] };
const A = { id: 1, type: "normal", alwaysOnTop: false, state: "normal", tabs: [tab(11, 100)] };
const B = { id: 2, type: "normal", alwaysOnTop: false, state: "normal", tabs: [tab(21, 50), tab(22, 60)] };
const C = { id: 3, type: "normal", alwaysOnTop: false, state: "normal", tabs: [tab(31, 300)] };

test("pickSplitWindow：最后聚焦的能分屏 → 就用它", () => {
  assert.equal(pickSplitWindow(A, [A, B, PIP]), A);
});
test("pickSplitWindow：最后聚焦的是 PiP → 优先 focused 的，其次打开 PiP 的那个窗口", () => {
  assert.equal(pickSplitWindow(PIP, [A, { ...C, focused: true }, B, PIP]).id, 3);
  assert.equal(pickSplitWindow(PIP, [A, C, B, PIP]), B);
});
test("pickSplitWindow：找不到打开者 → 没最小化的里取最近用过的（标签 lastAccessed 最大）", () => {
  const pip = { ...PIP, tabs: [{ id: 90 }] };
  assert.equal(pickSplitWindow(pip, [A, B, C, pip]), C);
  assert.equal(pickSplitWindow(pip, [A, B, { ...C, state: "minimized" }, pip]), A);
  assert.equal(pickSplitWindow(pip, [{ ...A, state: "minimized" }]).id, 1);
});
test("pickSplitWindow：没有能分屏的窗口 → null", () => {
  assert.equal(pickSplitWindow(PIP, [PIP]), null);
  assert.equal(pickSplitWindow(undefined, undefined), null);
});
