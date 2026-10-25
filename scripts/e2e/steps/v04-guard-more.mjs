// T24（v04-guard-x.mjs）的可选子项与公共起点：
// (d') 查询对对调两侧后按快捷键 cycle-right（复用 T19 的绑定与按键：ext-shortcuts.mjs 快照与恢复，cycleExclude 同 T19），
//      换的应是查询标签；快捷键绑不上记跳过并写明原因。
// (i) 无痕窗口（Target.createBrowserContext）里同一页面的选区上数菜单项，应比普通窗口少 1 项（本扩展项不出现，
//      manifest incognito: not_allowed）；只比两次 contextMenuCount 的差，不依赖本扩展项的行号。
//      无痕窗口里拿不到测试窗口或认不出菜单时记跳过并写明原因。
import { expandTemplate } from "../../../src/lib/trigger.js";
import { resetTabs, navigate, waitState, waitTarget, evalIn, siteX, nonce } from "./util.mjs";
import { verdict } from "./v03-lib.mjs";
import { withAttempts, fixWindow, testWindow } from "./xauto-lib.mjs";
import { CYCLE_EXCLUDE, T19_PRESSES } from "./xauto-t19.mjs";
import { COMMAND, TEST_KEYS, bindShortcut, restoreShortcut, xdoCombo } from "../ext-shortcuts.mjs";
import { deps, idle, gestureError, REASON_BUSY } from "../gesture.mjs";
import { primeClick, contextMenuCount } from "../gesture-ui.mjs";
import { metrics, cssToScreen, newFocusedWindow } from "../screen.mjs";
import { openTabIn } from "./v04-lib.mjs";
import { articleUrl, selectIn, mock, focusTestWindow } from "./v04-lookup-lib.mjs";
import { guardTabs, guardCheck, makeQueryPair, queryRecords } from "./v04-guard.mjs";

const J = JSON.stringify;
const tabOf = (st, id) => st.tabs.find(t => t.id === id);
// T24 外层 guarded 要写回的键（(d') 改 cycleExclude）
export const MORE_KEYS = ["cycleExclude"];

// 每次尝试的起点：整理标签，测试窗口固定尺寸、按 site-x 标签（此时是当前标签）的标题取 X 窗口 id、把焦点给它（focusTestWindow）。之后的现场都建在这个窗口里
export async function xBase(ctx) {
  const base = await resetTabs(ctx);
  await fixWindow(ctx, base.targetId);
  const wid = await testWindow(ctx, base.targetId);
  await focusTestWindow(ctx, base.windowId);
  return { base: { id: base.tabId, targetId: base.targetId, windowId: base.windowId }, wid };
}

// 查询对对调两侧：查询标签挪到网页左边，仍在同一个分屏里
async function swapPair(ctx, P, L, v) {
  const p0 = tabOf(await ctx.ext.state(), P.id);
  await ctx.ext.eval(`chrome.tabs.move(${L.id}, { index: ${p0.index} }).then(() => true)`);
  await waitState(ctx, st => tabOf(st, L.id)?.index < tabOf(st, P.id)?.index && [P.id, L.id].every(id => tabOf(st, id).splitViewId === v),
    `对调后查询标签 ${L.id} 在左、仍在分屏 ${v}`);
}

// 一次尝试：新开前台窗口 → 它的标签导航到 page-u 文章页 → 建查询对并对调 → 按一次快捷键
async function cycleAttempt(ctx) {
  const { xi, sleep, profileDir, nested } = deps(ctx);
  await resetTabs(ctx);
  if ((await idle(xi, { sleep, ...ctx.gx.idleOpts })) === "busy") throw gestureError("skip", REASON_BUSY);
  const start = siteX(ctx.port, `/t24-cycle?n=${nonce()}`);
  let nf;
  try { nf = await newFocusedWindow(ctx.browser, start, { xi, profileDir, nested, ...ctx.gx.focusOpts }); }
  catch (e) { throw gestureError("env", `${e.message}（新窗口没拿到前台，未按任何键）`); }
  const id = await waitState(ctx, st => st.tabs.find(t => t.url === start && t.status === "complete")?.id, `新窗口里的 ${start} 加载完成`);
  const url = articleUrl(ctx.port);
  await navigate(ctx, nf.targetId, url);
  await waitTarget(ctx, t => t.targetId === nf.targetId && t.url === url, url);
  await waitState(ctx, st => tabOf(st, id)?.status === "complete", `标签 ${id} 加载完 ${url}`);
  const P = { id, targetId: nf.targetId, url };
  const qp = await makeQueryPair(ctx, P, { query: `cycle ${nonce()}` });
  const { L } = qp;
  await swapPair(ctx, P, L, qp.splitViewId);
  const before = await guardTabs(ctx, [P]);
  try { await xi.key(xdoCombo(TEST_KEYS), { expectWindow: nf.wid }); }
  catch (e) {
    await xi.releaseModifiers().catch(() => {});
    throw gestureError(/前台窗口/.test(e.message) ? "env" : "fail", e.message);
  }
  const want = T19_PRESSES[0];
  const next = expandTemplate(mock(ctx.port, want).url, qp.query);
  const p = [];
  await waitState(ctx, st => tabOf(st, L.id)?.url === next && tabOf(st, L.id).status === "complete", `按快捷键后查询标签 ${L.id} 打开 ${next}`, { timeoutMs: 10000 })
    .catch(e => p.push(e.message));
  p.push(...await guardCheck(ctx, [P], before), ...await queryRecords(ctx, P, L, { ...qp, engine: want }));
  const st = await ctx.ext.state();
  if (![P.id, L.id].every(x => tabOf(st, x)?.splitViewId === qp.splitViewId)) p.push("按快捷键后分屏被拆开了");
  return verdict(p, `对调后查询标签 ${L.id} 在左；按 ${TEST_KEYS} 后它换成 ${want}（${next}），网页 ${P.id} 网址与标记不变，记录仍是 page↔lookup`);
}

export async function cycleItem(ctx) {
  await ctx.ext.eval(`chrome.storage.sync.set({ cycleExclude: ${J(CYCLE_EXCLUDE)} }).then(() => true)`);
  try {
    const err = await bindShortcut(ctx.browser, COMMAND, TEST_KEYS).then(() => null, e => e);
    if (err?.kind === "infra" || err?.kind === "unrestorable") return { status: "skip", detail: `快捷键绑不上，不测：${err.message}` };
    if (err) throw err;
    return await withAttempts(ctx, () => cycleAttempt(ctx));
  } finally {
    await restoreShortcut(ctx.browser).catch(e => ctx.log?.(`  改回快捷键失败（收尾会再试）：${e.message}`));
  }
}

// 不在分屏里的 page-u 页面：在下方空白处点一下，选中 #p1 的 quick，数选区上的菜单项（不点任何项）
async function countAt(ctx, targetId, wid) {
  const m = await metrics(ctx.browser, targetId);
  await primeClick(ctx, cssToScreen(m, m.innerWidth * 0.75, m.innerHeight * 0.9), wid);
  const s = await selectIn(ctx, targetId, { in: "#p1", word: "quick" });
  return contextMenuCount(ctx, { at: cssToScreen(await metrics(ctx.browser, targetId), s.x, s.y), wid });
}

async function incognitoAttempt(ctx) {
  const { base, wid } = await xBase(ctx);
  const P = await openTabIn(ctx, base.windowId, articleUrl(ctx.port));
  const normal = await countAt(ctx, P.targetId, wid);
  const { client } = ctx.browser;
  let ctxId;
  try { ({ browserContextId: ctxId } = await client.send("Target.createBrowserContext", {})); }
  catch (e) { return { status: "skip", detail: `建不了无痕（off-the-record）浏览器上下文：${e.message}` }; }
  try {
    const { targetId } = await client.send("Target.createTarget", { url: articleUrl(ctx.port), browserContextId: ctxId, newWindow: true });
    await ctx.browser.waitFor(() => evalIn(ctx, targetId, `document.readyState === "complete" && !!document.getElementById("p1")`).catch(() => false),
      { timeoutMs: 10000, intervalMs: 200 });
    let iwid;
    try {
      await fixWindow(ctx, targetId, { remember: () => {} }); // 无痕窗口用完即关，不进窗口尺寸快照
      iwid = await testWindow(ctx, targetId);
    } catch (e) { return { status: "skip", detail: `无痕窗口里拿不到测试窗口：${e.message}` }; }
    let inc;
    try { inc = await countAt(ctx, targetId, iwid); }
    catch (e) {
      if (e.kind === "env") return { status: "skip", detail: `无痕窗口里认不出菜单结构：${e.message}` };
      throw e;
    }
    return verdict(normal - inc === 1 ? [] : [`无痕窗口的菜单应比普通窗口少 1 项：普通 ${normal} 项，无痕 ${inc} 项`],
      `同一页面 #p1 的选区上：普通窗口 ${normal} 项，无痕窗口 ${inc} 项（本扩展项不出现）`);
  } finally {
    await client.send("Target.disposeBrowserContext", { browserContextId: ctxId }).catch(() => {});
  }
}

export const incognitoItem = ctx => withAttempts(ctx, () => incognitoAttempt(ctx));
