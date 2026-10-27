// B19 设置页“开始使用”卡（auto）：(a) 清掉 setupDone 后卡片显示；(b) 点“试一下”打开的一对出现后仍未完成
// （它的标签 id 在 storage.session 的 setupTryTabs 里）；(c) 不经“试一下”、在新标签里打开模拟引擎的触发网址出现一对后，
// setupDone 为 true、卡片换成完成确认，重新打开后消失；(c') 设置页关着时触发一次，重新打开设置页卡片不显示；
// (d) 撤销左侧（模拟引擎 A）授权后卡片重新出现、只有第 1 步，恢复授权后消失。
// 第 2 步拆成三个编号小步（先复制设置地址，再复制触发网址，最后设为默认），(a) 核对每步只带自己的复制按钮。
// 卡片显示时“添加到 Chrome”卡的默认组合一段和 5 步说明都收在默认收起的 <details> 里，(c) 重新打开后卡片不显示时照常显示
// （def、guideSteps）；(a) 最后点第 2 步的“详细步骤”，两段都展开、滚到 5 步说明、hash 不变、焦点落在 5 步说明的 summary 上，
// 之后一次无关的重渲染（临时 sync 键）不重建折叠区、不丢复制按钮上的焦点。
// 弹窗分屏外的三档（src/lib/popup-view.js 的 idleView）跟着走（子项在 b19-popup.mjs）：(a') try 档（左侧已授权、setupDone 没写），
// 先关掉所有设置页再点“查看第 2 步”，退回新开 options.html#setup，焦点落在卡片标题；(e) ready 档（setupDone 为 true），
// 这时直接打开 #setup 卡片不显示、焦点不动；(d) 撤销左侧授权后是 setup 档（只有“完成设置”，不显示说明文字和页脚），
// 设置页开着时点它不新开标签，已开的设置页成为活动标签、焦点落在重新授权的卡片标题。
// 完成由 go.html 判定并写 setupDone（chrome/setup-store.js），设置页只监听；所以 (c') 不需要开着的设置页。
// storage.local 的 setupDone 与 storage.session 的 setupTryTabs 都不在 run.mjs 的 storage 快照里：keepSetupDone 记下步骤前的值，
// 结束时（无论成败）写回并读回核对。左侧授权由 requestGrant 恢复（之前授权过，Chrome 直接批准）；没恢复成由 restores: true 的步骤后检查兜底。
// 注意：e2e 一直开着一个设置页（evalExt 用的），它不再参与完成判定；(c') 里“设置页关着”指卡片所在的设置页，evalExt 用的那一页照常开着。
import { GRANT_TIMEOUT_MS, requestGrant, contains } from "./guided.mjs";
import { openOptions, sleep } from "./optpage.mjs";
import { plainTab } from "./v03-popup.mjs";
import { resetTabs, openTab, waitState, findPair, trigger, summarize, nonce } from "./util.mjs";
import { msgIn, E2E_LOCALE } from "../i18n.mjs";
import { HOSTS } from "../config.mjs";
import { popupTier, readyTier, verdictOf } from "./b19-popup.mjs";

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
    pairCallouts: document.querySelectorAll("#pair-body .callout-warn").length,
    def: fold(document.querySelector("#triggers .trigger-default")), guideSteps: fold(document.querySelector("#guide-steps ol.steps")) };
  function fold(el) { return !el ? "none" : !el.closest("details") ? "plain" : el.closest("details").open ? "open" : "closed"; } })()`;
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

async function item(name, fn) {
  try { return { name, ...(await fn()) }; } catch (e) { return { name, status: "fail", detail: e.message }; }
}

async function shown(page) {
  const c = await waitCard(page, c => !c.hidden && c.mode === "steps" && c.steps.length === 3, "卡片显示三步");
  if (c.steps[0] !== "grant:done") return { status: "fail", detail: `模拟引擎 A 已授权，第 1 步应为 done：${fmt(c)}` };
  if (c.tryDisabled !== false) return { status: "fail", detail: "左侧已授权，“试一下”按钮应可点" };
  if (c.def !== "closed") return { status: "fail", detail: `卡片显示时“添加到 Chrome”卡的默认组合一段应收在收起的 <details> 里，实际 ${c.def}` };
  if (c.guideSteps !== "closed") return { status: "fail", detail: `卡片显示时“添加到 Chrome”卡的 5 步说明应收在收起的 <details> 里，实际 ${c.guideSteps}` };
  const subs = await page.ev(SUBSTEPS);
  const problems = substepProblems(subs);
  const link = await detailsLink(page);
  problems.push(...link.p);
  return verdictOf(problems, `${fmt(c)}；第 2 步 3 个小步，复制按钮 ${subs.map(x => x.buttons).join("/")}；${link.detail}`);
}

// 第 2 步的“详细步骤”：点了以后默认组合一段和 5 步说明都展开，页面滚到 5 步说明（容器顶边在视口内），网址的 hash 不变，
// 焦点落在 5 步说明的 summary 上（会改这一页的展开状态，放在 (a) 最后）。之后把焦点放到折叠区里第 1 步的复制按钮上，
// 写一个临时的 sync 键触发一次重渲染，核对折叠区没被重建、焦点还在那个按钮上
async function detailsLink(page) {
  const hashBefore = await page.ev("location.hash");
  if (!(await page.ev(`(() => { const a = document.querySelector('#setup [data-step="add"] a.step-link'); if (!a) return false; a.click(); return true; })()`))) {
    return { p: ["第 2 步没有“详细步骤”链接"], detail: "" };
  }
  try {
    await waitCard(page, c => c.def === "open" && c.guideSteps === "open", "点“详细步骤”后两段都展开", 3000);
  } catch (e) { return { p: [e.message], detail: "" }; }
  const after = await page.ev(`(() => { const a = document.activeElement, r = document.getElementById("guide-steps").getBoundingClientRect();
    return { focus: a?.tagName === "SUMMARY" && !!a.closest("#guide-steps-details"), hash: location.hash, top: Math.round(r.top), vh: innerHeight }; })()`);
  const p = [];
  if (!after.focus) p.push("点“详细步骤”后焦点应落在 5 步说明的 summary 上");
  if (after.hash !== hashBefore) p.push(`点“详细步骤”不该改网址的 hash：之前 ${J(hashBefore)}，之后 ${J(after.hash)}`);
  if (after.top < -2 || after.top >= after.vh) p.push(`点“详细步骤”后 5 步说明的顶边应在视口内：top ${after.top}，视口高 ${after.vh}`);
  const keep = await keepsFocus(page);
  p.push(...keep.p);
  return { p, detail: `“详细步骤”展开了默认组合一段和 5 步说明，焦点在 summary，hash 不变（${J(after.hash)}），5 步说明顶边 ${after.top}px；${keep.detail}` };
}

const PROBE = "e2eB19Probe";
async function keepsFocus(page) {
  const ok = await page.ev(`(() => { const b = document.querySelector("#guide-steps-details #settings-url-copy button");
    const e = document.getElementById("engines").firstElementChild;
    if (!b || !e) return false; b.focus(); document.getElementById("guide-steps-details").__b19 = 1; e.__b19 = 1;
    return document.activeElement === b; })()`);
  if (!ok) return { p: ["折叠区里第 1 步没有可聚焦的复制按钮"], detail: "" };
  try {
    await page.ev(`chrome.storage.sync.set({ ${PROBE}: ${J(nonce())} })`);
    await waitFor(page, `!document.getElementById("engines").firstElementChild?.__b19`, "写临时 sync 键后设置页重渲染");
    const r = await page.ev(`(() => { const d = document.getElementById("guide-steps-details"), a = document.activeElement;
      return { same: d?.__b19 === 1, open: !!d?.open, focus: !!a?.closest("#settings-url-copy") && a.tagName === "BUTTON" }; })()`);
    const p = [];
    if (!r.same) p.push("与卡片状态无关的重渲染不该重建 5 步说明的折叠区");
    if (!r.open) p.push("重渲染后 5 步说明的折叠区应仍展开");
    if (!r.focus) p.push("重渲染后焦点应仍在第 1 步的复制按钮上");
    return { p, detail: "无关的重渲染后折叠区原样保留、焦点仍在复制按钮上" };
  } catch (e) {
    return { p: [e.message], detail: "" };
  } finally {
    await page.ev(`chrome.storage.sync.remove(${J(PROBE)})`).catch(() => {});
  }
}

async function waitFor(page, expr, what, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!(await page.ev(expr).catch(() => false))) {
    if (Date.now() >= end) throw new Error(`${timeoutMs / 1000} 秒内没有等到：${what}`);
    await sleep(100);
  }
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
  if (after.def !== "plain") return { status: "fail", detail: `卡片不显示时默认组合一段应照常显示、不包 <details>，实际 ${after.def}` };
  if (after.guideSteps !== "plain") return { status: "fail", detail: `卡片不显示时 5 步说明应照常显示、不包 <details>，实际 ${after.guideSteps}` };
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
  if (c.def !== "closed") problems.push(`卡片重新出现后默认组合一段应收起，实际 ${c.def}`);
  if (c.guideSteps !== "closed") problems.push(`卡片重新出现后 5 步说明应收起，实际 ${c.guideSteps}`);
  if (c.pairCallouts) problems.push(`卡片显示时默认组合卡不应再有左侧未授权的提示框（实际 ${c.pairCallouts} 个）`);
  let pop = "";
  try {
    const r = await popupTier(ctx, tabId, "setup", { click: "idle-setup-open", via: "reuse", mode: "regrant" });
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
      items.push(await item("(a') 弹窗 try 档：没有设置页时点“查看第 2 步”新开 #setup，焦点在卡片标题", async () => {
        await page.close(); // 关掉所有设置页（其余的由 popupTier 关），测 tabs.create 的退回路径
        const r = await popupTier(ctx, idleTab, "try", { click: "idle-setup-link", via: "fresh", mode: "steps" });
        return verdictOf(r.p, r.detail);
      }));
      page = await openOptions(ctx.browser);
      items.push(await item("(b) “试一下”打开的一对不算完成", () => tryNotDone(ctx, page)));
      items.push(await item("(c) 新标签里真实触发算完成", () => realDone(ctx, page)));
      items.push(await item("(c') 设置页关着时触发也算完成，重新打开卡片不显示", () => closedDone(ctx, page)));
      items.push(await item("(e) 弹窗 ready 档；卡片不显示时 #setup 不移动焦点", async () => {
        if ((await readDone(ctx)) !== true) await setDone(ctx, true); // (c) 没成功时也能单独测
        return readyTier(ctx, idleTab);
      }));
      page = await openOptions(ctx.browser);
      items.push(await item("(d) 撤销左侧授权后重新出现（弹窗 setup 档、“完成设置”复用已开的设置页），恢复后消失", () => regrant(ctx, page, idleTab)));
    } finally { await page.close().catch(() => {}); }
    return summarize(items);
  }),
};
