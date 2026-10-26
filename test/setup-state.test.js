import { test } from "node:test";
import assert from "node:assert/strict";
import { setupView, countsAsSetup, addTryTab, TRY_TABS_MAX } from "../src/lib/setup-state.js";

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

// ---- countsAsSetup：go.html 写入一对搜索记录之后，算不算“设置完成” ----

test("真实触发写入一对、两侧和当前标签都不是“试一下”的标签：算完成", () => {
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: [], tabIds: [1, 2] }), true);
  assert.equal(countsAsSetup({ setupDone: undefined, tryTabs: [9], tabIds: [1, 2] }), true);
});

test("全新的相邻对（窄窗口）、在旁边新开的一对同样算：只看写入的标签 id", () => {
  // 相邻对与分屏写的都是同一对标签 id；在旁边新开一对时 tabIds 是当前标签加上新的两侧
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: [], tabIds: [5, 101] }), true);
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: [4], tabIds: [4, 102, 103] }), false);
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: [], tabIds: [4, 102, 103] }), true);
});

test("任一侧是“试一下”打开的标签：不算", () => {
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: [1], tabIds: [1, 2] }), false);
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: [7, 2], tabIds: [1, 2] }), false);
});

test("已经完成过：不再写", () => {
  assert.equal(countsAsSetup({ setupDone: true, tryTabs: [], tabIds: [1, 2] }), false);
});

test("没有写入一对（tabIds 不足两个或不是整数）、tryTabs 形状不对：按安全的一侧处理", () => {
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: [], tabIds: [1] }), false);
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: [], tabIds: null }), false);
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: [], tabIds: [1, "2"] }), false);
  // 读不出 tryTabs（不是数组）当作空：此时只差“试一下”的排除，标签 id 照样核对
  assert.equal(countsAsSetup({ setupDone: false, tryTabs: "x", tabIds: [1, 2] }), true);
  assert.equal(countsAsSetup({}), false);
});

// ---- addTryTab：“试一下”打开的标签 id 追加进 setupTryTabs ----

test("addTryTab：追加、去重、只留最近 max 个；不是数组当作空，不是整数不加", () => {
  assert.deepEqual(addTryTab([], 3), [3]);
  assert.deepEqual(addTryTab([1, 2], 3), [1, 2, 3]);
  assert.deepEqual(addTryTab([1, 3, 2], 3), [1, 2, 3]);
  assert.deepEqual(addTryTab(undefined, 3), [3]);
  assert.deepEqual(addTryTab(["x", 1], 3), [1, 3]);
  assert.deepEqual(addTryTab([1, 2, 3], 4, 3), [2, 3, 4]);
  assert.deepEqual(addTryTab([1], "4"), [1]);
  assert.equal(addTryTab(Array.from({ length: 60 }, (_, i) => i), 99).length, TRY_TABS_MAX);
});
