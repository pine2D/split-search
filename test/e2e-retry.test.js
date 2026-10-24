import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../scripts/e2e/server.mjs";
import { userWait, sorryHint } from "../scripts/e2e/steps/guided.mjs";
import { DRAG_STEPS } from "../scripts/e2e/steps/assisted-drag.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const [T4, T5_DRAG] = DRAG_STEPS;
const SORRY = "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dt5&q=EgQfake";
const sorryFor = q => `https://www.google.com/sorry/index?continue=${encodeURIComponent(`https://www.google.com/search?q=${encodeURIComponent(q)}`)}&q=EgQfake`;
const tab = (id, index, url, splitViewId = 9) => ({ id, index, windowId: 1, splitViewId, url, status: "complete" });
const gb = (l, r, q, leftUrl) => [tab(l, 1, leftUrl ?? `https://www.google.com/search?q=${encodeURIComponent(q)}`), tab(r, 2, `https://www.bing.com/search?q=${encodeURIComponent(q)}`)];

// 假的 assist：按脚本先点若干次“重试”（调 onRetry），再跑一次 probe → verdict
const fakeAssist = (retries, log) => async (ctx, o) => {
  log.push(o.title);
  for (let i = 0; i < (retries.shift() ?? 0); i++) { assert.ok(o.onRetry, `${o.title} 应提供 onRetry`); await o.onRetry(); }
  const v = await o.probe();
  return v ? (o.verdict ? o.verdict(v) : { status: "pass", detail: "" }) : { status: "fail", detail: "未等到" };
};

test("userWait: 点“重试”先显示无按钮的“重新准备”卡片并执行 onRetry，之后出新的说明；准备期间旧卡片的答案作废", async () => {
  const srv = await startServer({ port: 0 });
  try {
    const { guide } = srv;
    let seen = null, release;
    const gate = new Promise(r => { release = r; });
    const p = userWait({ guide, timeoutMs: 5000, abortSignal: new AbortController().signal }, {
      title: "T4 拖到已有标签", what: "w", instruction: "原说明", intervalMs: 10, hint: null, probe: async () => false,
      onRetry: async () => { seen = guide.state().step; await gate; },
    });
    await sleep(30);
    const s1 = guide.state().seq;
    guide.answer(s1, "retry");
    await sleep(60);
    assert.match(seen.instruction, /重新准备/);
    assert.deepEqual(seen.buttons, [], "重新准备时不给按钮");
    assert.equal(guide.answer(s1, "skip"), false, "旧卡片的答案作废");
    release();
    await sleep(60);
    const st = guide.state();
    assert.equal(st.step.instruction, "原说明");
    guide.answer(st.seq, "skip");
    assert.deepEqual(await p, { kind: "answer", answer: "skip" });
  } finally { await srv.close(); }
});

test("T4: 重试后用新准备的 site-x 标签判定，不用旧 id", async () => {
  const bases = [{ tabId: 11 }, { tabId: 22 }];
  const log = [];
  const deps = { prepare: async () => bases.shift(), state: async () => ({ tabs: gb(22, 23, "拖到已有标签", sorryFor("拖到已有标签")) }), assist: fakeAssist([1], log) };
  const r = await T4.run({}, deps);
  assert.equal(r.status, "pass", r.detail);
  assert.match(r.detail, /site-x 标签 22 变成左侧/);
  assert.match(r.detail, /左侧被 Google 人机验证挡住/);
  assert.equal(bases.length, 0, "重试时重新 prepare");

  // 对照：不重试时旧 id 11 与实际左侧 22 不符，判失败
  const r2 = await T4.run({}, { ...deps, prepare: async () => ({ tabId: 11 }), assist: fakeAssist([0], []) });
  assert.equal(r2.status, "fail");
  assert.match(r2.detail, /应是 site-x 标签 11/);
});

test("T5-DRAG: 两段等待的重试都重新整理现场、重新打开触发网址，并刷新两侧 id 和标签数", async () => {
  const calls = { prepare: 0, open: [], focus: 0 };
  let tabs = gb(1, 2, "t5", SORRY);
  const deps = {
    prepare: async () => { calls.prepare++; },
    openTab: async (ctx, url) => { calls.open.push(url); },
    focusGuide: async () => { calls.focus++; },
    // 重建后的新一对是 3｜4；拖拽之后两侧就地刷新为新关键词
    waitPair: async () => { tabs = gb(3, 4, "t5"); return tabs; },
    state: async () => ({ tabs }),
    assist: async (ctx, o) => {
      if (o.title === "T5 准备分屏") { await o.onRetry(); return o.verdict(await o.probe()); }
      await o.onRetry();
      tabs = gb(3, 4, "拖到右侧标签");
      return o.verdict(await o.probe());
    },
  };
  const r = await T5_DRAG.run({}, deps);
  assert.equal(r.status, "pass", r.detail);
  assert.match(r.detail, /3｜4/);
  assert.equal(calls.prepare, 3, "首次、准备阶段重试、拖拽阶段重试各整理一次");
  assert.deepEqual(calls.open, Array(3).fill("https://www.google.com/search?q=t5&_ss=google,bing"));
  assert.ok(calls.focus >= 2);

  // 对照：拖拽阶段重试后如果判定还用旧的 1｜2，会误判失败——这里确认用的是新 id
  tabs = gb(1, 2, "t5");
  const stale = await T5_DRAG.run({}, { ...deps, waitPair: async () => gb(7, 8, "t5"), assist: async (ctx, o) => {
    if (o.title === "T5 准备分屏") return o.verdict(await o.probe());
    await o.onRetry(); tabs = gb(3, 4, "拖到右侧标签"); return o.verdict(await o.probe());
  } });
  assert.equal(stale.status, "fail");
  assert.match(stale.detail, /应仍是标签 7｜8/);
});

test("sorryHint: 有 onRetry 才叫用户点“重试”", async () => {
  const ctx = { browser: { client: { send: async () => ({ targetInfos: [{ type: "page", url: SORRY, targetId: "x" }] }) } } };
  assert.match(await sorryHint(ctx, { onRetry: () => {} }), /点“重试”：脚本会重新整理标签/);
  assert.match(await sorryHint(ctx, {}), /不用点“重试”/);
  const none = { browser: { client: { send: async () => ({ targetInfos: [{ type: "page", url: "https://www.google.com/search?q=1", targetId: "x" }] }) } } };
  assert.equal(await sorryHint(none, {}), null);
});

test("T5-DRAG: 拖拽阶段重试时重建分屏超时，不结束这一步：卡片说明原因，可再重试成功", async () => {
  const srv = await startServer({ port: 0 });
  try {
    const { guide } = srv;
    let tabs = gb(1, 2, "t5"), waits = 0;
    const deps = {
      prepare: async () => {}, openTab: async () => {}, focusGuide: async () => {},
      // 第一次重建超时，第二次成功（新的一对 5｜6）
      waitPair: async () => { if (++waits === 1) throw new Error("30 秒内未等到：Google ｜ Bing 分屏（关键词 t5）"); tabs = gb(5, 6, "t5"); return tabs; },
      state: async () => ({ tabs }),
      assist: async (ctx, o) => {
        if (o.title === "T5 准备分屏") return o.verdict(await o.probe());
        return (await import("../scripts/e2e/steps/guided.mjs")).assist(ctx, { ...o, hint: null, intervalMs: 10 });
      },
    };
    const ctx = { guide, timeoutMs: 5000, abortSignal: new AbortController().signal };
    const p = T5_DRAG.run(ctx, deps);
    await sleep(40);
    // 旧的一对 1｜2 已被关掉：用户点重试 → 重建超时
    tabs = [];
    guide.answer(guide.state().seq, "retry");
    await sleep(80);
    const st = guide.state();
    assert.match(st.step.instruction, /^⚠ 重建分屏没成功（30 秒内未等到.*）。可再点“重试”或“跳过”。/);
    assert.deepEqual(st.step.buttons, ["skip", "retry"], "仍可重试或跳过");
    // 再点重试：重建成功，拖拽后两侧就地刷新
    guide.answer(st.seq, "retry");
    await sleep(80);
    assert.ok(!/重建分屏没成功/.test(guide.state().step.instruction), "成功后去掉失败说明");
    tabs = gb(5, 6, "拖到右侧标签");
    const r = await p;
    assert.equal(r.status, "pass", r.detail);
    assert.match(r.detail, /5｜6/);
    assert.equal(waits, 2);
  } finally { await srv.close(); }
});
