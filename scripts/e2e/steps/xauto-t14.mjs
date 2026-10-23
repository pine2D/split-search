// xauto 步骤（二）：T14 Bing、DuckDuckGo、Perplexity、Kagi 各当一次左侧，真实拖拽到两个标签之间。
// 每个引擎只建专用网站搜索 sse2e-<引擎 id>（网址 = 预置模板 + _ss=<id>,google），设为默认后拖拽；结束时由收尾统一删除并恢复默认。
// SW 核实保留（sw.mjs）：分屏通过；没分屏时按触发前后该 origin 的 SW 三态给结论（预期降级 / 缺陷 / 未知）。
import { splitPairs, waitState, summarize, nonce, resetTabs } from "./util.mjs";
import { dragText } from "../gesture.mjs";
import { useDefault, fixWindow, testWindow, tabSpan, withAttempts, xauto, assertAscii } from "./xauto-lib.mjs";
import { ASSISTED_2, LEFTS, warmUp, swNow, hasSs } from "./assisted-2.mjs";
import { hostOf, G } from "./assisted.mjs";
import { swText, t14Verdict, originOf } from "./sw.mjs";

const fallback = ASSISTED_2.find(s => s.id === "T14");
const PLAIN_STABLE_MS = 3000;
export const t14Entry = e => ({ keyword: `sse2e-${e.id}`, name: `sse2e-${e.id}`, url: `${e.url}&_ss=${e.id},google` });

async function leftItem(ctx, e) {
  const origin = originOf(e.url.replace("%s", "x"));
  await useDefault(ctx, t14Entry(e));
  const r = await withAttempts(ctx, async () => {
    const base = await resetTabs(ctx);
    await fixWindow(ctx, base.targetId);
    const wid = await testWindow(ctx, base.targetId);
    const st0 = await ctx.ext.state();
    const before = new Set(splitPairs(st0).map(p => p[0].splitViewId)), beforeTabs = new Set(st0.tabs.map(t => t.id));
    const sw0 = await swNow(ctx);
    const swBefore = sw0.error ? `未知（${sw0.error}）` : swText(sw0.map, origin);
    const s = await tabSpan(ctx, wid, base.tabId);
    const text = assertAscii(`xleft ${e.id} ${nonce()}`);
    await dragText(ctx, { fromTargetId: base.targetId, text, to: { x: s.L - 2, y: s.y }, wid });
    let plainSeen = null;
    const v = await waitState(ctx, st => {
      const p = splitPairs(st).find(x => !before.has(x[0].splitViewId) && hostOf(x[0].url) === e.host && hostOf(x[1].url) === G);
      if (p) return { split: p };
      const t = st.tabs.find(x => !beforeTabs.has(x.id) && hostOf(x.url) === e.host && hasSs(x.url) && (x.splitViewId ?? -1) === -1);
      if (!t) { plainSeen = null; return null; }
      if (plainSeen?.id !== t.id) plainSeen = { id: t.id, at: Date.now() };
      return Date.now() - plainSeen.at >= PLAIN_STABLE_MS && { plain: t };
    }, `左侧为 ${e.host} 的新分屏（或带 _ss 的普通左侧搜索）`, { timeoutMs: 30000 });
    const sw1 = await swNow(ctx);
    const res = t14Verdict({ name: e.name, split: !!v.split, swBefore, swAfter: sw1.error ? `未知（${sw1.error}）` : swText(sw1.map, origin),
      splitText: v.split ? `${v.split[0].url} ｜ ${v.split[1].url}` : "",
      plainText: v.plain ? `普通左侧搜索（引擎收到了 _ss）：标签 ${v.plain.id} ${v.plain.url}` : "" });
    // 预期降级（有 SW、没分屏）是确定的结论，不重试
    return res;
  }, { final: r => !!r.degraded });
  return { name: `${e.name} 作左侧`, ...r };
}

const T14 = xauto({
  id: "T14", title: "Bing、DuckDuckGo、Perplexity、Kagi 各当一次左侧：拖拽都分屏（真实拖拽）", timeoutMs: 900000,
  async run(ctx) {
    await resetTabs(ctx);
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
    return { ...res, detail: `${res.detail}\n（开始前已打开五个引擎首页，让它们有机会注册 Service Worker；SW 由 CDP ServiceWorker 域与 service_worker 目标核实；`
      + "网站搜索只用 sse2e-<引擎 id> 专用条目，收尾时删除）"
      + (degraded.length ? `\n预期降级（有 SW、未分屏）：${degraded.join("、")}——据此决定是否给这些预置引擎设 leftDiscouraged` : "")
      + (unknown.length ? `\nSW 状态读不到、未分屏（无法区分降级和缺陷，不据此设 leftDiscouraged）：${unknown.join("、")}` : "") };
  },
}, fallback);

export const XAUTO_T14 = [T14];
