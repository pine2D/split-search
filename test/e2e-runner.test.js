import { test } from "node:test";
import assert from "node:assert/strict";
import { runSteps } from "../scripts/e2e/runner.mjs";
import { STEPS, selectSteps, compareStepIds } from "../scripts/e2e/steps/index.mjs";

const fakeState = {
  tabs: [{ id: 11, index: 0, windowId: 1, splitViewId: 7, pinned: false, groupId: -1, url: "http://engine-a.localhost:8765/search?q=x", status: "complete" }],
  windows: [{ id: 1, type: "normal", focused: true }],
  rules: [],
};

function makeCtx(over = {}) {
  const calls = { progress: [], results: [], logs: [] };
  const ctx = {
    browser: {}, port: 8765, timeoutMs: 1000,
    abortSignal: new AbortController().signal,
    ext: { state: async () => fakeState },
    guide: {
      setProgress: (d, t) => calls.progress.push([d, t]),
      setResult: (id, s, d) => calls.results.push([id, s, d]),
      setStep: () => {},
    },
    log: m => calls.logs.push(m),
    ...over,
  };
  return { ctx, calls };
}
const step = (id, run, kind = "auto", extra = {}) => ({ id, title: `步骤 ${id}`, kind, needs: [], run, ...extra });

test("runSteps: 通过的步骤记录状态与耗时", async () => {
  const { ctx, calls } = makeCtx();
  const [r] = await runSteps([step("B5", async () => ({ status: "pass", detail: "好" }))], ctx, { timeoutMs: 1000 });
  assert.equal(r.id, "B5"); assert.equal(r.kind, "auto"); assert.equal(r.status, "pass"); assert.equal(r.detail, "好");
  assert.equal(typeof r.durationMs, "number");
  assert.deepEqual(calls.results, [["B5", "pass", "好"]]);
  assert.deepEqual(calls.progress.at(-1), [1, 1]);
});

test("runSteps: 抛异常记为 fail 并附诊断，后续步骤继续执行", async () => {
  const { ctx } = makeCtx();
  const rs = await runSteps([
    step("B6", async () => { throw new Error("对话框没打开"); }),
    step("B7", async () => ({ status: "pass", detail: "" })),
  ], ctx, { timeoutMs: 1000 });
  assert.equal(rs[0].status, "fail");
  assert.match(rs[0].detail, /对话框没打开/);
  assert.match(rs[0].detail, /诊断/);
  assert.match(rs[0].detail, /engine-a\.localhost/);
  assert.match(rs[0].detail, /split=7/);
  assert.deepEqual(rs[0].diag, fakeState);
  assert.equal(rs[1].status, "pass");
});

test("runSteps: 步骤自报 fail 也附诊断；读状态失败时说明原因", async () => {
  const { ctx } = makeCtx({ ext: { state: async () => { throw new Error("浏览器没了"); } } });
  const [r] = await runSteps([step("B8", async () => ({ status: "fail", detail: "网址不对" }))], ctx, { timeoutMs: 1000 });
  assert.equal(r.status, "fail");
  assert.match(r.detail, /网址不对/);
  assert.match(r.detail, /无法读取状态.*浏览器没了/);
});

test("runSteps: 超时记为 fail，并通知步骤的 signal", async () => {
  const { ctx } = makeCtx();
  let seen;
  const [r] = await runSteps([step("T5", c => new Promise(() => { seen = c.signal; }))], ctx, { timeoutMs: 30 });
  assert.equal(r.status, "fail");
  assert.match(r.detail, /超时/);
  assert.equal(seen.aborted, true);
});

test("runSteps: 步骤自带 timeoutMs 优先", async () => {
  const { ctx } = makeCtx();
  const slow = step("T9", () => new Promise(r => setTimeout(() => r({ status: "pass", detail: "" }), 60)), "assist", { timeoutMs: 500 });
  const [r] = await runSteps([slow], ctx, { timeoutMs: 20 });
  assert.equal(r.status, "pass");
});

test("runSteps: 中断后当前与剩余步骤记为 skip（中断）", async () => {
  const ac = new AbortController();
  const { ctx } = makeCtx({ abortSignal: ac.signal });
  const rs = await runSteps([
    step("B2", async () => ({ status: "pass", detail: "" })),
    step("B3", () => { setTimeout(() => ac.abort(), 10); return new Promise(() => {}); }),
    step("B5", async () => ({ status: "pass", detail: "不该执行" })),
  ], ctx, { timeoutMs: 5000 });
  assert.deepEqual(rs.map(r => r.status), ["pass", "skip", "skip"]);
  assert.match(rs[1].detail, /中断/);
  assert.match(rs[2].detail, /中断/);
  assert.equal(rs.length, 3);
});

test("runSteps: 开始前已中断则全部 skip", async () => {
  const ac = new AbortController(); ac.abort();
  const { ctx } = makeCtx({ abortSignal: ac.signal });
  let ran = false;
  const rs = await runSteps([step("B5", async () => { ran = true; return { status: "pass" }; })], ctx, { timeoutMs: 100 });
  assert.equal(ran, false);
  assert.equal(rs[0].status, "skip");
  assert.match(rs[0].detail, /中断/);
});

test("runSteps: assist 步骤 resolve 为 skip 时如实记录，不附诊断", async () => {
  const { ctx } = makeCtx();
  const [r] = await runSteps([step("T9", async () => ({ status: "skip", detail: "用户点了跳过" }), "assist")], ctx, { timeoutMs: 1000 });
  assert.equal(r.status, "skip");
  assert.equal(r.kind, "assist");
  assert.equal(r.detail, "用户点了跳过");
  assert.equal(r.diag, undefined);
});

test("runSteps: 返回值不合法记为 fail", async () => {
  const { ctx } = makeCtx();
  const [r] = await runSteps([step("B5", async () => "ok")], ctx, { timeoutMs: 1000 });
  assert.equal(r.status, "fail");
  assert.match(r.detail, /返回值/);
});

const fakes = [step("T7", null), step("B2", null), step("T9", null, "assist"), step("B14", null, "judge"), step("CORE-NEW", null), step("B10", null)];

test("compareStepIds: B 系列在前，T 按数字排序", () => {
  const ids = ["T10", "B10", "T2", "CORE-NEW", "B2", "T13"].sort(compareStepIds);
  assert.deepEqual(ids, ["B2", "B10", "CORE-NEW", "T2", "T10", "T13"]);
});

test("selectSteps: autoOnly 只留 auto", () => {
  assert.deepEqual(selectSteps(fakes, { autoOnly: true, only: null }).map(s => s.id), ["T7", "B2", "CORE-NEW", "B10"]);
  assert.equal(selectSteps(fakes, { autoOnly: false, only: null }).length, 6);
});

test("selectSteps: only 按 id 过滤，未知 id 抛出", () => {
  assert.deepEqual(selectSteps(fakes, { autoOnly: false, only: ["B2", "T9"] }).map(s => s.id), ["B2", "T9"]);
  assert.deepEqual(selectSteps(fakes, { autoOnly: true, only: ["B2", "T9"] }).map(s => s.id), ["B2"]);
  assert.throws(() => selectSteps(fakes, { autoOnly: false, only: ["B2", "X1"] }), /未知步骤.*X1/);
});

test("STEPS: 已注册 B5 且按编号排序、形状正确", () => {
  const ids = STEPS.map(s => s.id);
  assert.ok(ids.includes("B5"));
  assert.deepEqual(ids, [...ids].sort(compareStepIds));
  assert.equal(new Set(ids).size, ids.length);
  for (const s of STEPS) {
    assert.ok(["auto", "assist", "judge"].includes(s.kind), s.id);
    assert.equal(typeof s.run, "function");
    assert.ok(Array.isArray(s.needs) && s.title);
  }
});

test("checkB5: 正确规则通过；缺 host、多出 engine-c、错误的替换都报出", async () => {
  const { checkB5, REAL_HOSTS } = await import("../scripts/e2e/steps/options.mjs");
  const good = [{ id: 1, condition: { requestDomains: [...REAL_HOSTS, "engine-a.localhost", "engine-b.localhost"] },
    action: { redirect: { regexSubstitution: "chrome-extension://alngkkgnobglnfbhcplhpaflcgfiajnj/go.html?u=\\0" } } }];
  assert.deepEqual(checkB5(good, 8765), []);
  assert.match(checkB5([], 8765)[0], /恰好 1 条/);
  const bad = structuredClone(good);
  bad[0].condition.requestDomains = ["kagi.com", "engine-c.localhost"];
  bad[0].action.redirect.regexSubstitution = "chrome-extension://other/go.html?u=\\0";
  const p = checkB5(bad, 8765).join("\n");
  assert.match(p, /缺少 www\.google\.com/);
  assert.match(p, /缺少 engine-a\.localhost/);
  assert.match(p, /不应包含.*engine-c/);
  assert.match(p, /regexSubstitution/);
});

test("runSteps: 中断原因写进说明", async () => {
  const ac = new AbortController(); ac.abort("测试浏览器已退出");
  const { ctx } = makeCtx({ abortSignal: ac.signal });
  const [r] = await runSteps([step("B5", async () => ({ status: "pass" }))], ctx, { timeoutMs: 100 });
  assert.equal(r.detail, "中断（测试浏览器已退出）");
});
