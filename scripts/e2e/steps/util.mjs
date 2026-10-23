// 分屏流程步骤的公共工具：分屏分组、触发网址、整理标签、经 CDP 导航、轮询状态。
// 扩展 API 一律经 ctx.ext.eval（设置页）；扩展读不到 url 的页面（向导页、chrome://）用 CDP 目标信息。
import { EXT_ID, HOSTS } from "../config.mjs";

export const sleep = ms => new Promise(r => setTimeout(r, ms));
const OPT_PREFIX = `chrome-extension://${EXT_ID}/options/`;
export const GO_PREFIX = `chrome-extension://${EXT_ID}/go.html`;

// 按 splitViewId 分组，组内按 index 排序，返回 [[左, 右], ...]（按左侧所在窗口与位置排序）
export function splitPairs(state) {
  const groups = new Map();
  for (const t of state?.tabs || []) {
    if (t.splitViewId === undefined || t.splitViewId === null || t.splitViewId === -1) continue;
    if (!groups.has(t.splitViewId)) groups.set(t.splitViewId, []);
    groups.get(t.splitViewId).push(t);
  }
  return [...groups.values()]
    .filter(g => g.length >= 2) // 单标签分组（另一侧刚关闭、尚未解除分屏）不算一对
    .map(g => g.sort((a, b) => a.index - b.index))
    .sort((a, b) => a[0].windowId - b[0].windowId || a[0].index - b[0].index)
    .map(g => [g[0], g[1]]);
}

// 网址：q 为已编码的查询串（如 "hello+world"）
export const engineA = (port, q) => `http://${HOSTS.a}:${port}/search?q=${q}`;
export const engineB = (port, q) => `http://${HOSTS.b}:${port}/search?q=${q}`;
export const trigger = (port, q, ss = "ea,eb") => `${engineA(port, q)}&_ss=${ss}`;
export const siteX = (port, path) => `http://${HOSTS.site}:${port}${path}`;
// 期望的一对：左侧去掉 _ss 原样保留（+ 不变），右侧用 encodeURIComponent（空格为 %20）
export const expectPair = (port, q) => [engineA(port, q), engineB(port, encodeURIComponent(q.replace(/\+/g, " ")))];
export const isPair = (pair, port, q) => {
  const [l, r] = expectPair(port, q);
  return !!pair && pair[0].url === l && pair[1].url === r && pair[0].status === "complete" && pair[1].status === "complete";
};
export const findPair = (state, port, q) => splitPairs(state).find(p => isPair(p, port, q));
export const nonce = () => Math.random().toString(36).slice(2, 8);

export const pageTargets = async browser =>
  (await browser.client.send("Target.getTargets")).targetInfos.filter(t => t.type === "page");

// 轮询扩展状态直到 pred(state) 为真，返回 pred 的值；超时抛出带说明的错误
export async function waitState(ctx, pred, what, { timeoutMs = 15000 } = {}) {
  const end = Date.now() + timeoutMs;
  let st, last;
  for (;;) {
    if (ctx.signal?.aborted) throw new Error(`等待“${what}”时步骤被中断`);
    try { st = await ctx.ext.state(); const v = pred(st); if (v) return v; } catch (e) { last = e; }
    if (Date.now() >= end) {
      const urls = (st?.tabs || []).map(t => `${t.id}@${t.windowId}:${t.index} split=${t.splitViewId} ${t.url ?? "(不可读)"}`).join("；");
      throw new Error(`${timeoutMs / 1000} 秒内未等到：${what}${last ? `（${last.message}）` : ""}；当前标签：${urls}`);
    }
    await sleep(250);
  }
}

// 等 CDP 目标出现（按 url 判断），返回目标信息
export async function waitTarget(ctx, pred, what, { timeoutMs = 10000 } = {}) {
  try { return await ctx.browser.waitFor(async () => (await pageTargets(ctx.browser)).find(pred), { timeoutMs, intervalMs: 200 }); }
  catch (e) { throw new Error(`没有等到页面：${what}（${e.message}）`); }
}

// 在已有标签上导航（相当于把文字拖到该标签上）
export async function navigate(ctx, targetId, url) {
  const { client } = ctx.browser;
  const sid = await ctx.browser.attach(targetId);
  try {
    const r = await client.send("Page.navigate", { url }, sid);
    if (r.errorText && r.errorText !== "net::ERR_ABORTED") throw new Error(`导航失败：${r.errorText}`);
  } finally { await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {}); }
}

// 新标签页打开（相当于拖到两个标签之间）
export const openTab = (ctx, url) => ctx.browser.client.send("Target.createTarget", { url });

// 在页面里执行脚本（attach → evaluate → detach）
export async function evalIn(ctx, targetId, expr) {
  const sid = await ctx.browser.attach(targetId);
  try { return await ctx.browser.evaluate(sid, expr, { timeoutMs: 5000 }); }
  finally { await ctx.browser.client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {}); }
}

// 整理现场：只留向导页、一个设置页（扩展 API 的执行环境）和一个新开的 site-x 标签。
// 返回 { tabId, windowId, url, targetId }（site-x 标签）。
export async function resetTabs(ctx, path = "/start") {
  const url = siteX(ctx.port, `${path}?n=${nonce()}`);
  // 1) 扩展侧：在设置页所在窗口新建 site-x 标签，再关掉所有读得到 url 的其他标签（含其他设置页、popup）
  const made = await ctx.ext.eval(`(async () => {
    const cur = await chrome.tabs.getCurrent();
    const t = await chrome.tabs.create({ windowId: cur.windowId, url: ${JSON.stringify(url)}, active: true });
    const drop = (await chrome.tabs.query({})).filter(x => x.id !== cur.id && x.id !== t.id && x.url).map(x => x.id);
    if (drop.length) await chrome.tabs.remove(drop);
    return { tabId: t.id, windowId: t.windowId };
  })()`);
  // 2) CDP 侧：关掉扩展读不到 url 的页面（新标签页、about:blank 等），向导页与设置页保留
  const guide = `http://127.0.0.1:${ctx.port}/guide`;
  const site = await waitTarget(ctx, t => t.url === url, url);
  for (const t of await pageTargets(ctx.browser)) {
    if (t.targetId === site.targetId || t.url.startsWith(guide) || t.url.startsWith(OPT_PREFIX)) continue;
    await ctx.browser.client.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  }
  await waitState(ctx, st => st.tabs.every(t => t.splitViewId === -1 || t.splitViewId === undefined)
    && st.tabs.some(t => t.id === made.tabId && t.status === "complete")
    && st.windows.filter(w => w.type !== "normal").length === 0, "现场整理完成（无分屏、无 popup，site-x 已加载）");
  return { ...made, url, targetId: site.targetId };
}

// 一组子项的汇总：任何一项失败即失败；全部跳过（或没有子项）判跳过；通过与跳过混合判通过。
// 第一行写计数（报告表格与终端只显示第一行，跳过的子项也要看得见），之后每个子项一行
export function summarize(items) {
  const line = i => `${i.name}：${i.status === "pass" ? "通过" : i.status === "skip" ? "跳过" : "失败"}——${i.detail}`;
  const n = s => items.filter(i => i.status === s).length;
  const status = n("fail") ? "fail" : n("pass") ? "pass" : "skip";
  const head = `共 ${items.length} 项：通过 ${n("pass")}，跳过 ${n("skip")}，失败 ${n("fail")}`;
  return { status, detail: [head, ...items.map(line)].join("\n") };
}
