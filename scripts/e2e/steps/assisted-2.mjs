// 需要人参与的步骤（二）：T12 编辑自动发现的条目（judge）、T14 各引擎作左侧（assist）。两者都是 xauto 版本的回退。
import { splitPairs, sleep, summarize, nonce } from "./util.mjs";
import { assist, judge, focusGuide, guideUrl } from "./guided.mjs";
import { prepare, hostOf, fmt, SETTINGS, G, BING } from "./assisted.mjs";
import { L } from "./labels.mjs";
import { readServiceWorkers, swText, t14Verdict, originOf, findPlain, plainTracker, plainLine, tabChains, strayRight, takeoverEvidence } from "./sw.mjs";

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
export const LEFTS = [
  { id: "bing", name: "Bing", host: BING, kw: "bg", url: "https://www.bing.com/search?q=%s" },
  { id: "ddg", name: "DuckDuckGo", host: "duckduckgo.com", kw: "dg", url: "https://duckduckgo.com/?q=%s" },
  { id: "perplexity", name: "Perplexity", host: "www.perplexity.ai", kw: "px", url: "https://www.perplexity.ai/search?q=%s" },
  { id: "kagi", name: "Kagi", host: "kagi.com", kw: "kg", url: "https://kagi.com/search?q=%s" },
];
const HOMES = ["https://www.google.com/", "https://www.bing.com/", "https://duckduckgo.com/", "https://www.perplexity.ai/", "https://kagi.com/"];

// 先把五个引擎首页各打开一遍，让它们有机会注册 Service Worker（T14 要看 SW 会不会绕过 DNR）
export async function warmUp(ctx) {
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

// 全部页面的主框架跳转链（控制台收集器记的；没有收集器为 null）：只用来找“扩展接管过”的反证
export const navChains = ctx => ctx.consoleCollector?.navChains?.() ?? null;
// 每个标签自己的跳转链：认“普通左侧搜索”用（Perplexity 的 SPA 可能改写网址、丢掉 _ss），不用全局的链
export async function chainsByTab(ctx, st) {
  const col = ctx.consoleCollector;
  if (!col?.navChain) return new Map();
  return tabChains(st?.tabs, await ctx.browser.targets(), col.navChain);
}
export const errCount = ctx => ctx.consoleCollector?.errors?.length ?? 0;
// 触发后扩展接管过这次触发的反证（sw.mjs takeoverEvidence）；err0：触发前的控制台错误数
export async function takeoverNow(ctx, { text, err0, beforeTabs }) {
  const st = await ctx.ext.state().catch(() => null);
  const errors = (ctx.consoleCollector?.errors ?? []).slice(err0);
  return takeoverEvidence({ text, chains: navChains(ctx), errors, stray: strayRight(st, beforeTabs) });
}

export const swNow = async ctx => readServiceWorkers(ctx.browser, { prefer: t => t.url.startsWith(guideUrl(ctx.port)) })
  .catch(e => ({ map: new Map(), error: e.message }));

async function leftItem(ctx, e) {
  const origin = originOf(e.url.replace("%s", "x"));
  const sw0 = await swNow(ctx);
  const swBefore = sw0.error ? `未知（${sw0.error}）` : swText(sw0.map, origin);
  await focusGuide(ctx);
  let before, beforeTabs, q, err0;
  const plain = plainTracker();
  // 每次（含“重试”）重新记下现有标签、控制台错误数，并换一个带 nonce 的查询词（上一次尝试留下的标签和跳转链不会被认成这一次的）
  const snap = async () => {
    const st = await ctx.ext.state();
    before = new Set(splitPairs(st).map(p => p[0].splitViewId));
    beforeTabs = new Set(st.tabs.map(t => t.id));
    q = `左侧 ${e.name} 测试 ${nonce()}`;
    err0 = errCount(ctx);
    plain.reset();
  };
  await snap();
  const trig = `${e.url}&_ss=${e.id},google`;
  const takeover = () => takeoverNow(ctx, { text: q, err0, beforeTabs });
  const r = await assist(ctx, {
    title: `T14 ${e.name} 作左侧`, label: `T14 ${e.name}`, what: `左侧为 ${e.host} 的新分屏`, get sampleText() { return q; }, copyText: trig,
    timeoutMs: ctx.timeoutMs * 2,
    instruction: `1. 在 ${SETTINGS} 的${L.siteSearch}里点${L.add}：名称和快捷字词都填 ${e.kw}，网址粘贴下面的网址，保存；\n`
      + `2. 在 ${e.kw} 右侧 ${L.more} 里点${L.makeDefault}；\n3. 回到向导页，选中下面的文字，拖到标签栏上两个标签之间。\n`
      + `期望：${e.name} ｜ Google 分屏。（${e.name} 的 Service Worker：${swBefore}）脚本能自己认出“只打开了普通的 ${e.name} 搜索（带着这次的查询词、没分屏）”；`
      + "认不出时点“没分屏”（记为失败，脚本会记下那个标签的网址）；做不了这一项才点“跳过”。点“重试”会重新记下现有标签，再拖一次。",
    buttons: ["nosplit", "skip", "retry"],
    onRetry: snap,
    probe: async () => {
      const st = await ctx.ext.state();
      const p = splitPairs(st).find(x => !before.has(x[0].splitViewId) && hostOf(x[0].url) === e.host && hostOf(x[1].url) === G);
      if (p) return { split: p };
      const hit = plain.see(findPlain(st, { host: e.host, text: q, beforeTabs, chains: await chainsByTab(ctx, st) }));
      return hit && { plain: hit };
    },
    verdict: async v => {
      const sw1 = await swNow(ctx);
      return t14Verdict({ name: e.name, split: !!v.split, plain: !!v.plain, takeover: v.plain ? await takeover() : null, swBefore, swAfter: sw1.error ? `未知（${sw1.error}）` : swText(sw1.map, origin),
        splitText: v.split ? fmt(v.split) : "", plainText: v.plain ? plainLine(v.plain) : "" });
    },
    onAnswer: async a => {
      const seen = await engineTabs(ctx, e.host);
      if (a !== "nosplit") return { status: "skip", detail: `用户点了“跳过”；SW 注册：触发前${swBefore}；${seen}` };
      const sw1 = await swNow(ctx);
      const st = await ctx.ext.state().catch(() => null);
      const hit = st && findPlain(st, { host: e.host, text: q, beforeTabs, chains: await chainsByTab(ctx, st) });
      return t14Verdict({ name: e.name, split: false, plain: !!hit, takeover: hit ? await takeover() : null, swBefore, swAfter: sw1.error ? `未知（${sw1.error}）` : swText(sw1.map, origin),
        plainText: `用户报告没分屏；${hit ? `${plainLine(hit)}；` : ""}${seen}` });
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
    const degraded = items.filter(i => i.status === "degrade").map(short);
    const unknown = items.filter(i => i.status === "fail" && i.sw === "未知").map(short);
    return { ...res, detail: `${res.detail}\n（开始前已打开五个引擎首页，让它们有机会注册 Service Worker；SW 由 CDP ServiceWorker 域与 service_worker 目标核实）`
      + (degraded.length ? `\n预期降级（触发前有 SW、未分屏、左侧停在引擎上）：${degraded.join("、")}——据此决定是否给这些预置引擎设 leftDiscouraged` : "")
      + (unknown.length ? `\nSW 状态读不到、未分屏（无法区分降级和缺陷，不据此设 leftDiscouraged）：${unknown.join("、")}` : "") };
  },
};

export const ASSISTED_2 = [T12, T14]; // B14 已改为 auto（b14.mjs）
