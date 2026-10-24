// 需要人参与的步骤（一）：T1/T2 地址栏；T3(a) 真实拖拽；T6 新标签页子项；T11 右键搜索（都是 xauto 的回退）；T9 Kagi（auto，只有登录要人）。
// 左侧 Google 停在人机验证页（/sorry，continue 是期望的搜索）也算分屏已建成，见 captcha.mjs。
// 期望值以 docs/acceptance-v0.1.md 为准，默认组合 Google ｜ Bing。用户改 chrome://settings，脚本只看标签/分屏状态。
import { splitPairs, resetTabs, openTab, waitState, summarize } from "./util.mjs";
import { assist, judge, focusGuide } from "./guided.mjs";
import { googleLeft, sorryNote } from "./captcha.mjs";
import { L } from "./labels.mjs";
import { kagiGate } from "./setup.mjs";

export const G = "www.google.com", BING = "www.bing.com";
export const GB_TRIGGER = "https://www.google.com/search?q=%s&_ss=google,bing";
export const SETTINGS = "chrome://settings/searchEngines";

export const parse = s => { try { return new URL(s); } catch { return null; } };
export const hostOf = s => parse(s)?.hostname ?? null;
const qOf = u => (u.searchParams.get("q") ?? "").trim();
export function isSearch(url, host, q) {
  const u = parse(url);
  return !!u && u.hostname === host && u.pathname === "/search" && (q === undefined || qOf(u) === q);
}
// Google ｜ Bing 分屏，两侧关键词都是 q，左侧已去掉 _ss；左侧停在 Google 人机验证页（continue 是期望的搜索）也算
export const gbPair = (st, q) => splitPairs(st).find(([l, r]) => googleLeft(l.url, q) && isSearch(r.url, BING, q));
export const fmt = p => `${p[0].id}｜${p[1].id}：${p[0].url} ｜ ${p[1].url}${sorryNote(p)}`;
export const gbProbe = (ctx, q) => async () => gbPair(await ctx.ext.state(), q);

export const NEED_GB = `（前提：默认搜索引擎是网站搜索 gb。还不是的话，在 ${SETTINGS} 按 T1 添加 gb（网址见下），再在它右侧 ${L.more} 里点${L.makeDefault}。）`;
export const RETRY_NOTE = "做错了或现场乱了，点“重试”：脚本会重新整理标签，再按说明操作一次。";

// 每个 assist 步骤开头：清理现场、把向导页切到前台
export async function prepare(ctx) { const base = await resetTabs(ctx); await focusGuide(ctx); return base; }

const T1 = {
  id: "T1", title: "地址栏快捷字词 gb：Google ｜ Bing 分屏", kind: "assist", needs: [], timeoutFactor: 4, cleanup: ["default", "gb"],
  async run(ctx) {
    await prepare(ctx);
    return assist(ctx, {
      title: "T1 地址栏快捷字词", what: "Google ｜ Bing 分屏，两侧关键词都是“测试”", copyText: GB_TRIGGER,
      timeoutMs: ctx.timeoutMs * 3,
      instruction: `1. 按 Ctrl+T 新开一个标签，在它的地址栏打开 ${SETTINGS}（不要在向导页里打开）；\n2. ${L.siteSearch}旁点${L.add}：名称 gb，快捷字词 gb，网址粘贴下面的网址，保存（已有 gb 条目就跳过添加）；\n`
        + "3. 在地址栏输入 gb，按空格（进入 gb 搜索），再输入“测试”回车。\n期望：打开 Google ｜ Bing 原生分屏，左侧 Google 为当前焦点。",
      probe: gbProbe(ctx, "测试"),
      verdict: p => (p[0].active ? { status: "pass", detail: `Google ｜ Bing 分屏，左侧为焦点：${fmt(p)}` }
        : { status: "fail", detail: `分屏出现了，但左侧 Google 不是当前焦点：${fmt(p)}` }),
    });
  },
};

const T2 = {
  id: "T2", title: "默认引擎 gb：直接输入分屏；Alt+Enter 新标签打开不崩溃", kind: "assist", needs: [], timeoutFactor: 5, cleanup: ["default", "gb"],
  async run(ctx) {
    await prepare(ctx);
    const a = await assist(ctx, {
      title: "T2(a) 默认引擎", what: "Google ｜ Bing 分屏（关键词“默认引擎测试”）", copyText: GB_TRIGGER, timeoutMs: ctx.timeoutMs * 2,
      instruction: `1. 按 Ctrl+T 新开一个标签，在它的地址栏打开 ${SETTINGS}（不要在向导页里打开，否则这些说明就看不到了）；`
        + `在${L.siteSearch}里 gb 右侧 ${L.more} 点${L.makeDefault}（没有 gb 先按 T1 添加，网址见下）；\n`
        + "2. 在这个新标签的地址栏（不要在向导页里）直接输入“默认引擎测试”（不加快捷字词）回车。\n期望：Google ｜ Bing 分屏。",
      probe: gbProbe(ctx, "默认引擎测试"), verdict: p => ({ status: "pass", detail: fmt(p) }),
    });
    await prepare(ctx);
    let before = new Set((await ctx.ext.state()).tabs.map(t => t.id));
    const q = "新标签测试";
    const b = await assist(ctx, {
      title: "T2(b) Alt+Enter", what: `关键词“${q}”的 Google 搜索在新标签打开`, timeoutMs: ctx.timeoutMs * 2,
      instruction: `在地址栏输入“${q}”，按 Alt+Enter（不是回车）。\n期望：在新标签打开（出现分屏也可以），浏览器不崩溃。\n${RETRY_NOTE}`,
      // 重试：重新整理现场，并重新记下已有标签（否则旧的结果标签会被当成新开的）
      onRetry: async () => { await prepare(ctx); before = new Set((await ctx.ext.state()).tabs.map(t => t.id)); },
      probe: async () => {
        const st = await ctx.ext.state();
        return gbPair(st, q) ?? st.tabs.find(t => !before.has(t.id) && googleLeft(t.url, q));
      },
      verdict: async v => {
        const alive = await ctx.browser.client.send("Browser.getVersion").then(() => true, () => false);
        if (!alive) return { status: "fail", detail: "浏览器无响应" };
        return { status: "pass", detail: Array.isArray(v) ? `出现分屏：${fmt(v)}` : `在新标签 ${v.id} 打开（未分屏）：${v.url}${googleLeft(v.url, q) === "sorry" ? "（被 Google 人机验证挡住，搜索已发出）" : ""}` };
      },
    });
    return summarize([{ name: "(a) 直接输入", ...a }, { name: "(b) Alt+Enter", ...b }]);
  },
};

const T3 = {
  id: "T3", title: "(a) 选中文字拖到两个标签之间：Google ｜ Bing 分屏", kind: "assist", needs: [], timeoutFactor: 3, cleanup: ["default", "gb"],
  async run(ctx) {
    await prepare(ctx);
    const q = "拖拽测试文字";
    return assist(ctx, {
      title: "T3(a) 拖到两个标签之间", what: `Google ｜ Bing 分屏（关键词“${q}”）`, sampleText: q, copyText: GB_TRIGGER,
      instruction: `选中下面虚线框里的文字，拖到标签栏上两个标签之间的空隙（出现插入标记时松手）。\n期望：新开 Google ｜ Bing 分屏。`
        + `\n${NEED_GB}\n（T3(b) 从记事本等外部应用拖入，WSLg 做不了，留给 Windows 冒烟。）\n${RETRY_NOTE}`,
      onRetry: () => prepare(ctx),
      probe: gbProbe(ctx, q), verdict: p => ({ status: "pass", detail: fmt(p) }),
    });
  },
};

const T6_NTP = {
  id: "T6-NTP", title: "手动分屏里的新标签页上拖文字：新开一对，新标签页回到原页面", kind: "judge", needs: [], timeoutFactor: 3, cleanup: ["default", "gb"],
  async run(ctx) {
    await prepare(ctx);
    const q = "新标签页测试";
    const r = await judge(ctx, {
      title: "T6 新标签页子项", sampleText: q, copyText: GB_TRIGGER, timeoutMs: ctx.timeoutMs * 2,
      instruction: `1. 按 Ctrl+T 新开一个“新标签页”；\n2. 右键这个标签 → 选${L.newSplit}，把它和另一个标签手动组成分屏；\n`
        + "3. 切回向导页，选中下面的文字，拖到那个新标签页的标签上。\n期望：在该分屏右侧新开一对 Google ｜ Bing 分屏；被拖的标签回到新标签页；手动分屏的另一侧不动。\n" + NEED_GB,
    });
    const st = await ctx.ext.state().catch(() => null);
    const p = st && gbPair(st, q);
    return { ...r, detail: `${r.detail}；脚本观察：${p ? `出现了 Google ｜ Bing 分屏 ${fmt(p)}` : "没看到关键词为“新标签页测试”的 Google ｜ Bing 分屏"}` };
  },
};

const T9 = {
  // 只有登录 Kagi 要人：auto 步骤，开头经 kagiGate 确认登录（--auto-only 没登录就跳过）
  id: "T9", title: "已登录的 Kagi 带 _ss：Kagi ｜ Google 分屏，结果页正常", kind: "auto", needs: [], timeoutFactor: 5,
  async run(ctx) {
    const gate = await kagiGate(ctx);
    if (gate) return gate;
    await prepare(ctx);
    await openTab(ctx, "https://kagi.com/search?q=split+test&_ss=kagi,google");
    const p = await waitState(ctx, st => splitPairs(st).find(([l, r]) => hostOf(l.url) === "kagi.com" && hostOf(r.url) === G),
      "Kagi ｜ Google 分屏", { timeoutMs: 30000 });
    const left = p[0].url, problems = [];
    if (!left.startsWith("https://kagi.com/search")) problems.push(`左侧应停在 https://kagi.com/search，实际 ${left}`);
    if (/signin|turnstile/i.test(left)) problems.push(`左侧落在登录或 Turnstile 页：${left}`);
    const right = parse(p[1].url);
    const note = right?.pathname.startsWith("/sorry") ? "（右侧 Google 显示人机验证页，不影响分屏判定）" : "";
    return problems.length ? { status: "fail", detail: problems.join("；") } : { status: "pass", detail: `${fmt(p)}${note}` };
  },
};

const T11 = {
  id: "T11", title: "选中文字右键“用 gb 搜索”：Google ｜ Bing 分屏", kind: "assist", needs: [], timeoutFactor: 3, cleanup: ["default", "gb"],
  async run(ctx) {
    await prepare(ctx);
    const q = "右键搜索测试";
    return assist(ctx, {
      title: "T11 右键搜索", what: `Google ｜ Bing 分屏（关键词“${q}”）`, sampleText: q, copyText: GB_TRIGGER,
      instruction: `选中下面虚线框里的文字，右键，选以 gb 命名的搜索项（文字因版本和界面语言而异：${L.ctxSearch(q)}）。\n`
        + `期望：Google ｜ Bing 分屏。\n${NEED_GB}\n${RETRY_NOTE}`,
      onRetry: () => prepare(ctx),
      probe: gbProbe(ctx, q), verdict: p => ({ status: "pass", detail: fmt(p) }),
    });
  },
};

export const ASSISTED_STEPS = [T1, T2, T3, T6_NTP, T9, T11]; // T4、T5-DRAG 在 assisted-drag.mjs
