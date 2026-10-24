import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/e2e/server.mjs";
import { userWait, assist, judge, requestGrant } from "../scripts/e2e/steps/guided.mjs";
import { b1Verdict, kagiLoggedIn, ensureKagi, cleanupItems, cleanupNote, FIXTURES_NOTE, ensureGrants, withNeeds } from "../scripts/e2e/steps/setup.mjs";
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
  // 等待结束后换成无按钮的“处理中”卡片，不留着上一步的说明和按钮
  assert.equal(guide.state().step.title, "处理中…");
  assert.deepEqual(guide.state().step.buttons, []);
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

test("ensureKagi: 已登录直接返回 null；未登录只看现有标签网址等待（不再开探测标签），点“我已完成”后探测一次", async () => {
  const a = kagiCtx();
  assert.equal(await ensureKagi(a.ctx, { probe: async () => "https://kagi.com/settings", wait: async () => assert.fail("不应等待") }), null);

  // 等待期间的检查只走 tabLoggedIn（不导航）；探测只在开始时做一次
  const b = kagiCtx();
  let probes = 0, checks = 0, waited = null;
  const r = await ensureKagi(b.ctx, {
    probe: async () => { probes++; return "https://account.kagi.com/loginname"; },
    tabLoggedIn: async (ctx, id) => { assert.equal(id, "t1", "看的是给用户打开的登录标签"); return ++checks >= 3 && "https://kagi.com/settings"; },
    wait: async (ctx, o) => { waited = o; for (;;) { const v = await o.probe(); if (v) return { kind: "met", value: v }; } },
  });
  assert.equal(r, null);
  assert.equal(probes, 1, "登录等待期间不再开后台标签走登录跳转");
  assert.match(waited.instruction, /登录/);
  assert.deepEqual(waited.buttons, ["done", "skip"]);
  assert.ok(b.sent.some(([m, p]) => m === "Target.createTarget" && p.url === "https://kagi.com/settings"), "应给用户打开登录页");

  // 点“我已完成”：探测一次；仍未登录 → 再等，说明前写明复查结果；第二次完成后登录了 → 通过
  const c = kagiCtx();
  const seen = ["https://kagi.com/", "https://account.kagi.com/x", "https://kagi.com/settings"];
  const shown = [];
  const r2 = await ensureKagi(c.ctx, { probe: async () => seen.shift(), tabLoggedIn: async () => false,
    wait: async (ctx, o) => { shown.push(o.instruction); return { kind: "answer", answer: "done" }; } });
  assert.equal(r2, null);
  assert.equal(shown.length, 2);
  assert.match(shown[1], /^⚠ 复查仍未登录.*account\.kagi\.com/);

  const d = kagiCtx();
  const r3 = await ensureKagi(d.ctx, { probe: async () => "https://kagi.com/", wait: async () => ({ kind: "answer", answer: "skip" }) });
  assert.equal(r3.status, "skip");
  assert.match(r3.detail, /Kagi 未登录/);
  const e = kagiCtx();
  const r4 = await ensureKagi(e.ctx, { probe: async () => "https://kagi.com/", wait: async () => ({ kind: "timeout" }) });
  assert.equal(r4.status, "fail");
});

test("收尾：不再列删除 gb/bg/dg/px/kg、改回默认引擎、编辑 Kagi 条目；只给一句保留说明", () => {
  const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));
  // xauto 步骤的人工回退版本（xinput 不可用时）：用户自己加的条目保留复用；xauto 版本自己清理，不出收尾说明
  for (const id of ["T1", "T2", "T3", "T4", "T5-DRAG", "T6-NTP", "T11", "T12", "T14"]) {
    const manual = byId[id].fallback ?? byId[id];
    assert.deepEqual(cleanupItems([manual]), [], id);
    assert.match(cleanupNote([manual]), /保留即可，下次运行会复用/, id);
    if (byId[id].kind === "xauto") assert.equal(cleanupNote([byId[id]]), null, id);
  }
  assert.equal(cleanupNote([byId.T7]), null);
  assert.deepEqual(cleanupItems([byId.T7]), []);
  assert.deepEqual(cleanupItems([{ id: "B5" }]), []);
  assert.doesNotMatch(FIXTURES_NOTE, /删除网站搜索|改回 Google|_ss/);
});

test("收尾：T8(d) 站点访问只在 assist 回退路径真的做过时才提示改回", () => {
  const t8 = STEPS.find(s => s.id === "T8");
  const res = detail => [{ id: "T8", detail }];
  const items = cleanupItems([t8], res("共 2 项：通过 2，跳过 0，失败 0\n(a) 无痕窗口：通过——x\n(d) 站点访问“点击时”：通过——有选项"));
  assert.equal(items.length, 1);
  assert.match(items[0], /Site access/);
  assert.equal(cleanupItems([t8], res("共 2 项：通过 1，跳过 1，失败 0\n(a) 无痕窗口：通过——x\n(d) 站点访问“点击时”：跳过——不适用")).length, 0);
  assert.equal(cleanupItems([t8], res("共 1 项：通过 1，跳过 0，失败 0\n(a) 无痕窗口：通过——x")).length, 0);
  assert.equal(cleanupItems([t8], null).length, 1, "中断时没有结果，保守提示");
  for (const d of ["中断（用户按了 Ctrl+C）", "超时（600000 ms 内未完成）", "异常：boom", ""]) {
    assert.equal(cleanupItems([t8], res(d)).length, 1, d);
  }
  assert.equal(cleanupItems([t8], []).length, 1, "T8 没有结果");
  assert.equal(cleanupItems([byIdStub()], [{ id: "T8", detail: "" }]).length, 0);
});
const byIdStub = () => ({ id: "T1", cleanup: ["default", "gb"] });

// 授权申请从独占新窗口的设置页发起（ctx.openGrantPage 注入）；request 的结果：true 批准、false 拒绝、"hang" 弹框没人点
function fakeBrowser(outcome) {
  const calls = [];
  let granted = false;
  const b = {
    calls, closed: 0,
    client: { send: async m => { calls.push(m); return m === "Target.getTargets" ? { targetInfos: [] } : {}; } },
    evalExt: async (expr, opts = {}) => {
      calls.push({ expr, opts });
      if (expr.includes("permissions.contains")) return granted;
      return true;
    },
  };
  b.page = { targetId: "grant-win", close: async () => { b.closed++; },
    ev: async (expr, opts = {}) => {
      calls.push({ expr, opts, page: true });
      if (outcome === "hang") return new Promise(r => { b.release = v => { granted = v; r(v); }; });
      granted = outcome; return granted;
    } };
  return b;
}
const fakeGuide = () => ({ steps: [], setStep(s) { this.steps.push(s); }, waitAnswer: () => new Promise(() => {}), cancel() {} });
const grantCtx = (b, g, o = {}) => ({ browser: b, guide: g, port: 8765, openGrantPage: async () => b.page, autoGrantMs: 50, ...o });

test("ensureGrants: auto-only 缺授权只报缺失、不弹框；引导式带用户手势申请一次", async () => {
  const b1 = fakeBrowser(true);
  const r1 = await ensureGrants(grantCtx(b1, fakeGuide()), { autoOnly: true });
  assert.equal(r1.ok, false);
  assert.ok(!b1.calls.some(c => c.expr?.includes("permissions.request")));

  const b2 = fakeBrowser(true), g2 = fakeGuide();
  const r2 = await ensureGrants(grantCtx(b2, g2), { autoOnly: false });
  assert.deepEqual([r2.ok, r2.requested], [true, true]);
  const req = b2.calls.filter(c => c.expr?.includes("permissions.request"));
  assert.equal(req.length, 1);
  assert.equal(req[0].page, true, "从申请窗口里的设置页发起");
  assert.equal(req[0].opts.userGesture, true);
  assert.match(req[0].expr, /engine-a\.localhost:8765.*kagi\.com/);
  assert.equal(b2.closed, 1, "用完关掉申请窗口");
  // 先不等人申请一次（之前授权过的网站 Chrome 直接批准），成功就不再出“Chrome 弹出了授权框”的说明
  assert.match(g2.steps[0].instruction, /不弹框/);
  assert.ok(!g2.steps.some(s => /Chrome 弹出了授权框/.test(s.instruction ?? "")));

  // 被拒绝：不重弹（恢复检查自己会再申请），关掉窗口
  const b3 = fakeBrowser(false), g3 = fakeGuide();
  const r3 = await ensureGrants(grantCtx(b3, g3), { autoOnly: false });
  assert.equal(r3.ok, false);
  assert.equal(b3.calls.filter(c => c.expr?.includes("permissions.request")).length, 1);
  assert.equal(b3.closed, 1);
});

test("requestGrant: 弹框没人点——auto-only 到点关掉申请窗口返回 false；引导式换说明继续等同一个对话框，用户允许即通过", async () => {
  const b1 = fakeBrowser("hang");
  const t0 = Date.now();
  assert.equal(await requestGrant(grantCtx(b1, fakeGuide(), { autoOnly: true }), ["http://a/*"]), false);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(b1.closed, 1, "关掉窗口，原生授权框随之关闭");

  const b2 = fakeBrowser("hang"), g2 = fakeGuide();
  const p = requestGrant(grantCtx(b2, g2), ["http://a/*"]);
  await new Promise(r => setTimeout(r, 150));
  assert.match(g2.steps.at(-1).instruction, /Chrome 弹出了授权框.*请点“允许（Allow）”/);
  assert.equal(b2.closed, 0, "引导式不关窗口、不重弹");
  b2.release(true);
  assert.equal(await p, true);
  assert.equal(b2.calls.filter(c => c.expr?.includes("permissions.request")).length, 1, "只申请一次");
  assert.equal(b2.closed, 1);
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
  B1: "assist", T1: "assist", T2: "assist", T3: "assist", T4: "assist", "T5-DRAG": "assist",
  "T6-NTP": "judge", T11: "assist", T12: "judge", T14: "assist",
};

test("STEPS: assist/judge 步骤都已登记、类型正确，排在对应编号处，B15 仍最后", () => {
  const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));
  // xauto 步骤登记的是真实输入版本，人工版本在 fallback 里
  const XA = ["T1", "T2", "T3", "T4", "T5-DRAG", "T6-NTP", "T11", "T12", "T14"];
  for (const id of XA) assert.equal(byId[id]?.kind, "xauto", id);
  for (const [id, kind] of Object.entries(KINDS)) assert.equal((byId[id]?.fallback ?? byId[id])?.kind, kind, id);
  const ids = STEPS.map(s => s.id);
  assert.equal(ids.at(-1), "B15");
  assert.equal(ids[0], "B1");
  assert.ok(ids.indexOf("T5") < ids.indexOf("T5-DRAG") && ids.indexOf("T5-DRAG") < ids.indexOf("T6"));
  assert.ok(ids.indexOf("B4") < ids.indexOf("B5"));
  for (const id of ["T12", "T14"]) assert.ok(byId[id].fallback.needs.includes("kagi"), id);
  assert.equal(byId.T9.kind, "auto"); // T9 只有登录要人：开头 kagiGate
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
