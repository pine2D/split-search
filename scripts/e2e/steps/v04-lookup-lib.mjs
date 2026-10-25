// v0.4 右键查询步骤（T21 边读边查、T22 以图搜图）的公共部分：page-u 文章页现场、在页面里建选区、
// 分屏里网页一侧的屏幕坐标（校准视口原点）、等查询对、页面没被导航的核对。
// 网页一侧在 page-u（没有授权的 host）：扩展读不到它的网址，网址一律从 CDP 读，标签按 id 认。
import { UNGRANTED_HOSTS, mockEngines } from "../config.mjs";
import { resetTabs, waitState, evalIn, nonce, sleep } from "./util.mjs";
import { fixWindow, testWindow } from "./xauto-lib.mjs";
import { markPage, markIntact, cdpUrl, openTabIn, MENU_INDEX, MENU_MIN_ITEMS } from "./v04-lib.mjs";
import { metrics, cssToScreen } from "../screen.mjs";
import { deps, readyMouse, moveToIn, gestureError, pidOf } from "../gesture.mjs";
import { primeClick, contextMenuPick } from "../gesture-ui.mjs";

const J = JSON.stringify;
export const articleUrl = port => `http://${UNGRANTED_HOSTS.page}:${port}/article?n=${nonce()}`;
export const imgSrc = port => `http://${UNGRANTED_HOSTS.page}:${port}/img.png`;
export const mock = (port, id) => mockEngines(port).find(e => e.id === id);

// 现场：整理标签 → 在测试窗口新开 page-u 文章页（当前标签）→ 写页面标记。
// xinput：再固定窗口尺寸、按标题取测试窗口 id，并在页面下方空白处点一下（T11 的做法：窗口刚被抢走前台后第一次右键的菜单会立刻关掉）
export async function articleScene(ctx, { xinput = true } = {}) {
  const base = await resetTabs(ctx);
  const P = await openTabIn(ctx, base.windowId, articleUrl(ctx.port));
  let wid = null;
  if (xinput) {
    await fixWindow(ctx, P.targetId);
    wid = await testWindow(ctx, P.targetId);
    await focusTestWindow(ctx, base.windowId);
    const m = await metrics(ctx.browser, P.targetId);
    await primeClick(ctx, cssToScreen(m, m.innerWidth * 0.75, m.innerHeight * 0.9), wid);
  }
  const mark = await markPage(ctx, P.targetId);
  return { base, P, wid, mark };
}

// 嵌套显示没有窗口管理器：别的窗口（例如 T20 (g) 的 popup 窗口）关掉后 X 焦点落回根窗口，之后在页面里点击也拿不回来，
// Chrome 在没有焦点的窗口里右键不出菜单（整次 --auto-only 里 T21、T22、T24 因此全部“右键后没有出现菜单”）。
// 右键前经 chrome.windows.update 让 Chrome 自己把焦点给测试窗口；host 模式有窗口管理器，焦点跟着点击走，不动
export async function focusTestWindow(ctx, windowId) {
  if (!ctx.gx?.nested) return;
  await ctx.ext.eval(`chrome.windows.update(${windowId}, { focused: true }).then(() => true)`);
  await sleep(300);
}

// 在页面里建选区：{ in, word }（元素里的一个词）或 { from, to }（从 from 段开头到 to 段结尾）。
// 返回选区第一个矩形里的一点（CSS）与选区文字
export async function selectIn(ctx, targetId, spec) {
  const r = await evalIn(ctx, targetId, `(() => {
    const spec = ${J(spec)};
    const node = sel => document.querySelector(sel)?.firstChild;
    const range = document.createRange();
    if (spec.word) {
      const t = node(spec.in), i = t ? t.data.indexOf(spec.word) : -1;
      if (i < 0) return null;
      range.setStart(t, i); range.setEnd(t, i + spec.word.length);
    } else {
      const a = node(spec.from), b = node(spec.to);
      if (!a || !b) return null;
      range.setStart(a, 0); range.setEnd(b, b.data.length);
    }
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    const b = [...range.getClientRects()].find(x => x.width > 8 && x.height > 4);
    return b ? { x: b.x + Math.min(b.width / 2, 60), y: b.y + b.height / 2, sel: String(s) } : null;
  })()`);
  if (!r) throw new Error(`页面里建不出选区 ${J(spec)}`);
  return r;
}

export const clearSelection = (ctx, targetId) => evalIn(ctx, targetId, "getSelection().removeAllRanges(), true");

// 元素中心（CSS）
export async function cssCenter(ctx, targetId, selector) {
  const r = await evalIn(ctx, targetId, `(() => { const b = document.querySelector(${J(selector)})?.getBoundingClientRect(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`);
  if (!r) throw new Error(`页面里找不到 ${selector}`);
  return r;
}

// 分屏里网页一侧的 CSS 点 → 屏幕坐标。cssToScreen 假定视口贴着窗口右边（水平偏移 outerWidth − innerWidth），
// 网页在分屏左侧时这个偏移把右侧一栏的宽度也算进去了，点会落到右侧。所以左侧一栏先按“视口贴着窗口左边”猜一点
// （窗口左右没有边框，不在分屏时两种算法一样），右侧一栏（side "right"，T24 在查询一侧右键）按 cssToScreen 原样猜，
// 把指针移过去，读页面 mousemove 事件的 screenX − clientX 得到视口原点
export async function splitPoint(ctx, targetId, wid, css, { side = "left" } = {}) {
  const m = await metrics(ctx.browser, targetId);
  const guess = cssToScreen(side === "right" ? m : { ...m, outerWidth: m.innerWidth }, css.x, css.y);
  await evalIn(ctx, targetId, `(() => {
    globalThis.__ssOrigin = null;
    if (!globalThis.__ssProbe) {
      globalThis.__ssProbe = true;
      addEventListener("mousemove", e => { globalThis.__ssOrigin = { x: e.screenX - e.clientX, y: e.screenY - e.clientY }; }, true);
    }
    return true;
  })()`);
  const { xi, root, nested } = deps(ctx);
  const home = await readyMouse(ctx, wid);
  for (const d of [0, 3]) await moveToIn(xi, guess.x + d, guess.y + d, wid, "校准视口位置的点", { pid: pidOf(ctx), root, home, nested });
  let o = null;
  for (let i = 0; i < 10 && !o; i++) { await sleep(100); o = await evalIn(ctx, targetId, "globalThis.__ssOrigin"); }
  if (!o) throw gestureError("env", `指针移到 ${guess.x},${guess.y} 后页面没收到 mousemove，算不出网页一侧在屏幕上的位置`);
  return { x: Math.round((o.x + css.x) * m.dpr), y: Math.round((o.y + css.y) * m.dpr) };
}

// 屏幕坐标：网页不在分屏里时直接换算（同 selectionCenter），在分屏里时校准；side 是它在分屏里的哪一栏（缺省左栏）
export async function screenPoint(ctx, targetId, wid, css, { split, side }) {
  if (split) return splitPoint(ctx, targetId, wid, css, { side });
  return cssToScreen(await metrics(ctx.browser, targetId), css.x, css.y);
}

// 点本扩展的菜单项：kind "text" | "image"，行号与最少行数见 v04-lib 的 MENU_INDEX、MENU_MIN_ITEMS。返回当次菜单的行数
export async function pickOurs(ctx, kind, at, wid) {
  const m = await contextMenuPick(ctx, { at, wid, itemIndex: MENU_INDEX[kind], expectItems: MENU_MIN_ITEMS[kind] });
  return m.items;
}
export const pickNote = (kind, items) => `菜单共 ${items} 项，点第 ${(MENU_INDEX[kind] < 0 ? items : 0) + MENU_INDEX[kind] + 1} 项`;

// 写 storage 之后、右键之前，等本扩展的菜单重建完：storage.onChanged 每次都让 menus.js 先 removeAll 再重建，
// 紧接着右键可能撞上重建的空档（本扩展的项还没建回来，菜单少一行）。每次先等 MENU_SETTLE_MS 再用 count() 数：
// 给了 expected 就等到行数等于它，没给（还不知道带本扩展项时有几行）就等到连续两次相同。
// 数满 tries 次仍不满足时返回最后一次的行数，由调用方判定
export const MENU_SETTLE_MS = 400;
export async function settleMenu(count, expected = null, { tries = 5, wait = sleep } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    await wait(MENU_SETTLE_MS);
    const n = await count();
    if (expected === null ? n === last : n === expected) return n;
    last = n;
  }
  return last;
}

// 网页标签 pageId 在分屏里、对侧加载完并满足 pred 时返回 [网页, 查询]，否则 null
export function lookupPair(st, pageId, pred) {
  const p = st.tabs.find(t => t.id === pageId);
  if (!p || p.splitViewId === -1 || p.splitViewId === undefined) return null;
  const l = st.tabs.find(t => t.id !== pageId && t.splitViewId === p.splitViewId);
  return (l && l.status === "complete" && pred(l, st) && [p, l]) || null;
}
export const waitLookup = (ctx, pageId, pred, what) => waitState(ctx, st => lookupPair(st, pageId, pred), what, { timeoutMs: 20000 });

// 网页一侧没被导航：CDP 网址与页面标记都不变；返回问题列表
export async function pageUntouched(ctx, P, mark) {
  const p = [];
  const now = await cdpUrl(ctx, P.targetId);
  if (now !== P.url) p.push(`网页一侧网址应保持 ${P.url}，实际 ${now}`);
  if (!(await markIntact(ctx, P.targetId, mark))) p.push("网页一侧的页面标记丢了（页面被重新加载过）");
  return p;
}

// 手势层的错误（env/skip/stuck）原样抛给 withAttempts 重试或跳过；别的异常记为这一项失败
export async function item(name, fn) {
  try { return { name, ...(await fn()) }; }
  catch (e) {
    if (e.kind === "env" || e.kind === "skip" || e.kind === "stuck") throw e;
    return { name, status: "fail", detail: `异常：${e.message}` };
  }
}
