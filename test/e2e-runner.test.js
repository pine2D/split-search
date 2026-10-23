import { test } from "node:test";
import assert from "node:assert/strict";
import { runSteps } from "../scripts/e2e/runner.mjs";
import { STEPS, selectSteps, compareStepIds, sortSteps } from "../scripts/e2e/steps/index.mjs";

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
  const [r] = await runSteps([step("T5", c => new Promise(() => { seen = c.signal; }))], ctx, { timeoutMs: 30, settleMs: 50 });
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
  ], ctx, { timeoutMs: 5000, settleMs: 50 });
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

test("runSteps: assist 步骤被跳过时如实记录，并附当时的诊断", async () => {
  const { ctx } = makeCtx();
  const [r] = await runSteps([step("T9", async () => ({ status: "skip", detail: "用户点了跳过" }), "assist")], ctx, { timeoutMs: 1000 });
  assert.equal(r.status, "skip");
  assert.equal(r.kind, "assist");
  assert.match(r.detail, /^用户点了跳过\n诊断/);
  assert.match(r.detail, /engine-a\.localhost/);
  assert.deepEqual(r.diag, fakeState);
});

test("runSteps: auto / judge 步骤跳过不附诊断", async () => {
  const { ctx } = makeCtx();
  const rs = await runSteps([
    step("B3", async () => ({ status: "skip", detail: "不适用" })),
    step("B14", async () => ({ status: "skip", detail: "用户跳过" }), "judge"),
  ], ctx, { timeoutMs: 1000 });
  assert.deepEqual(rs.map(r => [r.detail, r.diag]), [["不适用", undefined], ["用户跳过", undefined]]);
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
  const plain = STEPS.filter(s => !s.last).map(s => s.id); // last 步骤另有测试
  assert.deepEqual(plain, [...plain].sort(compareStepIds));
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

test("STEPS: B15 标记 last 且排在最后，后注册的 T 步骤仍在它之前", () => {
  assert.equal(STEPS.at(-1).id, "B15");
  assert.equal(STEPS.at(-1).last, true);
  const all = sortSteps([...STEPS, { id: "T9", title: "t", kind: "auto", needs: [], run: async () => ({ status: "pass" }) }]);
  assert.equal(all.at(-1).id, "B15");
  const order = all.map(s => s.id);
  assert.ok(order.indexOf("T9") > order.indexOf("T7") && order.indexOf("T9") < order.indexOf("T10"), order.join(","));
});

test("runSteps: 超时后等步骤真正结束（有上限）再开始下一步", async () => {
  const { ctx } = makeCtx();
  const order = [];
  const rs = await runSteps([
    step("B2", c => new Promise(r => {
      c.signal.addEventListener("abort", () => setTimeout(() => { order.push("B2 收尾完成"); r({ status: "pass" }); }, 60));
    })),
    step("B3", async () => { order.push("B3 开始"); return { status: "pass", detail: "" }; }),
  ], ctx, { timeoutMs: 20, settleMs: 2000 });
  assert.deepEqual(order, ["B2 收尾完成", "B3 开始"]);
  assert.equal(rs[0].status, "fail");
  assert.match(rs[0].detail, /超时/);
  assert.doesNotMatch(rs[0].detail, /收尾期限/);
});

test("runSteps: 步骤一直不结束时，最多等 settleMs 就继续并在说明里注明", async () => {
  const { ctx } = makeCtx();
  let started = 0;
  const t0 = Date.now();
  const rs = await runSteps([
    step("B2", () => new Promise(() => {})),
    step("B3", async () => { started = Date.now(); return { status: "pass", detail: "" }; }),
  ], ctx, { timeoutMs: 20, settleMs: 80 });
  assert.ok(started - t0 >= 95, `B3 过早开始：${started - t0} ms`);
  assert.match(rs[0].detail, /收尾期限内仍未结束/);
  assert.equal(rs[1].status, "pass");
});

test("runSteps: 中断后也等当前步骤收尾，runSteps 才返回", async () => {
  const ac = new AbortController();
  const { ctx } = makeCtx({ abortSignal: ac.signal });
  let finished = false;
  setTimeout(() => ac.abort("收到 SIGINT"), 10);
  const rs = await runSteps([
    step("B2", c => new Promise(r => {
      c.signal.addEventListener("abort", () => setTimeout(() => { finished = true; r({ status: "pass" }); }, 50));
    })),
  ], ctx, { timeoutMs: 5000, settleMs: 2000 });
  assert.equal(finished, true);
  assert.equal(rs[0].status, "skip");
});

test("guarded: signal 已中断时不写回 storage", async () => {
  const { guarded } = await import("../scripts/e2e/steps/optpage.mjs");
  const exprs = [];
  const ext = { eval: async expr => { exprs.push(expr); return expr.includes(".get(") ? { order: ["ea"] } : true; } };
  const ac = new AbortController();
  const ctx = { ext, signal: ac.signal, log: () => {} };
  const r = await guarded(ctx, ["order"], async () => { ac.abort(); return { status: "pass", detail: "做完了" }; });
  assert.equal(exprs.filter(e => /\.(set|remove)\(/.test(e)).length, 0, exprs.join("\n"));
  assert.equal(r.status, "skip");
  assert.match(r.detail, /跳过 order 的写回/);
  // 运行级中断同样跳过
  const ac2 = new AbortController();
  exprs.length = 0;
  await assert.rejects(guarded({ ext, abortSignal: ac2.signal }, ["order"], async () => { ac2.abort(); throw new Error("坏了"); }), /坏了/);
  assert.equal(exprs.filter(e => /\.(set|remove)\(/.test(e)).length, 0);
});

test("guarded: 未中断时照常写回并读回核对", async () => {
  const { guarded } = await import("../scripts/e2e/steps/optpage.mjs");
  const exprs = [];
  const ext = { eval: async expr => { exprs.push(expr); return expr.includes(".get(") ? { order: ["ea"] } : true; } };
  const r = await guarded({ ext, signal: new AbortController().signal }, ["order"], async () => ({ status: "pass", detail: "好" }));
  assert.equal(r.status, "pass");
  assert.equal(exprs.filter(e => /\.set\(/.test(e)).length, 1);
});

test("STEPS: 分屏流程步骤都已登记为 auto", () => {
  const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));
  for (const id of ["CORE-NEW", "CORE-EXISTING", "T5", "T6", "T7", "T10", "T13"]) assert.equal(byId[id]?.kind, "auto", id);
});
