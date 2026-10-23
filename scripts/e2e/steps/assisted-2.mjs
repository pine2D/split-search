// 需要人参与的步骤（二）：T12 编辑自动发现的条目（judge）、T14 各引擎作左侧（assist）、B14 深色模式（judge）。
import { splitPairs, sleep, pageTargets, summarize } from "./util.mjs";
import { openOptions } from "./optpage.mjs";
import { assist, judge, focusGuide, activate, guideUrl } from "./guided.mjs";
import { prepare, hostOf, fmt, SETTINGS, G, BING } from "./assisted.mjs";
import { L } from "./labels.mjs";
import { readServiceWorkers, swText, t14Verdict, originOf } from "./sw.mjs";

// 联想只记录、不判失败（清单里是“建议”）：通过=有，不通过=没有
async function ask(ctx, title, question) {
  const r = await judge(ctx, { title, instruction: `${question}\n有点“通过”，没有点“不通过”，没注意可以“跳过”。`, timeoutMs: ctx.timeoutMs,
    passDetail: "有", failDetail: "没有", skipDetail: "未记录" });
  return r.status === "fail" && r.detail !== "没有" ? "未作答" : r.detail;
}

const T12 = {
  id: "T12", title: "编辑 Chrome 自动发现的 Kagi 条目追加 _ss 并设为默认：分屏，并记录联想", kind: "judge", needs: ["kagi"], timeoutFactor: 5,
  cleanup: ["default", "t12"],
  async run(ctx) {
    await prepare(ctx);
    const split = await assist(ctx, {
      title: "T12 自动发现的条目", what: "Kagi ｜ Bing 分屏（关键词“联想测试”）", copyText: "&_ss=kagi,bing", timeoutMs: ctx.timeoutMs * 2,
      instruction: [
        `1. 按 Ctrl+T 新开一个标签打开 ${SETTINGS}，找到 Chrome 自动发现的 Kagi 条目（快捷字词通常是 kagi.com）：在${L.siteSearch}或下方${L.inactive}里`
          + `（可能要先点${L.moreInactive}展开；没有就先在 kagi.com 搜索一次再刷新）。在${L.inactive}里的条目，先点它右侧的${L.activate}；`,
        `2. 点它右侧的${L.edit}，在网址末尾追加下面这段（可复制），保存；`,
        `3. 在它右侧 ${L.more} 里点${L.makeDefault}；`,
        "4. 在地址栏直接输入“联想测试”（不用快捷字词），先留意下拉框里有没有 Kagi 的搜索联想，再回车。",
        "期望：Kagi ｜ Bing 分屏。之后会问你联想的情况。（默认引擎和追加的 _ss 保留在测试配置里，下次运行复用。）",
      ].join("\n"),
      probe: async () => splitPairs(await ctx.ext.state()).find(([l, r]) => hostOf(l.url) === "kagi.com" && hostOf(r.url) === BING),
      verdict: p => ({ status: "pass", detail: `分屏：${fmt(p)}` }),
    });
    if (split.status === "skip") return split;
    await focusGuide(ctx);
    const plain = await ask(ctx, "T12 联想（直接输入）", "刚才直接输入“联想测试”时，地址栏下拉框里有 Kagi 的搜索联想吗？");
    const kw = await ask(ctx, "T12 联想（快捷字词模式）",
      "再试一次：在地址栏输入 Kagi 条目的快捷字词（通常是 kagi.com，以设置页里该条目显示的为准），按空格进入快捷字词模式，再输入“联想测试”（先别回车）。"
        + "下拉框里有 Kagi 的搜索联想吗？看完按 Esc。");
    // 联想回答写在最前面：报告表格只显示第一行的前 120 个字符，分屏网址很长
    return { status: split.status, detail: `直接输入时联想：${plain}；快捷字词模式联想：${kw}；${split.detail}` };
  },
};

// T14：每个引擎各当一次左侧（Google 作左侧已在 T1–T5 覆盖）。右侧统一用 Google
const LEFTS = [
  { id: "bing", name: "Bing", host: BING, kw: "bg", url: "https://www.bing.com/search?q=%s" },
  { id: "ddg", name: "DuckDuckGo", host: "duckduckgo.com", kw: "dg", url: "https://duckduckgo.com/?q=%s" },
  { id: "perplexity", name: "Perplexity", host: "www.perplexity.ai", kw: "px", url: "https://www.perplexity.ai/search?q=%s" },
  { id: "kagi", name: "Kagi", host: "kagi.com", kw: "kg", url: "https://kagi.com/search?q=%s" },
];
const HOMES = ["https://www.google.com/", "https://www.bing.com/", "https://duckduckgo.com/", "https://www.perplexity.ai/", "https://kagi.com/"];

// 先把五个引擎首页各打开一遍，让它们有机会注册 Service Worker（T14 要看 SW 会不会绕过 DNR）
async function warmUp(ctx) {
  const ids = [];
  for (const url of HOMES) ids.push((await ctx.browser.client.send("Target.createTarget", { url, background: true })).targetId);
  await sleep(8000);
  for (const targetId of ids) await ctx.browser.client.send("Target.closeTarget", { targetId }).catch(() => {});
}

// 记下该引擎 host 上的标签网址（最新的在前），供“没分屏 / 跳过”时写进说明
export async function engineTabs(ctx, host) {
  const st = await ctx.ext.state().catch(() => null);
  if (!st) return "读不到标签状态";
  const tabs = st.tabs.filter(t => hostOf(t.url) === host).sort((x, y) => y.id - x.id);
  if (!tabs.length) return `没有 ${host} 上的标签`;
  return `${host} 上的标签：${tabs.slice(0, 3).map(t => `${t.id}${(t.splitViewId ?? -1) !== -1 ? `（分屏 ${t.splitViewId}）` : "（未分屏）"} ${t.url}`).join("；")}`;
}

// 引擎收到了带 _ss 的触发网址（DNR 没生效）：普通左侧搜索、不在分屏里
const hasSs = url => { try { return [...new URL(url).searchParams.keys()].some(k => k === "_ss" || k === "amp;_ss"); } catch { return false; } };
const PLAIN_STABLE_MS = 3000; // 同一个标签连续这么久都是“带 _ss、未分屏”才判降级，避开导航中间态

const swNow = async ctx => readServiceWorkers(ctx.browser, { prefer: t => t.url.startsWith(guideUrl(ctx.port)) })
  .catch(e => ({ map: new Map(), error: e.message }));

async function leftItem(ctx, e) {
  const origin = originOf(e.url.replace("%s", "x"));
  const sw0 = await swNow(ctx);
  const swBefore = sw0.error ? `未知（${sw0.error}）` : swText(sw0.map, origin);
  await focusGuide(ctx);
  let before, beforeTabs, plainSeen = null;
  const snap = async () => {
    const st = await ctx.ext.state();
    before = new Set(splitPairs(st).map(p => p[0].splitViewId));
    beforeTabs = new Set(st.tabs.map(t => t.id));
    plainSeen = null;
  };
  await snap();
  const q = `左侧 ${e.name} 测试`;
  const trig = `${e.url}&_ss=${e.id},google`;
  const r = await assist(ctx, {
    title: `T14 ${e.name} 作左侧`, label: `T14 ${e.name}`, what: `左侧为 ${e.host} 的新分屏`, sampleText: q, copyText: trig,
    timeoutMs: ctx.timeoutMs * 2,
    instruction: `1. 在 ${SETTINGS} 的${L.siteSearch}里点${L.add}：名称和快捷字词都填 ${e.kw}，网址粘贴下面的网址，保存；\n`
      + `2. 在 ${e.kw} 右侧 ${L.more} 里点${L.makeDefault}；\n3. 回到向导页，选中下面的文字，拖到标签栏上两个标签之间。\n`
      + `期望：${e.name} ｜ Google 分屏。（${e.name} 的 Service Worker：${swBefore}）脚本能自己认出“只打开了普通的 ${e.name} 搜索（带 _ss、没分屏）”；`
      + "认不出时点“没分屏”（记为失败，脚本会记下那个标签的网址）；做不了这一项才点“跳过”。点“重试”会重新记下现有标签，再拖一次。",
    buttons: ["nosplit", "skip", "retry"],
    onRetry: snap,
    probe: async () => {
      const st = await ctx.ext.state();
      const p = splitPairs(st).find(x => !before.has(x[0].splitViewId) && hostOf(x[0].url) === e.host && hostOf(x[1].url) === G);
      if (p) return { split: p };
      const t = st.tabs.find(x => !beforeTabs.has(x.id) && hostOf(x.url) === e.host && hasSs(x.url) && (x.splitViewId ?? -1) === -1);
      if (!t) { plainSeen = null; return null; }
      if (plainSeen?.id !== t.id) plainSeen = { id: t.id, at: Date.now() };
      return Date.now() - plainSeen.at >= PLAIN_STABLE_MS && { plain: t };
    },
    verdict: async v => {
      const sw1 = await swNow(ctx);
      return t14Verdict({ name: e.name, split: !!v.split, swBefore, swAfter: sw1.error ? `未知（${sw1.error}）` : swText(sw1.map, origin),
        splitText: v.split ? fmt(v.split) : "", plainText: v.plain ? `普通左侧搜索（引擎收到了 _ss）：标签 ${v.plain.id} ${v.plain.url}` : "" });
    },
    onAnswer: async a => {
      const seen = await engineTabs(ctx, e.host);
      if (a !== "nosplit") return { status: "skip", detail: `用户点了“跳过”；SW 注册：触发前${swBefore}；${seen}` };
      const sw1 = await swNow(ctx);
      return t14Verdict({ name: e.name, split: false, swBefore, swAfter: sw1.error ? `未知（${sw1.error}）` : swText(sw1.map, origin), plainText: `用户报告没分屏；${seen}` });
    },
  });
  return { name: `${e.name} 作左侧`, ...r };
}

const T14 = {
  id: "T14", title: "Bing、DuckDuckGo、Perplexity、Kagi 各当一次左侧：拖拽都分屏", kind: "assist", needs: ["kagi"], timeoutFactor: 11,
  cleanup: ["default", "t14"],
  async run(ctx) {
    await prepare(ctx);
    await warmUp(ctx);
    const items = [];
    for (const e of LEFTS) {
      if (ctx.signal?.aborted) break;
      items.push(await leftItem(ctx, e));
    }
    const res = summarize(items);
    const short = i => i.name.replace(" 作左侧", "");
    const degraded = items.filter(i => i.degraded).map(short);
    const unknown = items.filter(i => i.status === "fail" && i.sw === "未知").map(short);
    return { ...res, detail: `${res.detail}\n（开始前已打开五个引擎首页，让它们有机会注册 Service Worker；SW 由 CDP ServiceWorker 域与 service_worker 目标核实）`
      + (degraded.length ? `\n预期降级（有 SW、未分屏）：${degraded.join("、")}——据此决定是否给这些预置引擎设 leftDiscouraged` : "")
      + (unknown.length ? `\nSW 状态读不到、未分屏（无法区分降级和缺陷，不据此设 leftDiscouraged）：${unknown.join("、")}` : "") };
  },
};

const DARK = { media: "", features: [{ name: "prefers-color-scheme", value: "dark" }] };

const B14 = {
  id: "B14", title: "深色模式：设置页与向导页配色跟随", kind: "judge", needs: [], timeoutFactor: 3,
  async run(ctx) {
    const { client } = ctx.browser;
    const page = await openOptions(ctx.browser);
    let gsid = null;
    try {
      const g = (await pageTargets(ctx.browser)).find(t => t.url.startsWith(guideUrl(ctx.port)));
      if (g) gsid = await ctx.browser.attach(g.targetId);
      await client.send("Emulation.setEmulatedMedia", DARK, page.sid);
      if (gsid) await client.send("Emulation.setEmulatedMedia", DARK, gsid);
      // 先在向导页显示说明，停顿一下再切到设置页
      return await judge(ctx, {
        title: "B14 深色模式", timeoutMs: ctx.timeoutMs * 2, afterShow: () => activate(ctx, page.targetId),
        instruction: "即将切到设置页（约 2 秒后），请先记住下面的步骤，看完回到本页作答。\n"
          + "脚本已把设置页和向导页切到深色模式（只模拟这两个页面，不改系统设置）。\n"
          + "1. 看当前设置页：背景、文字、按钮、横幅、对话框（可点“添加引擎”看一眼）是否都是深色配色、清晰可读；\n"
          + "2. 切回向导页（这一页）：是否也是深色。\n都正常点“通过”。",
      });
    } finally {
      if (gsid) {
        await client.send("Emulation.setEmulatedMedia", { media: "", features: [] }, gsid).catch(() => {});
        await client.send("Target.detachFromTarget", { sessionId: gsid }).catch(() => {});
      }
      await page.close();
      await focusGuide(ctx).catch(() => {});
    }
  },
};

export const ASSISTED_2 = [B14, T12, T14];
