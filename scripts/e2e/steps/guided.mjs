// 需要人参与的步骤的公共工具：在向导页给出说明，同时轮询条件与用户的按钮。
// 向导接口约定（server.mjs）：每次 setStep 只收一个答案；重试、提示变化都要重新 setStep（新 seq）再等。
import { EXT_ID } from "../config.mjs";
import { sleep, pageTargets } from "./util.mjs";

const EXT_PREFIX = `chrome-extension://${EXT_ID}/`;
const OPT_PREFIX = `${EXT_PREFIX}options/`;
const FOREVER = 2 ** 31 - 1; // 答案的等待由本模块的截止时间控制，guide 自己的计时器只作兜底
export const GRANT_TIMEOUT_MS = 5 * 60 * 1000;

const stoppedCtx = ctx => !!(ctx.signal?.aborted || ctx.abortSignal?.aborted);
// 一次等待结束后向导页显示的空闲卡片（无按钮）：免得上一个说明和按钮留在页面上，用户以为还要操作
export const IDLE = { title: "处理中…", instruction: "脚本正在处理刚才的结果，请稍候，下一步的说明马上出现。请先不要操作测试浏览器。", buttons: [] };

// Google 人机验证页：只读 CDP 目标网址，不依赖扩展
export async function sorryHint(ctx) {
  if (!ctx.browser?.client) return null;
  const hit = (await pageTargets(ctx.browser)).find(t => /^https:\/\/(www|ipv4|ipv6)\.google\.com\/sorry/.test(t.url));
  return hit ? "Google 弹出了人机验证页（google.com/sorry）。请切到那个标签完成验证，验证通过后 Google 会跳回搜索结果，"
    + "脚本继续等待；如果之后仍没有出现预期的结果，点“重试”再操作一次。" : null;
}

// 显示说明并等待：probe() 返回真值即满足；用户的答案（skip/retry/pass/fail/done）也会结束等待（retry 除外）。
// 返回 { kind: "met", value } | { kind: "answer", answer } | { kind: "timeout", last }。
// o: { title, instruction, sampleText?, copyText?, buttons?, probe?, hint?, timeoutMs?, intervalMs?, onRetry?, what, afterShow? }
// afterShow：说明显示出来、停顿 afterShowMs（默认 1500）之后执行一次，例如把设置页切到前台（先让用户看到说明）
export async function userWait(ctx, o) {
  const limit = o.timeoutMs ?? ctx.timeoutMs ?? 120000;
  const interval = o.intervalMs ?? 500;
  const buttons = o.buttons ?? ["skip", "retry"];
  const hintFn = o.hint === undefined ? sorryHint : o.hint;
  let hint = null, answer = null, token = 0, last = null;
  const show = () => {
    const my = ++token;
    ctx.guide.setStep({
      title: o.title, instruction: hint ? `⚠ ${hint}\n\n${o.instruction}` : o.instruction,
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
        end = Date.now() + limit;
        await o.onRetry?.();
        show();
        continue;
      }
      if (answer) return { kind: "answer", answer };
      if (o.probe) {
        try { const v = await o.probe(); if (v) return { kind: "met", value: v }; }
        catch (e) { last = e.message; }
      }
      if (hintFn) {
        const h = await Promise.resolve().then(() => hintFn(ctx)).catch(() => null);
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

// 由脚本发起授权申请（CDP 带用户手势），用户只需在弹框里点“允许”。返回是否已授权；被中断时抛出
export async function requestGrant(ctx, origins, { title = "授权", why = "" } = {}) {
  const hosts = [...new Set(origins.map(o => o.replace(/^\w+:\/\//, "").replace(/\/\*$/, "")))];
  ctx.guide.setStep({ title, instruction: `${why}即将弹出 Chrome 的授权框（${hosts.join("、")}），请点“允许”。允许后脚本自动继续。`, buttons: [] });
  await sleep(1500);
  await ctx.browser.evalExt("true"); // 确保有设置页
  const opt = (await pageTargets(ctx.browser)).find(t => t.url.startsWith(OPT_PREFIX));
  if (opt) await activate(ctx, opt.targetId); // 授权框挂在设置页所在的标签上
  let ok = false;
  try {
    ok = await abortable(ctx, ctx.browser.evalExt(`chrome.permissions.request({ origins: ${JSON.stringify(origins)} })`,
      { userGesture: true, timeoutMs: GRANT_TIMEOUT_MS }));
  } finally { await focusGuide(ctx).catch(() => {}); }
  return ok === true && (await contains(ctx.browser, origins)) === true;
}
