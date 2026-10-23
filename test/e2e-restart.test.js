import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRestart } from "../scripts/e2e/restart.mjs";
import { runSteps } from "../scripts/e2e/runner.mjs";

function setup({ launch, waitExtension = async () => true } = {}) {
  const closed = [];
  const oldBrowser = { name: "旧", close: async o => { closed.push(o); } };
  const oldCol = { errors: [{ text: "[split-search] 旧" }], stopped: false, stop: async () => { oldCol.stopped = true; }, stats: () => ({ attached: 1, extAttached: 1 }) };
  const notes = [];
  const rt = { browser: oldBrowser, col: oldCol, closing: false, browserDead: false, restartFailed: false, stopReason: null, orphanErrors: null, notes, ctx: null };
  rt.ctx = { browser: oldBrowser, ext: { name: "旧 ext", state: async () => ({ tabs: [], windows: [], rules: [] }) }, consoleErrors: oldCol.errors, consoleCollector: oldCol,
    stopReason: () => rt.stopReason, timeoutMs: 1000, abortSignal: new AbortController().signal };
  const watched = [];
  const restart = makeRestart(rt, {
    launch, waitExtension, watchExit: b => watched.push(b), headless: true, port: 8765,
    collectConsole: async (b, { carry }) => ({ errors: carry.errors, stop: async () => {}, stats: () => carry.stats() }),
    bindExt: b => ({ name: `${b.name} ext` }),
  });
  rt.ctx.restartBrowser = restart;
  return { rt, restart, closed, oldCol, watched };
}

test("restart: 正常重启后 ctx 指向新浏览器，旧浏览器优雅关闭、收集器沿用", async () => {
  const nb = { name: "新" };
  const { rt, restart, closed, oldCol, watched } = setup({ launch: async o => { assert.deepEqual(o, { headless: true, restoreSession: true }); return nb; } });
  const r = await restart();
  assert.deepEqual(closed, [{ graceful: true }]);
  assert.equal(oldCol.stopped, true);
  assert.equal(rt.browser, nb);
  assert.equal(rt.ctx.browser, nb);
  assert.equal(rt.ctx.ext.name, "新 ext");
  assert.equal(r.browser, nb);
  assert.equal(rt.ctx.consoleErrors, oldCol.errors);
  assert.deepEqual(watched, [nb]);
  assert.equal(rt.stopReason, null);
});

test("restart: 启动失败 → 说明里有原因、不算“中途退出”、当前步骤失败带原因、剩余步骤跳过", async () => {
  const { rt } = setup({ launch: async () => { throw new Error("测试配置已被占用（pid 42）"); } });
  const step = (id, run) => ({ id, title: id, kind: "auto", needs: [], run });
  let ran = false;
  const rs = await runSteps([
    step("T5", async c => { Object.assign(c, await c.restartBrowser()); return { status: "pass" }; }),
    step("T6", async () => { ran = true; return { status: "pass" }; }),
  ], rt.ctx, { timeoutMs: 1000 });
  assert.ok(rt.notes.some(n => n.includes("重启浏览器失败") && n.includes("测试配置已被占用（pid 42）")), rt.notes.join("\n"));
  assert.ok(!rt.notes.some(n => n.includes("中途退出")));
  assert.equal(rt.browserDead, true);
  assert.equal(rt.restartFailed, true);
  assert.equal(rs[0].status, "fail");
  assert.match(rs[0].detail, /重启浏览器失败：测试配置已被占用/);
  assert.equal(rs[1].status, "skip");
  assert.match(rs[1].detail, /中断（测试浏览器重启失败）/);
  assert.equal(ran, false);
});

test("restart: 扩展页等待失败 → ctx 已指向新浏览器、原因写入说明、剩余步骤跳过", async () => {
  const nb = { name: "新" };
  const { rt } = setup({ launch: async () => nb, waitExtension: async () => { throw new Error("等待条件超时"); } });
  const step = (id, run) => ({ id, title: id, kind: "auto", needs: [], run });
  const rs = await runSteps([
    step("T10", async c => { Object.assign(c, await c.restartBrowser()); return { status: "pass" }; }),
    step("T13", async () => ({ status: "pass" })),
  ], rt.ctx, { timeoutMs: 1000 });
  assert.equal(rt.ctx.browser, nb);
  assert.equal(rt.ctx.ext.name, "新 ext");
  assert.equal(rt.browserDead, false, "浏览器还活着，run.mjs 仍会尝试恢复 storage");
  assert.equal(rt.stopReason, "重启后扩展不可用");
  assert.ok(rt.notes.some(n => n.includes("重启后扩展页不可用：等待条件超时")));
  assert.equal(rs[0].status, "fail");
  assert.match(rs[0].detail, /重启后扩展页不可用：等待条件超时/);
  assert.equal(rs[1].status, "skip");
  assert.match(rs[1].detail, /重启后扩展不可用/);
});

test("restart: 启动期间被中断 → 新浏览器仍登记到 rt.browser（由 run.mjs 恢复后关闭），抛出中断；rt.restarting 期间可等待、结束后清空", async () => {
  const ac = new AbortController();
  const nb = { name: "新" };
  let release;
  const { rt, restart, watched } = setup({ launch: () => new Promise(r => { release = () => r(nb); }) });
  rt.ctx.abortSignal = ac.signal;
  const p = restart();
  await new Promise(r => setTimeout(r, 10));
  assert.ok(rt.restarting, "重启进行中");
  assert.equal(rt.browser, null);
  ac.abort("收到 SIGINT");
  release();
  await assert.rejects(p, /重启浏览器期间运行被中断/);
  assert.equal(rt.browser, nb, "新浏览器登记在 rt.browser 上，不会成为孤儿");
  assert.deepEqual(watched, [nb]);
  assert.equal(rt.browserDead, false);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(rt.restarting, null);
});

test("restart: 关闭旧浏览器后发现已中断 → 不再启动新浏览器", async () => {
  const ac = new AbortController();
  let launched = false;
  const { rt, restart, closed } = setup({ launch: async () => { launched = true; return {}; } });
  rt.ctx.abortSignal = ac.signal;
  ac.abort("收到 SIGINT");
  await assert.rejects(restart(), /中断/);
  assert.deepEqual(closed, [{ graceful: true }]);
  assert.equal(launched, false);
  assert.equal(rt.browser, null, "run.mjs 据此写“浏览器不可用、快照保留”，不调用 restoreStorage(null)");
});
