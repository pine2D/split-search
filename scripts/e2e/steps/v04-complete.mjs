// v0.4 自动步骤 T20（spec 3.2、3.14“⑦ 补成分屏”）：在没有授权的模拟引擎 U 结果页上经 triggerAction 打开工具栏弹窗
// （授予 activeTab），点一个引擎把当前页补成分屏。当前页不导航（网址与页面标记都不变）。
// 正例、反证（从没触发过 action 的标签：弹窗读不到网址、SW 不信任弹窗）、G5 降级网址、窄窗口在本文件；
// 显示说明的几种情况（用户分屏、路径模板、空关键词、非 normal 窗口）在 v04-complete-more.mjs。
// T20 期间默认组合改成 ea ｜ ec：没有 _ss 时建议的右侧是 ec，G5 子项据此区分“建议取自 _ss（eb）”。
import { mockEngines, mockEngineU } from "../config.mjs";
import { expandTemplate } from "../../../src/lib/trigger.js";
import { NARROW_WIDTH } from "../../../src/lib/narrow.js";
import { resetTabs, navigate, waitState, waitTarget, siteX, nonce, summarize, sleep, GO_PREFIX } from "./util.mjs";
import { guarded, addCustom } from "./optpage.mjs";
import { verdict, readRecords, checkPairRecords, sizeTo, restoreWindows } from "./v03-lib.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import { markPage, markIntact, cdpUrl, openActionPopup, requireActiveTab, extTabUrl, openTabIn, ownershipOf, subInfra, tabTargetOf, uUrl, tabCount, notOursProblems } from "./v04-lib.mjs";
import { MORE_ITEMS } from "./v04-complete-more.mjs";
import { infra } from "../ext-webui.mjs";
import { msg } from "../i18n.mjs";

const T20_PAIR = ["ea", "ec"];
const NARROW = 900;
const J = JSON.stringify;
const engine = (port, id) => mockEngines(port).find(e => e.id === id);

// 弹窗显示“补成分屏”区，识别出模拟引擎 U 和 query；返回问题列表
function completeProblems(s, query) {
  if (!s.complete) return [`弹窗应显示“补成分屏”区，实际${s.ours ? "显示了一对" : `显示说明“${s.notOursText}”`}`];
  const p = [];
  const want = msg("popup_complete_detected", mockEngineU(0).name, query);
  if (s.detected !== want) p.push(`识别结果应为“${want}”，实际“${s.detected}”`);
  if (s.completeChoices.includes("eu")) p.push("引擎按钮不应包含识别出的引擎 eu");
  if (!s.completeChoices.includes("ea")) p.push(`引擎按钮应包含 ea，实际 ${s.completeChoices.join(",")}`);
  return p;
}

// 等 L 和右侧（网址 right）组成分屏，返回 [左, 右]
const waitSplit = (ctx, L, right) => waitState(ctx, st => {
  const l = st.tabs.find(t => t.id === L.id);
  if (!l || l.splitViewId === -1) return null;
  const r = st.tabs.find(t => t.id !== L.id && t.splitViewId === l.splitViewId);
  return r && r.url === right && r.status === "complete" && [l, r];
}, `标签 ${L.id} 与 ${right} 组成分屏`);

// 当前页不导航：CDP 网址与页面标记都不变
async function untouched(ctx, L, url0, mark) {
  const p = [];
  const now = await cdpUrl(ctx, L.targetId);
  if (now !== url0) p.push(`左侧网址应保持 ${url0}，实际 ${now}`);
  if (!(await markIntact(ctx, L.targetId, mark))) p.push("左侧页面标记丢了（页面被重新加载过）");
  return p;
}

const positive = ctx => subInfra("(a) 未授权引擎 U 的结果页：triggerAction 打开弹窗、点模拟引擎 A，补成分屏，当前页不动", async () => {
  const { port } = ctx;
  const base = await resetTabs(ctx);
  const L = await openTabIn(ctx, base.windowId, uUrl(port, "hello"));
  const mark = await markPage(ctx, L.targetId);
  const page = await openActionPopup(ctx, L.tabTargetId);
  try {
    await requireActiveTab(ctx, L.id);
    const s = await page.read();
    const p = completeProblems(s, "hello");
    if (s.complete && s.suggested !== T20_PAIR[1]) p.push(`没有 _ss 时建议的右侧应是默认组合右侧 ${T20_PAIR[1]}，实际 ${s.suggested}`);
    if (p.length) return verdict(p, "");
    if (!(await page.click("ea", "complete-choices"))) return { status: "fail", detail: "弹窗里找不到模拟引擎 A 的按钮" };
    const right = expandTemplate(engine(port, "ea").url, "hello");
    const [l, r] = await waitSplit(ctx, L, right);
    if (r.index !== l.index + 1) p.push(`右侧应紧挨在左侧右边（左 ${l.index}、右 ${r.index}）`);
    p.push(...await untouched(ctx, L, L.url, mark));
    p.push(...checkPairRecords(await readRecords(ctx, [l.id, r.id]), l, r,
      { mode: "split", splitViewId: l.splitViewId, engines: ["eu", "ea"], query: "hello" }));
    const own = await ownershipOf(ctx, l.id);
    if (own !== "own") p.push(`左侧应判 own，实际 ${own}`);
    return verdict(p, `${L.url}：弹窗识别“${s.detected}”，点 A 后建成分屏 ${l.id}｜${r.id}（右侧 ${right}），左侧网址与标记不变，两条 search 记录，判 own`);
  } finally { await page.close(); }
});

const counter = ctx => subInfra("(b) 反证：从没触发过 action 的 U 标签，弹窗读不到网址显示说明，SW 对直接发来的 complete-split 回 not_results_page", async () => {
  const { port } = ctx;
  const base = await resetTabs(ctx);
  const T = await openTabIn(ctx, base.windowId, uUrl(port, "never"));
  const pre = await extTabUrl(ctx, T.id);
  if (pre !== null) throw infra(`从没触发过 action 的标签 ${T.id} 的网址扩展读得到（${pre}），反证前提不成立`);
  const page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${T.id}` });
  try {
    const s = await page.read();
    const p = notOursProblems(s);
    const n0 = await tabCount(ctx);
    const reply = await page.ev(`chrome.runtime.sendMessage({ type: "complete-split", tabId: ${T.id}, engineId: "ea" })`);
    if (reply?.ok !== false || reply?.code !== "not_results_page") p.push(`SW 应回 { ok: false, code: "not_results_page" }，实际 ${J(reply)}`);
    await sleep(500);
    const n1 = await tabCount(ctx);
    if (n1 !== n0) p.push(`标签数从 ${n0} 变成 ${n1}`);
    if ((await cdpUrl(ctx, T.targetId)) !== T.url) p.push("被测标签的网址变了");
    return verdict(p, `标签 ${T.id} 的网址扩展读不到；弹窗显示说明，SW 回 not_results_page，标签数 ${n0} 不变`);
  } finally { await page.close(); }
});

const g5 = ctx => subInfra("(c) G5 降级网址（带 _ss=eu,eb）：没有重定向；弹窗建议的右侧取 _ss 里的 eb、排第一", async () => {
  const { port } = ctx;
  const base = await resetTabs(ctx);
  const T = await openTabIn(ctx, base.windowId, siteX(port, `/t20-g5?n=${nonce()}`));
  const url = `${uUrl(port, "x")}&_ss=eu,eb`;
  await navigate(ctx, T.targetId, url);
  await waitTarget(ctx, t => t.targetId === T.targetId && t.url === url, url);
  await waitState(ctx, st => st.tabs.some(t => t.id === T.id && t.status === "complete"), `标签 ${T.id} 加载完成`);
  const p = [];
  const chain = ctx.consoleCollector?.navChain(T.targetId)?.map(e => e.url);
  if (chain?.some(u => u.startsWith(GO_PREFIX))) p.push(`跳转链里出现了 go.html：${chain.join(" → ")}`);
  if ((await cdpUrl(ctx, T.targetId)) !== url) p.push(`网址应仍是 ${url}（没有被重定向），实际 ${await cdpUrl(ctx, T.targetId)}`);
  const page = await openActionPopup(ctx, await tabTargetOf(ctx, url));
  try {
    await requireActiveTab(ctx, T.id);
    const s = await page.read();
    p.push(...completeProblems(s, "x"));
    if (s.complete && (s.suggested !== "eb" || s.completeChoices[0] !== "eb")) {
      p.push(`建议的右侧应是 _ss 里的 eb 并排第一（默认组合右侧是 ${T20_PAIR[1]}），实际建议 ${s.suggested}、顺序 ${s.completeChoices.join(",")}`);
    }
    const how = chain ? `跳转链 ${chain.length} 条，没有 go.html` : "没有控制台收集器，只核对了网址仍带 _ss";
    return verdict(p, `${url}：${how}；弹窗建议 eb 并排第一`);
  } finally { await page.close(); }
});

const narrow = (ctx, saved) => subInfra("(h) 窄窗口（narrowFallback 缺省）：右侧在相邻后台标签打开，记 adjacent，弹窗提示窗口较窄", async () => {
  const { port } = ctx;
  await ctx.ext.eval(`chrome.storage.sync.remove("narrowFallback").then(() => true)`);
  const base = await resetTabs(ctx);
  const w = await sizeTo(ctx, base, NARROW, saved);
  if (!(w < NARROW_WIDTH)) return { status: "skip", detail: `窗口宽度设不到 ${NARROW_WIDTH} 以下（设 ${NARROW}，读回 ${w}）` };
  const L = await openTabIn(ctx, base.windowId, uUrl(port, "narrow"));
  const mark = await markPage(ctx, L.targetId);
  const page = await openActionPopup(ctx, L.tabTargetId);
  try {
    await requireActiveTab(ctx, L.id);
    const s = await page.read();
    const p = completeProblems(s, "narrow");
    if (p.length) return verdict(p, "");
    if (!(await page.click("ea", "complete-choices"))) return { status: "fail", detail: "弹窗里找不到模拟引擎 A 的按钮" };
    const right = expandTemplate(engine(port, "ea").url, "narrow");
    const [l, r] = await waitState(ctx, st => {
      const l = st.tabs.find(t => t.id === L.id);
      const r = l && st.tabs.find(t => t.windowId === l.windowId && t.index === l.index + 1 && t.url === right && t.status === "complete");
      return r && [l, r];
    }, `相邻标签 ${right}`);
    if (l.splitViewId !== -1 || r.splitViewId !== -1) p.push("窄窗口下不应建分屏");
    if (r.active) p.push(`右侧 ${r.id} 应是后台标签`);
    p.push(...await untouched(ctx, L, L.url, mark));
    p.push(...checkPairRecords(await readRecords(ctx, [l.id, r.id]), l, r, { mode: "adjacent", splitViewId: -1, engines: ["eu", "ea"], query: "narrow" }));
    const want = msg("popup_complete_narrow");
    const s2 = await page.until(x => x.note === want, `提示“${want}”`).catch(e => { p.push(e.message); return null; });
    if (s2 && !s2.ours) p.push("补成之后弹窗应换成对视图");
    return verdict(p, `窗口宽 ${w}：右侧 ${r.id} 在相邻后台标签打开 ${right}，记录 adjacent，弹窗提示“${want}”并换成对视图`);
  } finally { await page.close(); }
});

const T20 = {
  id: "T20", title: "⑦ 补成分屏：未授权引擎的结果页经 activeTab 识别并补成分屏，当前页不动；反证、G5、窄窗口与显示说明的各种情况（自动判定）",
  kind: "auto", needs: [], timeoutMs: 180000,
  run: ctx => guarded(ctx, ["customEngines", "defaultPair", "narrowFallback"], async () => {
    await addCustom(ctx.ext, mockEngineU(ctx.port));
    await ctx.ext.eval(`chrome.storage.sync.set({ defaultPair: ${J(T20_PAIR)} }).then(() => true)`);
    const saved = new Map();
    try {
      const items = [await positive(ctx), await counter(ctx), await g5(ctx)];
      for (const item of MORE_ITEMS) items.push(await item(ctx));
      items.push(await narrow(ctx, saved));
      return summarize(items);
    } finally { await restoreWindows(ctx, saved); }
  }),
};

export const V04_COMPLETE_STEPS = [T20];
