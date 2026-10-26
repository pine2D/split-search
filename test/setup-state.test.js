import { test } from "node:test";
import assert from "node:assert/strict";
import { setupView, isCompletion } from "../src/lib/setup-state.js";

const base = { leftGranted: false, rightGranted: false, rightDistinct: true, setupDone: false, justCompleted: false };
const view = o => setupView({ ...base, ...o });
const states = v => Object.fromEntries(v.steps.map(s => [s.id, s.state]));

// ---- setupView ----

test("首次：三步都显示；左侧未授权时第 1 步待办、第 3 步不能点", () => {
  const v = view({});
  assert.equal(v.mode, "steps");
  assert.deepEqual(v.steps.map(s => s.id), ["grant", "add", "try"]);
  assert.deepEqual(states(v), { grant: "todo", add: "todo", try: "blocked" });
  assert.equal(v.rightPending, true);
});

test("左侧已授权、右侧没授权：第 1 步算完成，另留右侧（建议）的授权", () => {
  const v = view({ leftGranted: true });
  assert.deepEqual(states(v), { grant: "done", add: "todo", try: "ready" });
  assert.equal(v.rightPending, true);
});

test("两侧都授权：没有剩下的授权按钮", () => {
  const v = view({ leftGranted: true, rightGranted: true });
  assert.deepEqual(states(v), { grant: "done", add: "todo", try: "ready" });
  assert.equal(v.rightPending, false);
});

test("右侧与左侧是同一个引擎：不另要右侧授权", () => {
  assert.equal(view({ rightDistinct: false }).rightPending, false);
});

test("只授权了右侧：第 1 步仍待办，只差左侧", () => {
  const v = view({ rightGranted: true });
  assert.equal(states(v).grant, "todo");
  assert.equal(v.rightPending, false);
});

test("已完成且左侧已授权：不显示", () => {
  const v = view({ setupDone: true, leftGranted: true });
  assert.equal(v.mode, "hidden");
  assert.deepEqual(v.steps, []);
});

test("本页刚完成：显示一句完成确认，不再显示步骤", () => {
  const v = view({ setupDone: true, leftGranted: true, justCompleted: true });
  assert.equal(v.mode, "done");
  assert.deepEqual(v.steps, []);
});

test("已完成但左侧授权被撤销：重新显示，只有第 1 步", () => {
  for (const justCompleted of [false, true]) {
    const v = view({ setupDone: true, leftGranted: false, justCompleted });
    assert.equal(v.mode, "regrant");
    assert.deepEqual(v.steps, [{ id: "grant", state: "todo" }]);
    assert.equal(v.rightPending, true);
  }
});

test("缺省字段按“没有”处理", () => {
  assert.equal(setupView({}).mode, "steps");
});

// ---- isCompletion ----

const rec = (peer, query, extra = {}) => ({ peer, splitViewId: 7, mode: "split", role: "search", engine: "x", query, ...extra });
const pair = (a, b, query, extra) => ({
  [`split:${a}`]: { newValue: rec(b, query, extra) },
  [`split:${b}`]: { newValue: rec(a, query, extra) },
});
const none = new Map();

test("新出现一对搜索记录、两侧都不是“试一下”的标签：算完成", () => {
  assert.equal(isCompletion(pair(1, 2, "cats"), none), true);
});

test("“试一下”打开的那一对不算", () => {
  assert.equal(isCompletion(pair(1, 2, "示例"), new Map([[1, "示例"]])), false);
  assert.equal(isCompletion(pair(1, 2, "示例"), new Map([[2, "示例"]])), false);
});

test("“试一下”的标签里换了关键词再搜（经地址栏或拖拽）：算完成", () => {
  const changes = {
    "split:1": { oldValue: rec(2, "示例"), newValue: rec(2, "dogs") },
    "split:2": { oldValue: rec(1, "示例"), newValue: rec(1, "dogs") },
  };
  assert.equal(isCompletion(changes, new Map([[1, "示例"]])), true);
});

test("关键词没变的改写（换右侧、拼成分屏、标成失效）不算", () => {
  const same = (extra) => ({
    "split:1": { oldValue: rec(2, "cats"), newValue: rec(2, "cats", extra) },
    "split:2": { oldValue: rec(1, "cats"), newValue: rec(1, "cats", extra) },
  });
  assert.equal(isCompletion(same({ engine: "y" }), none), false);
  assert.equal(isCompletion(same({ splitViewId: -1 }), none), false);
  assert.equal(isCompletion(same({ mode: "adjacent", splitViewId: -1 }), none), false);
});

test("没有 role 的旧形状按搜索记录算", () => {
  const legacy = { "split:1": { newValue: { peer: 2, splitViewId: 3, mode: "split", engine: "a", query: "q" } },
    "split:2": { newValue: { peer: 1, splitViewId: 3, mode: "split", engine: "b", query: "q" } } };
  assert.equal(isCompletion(legacy, none), true);
});

test("查询对（page ↔ lookup）不算", () => {
  const changes = {
    "split:1": { newValue: { peer: 2, splitViewId: 7, mode: "split", role: "page", input: "text", engine: "", query: "q" } },
    "split:2": { newValue: { peer: 1, splitViewId: 7, mode: "split", role: "lookup", input: "text", engine: "b", query: "q" } },
  };
  assert.equal(isCompletion(changes, none), false);
});

test("查询对改写成搜索对（在 page 一侧搜索）：算完成", () => {
  const changes = {
    "split:1": { oldValue: { peer: 2, splitViewId: 7, mode: "split", role: "page", input: "text", engine: "", query: "q" }, newValue: rec(2, "q") },
    "split:2": { oldValue: { peer: 1, splitViewId: 7, mode: "split", role: "lookup", input: "text", engine: "b", query: "q" }, newValue: rec(1, "q") },
  };
  assert.equal(isCompletion(changes, none), true);
});

test("只有一侧、互不指向、删除、形状不对、别的键：不算", () => {
  assert.equal(isCompletion({ "split:1": { newValue: rec(2, "q") } }, none), false);
  assert.equal(isCompletion({ "split:1": { newValue: rec(3, "q") }, "split:2": { newValue: rec(1, "q") } }, none), false);
  assert.equal(isCompletion({ "split:1": { oldValue: rec(2, "q") }, "split:2": { oldValue: rec(1, "q") } }, none), false);
  assert.equal(isCompletion({ "split:1": { newValue: 2 }, "split:2": { newValue: 1 } }, none), false);
  assert.equal(isCompletion({ other: { newValue: rec(2, "q") } }, none), false);
  assert.equal(isCompletion({}, none), false);
  assert.equal(isCompletion(null, none), false);
});

test("一次变化里有别的记录也照样认出那一对", () => {
  const changes = { ...pair(5, 6, "q"), "split:9": { oldValue: rec(10, "z") } };
  assert.equal(isCompletion(changes, none), true);
});

test("tryTabs 缺省视为空", () => {
  assert.equal(isCompletion(pair(1, 2, "q")), true);
});
