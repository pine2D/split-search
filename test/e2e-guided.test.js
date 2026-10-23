import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/e2e/server.mjs";
import { userWait, assist, judge } from "../scripts/e2e/steps/guided.mjs";
import { b1Verdict, kagiLoggedIn, ensureKagi, cleanupItems, ensureGrants, withNeeds } from "../scripts/e2e/steps/setup.mjs";
import { ensureRecovered, makeAfterStep } from "../scripts/e2e/steps/recover.mjs";
import { runSteps } from "../scripts/e2e/runner.mjs";
import { STEPS, selectSteps } from "../scripts/e2e/steps/index.mjs";
import { gbPair, isSearch } from "../scripts/e2e/steps/assisted.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 向导等待：用真实的 guide（server.mjs），按 seq 作答 ----
async function withGuide(fn) {
  const srv = await startServer({ port: 0 });
  try { return await fn(srv.guide); } finally { await srv.close(); }
}
const ctxOf = (guide, over = {}) => ({ guide, timeoutMs: 2000, abortSignal: new AbortController().signal, ...over });
const answerSoon = (guide, a, ms = 50) => sleep(ms).then(() => guide.answer(guide.state().seq, a));

test("assist: 条件满足判通过，并在向导页记一条结果", async () => withGuide(async guide => {
  let n = 0;
  const r = await assist(ctxOf(guide), { title: "T3", what: "分屏", instruction: "拖", intervalMs: 10, hint: null, probe: async () => ++n >= 3 && "ok" });
  assert.equal(r.status, "pass");
  assert.equal(guide.state().results.at(-1).id, "T3");
  assert.deepEqual(guide.state().step.buttons, ["skip", "retry"]);
}));

test("assist: 点跳过判跳过；超时判失败并写明在等什么", async () => withGuide(async guide => {
  const p = assist(ctxOf(guide), { title: "T11", what: "右键分屏", instruction: "x", intervalMs: 10, hint: null, probe: async () => false });
  await answerSoon(guide, "skip");
  const r = await p;
  assert.equal(r.status, "skip");
  assert.match(r.detail, /跳过.*右键分屏/);
  const t = await assist(ctxOf(guide), { title: "T11", what: "右键分屏", instruction: "x", intervalMs: 10, timeoutMs: 80, hint: null,
    probe: async () => { throw new Error("读不到"); } });
  assert.equal(t.status, "fail");
  assert.match(t.detail, /未等到：右键分屏.*读不到/);
}));

test("userWait: 重试会重新 setStep（新 seq）再等；旧 seq 的答案作废；可多次重试", async () => withGuide(async guide => {
  let retried = 0;
  const p = userWait(ctxOf(guide), { title: "T1", what: "w", instruction: "x", intervalMs: 10, hint: null, timeoutMs: 5000,
    probe: async () => false, onRetry: () => { retried++; } });
  await sleep(30);
  const s1 = guide.state().seq;
  assert.equal(guide.answer(s1, "retry"), true);
  await sleep(60);
  const s2 = guide.state().seq;
  assert.ok(s2 > s1, "重试后应有新的 seq");
  assert.equal(guide.answer(s1, "skip"), false, "旧 seq 的答案应被拒绝");
  assert.equal(guide.answer(s2, "retry"), true);
  await sleep(60);
  const s3 = guide.state().seq;
  assert.ok(s3 > s2);
  guide.answer(s3, "skip");
  const r = await p;
  assert.deepEqual(r, { kind: "answer", answer: "skip" });
  assert.equal(retried, 2);
}));

test("userWait: 出现提示（如 Google 人机验证）时重新 setStep，说明前加上提示，仍可作答", async () => withGuide(async guide => {
  let hint = null;
  const p = userWait(ctxOf(guide), { title: "T1", what: "w", instruction: "原说明", intervalMs: 10, probe: async () => false, hint: async () => hint });
  await sleep(30);
  const s1 = guide.state().seq;
  hint = "请完成验证";
  await sleep(60);
  const st = guide.state();
  assert.ok(st.seq > s1);
  assert.match(st.step.instruction, /^⚠ 请完成验证\n\n原说明/);
  guide.answer(st.seq, "skip");
  assert.equal((await p).answer, "skip");
}));

test("userWait: 运行被中断时抛出", async () => withGuide(async guide => {
  const ac = new AbortController();
  const p = userWait(ctxOf(guide, { signal: ac.signal }), { title: "t", what: "w", instruction: "x", intervalMs: 10, hint: null, probe: async () => false });
  ac.abort();
  await assert.rejects(p, /中断/);
}));

test("judge: 通过/不通过/跳过 对应 pass/fail/skip，按钮为三个；超时判失败", async () => withGuide(async guide => {
  for (const [a, s] of [["pass", "pass"], ["fail", "fail"], ["skip", "skip"]]) {
    const p = judge(ctxOf(guide), { title: "B14", instruction: "看", intervalMs: 10 });
    await sleep(30);
    assert.deepEqual(guide.state().step.buttons, ["pass", "fail", "skip"]);
    guide.answer(guide.state().seq, a);
    assert.equal((await p).status, s);
  }
  const t = await judge(ctxOf(guide), { title: "B14", instruction: "看", intervalMs: 10, timeoutMs: 50 });
  assert.equal(t.status, "fail");
  assert.match(t.detail, /未作答/);
}));

// ---- 准备阶段的判定逻辑 ----
test("b1Verdict: 只有首次加载才验证；ID 不对或没自动打开设置页判失败", () => {
  assert.equal(b1Verdict({ fresh: false, optionsOpened: true, id: "alngkkgnobglnfbhcplhpaflcgfiajnj" }).status, "skip");
  assert.equal(b1Verdict({ fresh: true, optionsOpened: true, id: "alngkkgnobglnfbhcplhpaflcgfiajnj" }).status, "pass");
  assert.match(b1Verdict({ fresh: true, optionsOpened: true, id: "xyz" }).detail, /xyz/);
  assert.match(b1Verdict({ fresh: true, optionsOpened: false, id: "alngkkgnobglnfbhcplhpaflcgfiajnj" }).detail, /没有自动打开设置页/);
});

test("kagiLoggedIn: 只有最终停在 kagi.com 的 /settings 才算已登录", () => {
  assert.equal(kagiLoggedIn("https://kagi.com/settings"), true);
  assert.equal(kagiLoggedIn("https://kagi.com/settings?p=general"), true);
  assert.equal(kagiLoggedIn("https://account.kagi.com/loginname?redirect=x"), false);
  assert.equal(kagiLoggedIn("https://kagi.com/signin?next=%2Fsettings"), false);
  assert.equal(kagiLoggedIn("https://kagi.com/oauth2/authorize?x=1"), false);
  assert.equal(kagiLoggedIn("https://kagi.com/turnstile?r=/search%3Fq%3Dx"), false);
  assert.equal(kagiLoggedIn("https://kagi.com/"), false, "未登录时 kagi.com/ 照常 200，不能当成已登录");
  assert.equal(kagiLoggedIn("https://evil.example/settings"), false);
  assert.equal(kagiLoggedIn("about:blank"), false);
});

const kagiCtx = () => {
  const sent = [];
  return { sent, ctx: { timeoutMs: 1000, guide: fakeGuide(), port: 8765,
    browser: { client: { send: async (m, p) => { sent.push([m, p]); return m === "Target.createTarget" ? { targetId: "t1" } : { targetInfos: [] }; } } } } };
};

test("ensureKagi: 已登录直接返回 null；未登录引导登录，按同一规则复测", async () => {
  const a = kagiCtx();
  assert.equal(await ensureKagi(a.ctx, { probe: async () => "https://kagi.com/settings", wait: async () => assert.fail("不应等待") }), null);

  const b = kagiCtx();
  const urls = ["https://account.kagi.com/loginname", "https://kagi.com/turnstile", "https://kagi.com/settings"];
  let waited = null;
  const r = await ensureKagi(b.ctx, {
    probe: async () => urls.shift(),
    wait: async (ctx, o) => { waited = o; for (;;) { if (await o.probe()) return { status: "pass" }; await sleep(5100); } },
  });
  assert.equal(r, null);
  assert.match(waited.instruction, /登录/);
  assert.ok(b.sent.some(([m, p]) => m === "Target.createTarget" && p.url === "https://kagi.com/settings"), "应给用户打开登录页");

  const c = kagiCtx();
  const r2 = await ensureKagi(c.ctx, { probe: async () => "https://kagi.com/", wait: async () => ({ status: "skip", detail: "用户点了跳过" }) });
  assert.equal(r2.status, "skip");
  assert.match(r2.detail, /Kagi 未登录/);
});

test("cleanupItems: 只写 --only T3 时也提示删 gb、改回默认（让用户添加过 gb 的步骤都登记了）", () => {
  const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));
  for (const id of ["T1", "T2", "T3", "T4", "T5-DRAG", "T6-NTP", "T11"]) {
    const items = cleanupItems([byId[id]]);
    assert.ok(items.some(t => /默认搜索引擎改回 Google/.test(t)) && items.some(t => /删除网站搜索 gb/.test(t)), id);
  }
  assert.ok(cleanupItems([byId.T14]).some(t => /bg、dg、px、kg/.test(t)));
  assert.deepEqual(cleanupItems([byId.T7]), []);
});

test("cleanupItems: 按固定顺序去重（先改回默认引擎，再删条目）", () => {
  const items = cleanupItems([{ cleanup: ["t14", "default"] }, { cleanup: ["gb", "default"] }, {}]);
  assert.equal(items.length, 3);
  assert.match(items[0], /默认搜索引擎改回 Google/);
  assert.match(items[1], /gb/);
  assert.match(items[2], /dg、px、kg/);
  assert.deepEqual(cleanupItems([{ id: "B5" }]), []);
});

function fakeBrowser(grantedAfterRequest) {
  const calls = [];
  let granted = false;
  return {
    calls,
    client: { send: async m => { calls.push(m); return m === "Target.getTargets" ? { targetInfos: [] } : {}; } },
    evalExt: async (expr, opts = {}) => {
      calls.push({ expr, opts });
      if (expr.includes("permissions.contains")) return granted;
      if (expr.includes("permissions.request")) { granted = grantedAfterRequest; return granted; }
      return true;
    },
  };
}
const fakeGuide = () => ({ steps: [], setStep(s) { this.steps.push(s); }, waitAnswer: () => new Promise(() => {}), cancel() {} });

test("ensureGrants: auto-only 缺授权只报缺失、不弹框；引导式带用户手势申请一次", async () => {
  const b1 = fakeBrowser(true);
  const r1 = await ensureGrants({ browser: b1, guide: fakeGuide(), port: 8765 }, { autoOnly: true });
  assert.equal(r1.ok, false);
  assert.ok(!b1.calls.some(c => c.expr?.includes("permissions.request")));

  const b2 = fakeBrowser(true), g2 = fakeGuide();
  const r2 = await ensureGrants({ browser: b2, guide: g2, port: 8765 }, { autoOnly: false });
  assert.deepEqual([r2.ok, r2.requested], [true, true]);
  const req = b2.calls.filter(c => c.expr?.includes("permissions.request"));
  assert.equal(req.length, 1);
  assert.equal(req[0].opts.userGesture, true);
  assert.match(req[0].expr, /engine-a\.localhost:8765.*kagi\.com/);
  assert.match(g2.steps[0].instruction, /请点“允许”/);

  const r3 = await ensureGrants({ browser: fakeBrowser(false), guide: fakeGuide(), port: 8765 }, { autoOnly: false });
  assert.equal(r3.ok, false);
});

test("withNeeds: 只包装 needs 含 kagi 的步骤", () => {
  const plain = { id: "T1", needs: [], run: async () => ({}) };
  assert.equal(withNeeds(plain), plain);
  const k = withNeeds({ id: "T9", needs: ["kagi"], run: async () => ({}) });
  assert.equal(k.id, "T9");
  assert.notEqual(k.run, plain.run);
  assert.equal(k.timeoutFactor, 4, "要等用户登录，上限放宽 3 倍");
});

// ---- 登记与排序 ----
const KINDS = {
  B1: "assist", B4: "assist", B14: "judge", T1: "assist", T2: "assist", T3: "assist", T4: "assist", "T5-DRAG": "assist",
  "T6-NTP": "judge", T8: "assist", T9: "assist", T11: "assist", T12: "judge", T14: "assist",
};

test("STEPS: assist/judge 步骤都已登记、类型正确，排在对应编号处，B15 仍最后", () => {
  const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));
  for (const [id, kind] of Object.entries(KINDS)) assert.equal(byId[id]?.kind, kind, id);
  const ids = STEPS.map(s => s.id);
  assert.equal(ids.at(-1), "B15");
  assert.equal(ids[0], "B1");
  assert.ok(ids.indexOf("T5") < ids.indexOf("T5-DRAG") && ids.indexOf("T5-DRAG") < ids.indexOf("T6"));
  assert.ok(ids.indexOf("B4") < ids.indexOf("B5"));
  for (const id of ["T9", "T12", "T14"]) assert.ok(byId[id].needs.includes("kagi"), id);
});

test("selectSteps: --auto-only 排除全部 assist/judge 步骤", () => {
  const auto = selectSteps(STEPS, { autoOnly: true }).map(s => s.id);
  for (const id of Object.keys(KINDS)) assert.ok(!auto.includes(id), id);
  assert.ok(auto.includes("T5") && auto.includes("B15"));
  assert.deepEqual(selectSteps(STEPS, { autoOnly: true, only: ["T11", "T7"] }).map(s => s.id), ["T7"]);
});

test("gbPair: 左 Google 去掉 _ss、右 Bing、两侧关键词一致才算", () => {
  const tab = (id, index, url) => ({ id, index, windowId: 1, splitViewId: 5, url });
  const ok = { tabs: [tab(1, 0, "https://www.google.com/search?q=%E6%B5%8B%E8%AF%95"), tab(2, 1, "https://www.bing.com/search?q=%E6%B5%8B%E8%AF%95")] };
  assert.ok(gbPair(ok, "测试"));
  const withSs = { tabs: [tab(1, 0, "https://www.google.com/search?q=x&_ss=google,bing"), tab(2, 1, "https://www.bing.com/search?q=x")] };
  assert.equal(gbPair(withSs, "x"), undefined);
  assert.equal(gbPair(ok, "别的"), undefined);
  assert.equal(isSearch("https://www.google.com/sorry/index?continue=x", "www.google.com"), false);
});

// ---- 撤销授权的步骤之后的恢复检查 ----
function recoverDeps({ alive = [true], has = [true], grants = [] } = {}) {
  const calls = { requests: [], waits: 0 };
  return {
    calls,
    deps: {
      alive: async () => (alive.length > 1 ? alive.shift() : alive[0]),
      has: async () => (has.length > 1 ? has.shift() : has[0]),
      request: async (ctx, origins, o) => { calls.requests.push(o); return grants.shift() ?? false; },
      wait: async (ctx, o) => { calls.waits++; return (await o.probe()) ? { kind: "met" } : { kind: "timeout" }; },
      focus: async () => {},
    },
  };
}
const rctx = { port: 8765, timeoutMs: 1000, guide: fakeGuide() };

test("ensureRecovered: 已授权直接通过；缺授权申请一次成功", async () => {
  const a = recoverDeps({ has: [true] });
  assert.equal((await ensureRecovered(rctx, a.deps)).ok, true);
  assert.equal(a.calls.requests.length, 0);
  const b = recoverDeps({ has: [false], grants: [true] });
  const r = await ensureRecovered(rctx, b.deps);
  assert.equal(r.ok, true);
  assert.equal(b.calls.requests.length, 1);
});

test("ensureRecovered: 两次都被拒绝返回“授权未恢复”，第二次的说明写明是最后一次", async () => {
  const d = recoverDeps({ has: [false], grants: [false, false] });
  const r = await ensureRecovered(rctx, d.deps);
  assert.deepEqual([r.ok, r.reason], [false, "授权未恢复"]);
  assert.equal(d.calls.requests.length, 2);
  assert.match(d.calls.requests[1].why, /最后一次/);
  const e = recoverDeps({ has: [false], grants: [false, true] });
  assert.equal((await ensureRecovered(rctx, e.deps)).ok, true);
});

test("ensureRecovered: 扩展不可用先引导启用；启用不了返回“扩展未恢复”", async () => {
  const a = recoverDeps({ alive: [false, true], has: [true] });
  assert.equal((await ensureRecovered(rctx, a.deps)).ok, true);
  assert.equal(a.calls.waits, 1);
  const b = recoverDeps({ alive: [false] });
  assert.equal((await ensureRecovered(rctx, b.deps)).reason, "扩展未恢复");
});

test("afterStep：restores 步骤之后无论通过、失败还是超时都检查；恢复不了设 stopReason，剩余步骤跳过", async () => {
  const rt = { notes: [], stopReason: null, ctx: rctx };
  const d = recoverDeps({ has: [false], grants: [false, false] });
  const ctx = { guide: {}, abortSignal: new AbortController().signal, ext: { state: async () => ({}) },
    stopReason: () => rt.stopReason, afterStep: makeAfterStep(rt, {}, d.deps) };
  const st = (id, run, extra = {}) => ({ id, title: id, kind: "assist", needs: [], run, ...extra });
  const rs = await runSteps([
    st("B2", async () => ({ status: "pass", detail: "" })),
    st("B4", () => new Promise(() => {}), { restores: true }),
    st("T1", async () => ({ status: "pass", detail: "" })),
  ], ctx, { timeoutMs: 50, settleMs: 10 });
  assert.equal(rs[1].status, "fail", "B4 超时");
  assert.equal(d.calls.requests.length, 2, "超时之后仍做了恢复检查（只针对 restores 步骤）");
  assert.equal(rt.stopReason, "授权未恢复");
  assert.equal(rs[2].status, "skip");
  assert.match(rs[2].detail, /授权未恢复/);
  assert.match(rt.notes[0], /B4 之后/);
});

test("STEPS: B4、T8 标了 restores，且上限不小于授权等待加上 assist 时间", () => {
  const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));
  for (const id of ["B4", "T8"]) {
    assert.equal(byId[id].restores, true, id);
    assert.ok(byId[id].timeoutExtraMs >= 5 * 60 * 1000, id);
  }
});

test("assist: onAnswer 可把自定义按钮（T14 的“没分屏”）判为失败", async () => withGuide(async guide => {
  const p = assist(ctxOf(guide), { title: "T14", what: "分屏", instruction: "x", intervalMs: 10, hint: null, buttons: ["nosplit", "skip", "retry"],
    probe: async () => false, onAnswer: async a => (a === "nosplit" ? { status: "fail", detail: "没分屏；kagi.com 上的标签：…" } : null) });
  await sleep(30);
  assert.equal(guide.answer(guide.state().seq, "nosplit"), true);
  const r = await p;
  assert.equal(r.status, "fail");
  assert.match(r.detail, /没分屏/);
}));
