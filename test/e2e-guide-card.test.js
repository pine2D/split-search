// 向导卡片（每步开始/等待结束时的卡片）、授权等待的中断竞速、恢复检查的中断、B1 不附诊断、afterShow 顺序
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSteps, startCard } from "../scripts/e2e/runner.mjs";
import { userWait, requestGrant, IDLE } from "../scripts/e2e/steps/guided.mjs";
import { ensureGrants, cleanupPrompt } from "../scripts/e2e/steps/setup.mjs";
import { ensureRecovered, makeAfterStep } from "../scripts/e2e/steps/recover.mjs";
import { STEPS } from "../scripts/e2e/steps/index.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const recGuide = () => {
  const g = { steps: [], results: [], setStep(s) { g.steps.push(s); }, setResult(...a) { g.results.push(a); }, setProgress() {},
    waitAnswer: () => new Promise(() => {}), cancel() {} };
  return g;
};
const state = { tabs: [], windows: [], rules: [] };
const baseCtx = over => ({ browser: {}, port: 8765, timeoutMs: 1000, abortSignal: new AbortController().signal,
  ext: { state: async () => state }, guide: recGuide(), log: () => {}, ...over });

test("runSteps: 每步开始先换向导卡片——auto 步骤提示别动浏览器（无按钮），重启步骤预告重启；等人的步骤先显示“准备中”", async () => {
  const ctx = baseCtx();
  const seenAtRun = [];
  const st = (id, kind, extra = {}) => ({ id, title: `标题${id}`, kind, needs: [], ...extra,
    run: async () => { seenAtRun.push(ctx.guide.steps.at(-1)); return { status: "pass", detail: "" }; } });
  await runSteps([st("B5", "auto"), st("T5", "auto", { restarts: true }), st("T11", "assist")], ctx, { timeoutMs: 1000 });
  assert.equal(seenAtRun[0].title, "B5 标题B5（自动执行中）");
  assert.deepEqual(seenAtRun[0].buttons, []);
  assert.match(seenAtRun[0].instruction, /请不要点击或切换标签/);
  assert.doesNotMatch(seenAtRun[0].instruction, /重新打开/);
  assert.match(seenAtRun[1].instruction, /关闭并重新打开测试浏览器/);
  assert.equal(seenAtRun[2].title, "T11 标题T11");
  assert.deepEqual(seenAtRun[2].buttons, []);
  assert.match(seenAtRun[2].instruction, /准备/);
  assert.deepEqual(startCard({ id: "X", title: "y", kind: "judge" }).buttons, []);
});

test("STEPS: T5、T10 标了 restarts；B1 标了 noDiag", () => {
  const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));
  assert.equal(byId.T5.restarts, true);
  assert.equal(byId.T10.restarts, true);
  assert.equal(byId.B1.noDiag, true);
});

test("runSteps: noDiag 的 assist 步骤跳过时不附诊断，其他 assist 跳过照附", async () => {
  const ctx = baseCtx();
  const rs = await runSteps([
    { id: "B1", title: "b1", kind: "assist", needs: [], noDiag: true, run: async () => ({ status: "skip", detail: "已安装" }) },
    { id: "T1", title: "t1", kind: "assist", needs: [], run: async () => ({ status: "skip", detail: "用户跳过" }) },
  ], ctx, { timeoutMs: 1000 });
  assert.equal(rs[0].detail, "已安装");
  assert.equal(rs[0].diag, undefined);
  assert.match(rs[1].detail, /诊断/);
});

test("userWait: 结束后换成无按钮的“处理中”卡片；afterShow 在说明显示之后执行", async () => {
  const g = recGuide();
  const order = [];
  const r = await userWait({ guide: g, timeoutMs: 1000 }, {
    title: "B4", what: "w", instruction: "说明", hint: null, intervalMs: 5, afterShowMs: 10,
    afterShow: async () => { order.push(`切换时已显示：${g.steps.at(-1).title}`); },
    probe: async () => "ok",
  });
  assert.equal(r.kind, "met");
  assert.deepEqual(order, ["切换时已显示：B4"]);
  assert.deepEqual(g.steps.at(-1), IDLE);
});

// 授权框挂起（用户不点）：evalExt 永不返回
const hangingBrowser = () => ({
  evalExt: async expr => (expr.includes("permissions.request") ? new Promise(() => {}) : expr.includes("contains") ? false : true),
  client: { send: async m => (m === "Target.getTargets" ? { targetInfos: [] } : {}) },
});

test("requestGrant: 等授权框时运行被中断立即抛出，不等满 5 分钟", async () => {
  const ac = new AbortController();
  const p = requestGrant({ browser: hangingBrowser(), guide: recGuide(), port: 8765, abortSignal: ac.signal }, ["http://a/*"]);
  setTimeout(() => ac.abort("收到 SIGINT"), 1700); // requestGrant 先停顿 1.5 秒让用户看到说明
  const t0 = Date.now();
  await assert.rejects(p, /中断/);
  assert.ok(Date.now() - t0 < 4000);
});

test("ensureGrants: 授权申请抛出（超时/中断）时返回“授权未完成”，不让整次运行出错", async () => {
  const ac = new AbortController();
  ac.abort("x");
  const r = await ensureGrants({ browser: hangingBrowser(), guide: recGuide(), port: 8765, abortSignal: ac.signal }, { autoOnly: false });
  assert.deepEqual([r.ok, r.requested], [false, true]);
  assert.match(r.detail, /授权未完成/);
});

test("ensureRecovered / afterStep: 中断后不再申请授权，返回“中断”，不记“授权未恢复”也不设 stopReason", async () => {
  const ac = new AbortController();
  let requests = 0;
  const deps = { alive: async () => true, has: async () => false, request: async () => { requests++; ac.abort("收到 SIGINT"); return false; },
    wait: async () => ({ kind: "met" }), focus: async () => {} };
  const ctx = { port: 8765, timeoutMs: 1000, guide: recGuide(), abortSignal: ac.signal };
  const r = await ensureRecovered(ctx, deps);
  assert.deepEqual([r.ok, r.reason, requests], [false, "中断", 1], "第一次申请时被中断，不再申请第二次");
  const rt = { notes: [], stopReason: null, ctx };
  await makeAfterStep(rt, {}, deps)({ id: "T8", restores: true });
  assert.deepEqual(rt.notes, []);
  assert.equal(rt.stopReason, null);
});

test("cleanupPrompt: 返回 { confirmed, note }；用户点“我已完成”时 confirmed 为真", async () => {
  const g = recGuide();
  g.waitAnswer = () => sleep(5).then(() => "done");
  const fakeBrowser = { client: { send: async m => (m === "Target.getTargets" ? { targetInfos: [] } : {}) } };
  const r = await cleanupPrompt({ guide: g, browser: fakeBrowser, port: 8765, timeoutMs: 1000 }, [{ cleanup: ["access"] }]);
  assert.equal(r.confirmed, true);
  assert.match(r.note, /用户已确认/);
  assert.equal(await cleanupPrompt({ guide: g, browser: fakeBrowser, port: 8765 }, [{}]), null);
  assert.equal(await cleanupPrompt({ guide: g, browser: fakeBrowser, port: 8765 }, [{ cleanup: ["default", "gb"] }]), null, "只有测试配置里的固定条目时不再打扰用户");
});
