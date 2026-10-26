// B19 设置页“开始使用”卡（auto）：(a) 清掉 setupDone 后卡片显示；(b) 点“试一下”打开的一对出现后仍未完成；
// (c) 不经“试一下”、在新标签里打开模拟引擎的触发网址出现一对后，setupDone 为 true、卡片换成完成确认，重新打开后消失；
// (d) 撤销左侧（模拟引擎 A）授权后卡片重新出现、只有第 1 步，恢复授权后消失。
// storage.local 的 setupDone 不在 run.mjs 的 storage 快照里：keepSetupDone 记下步骤前的值，结束时（无论成败）写回并读回核对。
// 左侧授权由 requestGrant 恢复（之前授权过，Chrome 直接批准）；没恢复成由 restores: true 的步骤后检查兜底。
// 注意：e2e 一直开着一个设置页（evalExt 用的），它同样监听完成判定；“试一下”的标签 id 经 BroadcastChannel 告诉它，所以 (b) 也覆盖多页的情形。
import { GRANT_TIMEOUT_MS, requestGrant, contains } from "./guided.mjs";
import { openOptions, sleep } from "./optpage.mjs";
import { resetTabs, openTab, waitState, findPair, trigger, summarize, nonce } from "./util.mjs";
import { msgIn, E2E_LOCALE } from "../i18n.mjs";
import { HOSTS } from "../config.mjs";

const J = JSON.stringify;
const KEY = "setupDone";

const readDone = ctx => ctx.ext.eval(`chrome.storage.local.get(${J(KEY)}).then(r => r[${J(KEY)}] ?? null)`);
// value 为 null：删掉这个键（原本不存在）
export const setDone = (ctx, value) => ctx.ext.eval(value === null
  ? `chrome.storage.local.remove(${J(KEY)}).then(() => true)`
  : `chrome.storage.local.set({ ${J(KEY)}: ${J(value)} }).then(() => true)`);

// 记下 setupDone，fn 结束后写回并读回核对。setupDone 只在测试配置里，写回总是对的，中断时也照样尽力写回
export async function keepSetupDone(ctx, fn) {
  const saved = await readDone(ctx);
  let res, thrown;
  try { res = await fn(); } catch (e) { thrown = e; }
  let err = "";
  try {
    await setDone(ctx, saved);
    const now = await readDone(ctx);
    if (now !== saved) err = `setupDone 读回 ${J(now)}，应为 ${J(saved)}`;
  } catch (e) { err = `setupDone 写回失败：${e.message}`; }
  if (err) ctx.log?.(`清理失败：${err}`);
  if (thrown) { if (err) thrown.message += `；清理失败：${err}`; throw thrown; }
  if (err && res?.status !== "fail") return { ...res, status: "fail", detail: `${res?.detail ?? ""}；清理失败：${err}` };
  return res;
}

// 页面里读卡片的状态
const CARD = `(() => { const s = document.getElementById("setup");
  return { hidden: s.hidden, mode: s.dataset.mode ?? null,
    steps: [...s.querySelectorAll(".setup-step")].map(e => e.dataset.step + ":" + e.dataset.state),
    grantButton: !!document.getElementById("setup-grant"), tryDisabled: document.getElementById("setup-try")?.disabled ?? null,
    pairCallouts: document.querySelectorAll("#pair-body .callout-warn").length }; })()`;
const fmt = c => `mode ${c.mode}${c.hidden ? "（隐藏）" : ""}，步骤 ${c.steps.join("、") || "无"}`;

async function waitCard(page, pred, what, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  let c;
  for (;;) {
    c = await page.ev(CARD).catch(() => null);
    if (c && pred(c)) return c;
    if (Date.now() >= end) throw new Error(`${timeoutMs / 1000} 秒内没有等到：${what}（当前 ${c ? fmt(c) : "读不到卡片"}）`);
    await sleep(150);
  }
}

// 一对标签的两条记录都写进 storage.session 了（完成判定的输入）
const waitRecords = (ctx, pair) => ctx.browser.waitFor(async () => {
  const keys = pair.map(t => `split:${t.id}`);
  const got = await ctx.ext.eval(`chrome.storage.session.get(${J(keys)})`);
  return keys.every(k => got[k]?.role === "search");
}, { timeoutMs: 8000, intervalMs: 200 });

async function item(name, fn) {
  try { return { name, ...(await fn()) }; } catch (e) { return { name, status: "fail", detail: e.message }; }
}

async function shown(page) {
  const c = await waitCard(page, c => !c.hidden && c.mode === "steps" && c.steps.length === 3, "卡片显示三步");
  if (c.steps[0] !== "grant:done") return { status: "fail", detail: `模拟引擎 A 已授权，第 1 步应为 done：${fmt(c)}` };
  if (c.tryDisabled !== false) return { status: "fail", detail: "左侧已授权，“试一下”按钮应可点" };
  return { status: "pass", detail: fmt(c) };
}

async function tryNotDone(ctx, page) {
  const q = encodeURIComponent(msgIn(E2E_LOCALE, "setup_sample_query"));
  if (!(await page.ev(`(() => { const b = document.getElementById("setup-try"); if (!b || b.disabled) return false; b.click(); return true; })()`))) {
    return { status: "fail", detail: "“试一下”按钮不存在或不可点" };
  }
  const pair = await waitState(ctx, st => findPair(st, ctx.port, q), `“试一下”打开的分屏（关键词 ${decodeURIComponent(q)}）`);
  await waitRecords(ctx, pair);
  await sleep(1500); // 给两个设置页的监听留出时间
  const done = await readDone(ctx);
  const c = await page.ev(CARD);
  if (done === true) return { status: "fail", detail: `“试一下”打开的一对（标签 ${pair[0].id}/${pair[1].id}）被判成完成：setupDone 已是 true` };
  if (c.mode !== "steps") return { status: "fail", detail: `“试一下”之后卡片应仍显示三步：${fmt(c)}` };
  return { status: "pass", detail: `分屏 ${pair[0].id}/${pair[1].id} 出现、记录已写，setupDone 仍为 ${J(done)}，${fmt(c)}` };
}

async function realDone(ctx, page) {
  const q = `b19+${nonce()}`;
  await openTab(ctx, trigger(ctx.port, q));
  const pair = await waitState(ctx, st => findPair(st, ctx.port, q), `新标签触发的分屏（${q}）`);
  await waitRecords(ctx, pair);
  await ctx.browser.waitFor(async () => (await readDone(ctx)) === true, { timeoutMs: 5000, intervalMs: 200 })
    .catch(() => { throw new Error(`分屏 ${pair[0].id}/${pair[1].id} 出现后 5 秒内 setupDone 没有变成 true`); });
  const c = await waitCard(page, c => c.mode === "done" && c.steps.length === 0 && !c.hidden, "卡片换成完成确认");
  await page.reload();
  const after = await page.ev(CARD);
  if (!after.hidden || after.mode !== "hidden") return { status: "fail", detail: `完成后重新打开设置页，卡片应消失：${fmt(after)}` };
  return { status: "pass", detail: `分屏 ${pair[0].id}/${pair[1].id} 出现后 setupDone 为 true，当前页 ${fmt(c)}；重新打开后卡片隐藏` };
}

async function regrant(ctx, page) {
  if ((await readDone(ctx)) !== true) await setDone(ctx, true); // (c) 没成功时也能单独测 (d)
  await waitCard(page, c => c.hidden, "setupDone 为 true 时卡片隐藏");
  const origin = `http://${HOSTS.a}:${ctx.port}/*`;
  await ctx.ext.eval(`chrome.permissions.remove({ origins: ${J([origin])} })`);
  const c = await waitCard(page, c => !c.hidden && c.mode === "regrant", "撤销左侧授权后卡片重新出现");
  const problems = [];
  if (c.steps.length !== 1 || c.steps[0] !== "grant:todo") problems.push(`应只有第 1 步（grant:todo）：${fmt(c)}`);
  if (!c.grantButton) problems.push("没有第 1 步的授权按钮");
  if (c.pairCallouts) problems.push(`卡片显示时默认组合卡不应再有左侧未授权的提示框（实际 ${c.pairCallouts} 个）`);
  const ok = await requestGrant(ctx, [origin], { title: "B19 恢复模拟引擎 A 的授权" }).catch(() => false);
  if (!ok || (await contains(ctx.browser, [origin])) !== true) {
    problems.push("恢复模拟引擎 A 的授权没有成功（由步骤后检查兜底）");
  } else {
    await waitCard(page, c => c.hidden, "恢复授权后卡片消失").catch(e => problems.push(e.message));
  }
  return problems.length ? { status: "fail", detail: problems.join("；") }
    : { status: "pass", detail: `撤销后 ${fmt(c)}，恢复授权后卡片消失` };
}

export const B19 = {
  id: "B19", title: "设置页“开始使用”卡：“试一下”不算完成、真实触发算完成、撤销左侧授权后重新出现（自动判定）", kind: "auto", needs: [],
  timeoutFactor: 2, restores: true, timeoutExtraMs: GRANT_TIMEOUT_MS,
  run: ctx => keepSetupDone(ctx, async () => {
    await resetTabs(ctx);
    await setDone(ctx, null);
    const page = await openOptions(ctx.browser);
    const items = [];
    try {
      items.push(await item("(a) 清掉 setupDone 后卡片显示", () => shown(page)));
      items.push(await item("(b) “试一下”打开的一对不算完成", () => tryNotDone(ctx, page)));
      items.push(await item("(c) 新标签里真实触发算完成", () => realDone(ctx, page)));
      items.push(await item("(d) 撤销左侧授权后重新出现，恢复后消失", () => regrant(ctx, page)));
    } finally { await page.close(); }
    return summarize(items);
  }),
};
