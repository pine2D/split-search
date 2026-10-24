// 需要人参与的步骤的公共工具：在向导页给出说明，同时轮询条件与用户的按钮。
// 向导接口约定（server.mjs）：每次 setStep 只收一个答案；重试、提示变化都要重新 setStep（新 seq）再等。
import { EXT_ID } from "../config.mjs";
import { sleep, pageTargets } from "./util.mjs";
import { isSorry } from "./captcha.mjs";
import { openOptions } from "./optpage.mjs";

const EXT_PREFIX = `chrome-extension://${EXT_ID}/`;
const FOREVER = 2 ** 31 - 1; // 答案的等待由本模块的截止时间控制，guide 自己的计时器只作兜底
export const GRANT_TIMEOUT_MS = 5 * 60 * 1000;

const stoppedCtx = ctx => !!(ctx.signal?.aborted || ctx.abortSignal?.aborted);
// 一次等待结束后向导页显示的空闲卡片（无按钮）：免得上一个说明和按钮留在页面上，用户以为还要操作
export const IDLE = { title: "处理中…", instruction: "脚本正在处理刚才的结果，请稍候，下一步的说明马上出现。请先不要操作测试浏览器。", buttons: [] };

// Google 人机验证页：只读 CDP 目标网址，不依赖扩展。o.onRetry 存在时“重试”会重新准备现场，才叫用户点它
export async function sorryHint(ctx, o = {}) {
  if (!ctx.browser?.client) return null;
  const hit = (await pageTargets(ctx.browser)).find(t => isSorry(t.url));
  if (!hit) return null;
  return "Google 弹出了人机验证页（google.com/sorry）。请切到那个标签完成验证，验证通过后 Google 会跳回搜索结果，脚本继续等待。"
    + (o.onRetry ? "如果之后仍没有出现预期的结果，点“重试”：脚本会重新整理标签、重新准备这一项，再按说明操作一次。"
      : "如果之后仍没有出现预期的结果，按说明再操作一次（不用点“重试”）。");
}
// 点“重试”且步骤提供了 onRetry 时，重新准备期间显示的卡片（无按钮，免得用户在旧说明上再点一次）
export const RETRYING = title => ({ title, instruction: "正在重新准备这一项（整理标签、重新打开测试网址），请稍候，说明马上重新出现。", buttons: [] });

// 显示说明并等待：probe() 返回真值即满足；用户的答案（skip/retry/pass/fail/done）也会结束等待（retry 除外）。
// 返回 { kind: "met", value } | { kind: "answer", answer } | { kind: "timeout", last }。
// o: { title, instruction, sampleText?, copyText?, buttons?, probe?, hint?, timeoutMs?, intervalMs?, onRetry?, what, afterShow? }
// onRetry：用户点“重试”时先执行（重新整理现场、重新打开触发网址、重新记下判定要用的 id），再重新显示说明并重新计时；
// 它抛出时不结束等待，说明前加上失败原因，用户可再重试或跳过
// afterShow：说明显示出来、停顿 afterShowMs（默认 1500）之后执行一次，例如把设置页切到前台（先让用户看到说明）
export async function userWait(ctx, o) {
  const limit = o.timeoutMs ?? ctx.timeoutMs ?? 120000;
  const interval = o.intervalMs ?? 500;
  const buttons = o.buttons ?? ["skip", "retry"];
  const hintFn = o.hint === undefined ? sorryHint : o.hint;
  let hint = null, answer = null, token = 0, last = null, retryNote = null;
  const show = () => {
    const my = ++token;
    const warn = [retryNote, hint].filter(Boolean).map(t => `⚠ ${t}\n\n`).join("");
    ctx.guide.setStep({
      title: o.title, instruction: `${warn}${o.instruction}`,
      sampleText: o.sampleText, copyText: o.copyText, buttons,
    });
    Promise.resolve(ctx.guide.waitAnswer({ timeoutMs: FOREVER }))
      .then(a => { if (my === token && a && a !== "timeout") answer = a; }, () => {});
  };
  show();
  let end = Date.now() + limit;
  try {
    if (o.afterShow) { await sleep(o.afterShowMs ?? 1500); await o.afterShow(); }
    for (;;) {
      if (stoppedCtx(ctx)) throw new Error(`等待“${o.what}”时步骤被中断`);
      if (answer === "retry") {
        answer = null;
        if (o.onRetry) {
          token++; // 旧卡片上的答案作废
          ctx.guide.setStep(RETRYING(o.title));
          // 重新准备失败（如重建分屏超时）不结束这一步：卡片上说明原因，用户可再点“重试”或“跳过”
          retryNote = null;
          try { await o.onRetry(); }
          catch (e) { last = e.message; retryNote = `${e.message}。可再点“重试”或“跳过”。`; }
        }
        end = Date.now() + limit;
        hint = null;
        show();
        continue;
      }
      if (answer) return { kind: "answer", answer };
      if (o.probe) {
        try { const v = await o.probe(); if (v) return { kind: "met", value: v }; }
        catch (e) { last = e.message; }
      }
      if (hintFn) {
        const h = await Promise.resolve().then(() => hintFn(ctx, o)).catch(() => null);
        if (h !== hint) { hint = h; show(); }
      }
      if (Date.now() >= end) return { kind: "timeout", last };
      await sleep(interval);
    }
  } finally {
    token++; // 之后到达的答案作废
    ctx.guide.setStep(IDLE); // 也会结算等待中的答案（作废）
    ctx.guide.cancel?.();
  }
}

// assist：满足条件判通过（verdict 可改判），用户点跳过判跳过，超时判失败
export async function assist(ctx, o) {
  const limit = o.timeoutMs ?? ctx.timeoutMs ?? 120000;
  const r = await userWait(ctx, o);
  if (r.kind === "met") {
    const v = o.verdict ? await o.verdict(r.value) : { status: "pass", detail: `已满足：${o.what}` };
    ctx.guide.setResult?.(o.label ?? o.title, v.status, v.detail);
    return v;
  }
  // onAnswer：步骤自定义按钮（如 T14 的“没分屏”）的判定；返回 null 时按跳过处理
  if (r.kind === "answer") {
    const v = o.onAnswer ? await o.onAnswer(r.answer) : null;
    return v ?? { status: "skip", detail: `用户点了“跳过”（未等到：${o.what}）` };
  }
  return { status: "fail", detail: `${Math.round(limit / 1000)} 秒内未等到：${o.what}${r.last ? `（最后一次检查出错：${r.last}）` : ""}` };
}

// judge：只能人眼判断，用户点 通过 / 不通过 / 跳过；超时判失败
export async function judge(ctx, o) {
  const r = await userWait(ctx, { buttons: ["pass", "fail", "skip"], hint: null, ...o, probe: null });
  if (r.kind === "answer") {
    if (r.answer === "pass") return { status: "pass", detail: o.passDetail ?? "用户判断：通过" };
    if (r.answer === "fail") return { status: "fail", detail: o.failDetail ?? "用户判断：不通过" };
    return { status: "skip", detail: o.skipDetail ?? "用户点了“跳过”" };
  }
  return { status: "fail", detail: `${Math.round((o.timeoutMs ?? ctx.timeoutMs ?? 120000) / 1000)} 秒内未作答` };
}

// ---- 页面与扩展 ----
export const guideUrl = port => `http://127.0.0.1:${port}/guide`;

export async function activate(ctx, targetId) {
  await ctx.browser.client.send("Target.activateTarget", { targetId }).catch(() => {});
}

// 把向导页切到前台（没有就新开）：说明要让用户看得见
export async function focusGuide(ctx) {
  const t = (await pageTargets(ctx.browser)).find(x => x.url.startsWith(guideUrl(ctx.port)));
  if (t) return activate(ctx, t.targetId);
  if (ctx.autoOnly) return; // --auto-only 不打开向导页（没人看）
  await ctx.browser.client.send("Target.createTarget", { url: guideUrl(ctx.port) });
}

export const extTargets = async browser => (await browser.targets()).filter(t => t.url.startsWith(EXT_PREFIX));

// 扩展是否可用：能在扩展页里执行脚本。失败时关掉停在错误页的扩展页，下次重新创建
export async function extAlive(browser) {
  try { return (await browser.evalExt("chrome.runtime.id", { timeoutMs: 3000 })) === EXT_ID; }
  catch {
    for (const t of await extTargets(browser)) {
      if (t.type === "page") await browser.client.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
    }
    return false;
  }
}

export const contains = (browser, origins) => browser.evalExt(`chrome.permissions.contains({ origins: ${JSON.stringify(origins)} })`);

// 等 p 完成；运行或步骤被中断时立刻抛出（不必等满授权框的 5 分钟）
export function abortable(ctx, p) {
  const sigs = [ctx.signal, ctx.abortSignal].filter(Boolean);
  if (sigs.some(s => s.aborted)) return Promise.reject(new Error("等待授权时运行被中断"));
  let off = () => {};
  const stop = new Promise((_, rej) => {
    const on = () => rej(new Error("等待授权时运行被中断"));
    for (const s of sigs) s.addEventListener("abort", on, { once: true });
    off = () => { for (const s of sigs) s.removeEventListener("abort", on); };
  });
  return Promise.race([p, stop]).finally(off);
}

// 由脚本发起授权申请（CDP 带用户手势）。返回是否已授权；被中断时抛出。
// 测试配置里这些网站都授权过（permissions.remove 只是暂时撤销，“已授予”记录还在），Chrome 直接批准、不弹框（perm-dialog spike）。
// 申请只发一次，从独占一个新窗口的设置页发起：授权框挂在浏览器窗口上，关掉这个窗口它才随之消失（只关标签不行，spike 第 4 条）。
// AUTO_GRANT_MS 内没有结果说明弹出了原生授权框：--auto-only 不点原生对话框，关掉窗口（对话框随之关闭）返回 false；
// 引导式运行换成“请点允许”的说明，继续等同一个对话框（不关掉重弹），总共最多 GRANT_TIMEOUT_MS。中断时同样关掉窗口。
// 单测注入：ctx.openGrantPage（打开申请用的设置页，返回 { targetId, ev(expr, opts), close() }）、ctx.autoGrantMs
export const AUTO_GRANT_MS = 15000;
const PENDING = Symbol("pending");
function within(p, ms, value) {
  let t;
  return Promise.race([p, new Promise(r => { t = setTimeout(() => r(value), ms); })]).finally(() => clearTimeout(t));
}
export async function requestGrant(ctx, origins, { title = "授权", why = "" } = {}) {
  const open = ctx.openGrantPage ?? (b => openOptions(b, { newWindow: true }));
  const autoMs = ctx.autoGrantMs ?? AUTO_GRANT_MS;
  const hosts = [...new Set(origins.map(o => o.replace(/^\w+:\/\//, "").replace(/\/\*$/, "")))].join("、");
  ctx.guide?.setStep?.({ title, buttons: [], instruction: `${why}脚本重新申请授权（${hosts}；之前授权过的网站 Chrome 直接批准，不弹框）。`
    + (ctx.autoOnly ? "" : "万一弹出了 Chrome 的授权框，请点“允许（Allow）”，脚本自动继续。") });
  if (stoppedCtx(ctx)) throw new Error("等待授权时运行被中断");
  const page = await open(ctx.browser);
  try {
    await activate(ctx, page.targetId);
    const req = page.ev(`chrome.permissions.request({ origins: ${JSON.stringify(origins)} })`,
      { userGesture: true, timeoutMs: GRANT_TIMEOUT_MS + 5000 }).catch(() => false);
    let ok = await abortable(ctx, within(req, autoMs, PENDING));
    if (ok === PENDING && ctx.autoOnly) {
      ctx.log?.(`  ${title}：${autoMs / 1000} 秒内没有批准（多半弹出了原生授权框：测试配置里没有这些网站的已授予记录），关掉申请窗口（对话框随之关闭），不点原生对话框`);
      ok = false;
    } else if (ok === PENDING) {
      ctx.guide.setStep({ title, buttons: [], instruction: `${why}Chrome 弹出了授权框（${hosts}，在单独的“Split Search 设置”窗口里），请点“允许（Allow）”。允许后脚本自动继续。` });
      ok = await abortable(ctx, within(req, GRANT_TIMEOUT_MS - autoMs, false));
    }
    return ok === true && (await contains(ctx.browser, origins)) === true;
  } finally {
    await page.close().catch(() => {});
    await focusGuide(ctx).catch(() => {});
  }
}
