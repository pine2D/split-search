// 需要人参与的步骤（一）：B4 横幅授权；T1/T2 地址栏；T3(a)/T4/T5 真实拖拽；T6 新标签页子项；T9 Kagi；T11 右键搜索。
// 期望值以 docs/acceptance-v0.1.md 为准，默认组合 Google ｜ Bing。用户改 chrome://settings，脚本只看标签/分屏状态。
import { splitPairs, resetTabs, openTab, waitState, summarize } from "./util.mjs";
import { guarded, openOptions } from "./optpage.mjs";
import { assist, judge, focusGuide, activate, contains, requestGrant } from "./guided.mjs";

export const G = "www.google.com", BING = "www.bing.com";
export const GB_TRIGGER = "https://www.google.com/search?q=%s&_ss=google,bing";
const GB_ORIGINS = ["https://www.google.com/*", "https://www.bing.com/*"];
export const SETTINGS = "chrome://settings/searchEngines";

export const parse = s => { try { return new URL(s); } catch { return null; } };
export const hostOf = s => parse(s)?.hostname ?? null;
const qOf = u => (u.searchParams.get("q") ?? "").trim();
export function isSearch(url, host, q) {
  const u = parse(url);
  return !!u && u.hostname === host && u.pathname === "/search" && (q === undefined || qOf(u) === q);
}
// Google ｜ Bing 分屏，两侧关键词都是 q，左侧已去掉 _ss
export const gbPair = (st, q) => splitPairs(st).find(([l, r]) =>
  isSearch(l.url, G, q) && !parse(l.url).searchParams.has("_ss") && isSearch(r.url, BING, q));
export const fmt = p => `${p[0].id}｜${p[1].id}：${p[0].url} ｜ ${p[1].url}`;
const gbProbe = (ctx, q) => async () => gbPair(await ctx.ext.state(), q);

export const NEED_GB = `（前提：默认搜索引擎是网站搜索 gb。还不是的话，在 ${SETTINGS} 按 T1 添加 gb（网址见下），再在它右侧 ⋮ 里点“设为默认”。）`;

// 每个 assist 步骤开头：清理现场、把向导页切到前台
export async function prepare(ctx) { const base = await resetTabs(ctx); await focusGuide(ctx); return base; }

const B4 = {
  id: "B4", title: "设置页横幅授权：一次申请 Google 和 Bing", kind: "assist", needs: [], timeoutFactor: 3,
  async run(ctx) {
    return guarded(ctx, ["defaultPair"], async () => {
      await ctx.ext.eval(`chrome.storage.sync.set({ defaultPair: ["google", "bing"] }).then(() => true)`);
      await ctx.ext.eval(`chrome.permissions.remove({ origins: ${JSON.stringify(GB_ORIGINS)} })`);
      let granted = false;
      const page = await openOptions(ctx.browser);
      try {
        const label = await page.until(`return document.querySelector("#banner button")?.textContent`, 8000).catch(() => null);
        if (!label) return { status: "fail", detail: "撤销 Google、Bing 授权后，设置页没有出现授权横幅" };
        const problems = [];
        if (!label.includes("Google") || !label.includes("Bing")) problems.push(`横幅按钮应同时提到 Google 和 Bing，实际“${label}”`);
        await activate(ctx, page.targetId);
        const r = await assist(ctx, {
          title: "B4 横幅授权", what: "Google 和 Bing 都已授权", hint: null,
          instruction: `脚本已撤销 Google、Bing 的授权，并打开了设置页（已切到前台）。\n1. 点设置页顶部黄色横幅里的“${label}”；\n`
            + "2. 确认弹出的权限框里同时列出 www.google.com 和 www.bing.com，点“允许”；\n3. 回到向导页。",
          probe: () => contains(ctx.browser, GB_ORIGINS),
        });
        if (r.status !== "pass") return r;
        granted = true;
        const gone = await page.until(`return document.getElementById("banner").children.length === 0`, 5000).then(() => true, () => false);
        if (!gone) problems.push("授权后横幅没有消失");
        return problems.length ? { status: "fail", detail: problems.join("；") } : { status: "pass", detail: `横幅“${label}”一次申请了两个网站；允许后横幅消失` };
      } finally {
        await page.close();
        if (!granted && !ctx.signal?.aborted && (await contains(ctx.browser, GB_ORIGINS).catch(() => false)) !== true) {
          await requestGrant(ctx, GB_ORIGINS, { title: "B4 恢复授权", why: "B4 没有完成，后续步骤需要 Google 和 Bing 的授权。" }).catch(() => false);
        }
      }
    });
  },
};

const T1 = {
  id: "T1", title: "地址栏快捷字词 gb：Google ｜ Bing 分屏", kind: "assist", needs: [], timeoutFactor: 4, cleanup: ["gb"],
  async run(ctx) {
    await prepare(ctx);
    return assist(ctx, {
      title: "T1 地址栏快捷字词", what: "Google ｜ Bing 分屏，两侧关键词都是“测试”", copyText: GB_TRIGGER,
      timeoutMs: ctx.timeoutMs * 3,
      instruction: `1. 新开一个标签，打开 ${SETTINGS}；\n2. “网站搜索”旁点“添加”：名称 gb，快捷字词 gb，网址粘贴下面的网址，保存；\n`
        + "3. 在地址栏输入 gb，按空格（进入 gb 搜索），再输入“测试”回车。\n期望：打开 Google ｜ Bing 原生分屏，左侧 Google 为当前焦点。",
      probe: gbProbe(ctx, "测试"),
      verdict: p => (p[0].active ? { status: "pass", detail: `Google ｜ Bing 分屏，左侧为焦点：${fmt(p)}` }
        : { status: "fail", detail: `分屏出现了，但左侧 Google 不是当前焦点：${fmt(p)}` }),
    });
  },
};

const T2 = {
  id: "T2", title: "默认引擎 gb：直接输入分屏；Alt+Enter 新标签打开不崩溃", kind: "assist", needs: [], timeoutFactor: 5, cleanup: ["default"],
  async run(ctx) {
    await prepare(ctx);
    const a = await assist(ctx, {
      title: "T2(a) 默认引擎", what: "Google ｜ Bing 分屏（关键词“默认引擎测试”）", copyText: GB_TRIGGER, timeoutMs: ctx.timeoutMs * 2,
      instruction: `1. 打开 ${SETTINGS}，在“网站搜索”里 gb 右侧 ⋮ 点“设为默认”（没有 gb 先按 T1 添加，网址见下）；\n`
        + "2. 在地址栏直接输入“默认引擎测试”（不加快捷字词）回车。\n期望：Google ｜ Bing 分屏。",
      probe: gbProbe(ctx, "默认引擎测试"), verdict: p => ({ status: "pass", detail: fmt(p) }),
    });
    await prepare(ctx);
    const before = new Set((await ctx.ext.state()).tabs.map(t => t.id));
    const q = "新标签测试";
    const b = await assist(ctx, {
      title: "T2(b) Alt+Enter", what: `关键词“${q}”的 Google 搜索在新标签打开`, timeoutMs: ctx.timeoutMs * 2,
      instruction: `在地址栏输入“${q}”，按 Alt+Enter（不是回车）。\n期望：在新标签打开（出现分屏也可以），浏览器不崩溃。`,
      probe: async () => {
        const st = await ctx.ext.state();
        return gbPair(st, q) ?? st.tabs.find(t => !before.has(t.id) && isSearch(t.url, G, q));
      },
      verdict: async v => {
        const alive = await ctx.browser.client.send("Browser.getVersion").then(() => true, () => false);
        if (!alive) return { status: "fail", detail: "浏览器无响应" };
        return { status: "pass", detail: Array.isArray(v) ? `出现分屏：${fmt(v)}` : `在新标签 ${v.id} 打开（未分屏）：${v.url}` };
      },
    });
    return summarize([{ name: "(a) 直接输入", ...a }, { name: "(b) Alt+Enter", ...b }]);
  },
};

const T3 = {
  id: "T3", title: "(a) 选中文字拖到两个标签之间：Google ｜ Bing 分屏", kind: "assist", needs: [], timeoutFactor: 3, cleanup: ["default"],
  async run(ctx) {
    await prepare(ctx);
    const q = "拖拽测试文字";
    return assist(ctx, {
      title: "T3(a) 拖到两个标签之间", what: `Google ｜ Bing 分屏（关键词“${q}”）`, sampleText: q, copyText: GB_TRIGGER,
      instruction: `选中下面虚线框里的文字，拖到标签栏上两个标签之间的空隙（出现插入标记时松手）。\n期望：新开 Google ｜ Bing 分屏。`
        + `\n${NEED_GB}\n（T3(b) 从记事本等外部应用拖入，WSLg 做不了，留给 Windows 冒烟。）`,
      probe: gbProbe(ctx, q), verdict: p => ({ status: "pass", detail: fmt(p) }),
    });
  },
};

const T4 = {
  id: "T4", title: "选中文字拖到已有标签上：该标签变左侧，右侧新开", kind: "assist", needs: [], timeoutFactor: 3, cleanup: ["default"],
  async run(ctx) {
    const base = await prepare(ctx);
    const q = "拖到已有标签";
    return assist(ctx, {
      title: "T4 拖到已有标签", what: `标签 ${base.tabId} 变成 Google ｜ Bing 分屏的左侧（关键词“${q}”）`, sampleText: q, copyText: GB_TRIGGER,
      instruction: `选中下面虚线框里的文字，拖到标题为“site-x /start”的标签上（标签高亮时松手）。\n期望：该标签变成左侧 Google，右侧新开 Bing。\n${NEED_GB}`,
      probe: gbProbe(ctx, q),
      verdict: p => (p[0].id === base.tabId ? { status: "pass", detail: `site-x 标签 ${base.tabId} 变成左侧：${fmt(p)}` }
        : { status: "fail", detail: `左侧应是 site-x 标签 ${base.tabId}，实际 ${fmt(p)}` }),
    });
  },
};

const T5_DRAG = {
  id: "T5-DRAG", title: "拖到本扩展分屏的右侧标签：两侧就地刷新，左右不对调", kind: "assist", needs: [], timeoutFactor: 4, cleanup: ["default"],
  async run(ctx) {
    await prepare(ctx);
    await openTab(ctx, "https://www.google.com/search?q=t5&_ss=google,bing");
    const made = await assist(ctx, {
      title: "T5 准备分屏", what: "Google ｜ Bing 分屏（关键词 t5）", instruction: "脚本正在打开一个 Google ｜ Bing 分屏，请稍候。",
      probe: gbProbe(ctx, "t5"), verdict: p => ({ status: "pass", detail: fmt(p), pair: p }),
    });
    if (made.status !== "pass") return { status: made.status, detail: `没能建出初始分屏：${made.detail}` };
    const [l, r] = made.pair;
    const count = (await ctx.ext.state()).tabs.length;
    await focusGuide(ctx);
    const q = "拖到右侧标签";
    return assist(ctx, {
      title: "T5 拖到分屏右侧", what: `分屏 ${l.id}｜${r.id} 就地刷新为“${q}”`, sampleText: q, copyText: GB_TRIGGER,
      instruction: `标签栏上有一个 Google ｜ Bing 分屏（关键词 t5）。选中下面的文字，拖到这个分屏的右侧（Bing）标签上。\n期望：两侧就地刷新为新关键词，标签数不增加，左右不对调。\n${NEED_GB}`,
      probe: async () => {
        const st = await ctx.ext.state();
        const p = gbPair(st, q);
        return p && { p, n: st.tabs.length };
      },
      verdict: ({ p, n }) => {
        const problems = [];
        if (p[0].id !== l.id || p[1].id !== r.id) problems.push(`应仍是标签 ${l.id}｜${r.id}，实际 ${p[0].id}｜${p[1].id}`);
        if (n > count) problems.push(`标签数从 ${count} 增加到 ${n}`);
        return problems.length ? { status: "fail", detail: problems.join("；") } : { status: "pass", detail: `就地刷新：${fmt(p)}` };
      },
    });
  },
};

const T6_NTP = {
  id: "T6-NTP", title: "手动分屏里的新标签页上拖文字：新开一对，新标签页回到原页面", kind: "judge", needs: [], timeoutFactor: 3, cleanup: ["default"],
  async run(ctx) {
    await prepare(ctx);
    const q = "新标签页测试";
    const r = await judge(ctx, {
      title: "T6 新标签页子项", sampleText: q, copyText: GB_TRIGGER, timeoutMs: ctx.timeoutMs * 2,
      instruction: `1. 按 Ctrl+T 新开一个“新标签页”；\n2. 右键这个标签 → 选“添加标签页到新分屏”之类的菜单，把它和另一个标签手动组成分屏；\n`
        + "3. 切回向导页，选中下面的文字，拖到那个新标签页的标签上。\n期望：在该分屏右侧新开一对 Google ｜ Bing 分屏；被拖的标签回到新标签页；手动分屏的另一侧不动。\n" + NEED_GB,
    });
    const st = await ctx.ext.state().catch(() => null);
    const p = st && gbPair(st, q);
    return { ...r, detail: `${r.detail}；脚本观察：${p ? `出现了 Google ｜ Bing 分屏 ${fmt(p)}` : "没看到关键词为“新标签页测试”的 Google ｜ Bing 分屏"}` };
  },
};

const T9 = {
  id: "T9", title: "已登录的 Kagi 带 _ss：Kagi ｜ Google 分屏，结果页正常", kind: "assist", needs: ["kagi"], timeoutFactor: 2,
  async run(ctx) {
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
  id: "T11", title: "选中文字右键“用 gb 搜索”：Google ｜ Bing 分屏", kind: "assist", needs: [], timeoutFactor: 3, cleanup: ["default"],
  async run(ctx) {
    await prepare(ctx);
    const q = "右键搜索测试";
    return assist(ctx, {
      title: "T11 右键搜索", what: `Google ｜ Bing 分屏（关键词“${q}”）`, sampleText: q, copyText: GB_TRIGGER,
      instruction: `选中下面虚线框里的文字，右键，选以 gb 命名的搜索项（形如“使用 gb 搜索“${q}””）。\n`
        + `期望：Google ｜ Bing 分屏。\n${NEED_GB}`,
      probe: gbProbe(ctx, q), verdict: p => ({ status: "pass", detail: fmt(p) }),
    });
  },
};

export const ASSISTED_STEPS = [B4, T1, T2, T3, T4, T5_DRAG, T6_NTP, T9, T11];
