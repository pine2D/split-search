// B19 里弹窗分屏外三档的子项（从 b19.mjs 拆出，行为说明见那边的文件头）。
// 点“完成设置”/“查看第 2 步”有两条路（src/popup/idle.js 的 openSetup）：
// - reuse：已开着设置页时不新开标签，把它切成活动标签，发 reveal-setup 让它滚到卡片、焦点给卡片标题；
// - fresh：先关掉所有设置页再点，退回 tabs.create(options.html#setup)，新开的那页焦点给卡片标题。
import { OPTIONS_URL, sleep } from "./optpage.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import { pageTargets, waitTarget } from "./util.mjs";
import { msgIn, E2E_LOCALE } from "../i18n.mjs";
import { mockEngines } from "../config.mjs";

const J = JSON.stringify;
export const SETUP_URL = `${OPTIONS_URL}#setup`;
// 各档显示的块（idleShown 的顺序与 popup.html 一致）、说明文字与页脚
const TIERS = {
  setup: { shown: ["idle-setup"], notOurs: false, footer: false },
  try: { shown: ["idle-try", "idle-setup-note"], notOurs: true, footer: true },
  ready: { shown: ["idle-try"], notOurs: true, footer: true },
};
const fmtPopup = s => `${s.idleTier ?? "无"} 档，显示 ${s.idleShown.join("、") || "无"}，说明文字${s.notOurs ? "有" : "无"}，页脚${s.footer ? "有" : "无"}`;

export const verdictOf = (p, detail) => p.length ? { status: "fail", detail: p.join("；") } : { status: "pass", detail };

// 卡片、焦点、选中的 tab、hash 与本页是不是活动标签（options.js 去掉 loading 之后才按 #setup 给焦点；没渲染完返回 null）
const PAGE_STATE = `(async () => {
  const s = document.getElementById("setup");
  if (!s || document.body.classList.contains("loading") || !s.dataset.mode) return null;
  const a = document.activeElement;
  const tab = await chrome.tabs.getCurrent();
  return { mode: s.dataset.mode, hidden: s.hidden, focus: a?.id || a?.tagName || "", active: tab?.active ?? null,
    tab: document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null, hash: location.hash }; })()`;

async function evalTarget(ctx, targetId, expr) {
  const sid = await ctx.browser.attach(targetId);
  try { return await ctx.browser.evaluate(sid, expr, { timeoutMs: 3000 }); }
  finally { await ctx.browser.client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {}); }
}

// 页面显示出来后读卡片与焦点
export const setupFocus = (ctx, targetId) =>
  ctx.browser.waitFor(() => evalTarget(ctx, targetId, PAGE_STATE), { timeoutMs: 10000, intervalMs: 150 });
export const closeTarget = (ctx, targetId) => ctx.browser.client.send("Target.closeTarget", { targetId }).catch(() => {});
const optionsTargets = async ctx => (await pageTargets(ctx.browser)).filter(t => t.url.startsWith(OPTIONS_URL));

// prevHash：点之前这一页的 hash。卡片在“添加到 Chrome”tab：从别的 tab 切过来写 #tab-add，本来就在 ① 时 hash 不动
const cardProblems = (f, mode, prevHash = "#setup") => [
  ...(f.mode !== mode || f.hidden ? [`设置页的卡片应是 ${mode}，实际 ${f.mode}${f.hidden ? "（隐藏）" : ""}`] : []),
  ...(f.focus !== "setup-title" ? [`设置页的焦点应在卡片标题，实际 ${f.focus}`] : []),
  ...(f.tab !== "tabbtn-add" ? [`设置页应选中“添加到 Chrome”tab，实际 ${f.tab}`] : []),
  ...(![`#tab-add`, "#setup", prevHash].includes(f.hash) ? [`设置页的 hash 应为 #tab-add、#setup 或原值 ${J(prevHash)}，实际 ${J(f.hash)}`] : []),
];

// reuse：已开着设置页时点 click。标签数不变、没有新开设置页，原有的一个设置页变成活动标签，焦点落在 setup-title
async function clickReuse(ctx, page, click, mode) {
  const before = await optionsTargets(ctx);
  if (!before.length) throw new Error("点之前应至少开着一个设置页");
  for (const t of before) await evalTarget(ctx, t.targetId, "document.activeElement?.blur(); true");
  const count = (await pageTargets(ctx.browser)).length;
  await page.ev(`document.getElementById(${J(click)}).click(); true`);
  const hit = await ctx.browser.waitFor(async () => {
    for (const t of before) {
      const f = await evalTarget(ctx, t.targetId, PAGE_STATE).catch(() => null);
      if (f?.focus === "setup-title") return { t, f };
    }
    return null;
  }, { timeoutMs: 10000, intervalMs: 200 }).catch(() => null);
  await sleep(800); // 误走退回路径的 tabs.create 也给它时间出现
  const p = [];
  const after = await pageTargets(ctx.browser);
  const fresh = after.filter(t => t.url.startsWith(OPTIONS_URL) && !before.some(b => b.targetId === t.targetId));
  if (fresh.length) p.push(`已开着设置页时不该新开设置页，实际新开了 ${fresh.map(t => t.url).join("、")}`);
  if (after.length !== count) p.push(`点之前 ${count} 个页面，点之后 ${after.length} 个`);
  if (!hit) {
    p.push(`10 秒内已开的 ${before.length} 个设置页都没有把焦点给卡片标题`);
    return { p, detail: "" };
  }
  p.push(...cardProblems(hit.f, mode, new URL(hit.t.url).hash));
  if (hit.f.active !== true) p.push(`被复用的设置页应是活动标签，实际 active ${J(hit.f.active)}`);
  return { p, detail: `点 #${click}：复用已开的设置页（共 ${before.length} 个），没有新开标签，它成了活动标签，卡片 ${hit.f.mode}，焦点 ${hit.f.focus}` };
}

// fresh：关掉所有设置页后点 click，新开 options.html#setup，焦点落在 setup-title；核对完关掉
async function clickFresh(ctx, page, click, mode) {
  for (const t of await optionsTargets(ctx)) await closeTarget(ctx, t.targetId);
  await ctx.browser.waitFor(async () => (await optionsTargets(ctx)).length === 0, { timeoutMs: 5000, intervalMs: 150 })
    .catch(() => { throw new Error("5 秒内没能关掉所有设置页"); });
  const before = new Set((await pageTargets(ctx.browser)).map(t => t.targetId));
  await page.ev(`document.getElementById(${J(click)}).click(); true`);
  const t = await waitTarget(ctx, t => !before.has(t.targetId) && t.url === SETUP_URL, `没有设置页时点 #${click} 后打开 ${SETUP_URL}`);
  try {
    const f = await setupFocus(ctx, t.targetId);
    return { p: cardProblems(f, mode), detail: `关掉所有设置页后点 #${click}：新开 #setup，卡片 ${f.mode}，焦点 ${f.focus}` };
  } finally { await closeTarget(ctx, t.targetId); }
}

// 弹窗（popup.html?tabId=<普通标签>）应显示 tier 档；给了 click（按钮 id）时按 via（reuse | fresh）点它，
// 核对卡片是 mode、焦点在卡片标题。返回问题列表与说明
export async function popupTier(ctx, tabId, tier, { click = null, via = "reuse", mode = null } = {}) {
  const want = TIERS[tier];
  const page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${tabId}` });
  const p = [];
  try {
    const s = await page.until(s => s.idleTier === tier, `分屏外显示 ${tier} 档`).catch(async (e) => {
      const now = await page.read().catch(() => null);
      throw new Error(`${e.message}；当前 ${now ? fmtPopup(now) : "读不到弹窗"}`);
    });
    if (s.idleShown.join() !== want.shown.join() || s.notOurs !== want.notOurs || s.footer !== want.footer) p.push(`${tier} 档显示不对：${fmtPopup(s)}`);
    if (tier !== "setup" && s.idlePair.length !== 2) p.push(`${tier} 档应列出默认组合，实际 ${J(s.idlePair)}`);
    if (tier === "setup" && s.idlePair.length) p.push(`setup 档不该列默认组合，实际 ${J(s.idlePair)}`);
    if (tier === "setup") {
      // 完成过设置、左侧授权没了：说“已无权访问 <左侧引擎>”，不说“还没设置好”
      const want = msgIn(E2E_LOCALE, "popup_setup_regrant", mockEngines(ctx.port).find(e => e.id === "ea").name);
      const text = await page.ev(`document.getElementById("idle-setup-text").textContent`);
      if (text !== want) p.push(`setup 档（setupDone 为 true）的说明应为“${want}”，实际“${text}”`);
    }
    let detail = fmtPopup(s);
    if (!click) return { p, detail };
    const r = await (via === "fresh" ? clickFresh : clickReuse)(ctx, page, click, mode);
    p.push(...r.p);
    if (r.detail) detail += `；${r.detail}`;
    return { p, detail };
  } finally { await page.close(); }
}

// (e) 设置完成（调用方先把 setupDone 写成 true）：弹窗 ready 档；直接打开 options.html#setup，卡片不显示、焦点不动
export async function readyTier(ctx, tabId) {
  const { p, detail } = await popupTier(ctx, tabId, "ready");
  const { targetId } = await ctx.browser.client.send("Target.createTarget", { url: SETUP_URL, background: true });
  try {
    const f = await setupFocus(ctx, targetId);
    if (!f.hidden || f.mode !== "hidden") p.push(`setupDone 为 true 时 #setup 页的卡片应不显示：${f.mode}`);
    if (f.focus !== "BODY") p.push(`卡片不显示时 #setup 不该移动焦点，实际 ${f.focus}`);
    if (f.tab !== "tabbtn-pair") p.push(`卡片不显示时 #setup 应进“搜索组合”tab，实际 ${f.tab}`);
    return verdictOf(p, `${detail}；直接打开 #setup：卡片 ${f.mode}，焦点 ${f.focus}`);
  } finally { await closeTarget(ctx, targetId); }
}
