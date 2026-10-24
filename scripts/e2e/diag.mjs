// 失败诊断的 CDP 部分：扩展读不到网址的标签（未授权的 origin、向导页、chrome://）用 CDP 目标网址补上；
// 步骤自己的标签再附上主框架的导航记录（控制台收集器记下的 Document 请求跳转链，没有就用 Page.getNavigationHistory）。
// 一切都有上限（页面数、条目数、单次调用超时），写出前一律经 redact 脱敏（由调用方 runner.mjs 统一处理）。
import { EXT_ID } from "./config.mjs";

const MAX_PAGES = 6, MAX_ENTRIES = 8;
const OPT_PREFIX = `chrome-extension://${EXT_ID}/options/`;

// 纯函数：把 CDP 页面目标对应到扩展的标签。先按“同一窗口、网址相同”配对；剩下的按窗口内顺序配对
// （只剩一个标签和一个目标时是确定的，否则是推测）。返回 { byTab: Map(tabId → { page, how }), unmatched: pages[] }
export function mapTargets(tabs = [], pages = []) {
  const byTab = new Map(), used = new Set();
  const sameWin = (p, t) => p.windowId == null || p.windowId === t.windowId;
  for (const t of tabs) {
    if (!t.url) continue;
    const p = pages.find(x => !used.has(x.targetId) && x.url === t.url && sameWin(x, t));
    if (p) { used.add(p.targetId); byTab.set(t.id, { page: p, how: "网址" }); }
  }
  const wins = [...new Set(tabs.map(t => t.windowId))];
  for (const w of wins) {
    const restTabs = tabs.filter(t => t.windowId === w && !byTab.has(t.id)).sort((a, b) => a.index - b.index);
    const restPages = pages.filter(p => !used.has(p.targetId) && p.windowId === w);
    const how = restTabs.length === 1 && restPages.length === 1 ? "唯一" : "按顺序推测";
    restTabs.forEach((t, i) => {
      const p = restPages[i];
      if (p) { used.add(p.targetId); byTab.set(t.id, { page: p, how }); }
    });
  }
  return { byTab, unmatched: pages.filter(p => !used.has(p.targetId)) };
}

// 步骤自己的页面：不是向导页、设置页
export const ownPage = (p, port) => !p.url.startsWith(`http://127.0.0.1:${port}/guide`) && !p.url.startsWith(OPT_PREFIX);

async function navHistory(browser, targetId) {
  const { client } = browser;
  const sid = (await client.send("Target.attachToTarget", { targetId, flatten: true }, undefined, { timeoutMs: 3000 })).sessionId;
  try {
    const h = await client.send("Page.getNavigationHistory", {}, sid, { timeoutMs: 3000 });
    return h.entries.slice(-MAX_ENTRIES).map((e, i, a) => ({
      url: e.url, how: e.transitionType, current: h.currentIndex === h.entries.length - a.length + i,
    }));
  } finally { await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {}); }
}

// 收集：页面目标（含所在窗口）、标签对应、步骤页面的导航记录。ctx = { browser, port, consoleCollector? }
export async function collectCdp(ctx, state) {
  const { client } = ctx.browser;
  const infos = (await client.send("Target.getTargets", {}, undefined, { timeoutMs: 3000 })).targetInfos.filter(t => t.type === "page");
  const pages = [];
  for (const t of infos) {
    const w = await client.send("Browser.getWindowForTarget", { targetId: t.targetId }, undefined, { timeoutMs: 2000 }).catch(() => null);
    pages.push({ targetId: t.targetId, url: t.url, title: t.title, windowId: w?.windowId ?? null });
  }
  const { byTab, unmatched } = mapTargets(state?.tabs ?? [], pages);
  const chains = [];
  for (const p of pages.filter(x => ownPage(x, ctx.port)).slice(0, MAX_PAGES)) {
    const net = ctx.consoleCollector?.navChain?.(p.targetId) ?? [];
    if (net.length) { chains.push({ targetId: p.targetId, source: "网络", entries: net.slice(-MAX_ENTRIES) }); continue; }
    const entries = await navHistory(ctx.browser, p.targetId).catch(e => [{ url: `（读不到：${e.message}）` }]);
    chains.push({ targetId: p.targetId, source: "导航历史", entries });
  }
  return { pages, tabTargets: Object.fromEntries([...byTab].map(([id, v]) => [id, { targetId: v.page.targetId, url: v.page.url, how: v.how }])),
    unmatched, chains };
}

const short = id => String(id).slice(0, 8);
// 标签那一行末尾追加的 CDP 信息
export const tabSuffix = (cdp, tab) => {
  const m = cdp?.tabTargets?.[tab.id];
  if (!m) return "";
  return !tab.url || tab.url !== m.url ? ` ｜CDP 目标 ${short(m.targetId)}（${m.how}）：${m.url}` : ` ｜CDP 目标 ${short(m.targetId)}`;
};

export function formatCdp(cdp) {
  if (!cdp) return [];
  if (cdp.error) return [`  CDP 目标：读不到（${cdp.error}）`];
  const lines = [];
  if (cdp.unmatched?.length) {
    lines.push("  没对应上标签的 CDP 页面目标：");
    for (const p of cdp.unmatched) lines.push(`    ${short(p.targetId)} 窗口=${p.windowId ?? "?"} ${p.url}`);
  }
  if (cdp.chains?.length) {
    lines.push("  步骤页面的主框架导航记录（最近的在后）：");
    for (const c of cdp.chains) {
      const steps = c.entries.map(e => `${e.status ? `[${e.status}] ` : ""}${e.url}${e.how ? `（${e.how}）` : ""}${e.current ? "←当前" : ""}`);
      lines.push(`    ${short(c.targetId)}（${c.source}）：${steps.join(" → ")}`);
    }
  }
  return lines;
}
