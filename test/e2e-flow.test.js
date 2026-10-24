import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPairs, expectPair, trigger, isPair, summarize } from "../scripts/e2e/steps/util.mjs";
import { collectConsole } from "../scripts/e2e/console.mjs";

const tab = (id, index, splitViewId, windowId = 1, url = "") => ({ id, index, splitViewId, windowId, url, status: "complete" });

test("splitPairs: 按 splitViewId 分组、组内按 index 排左右，忽略未分屏标签", () => {
  const st = { tabs: [tab(5, 4, 9), tab(1, 0, -1), tab(4, 3, 9), tab(7, 1, 2, 2), tab(8, 0, 2, 2), tab(3, 2, undefined)] };
  const pairs = splitPairs(st);
  assert.deepEqual(pairs.map(p => p.map(t => t.id)), [[4, 5], [8, 7]]);
  assert.deepEqual(splitPairs({ tabs: [] }), []);
  assert.deepEqual(splitPairs(undefined), []);
});

test("expectPair/trigger: 左侧保留 +，右侧用 %20；触发网址带 _ss", () => {
  assert.equal(trigger(8765, "hello+world"), "http://engine-a.localhost:8765/search?q=hello+world&_ss=ea,eb");
  assert.deepEqual(expectPair(8765, "hello+world"),
    ["http://engine-a.localhost:8765/search?q=hello+world", "http://engine-b.localhost:8765/search?q=hello%20world"]);
  const [l, r] = expectPair(8765, "x");
  assert.equal(isPair([tab(1, 0, 3, 1, l), tab(2, 1, 3, 1, r)], 8765, "x"), true);
  assert.equal(isPair([tab(1, 0, 3, 1, r), tab(2, 1, 3, 1, l)], 8765, "x"), false, "左右颠倒不算");
  assert.equal(isPair([tab(1, 0, 3, 1, l + "&_ss=ea,eb"), tab(2, 1, 3, 1, r)], 8765, "x"), false, "左侧含 _ss 不算");
});

test("summarize: 任一子项失败即失败，跳过项不致失败；首行是计数", () => {
  const mixed = summarize([{ name: "a", status: "pass", detail: "" }, { name: "b", status: "skip", detail: "原因" }]);
  assert.equal(mixed.status, "pass");
  assert.equal(mixed.detail.split("\n")[0], "共 2 项：通过 1，跳过 1，失败 0（未覆盖：b（跳过））");
  const r = summarize([{ name: "a", status: "pass", detail: "" }, { name: "b", status: "fail", detail: "坏" }]);
  assert.equal(r.status, "fail");
  assert.match(r.detail, /b：失败——坏/);
  assert.equal(r.detail.split("\n")[0], "共 2 项：通过 1，跳过 0，失败 1");
});

test("summarize: 全部跳过判跳过，不是通过；没有子项也判跳过", () => {
  const r = summarize([{ name: "(a)", status: "skip", detail: "用户点了“跳过”" }, { name: "(b)", status: "skip", detail: "x" }]);
  assert.equal(r.status, "skip");
  assert.equal(r.detail.split("\n")[0], "共 2 项：通过 0，跳过 2，失败 0");
  assert.equal(summarize([]).status, "skip");
});

test("splitPairs: 只有一个标签的分组（另一侧刚关闭）不算一对", () => {
  assert.deepEqual(splitPairs({ tabs: [tab(1, 0, 4), tab(2, 1, 5), tab(3, 2, 5)] }).map(p => p.map(t => t.id)), [[2, 3]]);
});

function fakeBrowser() {
  const handlers = new Map();
  const client = {
    on: (m, fn) => handlers.set(m, fn), off: m => handlers.delete(m), send: async () => ({}),
    emit: (m, p, sid) => handlers.get(m)?.(p, sid),
  };
  return { client };
}

test("collectConsole: carry 沿用重启前的错误列表与附着计数", async () => {
  const b1 = fakeBrowser();
  const c1 = await collectConsole(b1);
  b1.client.emit("Target.attachedToTarget", { sessionId: "s1", targetInfo: { type: "page", url: "chrome-extension://alngkkgnobglnfbhcplhpaflcgfiajnj/go.html" } });
  b1.client.emit("Runtime.consoleAPICalled", { type: "error", args: [{ type: "string", value: "[split-search] 旧错误" }], timestamp: 1 }, "s1");
  await c1.stop();
  const b2 = fakeBrowser();
  const c2 = await collectConsole(b2, { carry: c1 });
  b2.client.emit("Target.attachedToTarget", { sessionId: "s2", targetInfo: { type: "service_worker", url: "chrome-extension://alngkkgnobglnfbhcplhpaflcgfiajnj/background.js" } });
  b2.client.emit("Runtime.consoleAPICalled", { type: "error", args: [{ type: "string", value: "[split-search] 新错误" }], timestamp: 2 }, "s2");
  assert.equal(c2.errors, c1.errors);
  assert.deepEqual(c2.errors.map(e => e.text), ["[split-search] 旧错误", "[split-search] 新错误"]);
  assert.deepEqual(c2.stats(), { attached: 2, extAttached: 2 });
});
