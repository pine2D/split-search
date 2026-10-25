// T20（v04-complete.mjs）的子项（续）：弹窗应显示 v0.3 说明、不显示“补成分屏”区的几种情况（spec 3.2 显示表）。
// 用户分屏里的页面、路径模板引擎 C 的结果页、空关键词、popup 类型窗口里的结果页（再从弹窗页直接发 complete-split，
// SW 应回 window_unsupported、不建标签）。
import { HOSTS } from "../config.mjs";
import { resetTabs, waitState, siteX, nonce, sleep, engineA } from "./util.mjs";
import { verdict } from "./v03-lib.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import { openActionPopup, requireActiveTab, openTabIn, subInfra, uUrl, tabCount, notOursProblems } from "./v04-lib.mjs";

const J = JSON.stringify;

// 新开标签 url，经 triggerAction 打开弹窗，断言显示说明
const explains = (name, urlOf, what) => ctx => subInfra(name, async () => {
  const base = await resetTabs(ctx);
  const url = urlOf(ctx.port);
  const T = await openTabIn(ctx, base.windowId, url);
  const page = await openActionPopup(ctx, T.tabTargetId);
  try {
    await requireActiveTab(ctx, T.id);
    return verdict(notOursProblems(await page.read()), `${url}（${what}）：弹窗显示说明`);
  } finally { await page.close(); }
});

const userSplit = ctx => subInfra("(d) 页面在用户分屏里（engine-u ｜ site-x，没有记录）：弹窗显示说明，分屏不变", async () => {
  const { port } = ctx;
  const base = await resetTabs(ctx);
  const U = await openTabIn(ctx, base.windowId, uUrl(port, "usersplit"));
  const S = await openTabIn(ctx, base.windowId, siteX(port, `/t20-split?n=${nonce()}`), { active: false });
  const splitViewId = await ctx.ext.eval(`chrome.tabs.createSplit([${U.id}, ${S.id}])`);
  await waitState(ctx, st => [U.id, S.id].every(id => st.tabs.find(t => t.id === id)?.splitViewId === splitViewId), "用户分屏建好");
  const page = await openActionPopup(ctx, U.tabTargetId);
  try {
    await requireActiveTab(ctx, U.id);
    const p = notOursProblems(await page.read());
    const st = await ctx.ext.state();
    if (![U.id, S.id].every(id => st.tabs.find(t => t.id === id)?.splitViewId === splitViewId)) p.push("用户分屏被拆开了");
    return verdict(p, `用户分屏 ${U.id}｜${S.id}：弹窗显示说明`);
  } finally { await page.close(); }
});

const popupWindow = ctx => subInfra("(g) popup 窗口里的模拟引擎 A 结果页：弹窗显示说明；直接发 complete-split 回 window_unsupported，标签数不变", async () => {
  const url = engineA(ctx.port, `t20popup&n=${nonce()}`);
  await resetTabs(ctx);
  const w = await ctx.ext.eval(`chrome.windows.create({ type: "popup", url: ${J(url)} }).then(w => ({ id: w.id, tab: w.tabs[0].id }))`);
  let page = null;
  try {
    await waitState(ctx, st => st.tabs.some(t => t.id === w.tab && t.url === url && t.status === "complete"), `popup 窗口加载 ${url}`);
    page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${w.tab}` });
    const p = notOursProblems(await page.read());
    const n0 = await tabCount(ctx);
    const reply = await page.ev(`chrome.runtime.sendMessage({ type: "complete-split", tabId: ${w.tab}, engineId: "eb" })`);
    if (reply?.ok !== false || reply?.code !== "window_unsupported") p.push(`SW 应回 { ok: false, code: "window_unsupported" }，实际 ${J(reply)}`);
    await sleep(500);
    const n1 = await tabCount(ctx);
    if (n1 !== n0) p.push(`标签数从 ${n0} 变成 ${n1}`);
    return verdict(p, `popup 窗口 ${w.id} 里的 ${url}：弹窗显示说明，SW 回 window_unsupported，标签数 ${n0} 不变`);
  } finally {
    await page?.close();
    await ctx.ext.eval(`chrome.windows.remove(${w.id}).then(() => true, () => false)`).catch(() => {});
  }
});

export const MORE_ITEMS = [
  userSplit,
  explains("(e) 路径模板引擎 C 的 /wiki/x：弹窗显示说明", port => `http://${HOSTS.c}:${port}/wiki/x`, "%s 在路径里，不支持"),
  explains("(f) 空关键词 /search?q=：弹窗显示说明", port => uUrl(port, ""), "关键词为空"),
  popupWindow,
];
