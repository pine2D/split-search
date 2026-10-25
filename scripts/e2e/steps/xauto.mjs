// xauto 步骤（一）：T1、T2(a)(b) 地址栏；T3(a)、T4、T5-DRAG、T6-NTP 拖拽；T11 右键。真实鼠标/键盘（gesture.mjs），自动判定。
// 一律用模拟引擎 A|B 的专用网站搜索 sse2e（xauto-lib.mjs），关键词与查询只用 ASCII；判定复用 util 的 findPair/waitState。
// 拖拽的选区都放在一个不在分屏里的 site-x 标签（整页宽，坐标换算才对），落点按标签栏截图实测。
import { resetTabs, findPair, waitState, siteX, nonce, openTab, trigger, expectPair, splitPairs, pageTargets, summarize } from "./util.mjs";
import { dragText } from "../gesture.mjs";
import { contextMenuPick, omnibox, primeClick } from "../gesture-ui.mjs";
import { selectionCenter } from "../screen.mjs";
import { mockEntry, useDefault, useEntry, fixWindow, testWindow, tabSpan, withAttempts, xauto, assertAscii } from "./xauto-lib.mjs";
import { ASSISTED_STEPS } from "./assisted.mjs";
import { DRAG_STEPS } from "./assisted-drag.mjs";

const fb = id => [...ASSISTED_STEPS, ...DRAG_STEPS].find(s => s.id === id);
const fmtPair = p => `${p[0].id}｜${p[1].id}：${p[0].url} ｜ ${p[1].url}`;
const WAIT_MS = 20000;

// 查询词：ASCII、带随机后缀（每次尝试都不同，旧结果不会被误认），返回 { text（输入/拖拽的原文）, q（网址里的编码形式）}
export const query = word => { const text = assertAscii(`${word} ${nonce()}`); return { text, q: text.replace(/ /g, "+") }; };
// 本文件用到的固定词（单测核对 ASCII）
export const WORDS = ["xkw", "xdef", "xalt", "xgap", "xonto", "xright", "xntp", "xmenu", "t5x"];

// 拖拽现场：整理标签（site-x 为当前标签）、固定窗口尺寸、按标题取测试窗口 id
async function dragScene(ctx) {
  const base = await resetTabs(ctx);
  await fixWindow(ctx, base.targetId, { windowId: base.windowId });
  const wid = await testWindow(ctx, base.targetId);
  return { base, wid };
}
const newTab = async (ctx, windowId, url) => {
  const id = await ctx.ext.eval(`chrome.tabs.create({ windowId: ${windowId}, url: ${JSON.stringify(url)}, active: false }).then(t => t.id)`);
  await waitState(ctx, st => st.tabs.some(t => t.id === id && t.status === "complete"), `标签 ${id} 加载完成`);
  return id;
};
const pairOf = (ctx, q, what) => waitState(ctx, st => findPair(st, ctx.port, q), what ?? `新分屏 ${expectPair(ctx.port, q).join(" ｜ ")}`, { timeoutMs: WAIT_MS });

// ---- T1 / T2：地址栏（键盘手势在新开的前台窗口里做）----
const omniUrl = ctx => siteX(ctx.port, `/omni?n=${nonce()}`);

const T1 = xauto({
  id: "T1", title: "地址栏快捷字词 sse2e：A ｜ B 分屏（真实键盘）",
  async run(ctx) {
    await useEntry(ctx, mockEntry(ctx.port));
    return withAttempts(ctx, async () => {
      await resetTabs(ctx);
      const { text, q } = query("xkw");
      await omnibox(ctx, { text: `sse2e ${text}`, url: omniUrl(ctx) });
      const p = await pairOf(ctx, q);
      return p[0].active ? { status: "pass", detail: `快捷字词 sse2e 打开分屏，左侧为焦点：${fmtPair(p)}` }
        : { status: "fail", detail: `分屏出现了，但左侧不是当前焦点：${fmtPair(p)}` };
    });
  },
}, fb("T1"));

const T2 = xauto({
  id: "T2", title: "默认引擎 sse2e：直接输入分屏；Alt+Enter 新标签打开不崩溃（真实键盘）",
  async run(ctx) {
    await useDefault(ctx, mockEntry(ctx.port));
    const a = await withAttempts(ctx, async () => {
      await resetTabs(ctx);
      const { text, q } = query("xdef");
      await omnibox(ctx, { text, url: omniUrl(ctx) });
      return { status: "pass", detail: fmtPair(await pairOf(ctx, q)) };
    });
    const b = await withAttempts(ctx, async () => {
      await resetTabs(ctx);
      const before = new Set((await ctx.ext.state()).tabs.map(t => t.id));
      const { text, q } = query("xalt");
      const left = expectPair(ctx.port, q)[0];
      await omnibox(ctx, { text, altEnter: true, url: omniUrl(ctx) });
      const v = await waitState(ctx, st => findPair(st, ctx.port, q) ?? st.tabs.find(t => !before.has(t.id) && t.url?.startsWith(left)),
        `关键词 ${q} 在新标签打开`, { timeoutMs: WAIT_MS });
      const alive = await ctx.browser.client.send("Browser.getVersion").then(() => true, () => false);
      if (!alive) return { status: "fail", detail: "浏览器无响应" };
      return { status: "pass", detail: Array.isArray(v) ? `出现分屏：${fmtPair(v)}` : `在新标签 ${v.id} 打开（未分屏）：${v.url}` };
    });
    return summarize([{ name: "(a) 直接输入", ...a }, { name: "(b) Alt+Enter", ...b }]);
  },
}, fb("T2"));

// ---- 拖拽 ----
const T3 = xauto({
  id: "T3", title: "(a) 选中文字拖到两个标签之间：A ｜ B 分屏（真实拖拽）",
  async run(ctx) {
    await useDefault(ctx, mockEntry(ctx.port));
    return withAttempts(ctx, async () => {
      const { base, wid } = await dragScene(ctx);
      const s = await tabSpan(ctx, wid, base.tabId);
      const { text, q } = query("xgap");
      await dragText(ctx, { fromTargetId: base.targetId, text, to: { x: s.L - 2, y: s.y }, wid });
      const p = await pairOf(ctx, q);
      const st = await ctx.ext.state();
      const src = st.tabs.find(t => t.id === base.tabId);
      if (src?.url !== base.url) return { status: "fail", detail: `拖拽来源标签不该跳转（应为 ${base.url}，实际 ${src?.url ?? "不见了"}）；${fmtPair(p)}` };
      return { status: "pass", detail: `落在标签 ${base.tabId} 左侧空隙（x=${s.L - 2}）：${fmtPair(p)}` };
    });
  },
}, fb("T3"));

const T4 = xauto({
  id: "T4", title: "选中文字拖到已有标签上：该标签变左侧，右侧新开（真实拖拽）",
  async run(ctx) {
    await useDefault(ctx, mockEntry(ctx.port));
    return withAttempts(ctx, async () => {
      const { base, wid } = await dragScene(ctx);
      const target = await newTab(ctx, base.windowId, siteX(ctx.port, `/target?n=${nonce()}`));
      const s = await tabSpan(ctx, wid, target, base.tabId);
      const { text, q } = query("xonto");
      await dragText(ctx, { fromTargetId: base.targetId, text, to: { x: Math.round((s.L + s.R) / 2), y: s.y }, wid });
      const p = await pairOf(ctx, q);
      return p[0].id === target ? { status: "pass", detail: `标签 ${target} 变成左侧：${fmtPair(p)}` }
        : { status: "fail", detail: `左侧应是被拖到的标签 ${target}，实际 ${fmtPair(p)}` };
    });
  },
}, fb("T4"));

const T5_DRAG = xauto({
  id: "T5-DRAG", title: "拖到本扩展分屏的右侧标签：两侧就地刷新，左右不对调（真实拖拽）",
  async run(ctx) {
    await useDefault(ctx, mockEntry(ctx.port));
    return withAttempts(ctx, async () => {
      const { base, wid } = await dragScene(ctx);
      const first = query("t5x");
      await openTab(ctx, trigger(ctx.port, first.q));
      const [l, r] = await pairOf(ctx, first.q, `初始分屏（${first.q}）`);
      const count = (await ctx.ext.state()).tabs.length;
      const s = await tabSpan(ctx, wid, l.id, base.tabId);
      const { text, q } = query("xright");
      await dragText(ctx, { fromTargetId: base.targetId, text, to: { x: Math.round(s.L + 0.75 * (s.R - s.L)), y: s.y }, wid });
      const p = await pairOf(ctx, q, `初始分屏就地刷新为 ${q}`);
      const n = (await ctx.ext.state()).tabs.length;
      const problems = [];
      if (p[0].id !== l.id || p[1].id !== r.id) problems.push(`应仍是标签 ${l.id}｜${r.id}，实际 ${p[0].id}｜${p[1].id}`);
      if (n > count) problems.push(`标签数从 ${count} 增加到 ${n}`);
      return problems.length ? { status: "fail", detail: problems.join("；") } : { status: "pass", detail: `就地刷新：${fmtPair(p)}` };
    });
  },
}, fb("T5-DRAG"));

// T6-NTP：手动分屏 [site-x | 新标签页]，把文字拖到新标签页那一侧：新开一对在手动分屏右侧，新标签页回到新标签页，另一侧不动
const isNtp = u => /^chrome:\/\/(newtab|new-tab-page)\//.test(u ?? "");
const T6_NTP = xauto({
  id: "T6-NTP", title: "手动分屏里的新标签页上拖文字：新开一对，新标签页回到原页面（真实拖拽）",
  async run(ctx) {
    await useDefault(ctx, mockEntry(ctx.port));
    return withAttempts(ctx, async () => {
      const { base, wid } = await dragScene(ctx);
      const other = await newTab(ctx, base.windowId, siteX(ctx.port, `/manual?n=${nonce()}`));
      const made = await ctx.ext.eval(`(async () => {
        const ntp = await chrome.tabs.create({ windowId: ${base.windowId}, url: "chrome://newtab/", active: false });
        const splitViewId = await chrome.tabs.createSplit([${other}, ntp.id]);
        await chrome.tabs.update(${base.tabId}, { active: true });
        return { ntp: ntp.id, splitViewId };
      })()`);
      await ctx.browser.waitFor(async () => (await pageTargets(ctx.browser)).filter(t => isNtp(t.url)).length === 1, { timeoutMs: 8000 })
        .catch(() => { throw Object.assign(new Error("新标签页没有打开（CDP 里找不到唯一的 chrome://newtab）"), { kind: "env" }); });
      const s = await tabSpan(ctx, wid, other, base.tabId);
      const { text, q } = query("xntp");
      await dragText(ctx, { fromTargetId: base.targetId, text, to: { x: Math.round(s.L + 0.75 * (s.R - s.L)), y: s.y }, wid });
      const p = await pairOf(ctx, q);
      // 新标签页经 history.back() 回去：扩展读不到 chrome:// 网址（url 为空），CDP 里重新出现新标签页
      const st = await waitState(ctx, x => {
        const t = x.tabs.find(y => y.id === made.ntp);
        return t && !t.url && t.status === "complete" && x;
      }, `新标签页 ${made.ntp} 回到新标签页`, { timeoutMs: 10000 }).catch(async e => ({ err: e.message, ...(await ctx.ext.state()) }));
      const ntpBack = (await pageTargets(ctx.browser)).some(t => isNtp(t.url));
      const tab = id => st.tabs.find(t => t.id === id);
      const problems = [];
      if (st.err) problems.push(st.err);
      if (!ntpBack) problems.push("CDP 里看不到回到新标签页的页面");
      if (tab(other)?.url?.split("?")[0] !== siteX(ctx.port, "/manual")) problems.push(`手动分屏另一侧应保持 site-x /manual，实际 ${tab(other)?.url}`);
      if (tab(other)?.splitViewId !== made.splitViewId || tab(made.ntp)?.splitViewId !== made.splitViewId) problems.push("手动分屏被拆开了");
      if ([other, made.ntp].includes(p[0].id) || [other, made.ntp].includes(p[1].id)) problems.push(`新分屏不应使用手动分屏的标签：${fmtPair(p)}`);
      const maxIndex = Math.max(tab(other)?.index ?? -1, tab(made.ntp)?.index ?? -1);
      const now = findPair(st, ctx.port, q) ?? p;
      if (now[0].index !== maxIndex + 1) problems.push(`新分屏应紧挨在手动分屏右侧（手动分屏最大位置 ${maxIndex}，新分屏左侧 ${now[0].index}）`);
      if (splitPairs(st).length !== 2) problems.push(`应有 2 个分屏（手动 + 新开），实际 ${splitPairs(st).length} 个`);
      return problems.length ? { status: "fail", detail: problems.join("；") }
        : { status: "pass", detail: `手动分屏 ${other}｜${made.ntp} 未被覆盖，新标签页已回去；新分屏紧挨在右侧：${fmtPair(now)}` };
    });
  },
}, fb("T6-NTP"));

// T11：选区上右键，点第 3 项“用 <默认引擎> 搜索…”（菜单：复制 / 复制指向突出显示内容的链接 / 搜索…）
const T11 = xauto({
  id: "T11", title: "选中文字右键“用 sse2e 搜索”：A ｜ B 分屏（真实鼠标）",
  async run(ctx) {
    await useDefault(ctx, mockEntry(ctx.port));
    return withAttempts(ctx, async () => {
      const { base, wid } = await dragScene(ctx);
      const { text, q } = query("xmenu");
      const first = await selectionCenter(ctx.browser, base.targetId, text);
      await primeClick(ctx, { x: first.x, y: first.y + 400 }, wid);
      const at = await selectionCenter(ctx.browser, base.targetId, text);
      const m = await contextMenuPick(ctx, { at, itemIndex: 2, expectItems: 4, wid });
      const p = await pairOf(ctx, q);
      return { status: "pass", detail: `右键菜单（${m.items} 项）第 3 项：${fmtPair(p)}` };
    });
  },
}, fb("T11"));

export const XAUTO_STEPS = [T1, T2, T3, T4, T5_DRAG, T6_NTP, T11];
