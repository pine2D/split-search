// 需要人参与的步骤（二）：T12 编辑自动发现的条目（judge）、T14 各引擎作左侧（assist）、B14 深色模式（judge）。
import { splitPairs, sleep, pageTargets, summarize } from "./util.mjs";
import { openOptions } from "./optpage.mjs";
import { assist, judge, focusGuide, activate, guideUrl } from "./guided.mjs";
import { prepare, hostOf, fmt, SETTINGS, G, BING } from "./assisted.mjs";

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
        `1. 打开 ${SETTINGS}，找到 Chrome 自动发现的 Kagi 条目（在“网站搜索”或“非活动的快捷方式”里；没有就先在 kagi.com 搜索一次再刷新）；`,
        "2. 点它右侧的“修改”（铅笔或 ⋮ → 修改），在网址末尾追加下面这段（可复制），保存；",
        "3. 在它右侧 ⋮ 里点“设为默认”；",
        "4. 在地址栏直接输入“联想测试”（不用快捷字词），先留意下拉框里有没有 Kagi 的搜索联想，再回车。",
        "期望：Kagi ｜ Bing 分屏。之后会问你联想的情况。（默认改回 Google、删掉追加的 _ss 放在全部步骤后的收尾提示里。）",
      ].join("\n"),
      probe: async () => splitPairs(await ctx.ext.state()).find(([l, r]) => hostOf(l.url) === "kagi.com" && hostOf(r.url) === BING),
      verdict: p => ({ status: "pass", detail: `分屏：${fmt(p)}` }),
    });
    if (split.status === "skip") return split;
    await focusGuide(ctx);
    const plain = await ask(ctx, "T12 联想（直接输入）", "刚才直接输入“联想测试”时，地址栏下拉框里有 Kagi 的搜索联想吗？");
    const kw = await ask(ctx, "T12 联想（快捷字词模式）",
      "再试一次：在地址栏输入 Kagi 条目的快捷字词，按空格进入快捷字词模式，再输入“联想测试”（先别回车）。下拉框里有 Kagi 的搜索联想吗？看完按 Esc。");
    return { status: split.status, detail: `${split.detail}；直接输入时联想：${plain}；快捷字词模式联想：${kw}` };
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

// 先把五个引擎首页各打开一遍，让它们的 Service Worker 注册上（T14 要看 SW 会不会绕过 DNR）
async function warmUp(ctx) {
  const ids = [];
  for (const url of HOMES) ids.push((await ctx.browser.client.send("Target.createTarget", { url, background: true })).targetId);
  await sleep(8000);
  for (const targetId of ids) await ctx.browser.client.send("Target.closeTarget", { targetId }).catch(() => {});
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
      await focusGuide(ctx);
      const before = new Set(splitPairs(await ctx.ext.state()).map(p => p[0].splitViewId));
      const q = `左侧 ${e.name} 测试`;
      const trig = `${e.url}&_ss=${e.id},google`;
      const r = await assist(ctx, {
        title: `T14 ${e.name} 作左侧`, label: `T14 ${e.name}`, what: `左侧为 ${e.host} 的新分屏`, sampleText: q, copyText: trig,
        timeoutMs: ctx.timeoutMs * 2,
        instruction: `1. 在 ${SETTINGS} 的“网站搜索”里添加：名称和快捷字词都填 ${e.kw}，网址粘贴下面的网址，保存；\n`
          + `2. 在 ${e.kw} 右侧 ⋮ 里点“设为默认”；\n3. 回到向导页，选中下面的文字，拖到标签栏上两个标签之间。\n`
          + `期望：${e.name} ｜ Google 分屏。若只打开了普通的 ${e.name} 搜索（没分屏），可能是该引擎的 Service Worker 绕过了 DNR：点“跳过”，并记下现象。`,
        probe: async () => splitPairs(await ctx.ext.state()).find(p => !before.has(p[0].splitViewId) && hostOf(p[0].url) === e.host && hostOf(p[1].url) === G),
        verdict: p => ({ status: "pass", detail: fmt(p) }),
      });
      items.push({ name: `${e.name} 作左侧`, ...r });
    }
    const res = summarize(items);
    return { ...res, detail: `已先打开五个引擎首页注册 Service Worker\n${res.detail}` };
  },
};

const DARK = { media: "", features: [{ name: "prefers-color-scheme", value: "dark" }] };

const B14 = {
  id: "B14", title: "深色模式：设置页与向导页配色跟随", kind: "judge", needs: [], timeoutFactor: 2,
  async run(ctx) {
    const { client } = ctx.browser;
    const page = await openOptions(ctx.browser);
    let gsid = null;
    try {
      const g = (await pageTargets(ctx.browser)).find(t => t.url.startsWith(guideUrl(ctx.port)));
      if (g) gsid = await ctx.browser.attach(g.targetId);
      await client.send("Emulation.setEmulatedMedia", DARK, page.sid);
      if (gsid) await client.send("Emulation.setEmulatedMedia", DARK, gsid);
      await activate(ctx, page.targetId);
      return await judge(ctx, {
        title: "B14 深色模式", timeoutMs: ctx.timeoutMs,
        instruction: "脚本已把设置页和向导页切到深色模式（只模拟这两个页面，不改系统设置）。\n"
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
