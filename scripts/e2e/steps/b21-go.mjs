// B21 (o) go.html 出错页的“打开设置”按错误码进对应 tab（lib/options-route.js 的 errorTab，chrome/options-page.js 的 openOptionsTab）：
// 没有设置页时新开 options.html#tab-<key>；已开的设置页停在 ② 时把它切到前台、换到那个 tab，不新开、不重载；
// 已开的页先停在 ③ 再点到 ②（核对 documentUrl 跟着 replaceState 变），以及本来就停在 ③（网址已是目标，不导航）；
// 没收到触发网址（no_trigger，不对应 tab）时照旧 openOptionsPage，新开的页不带 hash。
import { EXT_ID } from "../config.mjs";
import { OPTIONS_URL, openOptions, showTab } from "./optpage.mjs";
import { setDone } from "./b19.mjs";
import { closeTarget } from "./b19-popup.mjs";
import { pageTargets } from "./util.mjs";
import { verdict } from "./v03-lib.mjs";
import { NOW, fmtNow } from "./b21-links.mjs";

const J = JSON.stringify;
const GO = `chrome-extension://${EXT_ID}/go.html`;
// unknown_engine（_ss 的右侧不存在）→ ③；marker_format（_ss 只有一个引擎）→ ①；no_trigger → 不深链
const UNKNOWN = `${GO}?u=https://a.test/?q=x&_ss=ea,nope`;
const MARKER = `${GO}?u=https://a.test/?q=x&_ss=ea`;

const optionsTargets = async ctx => (await pageTargets(ctx.browser)).filter(t => t.url.startsWith(OPTIONS_URL));

async function evalIn(ctx, targetId, expr) {
  const sid = await ctx.browser.attach(targetId);
  try { return await ctx.browser.evaluate(sid, expr, { timeoutMs: 3000 }); }
  finally { await ctx.browser.client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {}); }
}

// 打开出错页，等“打开设置”出现后点它；返回出错页的 targetId（用完关掉）
async function clickOpenOptions(ctx, url) {
  const { targetId } = await ctx.browser.client.send("Target.createTarget", { url });
  const shown = await ctx.browser.waitFor(() => evalIn(ctx, targetId, `document.getElementById("open-options")?.hidden === false`).catch(() => false),
    { timeoutMs: 10000, intervalMs: 150 }).catch(() => false);
  if (!shown) throw new Error(`出错页 10 秒内没有显示“打开设置”：${url}`);
  await evalIn(ctx, targetId, `document.getElementById("open-options").click(), true`);
  return targetId;
}

async function closeAllOptions(ctx) {
  for (const t of await optionsTargets(ctx)) await closeTarget(ctx, t.targetId);
  await ctx.browser.waitFor(async () => (await optionsTargets(ctx)).length === 0, { timeoutMs: 5000, intervalMs: 150 })
    .catch(() => { throw new Error("5 秒内没能关掉所有设置页"); });
}

// 没有设置页：点“打开设置”后新开一个，网址是 want，渲染出来选中 tab
async function fresh(ctx, url, wantHash, wantTab, p, seen) {
  await closeAllOptions(ctx);
  const go = await clickOpenOptions(ctx, url);
  try {
    const t = await ctx.browser.waitFor(async () => (await optionsTargets(ctx))[0], { timeoutMs: 10000, intervalMs: 200 }).catch(() => null);
    if (!t) return p.push(`没有设置页时点 ${url} 的“打开设置”，10 秒内没有新开设置页`);
    // 新标签先是 about:blank（目标网址已经是设置页）：等文档真的是设置页、渲染完并选中了一个 tab 再读
    const n = await ctx.browser.waitFor(() => evalIn(ctx, t.targetId, `location.href.startsWith(${J(OPTIONS_URL)}) && !document.body.classList.contains("loading")
      && document.querySelector('[role="tab"][aria-selected="true"]') ? ${NOW} : null`).catch(() => null),
      { timeoutMs: 10000, intervalMs: 200 }).catch(() => null);
    seen.push(`新开 ${J(new URL(t.url).hash)}→${n ? fmtNow(n) : "没渲染完"}`);
    if (t.url !== OPTIONS_URL + wantHash) p.push(`新开的设置页网址应为 options.html${wantHash}，实际 ${t.url}`);
    if (n?.tab !== wantTab) p.push(`新开的设置页应选中 ${wantTab}，实际 ${n ? fmtNow(n) : "10 秒内没渲染完"}`);
  } finally {
    await closeAllOptions(ctx).catch(() => {});
    await closeTarget(ctx, go);
  }
}

// 已开的设置页按 from 打开（via：打开后再点到这个 tab，hash 经 replaceState 改写，核对 getContexts 的 documentUrl 跟着变）：
// 点“打开设置”后它成为本窗口的活动标签、换到 wantTab，页面标记还在，没有新开设置页。from 等于 wantTab 时走“网址已是目标、不导航”一支
async function reuse(ctx, url, wantTab, p, seen, { from = "pair", via = null } = {}) {
  await closeAllOptions(ctx);
  const page = await openOptions(ctx.browser, { tab: from });
  let go = null;
  try {
    if (via) await showTab(page, via);
    await page.ev(`globalThis.__e2eB21o = 1`);
    go = await clickOpenOptions(ctx, url);
    const n = await page.until(`const n = ${NOW}; return n.tab === ${J(wantTab)} && n;`, 5000).catch(() => page.ev(NOW));
    const mark = await page.ev(`globalThis.__e2eB21o === 1`);
    const count = (await optionsTargets(ctx)).length;
    const active = await page.ev(`chrome.tabs.getCurrent().then(t => t.active)`).catch(() => null);
    seen.push(`已开在 ${via ?? from}→${fmtNow(n)}`);
    if (n.tab !== wantTab || n.hash !== `#tab-${wantTab}`) p.push(`已开的设置页应换到 ${wantTab}、hash #tab-${wantTab}：${fmtNow(n)}`);
    if (!mark) p.push("原设置页的页面标记没了（被重载了）");
    if (count !== 1) p.push(`应只有原来那一个设置页，实际 ${count} 个`);
    if (active !== true) p.push(`原设置页应成为它所在窗口的活动标签，实际 ${J(active)}`);
  } finally {
    if (go) await closeTarget(ctx, go);
    await page.close();
  }
}

export async function goDeepLink(ctx) {
  await setDone(ctx, true); // 卡片不显示：默认 tab 是 ②，深链的效果看得出来
  const p = [], seen = [];
  await fresh(ctx, UNKNOWN, "#tab-engines", "engines", p, seen);
  await reuse(ctx, UNKNOWN, "engines", p, seen);
  await reuse(ctx, MARKER, "add", p, seen);
  await reuse(ctx, UNKNOWN, "engines", p, seen, { from: "engines", via: "pair" });
  await reuse(ctx, UNKNOWN, "engines", p, seen, { from: "engines" });
  await fresh(ctx, GO, "", "pair", p, seen);
  return verdict(p, seen.join("；"));
}
