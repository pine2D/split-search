import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/e2e/server.mjs";
import { userWait, assist, judge } from "../scripts/e2e/steps/guided.mjs";
import { b1Verdict, isSignin, cleanupItems, ensureGrants, withNeeds } from "../scripts/e2e/steps/setup.mjs";
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

test("isSignin: 只看 kagi 网址的路径是否以 /signin 开头", () => {
  assert.equal(isSignin("https://kagi.com/signin?next=/"), true);
  assert.equal(isSignin("https://kagi.com/"), false);
  assert.equal(isSignin("https://kagi.com/search?q=signin"), false);
  assert.equal(isSignin("不是网址"), false);
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
