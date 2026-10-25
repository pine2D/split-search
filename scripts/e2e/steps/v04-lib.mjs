// v0.4 步骤（T20 起、B18 起）的公共工具：页面标记（区分“没动”和“被导航回同一网址”）、
// 从 CDP 读网址（扩展读不到未授权 host 上标签的 url）、经 Extensions.triggerAction 打开工具栏弹窗（授予 activeTab）、
// 在指定窗口新开标签并拿到它的标签 id 与 CDP 目标。
import { pageTargets, nonce, evalIn, waitTarget, waitState } from "./util.mjs";
import { sub } from "./v03-lib.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import { EXT_ID, UNGRANTED_HOSTS } from "../config.mjs";
import { msg } from "../i18n.mjs";
import { infra } from "../ext-webui.mjs";

const J = JSON.stringify;

// 右键菜单里本扩展项的行号（负数从末尾数）与菜单至少的行数。本扩展项总在倒数第二行，紧挨着最后的“检查”（Inspect）：
// Spike S11（一次性配置，默认搜索引擎 Google）选区菜单、图片菜单都是 8 行，本扩展项是 0 起算第 6 行；
// e2e 测试配置（界面英文、默认搜索引擎 Kagi，T11/T2 之后是 sse2e）没有“翻译所选内容”和“用 Google 智能镜头搜索”，两种菜单都是 7 行，
// 本扩展项是第 5 行。Chrome 自带项随配置增减，都在本扩展项上面，所以从末尾数；T21/T22 的 detail 照写当次的实际行数
export const MENU_INDEX = { text: -2, image: -2 };
export const MENU_MIN_ITEMS = { text: 7, image: 7 };

// 在页面里写一个随机标记，返回它；页面重载（哪怕网址相同）后标记就没了
export async function markPage(ctx, targetId) {
  const mark = `ss-${nonce()}${nonce()}`;
  await evalIn(ctx, targetId, `(globalThis.__ssMark = ${J(mark)})`);
  return mark;
}

export async function markIntact(ctx, targetId, mark) {
  const got = await evalIn(ctx, targetId, "globalThis.__ssMark ?? null").catch(() => null);
  return got === mark;
}

// CDP 目标的当前网址（目标不见了为 undefined）
export async function cdpUrl(ctx, targetId) {
  const { targetInfos } = await ctx.browser.client.send("Target.getTargets");
  return targetInfos.find(t => t.targetId === targetId)?.url;
}

// 网址为 url 的 tab 目标（Extensions.triggerAction 只接受 type "tab" 的目标，Spike S9）
export async function tabTargetOf(ctx, url) {
  const find = async () => (await ctx.browser.client.send("Target.getTargets", { filter: [{ type: "tab" }] })).targetInfos.find(t => t.url === url);
  try { return (await ctx.browser.waitFor(find, { timeoutMs: 5000, intervalMs: 150 })).targetId; }
  catch { throw infra(`找不到网址为 ${url} 的 tab 目标`); }
}

// 工具栏弹窗目标：triggerAction 打开的弹窗网址就是 popup.html（不带 ?tabId=，那是测试接缝开的普通标签）
const actionPopups = async ctx => (await pageTargets(ctx.browser)).filter(t => t.url === POPUP_URL);

// 关掉旧弹窗 → triggerAction 作用于 tab 目标（与真点图标一样授予 activeTab）→ 等弹窗目标出现 → 接管它
export async function openActionPopup(ctx, tabTargetId) {
  const { client } = ctx.browser;
  for (const t of await actionPopups(ctx)) await client.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  await ctx.browser.waitFor(async () => (await actionPopups(ctx)).length === 0, { timeoutMs: 5000 }).catch(() => {});
  await client.send("Extensions.triggerAction", { id: EXT_ID, targetId: tabTargetId });
  const t = await ctx.browser.waitFor(async () => (await actionPopups(ctx))[0], { timeoutMs: 10000, intervalMs: 150 })
    .catch(() => { throw infra("触发扩展图标动作后 10 秒内没有出现弹窗页"); });
  return popupPage(ctx, { targetId: t.targetId });
}

// 扩展里读到的标签网址（读不到为 null）：未授权 host 上的标签只有 activeTab 授予后才读得到
export const extTabUrl = (ctx, tabId) => ctx.ext.eval(`chrome.tabs.get(${tabId}).then(t => t.url ?? null)`);

// activeTab 前提：triggerAction 之后扩展读得到这个标签的网址
export async function requireActiveTab(ctx, tabId) {
  if ((await extTabUrl(ctx, tabId)) === null) throw infra(`triggerAction 未授予 activeTab：扩展仍读不到标签 ${tabId} 的网址`);
}

// 在 windowId 窗口新开标签并等它加载完：返回 { id, targetId（page 目标）, tabTargetId, url }。
// url 要在现场唯一（调用前 resetTabs）；扩展读不到它的网址时按标签 id 等加载状态
export async function openTabIn(ctx, windowId, url, { active = true } = {}) {
  const id = await ctx.ext.eval(`chrome.tabs.create({ windowId: ${windowId}, url: ${J(url)}, active: ${active} }).then(t => t.id)`);
  const { targetId } = await waitTarget(ctx, t => t.url === url, url);
  await waitState(ctx, st => st.tabs.some(t => t.id === id && t.status === "complete"), `标签 ${id} 加载完成`);
  return { id, targetId, tabTargetId: await tabTargetOf(ctx, url), url };
}

// 扩展页里按 inspectTab 判归属（与弹窗、go.html 同一套判定）
export const ownershipOf = (ctx, tabId) => ctx.ext.eval(`(async () => {
  const { inspectTab } = await import("/chrome/split-state.js");
  const { loadConfig } = await import("/chrome/config-store.js");
  return (await inspectTab(await chrome.tabs.get(${tabId}), (await loadConfig()).engines)).ownership;
})()`);

// 子项包装：测试设施问题（kind "infra"）记跳过并写明原因，其余同 sub
export const subInfra = (name, fn) => sub(name, async () => {
  try { return await fn(); } catch (e) { if (e.kind === "infra") return { status: "skip", detail: `测试设施问题：${e.message}` }; throw e; }
});

// 模拟引擎 U（没有授权）的结果页网址；q 是已编码的查询串
export const uUrl = (port, q) => `http://${UNGRANTED_HOSTS.u}:${port}/search?q=${q}`;
export const tabCount = async ctx => (await ctx.ext.state()).tabs.length;

// 弹窗应显示 v0.3 的说明（不是一对、也没有“补成分屏”区）；返回问题列表
export function notOursProblems(s) {
  const want = msg("popup_not_ours");
  if (s.notOurs && !s.complete && !s.ours && s.notOursText === want) return [];
  return [`弹窗应显示说明“${want}”，实际 ${J({ complete: s.complete, ours: s.ours, text: s.notOursText })}`];
}
