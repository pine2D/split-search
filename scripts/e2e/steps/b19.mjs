// B19 设置页“开始使用”卡（auto）：(a) 清掉 setupDone 后卡片显示；(b) 点“试一下”打开的一对出现后仍未完成
// （它的标签 id 在 storage.session 的 setupTryTabs 里）；(c) 不经“试一下”、在新标签里打开模拟引擎的触发网址出现一对后，
// setupDone 为 true、卡片换成完成确认，重新打开后消失；(c') 设置页关着时触发一次，重新打开设置页卡片不显示；
// (d) 撤销左侧（模拟引擎 A）授权后卡片重新出现、只有第 1 步，恢复授权后消失。
// 第 2 步拆成三个编号小步（先复制设置地址，再复制触发网址，最后设为默认），(a) 核对每步只带自己的复制按钮。
// 弹窗分屏外的三档（src/lib/popup-view.js 的 idleView）跟着走：(a') try 档（左侧已授权、setupDone 没写）点“查看第 2 步”
// 打开 options.html#setup，焦点落在卡片标题；(e) ready 档（setupDone 为 true），这时直接打开 #setup 卡片不显示、焦点不动；
// (d) 撤销左侧授权后是 setup 档（只有“完成设置”，不显示说明文字和页脚），点它打开 #setup、焦点落在重新授权的卡片标题。
// 完成由 go.html 判定并写 setupDone（chrome/setup-store.js），设置页只监听；所以 (c') 不需要开着的设置页。
// storage.local 的 setupDone 与 storage.session 的 setupTryTabs 都不在 run.mjs 的 storage 快照里：keepSetupDone 记下步骤前的值，
// 结束时（无论成败）写回并读回核对。左侧授权由 requestGrant 恢复（之前授权过，Chrome 直接批准）；没恢复成由 restores: true 的步骤后检查兜底。
// 注意：e2e 一直开着一个设置页（evalExt 用的），它不再参与完成判定；(c') 里“设置页关着”指卡片所在的设置页，evalExt 用的那一页照常开着。
import { GRANT_TIMEOUT_MS, requestGrant, contains } from "./guided.mjs";
import { openOptions, sleep, OPTIONS_URL } from "./optpage.mjs";
import { POPUP_URL, popupPage, plainTab } from "./v03-popup.mjs";
import { pageTargets, waitTarget } from "./util.mjs";
import { resetTabs, openTab, waitState, findPair, trigger, summarize, nonce } from "./util.mjs";
import { msgIn, E2E_LOCALE } from "../i18n.mjs";
import { HOSTS } from "../config.mjs";

const J = JSON.stringify;
const KEY = "setupDone";
const TRY_KEY = "setupTryTabs";

const readKey = (ctx, area, key) => ctx.ext.eval(`chrome.storage.${area}.get(${J(key)}).then(r => r[${J(key)}] ?? null)`);
// value 为 null：删掉这个键（原本不存在）
const writeKey = (ctx, area, key, value) => ctx.ext.eval(value === null
  ? `chrome.storage.${area}.remove(${J(key)}).then(() => true)`
  : `chrome.storage.${area}.set({ ${J(key)}: ${J(value)} }).then(() => true)`);
const readDone = ctx => readKey(ctx, "local", KEY);
export const setDone = (ctx, value) => writeKey(ctx, "local", KEY, value);
const readTry = ctx => readKey(ctx, "session", TRY_KEY);

// 记下 setupDone 和 setupTryTabs，fn 结束后写回并读回核对。两者只在测试配置里，写回总是对的，中断时也照样尽力写回
export async function keepSetupDone(ctx, fn) {
  const saved = await readDone(ctx);
  const savedTry = await readTry(ctx);
  let res, thrown;
  try { res = await fn(); } catch (e) { thrown = e; }
  let err = "";
  try {
    await setDone(ctx, saved);
    await writeKey(ctx, "session", TRY_KEY, savedTry);
    const now = await readDone(ctx);
    const nowTry = await readTry(ctx);
    if (now !== saved) err = `setupDone 读回 ${J(now)}，应为 ${J(saved)}`;
    else if (J(nowTry) !== J(savedTry)) err = `setupTryTabs 读回 ${J(nowTry)}，应为 ${J(savedTry)}`;
  } catch (e) { err = `setupDone / setupTryTabs 写回失败：${e.message}`; }
  if (err) ctx.log?.(`清理失败：${err}`);
  if (thrown) { if (err) thrown.message += `；清理失败：${err}`; throw thrown; }
  if (err && res?.status !== "fail") return { ...res, status: "fail", detail: `${res?.detail ?? ""}；清理失败：${err}` };
  return res;
}

// 页面里读卡片的状态
const CARD = `(() => { const s = document.getElementById("setup");
  return { hidden: s.hidden, mode: s.dataset.mode ?? null,
    steps: [...s.querySelectorAll(".setup-step")].map(e => e.dataset.step + ":" + e.dataset.state),
    grantButton: !!document.getElementById("setup-grant"), tryDisabled: document.getElementById("setup-try")?.disabled ?? null,
    pairCallouts: document.querySelectorAll("#pair-body .callout-warn").length }; })()`;
const fmt = c => `mode ${c.mode}${c.hidden ? "（隐藏）" : ""}，步骤 ${c.steps.join("、") || "无"}`;

async function waitCard(page, pred, what, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  let c;
  for (;;) {
    c = await page.ev(CARD).catch(() => null);
    if (c && pred(c)) return c;
    if (Date.now() >= end) throw new Error(`${timeoutMs / 1000} 秒内没有等到：${what}（当前 ${c ? fmt(c) : "读不到卡片"}）`);
    await sleep(150);
  }
}

// 一对标签的两条记录都写进 storage.session 了（完成判定的输入）
const waitRecords = (ctx, pair) => ctx.browser.waitFor(async () => {
  const keys = pair.map(t => `split:${t.id}`);
  const got = await ctx.ext.eval(`chrome.storage.session.get(${J(keys)})`);
  return keys.every(k => got[k]?.role === "search");
}, { timeoutMs: 8000, intervalMs: 200 });

// ---- 第 2 步的三个小步 ----

const SUBSTEPS = `[...document.querySelectorAll('#setup [data-step="add"] .setup-substeps > li')]
  .map(li => ({ buttons: li.querySelectorAll("button").length, box: li.querySelector(".url-box")?.textContent ?? "" }))`;
const SETTINGS = "chrome://settings/searchEngines";

// 纯判定：三个小步依次是设置地址（一个复制按钮）、触发网址（一个复制按钮）、设为默认（没有复制框）
export function substepProblems(subs) {
  if (!Array.isArray(subs) || subs.length !== 3) return [`第 2 步应有 3 个小步，实际 ${subs?.length ?? 0} 个`];
  const p = [];
  if (subs[0].buttons !== 1 || subs[0].box !== SETTINGS) p.push(`第 ① 步应只带 ${SETTINGS} 的复制按钮：${J(subs[0])}`);
  if (subs[1].buttons !== 1 || !subs[1].box.includes("_ss=")) p.push(`第 ② 步应只带触发网址的复制按钮：${J(subs[1])}`);
  if (subs[2].buttons !== 0 || subs[2].box) p.push(`第 ③ 步不该有复制框：${J(subs[2])}`);
  return p;
}

// ---- 弹窗分屏外的三档与 options.html#setup ----

const SETUP_URL = `${OPTIONS_URL}#setup`;
// 各档显示的块（idleShown 的顺序与 popup.html 一致）、说明文字与页脚
const TIERS = {
  setup: { shown: ["idle-setup"], notOurs: false, footer: false },
  try: { shown: ["idle-try", "idle-setup-note"], notOurs: true, footer: true },
  ready: { shown: ["idle-try"], notOurs: true, footer: true },
};
const fmtPopup = s => `${s.idleTier ?? "无"} 档，显示 ${s.idleShown.join("、") || "无"}，说明文字${s.notOurs ? "有" : "无"}，页脚${s.footer ? "有" : "无"}`;

// 页面显示出来后读卡片与焦点（options.js 去掉 loading 之后才按 #setup 给焦点）
async function setupFocus(ctx, targetId) {
  const sid = await ctx.browser.attach(targetId);
  try {
    return await ctx.browser.waitFor(() => ctx.browser.evaluate(sid, `(() => {
      const s = document.getElementById("setup");
      if (!s || document.body.classList.contains("loading") || !s.dataset.mode) return null;
      const a = document.activeElement;
      return { mode: s.dataset.mode, hidden: s.hidden, focus: a?.id || a?.tagName || "" }; })()`, { timeoutMs: 3000 }),
    { timeoutMs: 10000, intervalMs: 150 });
  } finally { await ctx.browser.client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {}); }
}
const closeTarget = (ctx, targetId) => ctx.browser.client.send("Target.closeTarget", { targetId }).catch(() => {});

// 弹窗（popup.html?tabId=<普通标签>）应显示 tier 档；click 给出按钮 id 时点它，等新开的 options.html#setup，
// 核对焦点在卡片标题、卡片是 mode。返回问题列表与说明
async function popupTier(ctx, tabId, tier, { click = null, mode = null } = {}) {
  const want = TIERS[tier];
  const page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${tabId}` });
  const p = [];
  let detail;
  try {
    const s = await page.until(s => s.idleTier === tier, `分屏外显示 ${tier} 档`).catch(async (e) => {
      const now = await page.read().catch(() => null);
      throw new Error(`${e.message}；当前 ${now ? fmtPopup(now) : "读不到弹窗"}`);
    });
    if (s.idleShown.join() !== want.shown.join() || s.notOurs !== want.notOurs || s.footer !== want.footer) p.push(`${tier} 档显示不对：${fmtPopup(s)}`);
    if (tier !== "setup" && s.idlePair.length !== 2) p.push(`${tier} 档应列出默认组合，实际 ${J(s.idlePair)}`);
    if (tier === "setup" && s.idlePair.length) p.push(`setup 档不该列默认组合，实际 ${J(s.idlePair)}`);
    detail = fmtPopup(s);
    if (!click) return { p, detail };
    const before = new Set((await pageTargets(ctx.browser)).map(t => t.targetId));
    await page.ev(`document.getElementById(${J(click)}).click(); true`);
    const t = await waitTarget(ctx, t => !before.has(t.targetId) && t.url === SETUP_URL, `点 #${click} 后打开 ${SETUP_URL}`);
    try {
      const f = await setupFocus(ctx, t.targetId);
      if (f.mode !== mode || f.hidden) p.push(`#setup 页的卡片应是 ${mode}，实际 ${f.mode}${f.hidden ? "（隐藏）" : ""}`);
      if (f.focus !== "setup-title") p.push(`#setup 页的焦点应在卡片标题，实际 ${f.focus}`);
      detail += `；点 #${click} 打开 #setup，卡片 ${f.mode}，焦点 ${f.focus}`;
    } finally { await closeTarget(ctx, t.targetId); }
    return { p, detail };
  } finally { await page.close(); }
}

// (e) 设置完成：弹窗 ready 档；直接打开 options.html#setup，卡片不显示、焦点不动
async function readyTier(ctx, tabId) {
  if ((await readDone(ctx)) !== true) await setDone(ctx, true); // (c) 没成功时也能单独测
  const { p, detail } = await popupTier(ctx, tabId, "ready");
  const { targetId } = await ctx.browser.client.send("Target.createTarget", { url: SETUP_URL, background: true });
  try {
    const f = await setupFocus(ctx, targetId);
    if (!f.hidden || f.mode !== "hidden") p.push(`setupDone 为 true 时 #setup 页的卡片应不显示：${f.mode}`);
    if (f.focus !== "BODY") p.push(`卡片不显示时 #setup 不该移动焦点，实际 ${f.focus}`);
    return verdictOf(p, `${detail}；直接打开 #setup：卡片 ${f.mode}，焦点 ${f.focus}`);
  } finally { await closeTarget(ctx, targetId); }
}

const verdictOf = (p, detail) => p.length ? { status: "fail", detail: p.join("；") } : { status: "pass", detail };

async function item(name, fn) {
  try { return { name, ...(await fn()) }; } catch (e) { return { name, status: "fail", detail: e.message }; }
}

async function shown(page) {
  const c = await waitCard(page, c => !c.hidden && c.mode === "steps" && c.steps.length === 3, "卡片显示三步");
  if (c.steps[0] !== "grant:done") return { status: "fail", detail: `模拟引擎 A 已授权，第 1 步应为 done：${fmt(c)}` };
  if (c.tryDisabled !== false) return { status: "fail", detail: "左侧已授权，“试一下”按钮应可点" };
  const subs = await page.ev(SUBSTEPS);
  return verdictOf(substepProblems(subs), `${fmt(c)}；第 2 步 3 个小步，复制按钮 ${subs.map(x => x.buttons).join("/")}`);
}

async function tryNotDone(ctx, page) {
  const q = encodeURIComponent(msgIn(E2E_LOCALE, "setup_sample_query"));
  if (!(await page.ev(`(() => { const b = document.getElementById("setup-try"); if (!b || b.disabled) return false; b.click(); return true; })()`))) {
    return { status: "fail", detail: "“试一下”按钮不存在或不可点" };
  }
  const pair = await waitState(ctx, st => findPair(st, ctx.port, q), `“试一下”打开的分屏（关键词 ${decodeURIComponent(q)}）`);
  await waitRecords(ctx, pair);
  await sleep(1500); // go.html 写 setupDone 在跳转之前；多等一会儿，确认确实没写
  const done = await readDone(ctx);
  const tried = await readTry(ctx);
  const c = await page.ev(CARD);
  if (done === true) return { status: "fail", detail: `“试一下”打开的一对（标签 ${pair[0].id}/${pair[1].id}）被判成完成：setupDone 已是 true` };
  if (!Array.isArray(tried) || !pair.some(t => tried.includes(t.id))) {
    return { status: "fail", detail: `setupTryTabs 里应有“试一下”打开的标签（${pair[0].id}/${pair[1].id} 之一），实际 ${J(tried)}` };
  }
  if (c.mode !== "steps") return { status: "fail", detail: `“试一下”之后卡片应仍显示三步：${fmt(c)}` };
  return { status: "pass", detail: `分屏 ${pair[0].id}/${pair[1].id} 出现、记录已写，setupTryTabs ${J(tried)}，setupDone 仍为 ${J(done)}，${fmt(c)}` };
}

async function realDone(ctx, page) {
  const q = `b19+${nonce()}`;
  await openTab(ctx, trigger(ctx.port, q));
  const pair = await waitState(ctx, st => findPair(st, ctx.port, q), `新标签触发的分屏（${q}）`);
  await waitRecords(ctx, pair);
  await ctx.browser.waitFor(async () => (await readDone(ctx)) === true, { timeoutMs: 5000, intervalMs: 200 })
    .catch(() => { throw new Error(`分屏 ${pair[0].id}/${pair[1].id} 出现后 5 秒内 setupDone 没有变成 true`); });
  const c = await waitCard(page, c => c.mode === "done" && c.steps.length === 0 && !c.hidden, "卡片换成完成确认");
  await page.reload();
  const after = await page.ev(CARD);
  if (!after.hidden || after.mode !== "hidden") return { status: "fail", detail: `完成后重新打开设置页，卡片应消失：${fmt(after)}` };
  return { status: "pass", detail: `分屏 ${pair[0].id}/${pair[1].id} 出现后 setupDone 为 true，当前页 ${fmt(c)}；重新打开后卡片隐藏` };
}

// (c') 卡片所在的设置页关着：清掉 setupDone 后触发一次，go.html 自己写 setupDone；重新打开设置页卡片不显示
async function closedDone(ctx, page) {
  await page.close();
  await setDone(ctx, null);
  const q = `b19c+${nonce()}`;
  await openTab(ctx, trigger(ctx.port, q));
  const pair = await waitState(ctx, st => findPair(st, ctx.port, q), `设置页关着时触发的分屏（${q}）`);
  await waitRecords(ctx, pair);
  await ctx.browser.waitFor(async () => (await readDone(ctx)) === true, { timeoutMs: 5000, intervalMs: 200 })
    .catch(() => { throw new Error(`设置页关着时，分屏 ${pair[0].id}/${pair[1].id} 出现后 5 秒内 setupDone 没有变成 true`); });
  const again = await openOptions(ctx.browser);
  try {
    const c = await waitCard(again, c => c.mode !== null, "设置页渲染出卡片状态");
    if (!c.hidden || c.mode !== "hidden") return { status: "fail", detail: `设置页关着时完成，重新打开后卡片应不显示：${fmt(c)}` };
    return { status: "pass", detail: `设置页关着时分屏 ${pair[0].id}/${pair[1].id} 出现，setupDone 为 true；重新打开后 ${fmt(c)}` };
  } finally { await again.close(); }
}

async function regrant(ctx, page, tabId) {
  if ((await readDone(ctx)) !== true) await setDone(ctx, true); // (c) 没成功时也能单独测 (d)
  await waitCard(page, c => c.hidden, "setupDone 为 true 时卡片隐藏");
  const origin = `http://${HOSTS.a}:${ctx.port}/*`;
  await ctx.ext.eval(`chrome.permissions.remove({ origins: ${J([origin])} })`);
  const c = await waitCard(page, c => !c.hidden && c.mode === "regrant", "撤销左侧授权后卡片重新出现");
  const problems = [];
  if (c.steps.length !== 1 || c.steps[0] !== "grant:todo") problems.push(`应只有第 1 步（grant:todo）：${fmt(c)}`);
  if (!c.grantButton) problems.push("没有第 1 步的授权按钮");
  if (c.pairCallouts) problems.push(`卡片显示时默认组合卡不应再有左侧未授权的提示框（实际 ${c.pairCallouts} 个）`);
  let pop = "";
  try {
    const r = await popupTier(ctx, tabId, "setup", { click: "idle-setup-open", mode: "regrant" });
    problems.push(...r.p);
    pop = `；弹窗 ${r.detail}`;
  } catch (e) { problems.push(`弹窗：${e.message}`); }
  const ok = await requestGrant(ctx, [origin], { title: "B19 恢复模拟引擎 A 的授权" }).catch(() => false);
  if (!ok || (await contains(ctx.browser, [origin])) !== true) {
    problems.push("恢复模拟引擎 A 的授权没有成功（由步骤后检查兜底）");
  } else {
    await waitCard(page, c => c.hidden, "恢复授权后卡片消失").catch(e => problems.push(e.message));
  }
  return problems.length ? { status: "fail", detail: problems.join("；") }
    : { status: "pass", detail: `撤销后 ${fmt(c)}${pop}；恢复授权后卡片消失` };
}

export const B19 = {
  id: "B19", title: "设置页“开始使用”卡：第 2 步三个小步、“试一下”不算完成、真实触发算完成（设置页关着也算）、撤销左侧授权后重新出现；弹窗分屏外三档与 #setup 定位（自动判定）", kind: "auto", needs: [],
  timeoutFactor: 2, restores: true, timeoutExtraMs: GRANT_TIMEOUT_MS,
  run: ctx => keepSetupDone(ctx, async () => {
    const base = await resetTabs(ctx);
    await setDone(ctx, null);
    const idleTab = await plainTab(ctx, base.windowId);
    let page = await openOptions(ctx.browser);
    const items = [];
    try {
      items.push(await item("(a) 清掉 setupDone 后卡片显示三步，第 2 步分成三个小步", () => shown(page)));
      items.push(await item("(a') 弹窗 try 档：点“查看第 2 步”打开 #setup，焦点在卡片标题", async () => {
        const r = await popupTier(ctx, idleTab, "try", { click: "idle-setup-link", mode: "steps" });
        return verdictOf(r.p, r.detail);
      }));
      items.push(await item("(b) “试一下”打开的一对不算完成", () => tryNotDone(ctx, page)));
      items.push(await item("(c) 新标签里真实触发算完成", () => realDone(ctx, page)));
      items.push(await item("(c') 设置页关着时触发也算完成，重新打开卡片不显示", () => closedDone(ctx, page)));
      items.push(await item("(e) 弹窗 ready 档；卡片不显示时 #setup 不移动焦点", () => readyTier(ctx, idleTab)));
      page = await openOptions(ctx.browser);
      items.push(await item("(d) 撤销左侧授权后重新出现（弹窗 setup 档、“完成设置”打开 #setup），恢复后消失", () => regrant(ctx, page, idleTab)));
    } finally { await page.close().catch(() => {}); }
    return summarize(items);
  }),
};
