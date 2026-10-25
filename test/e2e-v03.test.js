import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPairRecords, findAdjacent, queryOf } from "../scripts/e2e/steps/v03-lib.mjs";
import { expectPair } from "../scripts/e2e/steps/util.mjs";

const L = { id: 11 }, R = { id: 12 };
const want = { mode: "split", splitViewId: 7, engines: ["ea", "eb"], query: "a b" };
const good = () => ({
  11: { peer: 12, splitViewId: 7, mode: "split", engine: "ea", query: "a b" },
  12: { peer: 11, splitViewId: 7, mode: "split", engine: "eb", query: "a b" },
});

test("queryOf: + 还原为空格并解码", () => {
  assert.equal(queryOf("t16+one"), "t16 one");
  assert.equal(queryOf("a%26b+c"), "a&b c");
});

test("checkPairRecords: 两条记录互指、字段齐全时无问题", () => {
  assert.deepEqual(checkPairRecords(good(), L, R, want), []);
});

test("checkPairRecords: 缺记录、旧版裸数字、字段不符、多余字段都报出来", () => {
  const missing = good(); delete missing[12];
  assert.match(checkPairRecords(missing, L, R, want).join(), /右侧标签 12 没有记录/);
  const bare = good(); bare[11] = 12;
  assert.match(checkPairRecords(bare, L, R, want).join(), /左侧标签 11 没有记录/);
  const wrong = good(); wrong[12].splitViewId = 8; wrong[11].engine = "eb";
  const p = checkPairRecords(wrong, L, R, want).join("；");
  assert.match(p, /右侧记录 splitViewId 应为 7，实际 8/);
  assert.match(p, /左侧记录 engine 应为 "ea"，实际 "eb"/);
  const extra = good(); extra[11].side = "left";
  assert.match(checkPairRecords(extra, L, R, want).join(), /左侧记录字段应为 engine,mode,peer,query,splitViewId/);
  assert.equal(checkPairRecords(undefined, L, R, want).length, 2);
});

test("findAdjacent: 同窗口、都不在分屏、右侧紧挨左侧且加载完成才算", () => {
  const [l, r] = expectPair(8765, "x");
  const tab = (id, index, url, extra = {}) => ({ id, index, windowId: 1, splitViewId: -1, url, status: "complete", ...extra });
  assert.deepEqual(findAdjacent({ tabs: [tab(1, 0, l), tab(2, 1, r)] }, 8765, "x").map(t => t.id), [1, 2]);
  assert.equal(findAdjacent({ tabs: [tab(1, 0, l), tab(2, 2, r)] }, 8765, "x"), null, "不紧挨");
  assert.equal(findAdjacent({ tabs: [tab(1, 0, l), tab(2, 1, r, { splitViewId: 5 })] }, 8765, "x"), null, "在分屏中");
  assert.equal(findAdjacent({ tabs: [tab(1, 0, l), tab(2, 1, r, { windowId: 2 })] }, 8765, "x"), null, "不同窗口");
  assert.equal(findAdjacent({ tabs: [tab(1, 0, l), tab(2, 1, r, { status: "loading" })] }, 8765, "x"), null, "没加载完");
  assert.equal(findAdjacent({ tabs: [tab(2, 0, r), tab(1, 1, l)] }, 8765, "x"), null, "左右颠倒");
  assert.equal(findAdjacent(undefined, 8765, "x"), null);
});

test("STEPS: T16、T17、T18 是 auto，--auto-only 会跑；T16 标了 restarts；B2 改成弹窗", async () => {
  const { STEPS, selectSteps } = await import("../scripts/e2e/steps/index.mjs");
  const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));
  for (const id of ["T16", "T17", "T18"]) assert.equal(byId[id]?.kind, "auto", id);
  assert.equal(byId.T16.restarts, true);
  assert.equal(byId.T16.timeoutMs, 180000);
  assert.equal(byId.T17.timeoutMs, 240000); // 8 个子项（含 (g)(h)）
  assert.match(byId.B2.title, /弹窗/);
  const auto = selectSteps(STEPS, { autoOnly: true, xinput: false }).map(s => s.id);
  for (const id of ["B2", "T16", "T17", "T18"]) assert.ok(auto.includes(id), id);
});
