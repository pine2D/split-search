// I18N 多语言冒烟（auto）：4 种语言逐一打开设置页（含引擎库对话框）、工具栏弹窗（本扩展的一对）和 go.html 出错页，核对 lang、原样 key、溢出并截图；
// 设置页含“开始使用”卡（每种语言前清掉 setupDone，结束时写回）；页内切换、连切、两个设置页跟随；uiLocale = "auto" 时 t() 与 chrome.i18n.getMessage 的替换结果逐 key 相同。
// uiLocale 由 guarded 写回步骤前的值（基线 zh_CN），中断时由快照恢复兜底。截图存 .e2e/i18n/。v0.4 的弹窗“补成分屏”区与设置页“右键查询”卡片见 v04-i18n.mjs。
import { join } from "node:path";
import { EXT_ID } from "../config.mjs";
import { catalog, msgIn, sel } from "../i18n.mjs";
import { openOptions, guarded, sleep } from "./optpage.mjs";
import { summarize } from "./util.mjs";
import { pairOn } from "./v03-lib.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import { v04I18nChecks } from "./v04-i18n.mjs";
import { keepSetupDone, setDone } from "./b19.mjs";
import { SHOT_DIR, htmlLang, audit, auditProblems, waitPage, shoot, bodyClip } from "./i18n-audit.mjs";

const LOCALES = ["en", "zh_CN", "zh_TW", "es"];
const GO_URL = `chrome-extension://${EXT_ID}/go.html?u=https://a.test/?q=x&_ss=ea,nope`;
const FAKE_ARGS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const J = JSON.stringify;

const AUDIT = audit();
const POPUP_AUDIT = audit({ box: "body" });
// “开始使用”卡：每种语言打开设置页前清掉 setupDone，卡片显示三步（模拟引擎 A 已授权，第 1 步是“已授权”）
const SETUP_AUDIT = audit({ scope: "#setup ", items: "button, a, h2, h3, .url-box, .setup-field-label, .step-status", box: "#setup" });
const SETUP_SHOWN = `(() => { const s = document.getElementById("setup"); return !s.hidden && s.dataset.mode === "steps"; })()`;

const setPref = (ctx, value) => ctx.ext.eval(`chrome.storage.sync.set({ uiLocale: ${J(value)} }).then(() => true)`);

const missingSince = (ctx, n0) => (ctx.consoleCollector?.errors ?? []).slice(n0).filter(e => e.text.includes("missing message"));

// 页面已按 locale 显示：lang 对、所有 options_title 元素（<title> 与 h1）等于该语言目录的值
const showsLocale = (locale, extra = "true") => `(() => document.documentElement.lang === ${J(htmlLang(locale))}
  && [...document.querySelectorAll(${J(sel("options_title"))})].every(el => el.textContent === ${J(msgIn(locale, "options_title"))})
  && (${extra}))()`;



// go.html 出错页（未知引擎 nope）：打开并等错误说明按 locale 显示出来
async function openGo(ctx, locale) {
  const { client } = ctx.browser;
  const { targetId } = await client.send("Target.createTarget", { url: GO_URL });
  const sid = await ctx.browser.attach(targetId);
  const page = { targetId, sid, ev: (e, o) => ctx.browser.evaluate(sid, e, o) };
  page.close = async () => {
    await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
  };
  const want = msgIn(locale, "err_unknown_engine", "nope");
  try {
    await waitPage(page, `document.documentElement.lang === ${J(htmlLang(locale))} && !document.getElementById("error").hidden
      && document.getElementById("error-message").textContent === ${J(want)}`, `go.html 出错页显示“${want}”（lang ${htmlLang(locale)}）`);
  } catch (e) { await page.close(); throw e; }
  return page;
}

// 弹窗页（本扩展的一对，popup.html?tabId=左侧）：等它按 locale 渲染出“关键词”标签，返回页面对象。截图只截 body（弹窗本身的大小）
async function openPopup(ctx, locale, tabId) {
  const p = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${tabId}` });
  try {
    await waitPage(p, `document.documentElement.lang === ${J(htmlLang(locale))} && !document.getElementById("pair").hidden
      && document.querySelector(${J(sel("popup_query_label"))}).textContent === ${J(msgIn(locale, "popup_query_label"))}`,
    `弹窗显示本扩展的一对（lang ${htmlLang(locale)}）`);
  } catch (e) { await p.close(); throw e; }
  return p;
}

// 引擎库对话框：在已打开的设置页里打开，自查对话框里的文字与溢出、截图，再关掉
const CATALOG_AUDIT = audit({ scope: "#catalog-dialog ", items: "button, label, .catalog-name, .catalog-row", box: "#catalog-dialog" });
async function catalogDialog(ctx, opt, locale) {
  await waitPage(opt, `(() => { document.getElementById("catalog-open").click(); const d = document.getElementById("catalog-dialog");
    return d.open && d.querySelectorAll(".catalog-row").length > 0
      && document.getElementById("catalog-title").textContent === ${J(msgIn(locale, "catalog_title"))}; })()`, "引擎库对话框按该语言打开");
  const problems = auditProblems(locale, await opt.ev(CATALOG_AUDIT)).map(p => `引擎库对话框：${p}`);
  const shot = await shoot(ctx, opt, join(SHOT_DIR, `${locale}-catalog.png`));
  await opt.ev(`document.getElementById("catalog-close").click(); true`);
  return { problems, shot };
}

async function perLocale(ctx, locale, pairTab) {
  const n0 = ctx.consoleCollector?.errors?.length ?? 0;
  await setPref(ctx, locale);
  await setDone(ctx, null); // 前面建的一对会让一直开着的设置页写入 setupDone，每种语言都重新清掉
  const problems = [], shots = [];
  const opt = await openOptions(ctx.browser);
  try {
    await waitPage(opt, showsLocale(locale), `设置页显示为 ${locale}`).catch(e => problems.push(`设置页：${e.message}`));
    problems.push(...auditProblems(locale, await opt.ev(AUDIT)).map(p => `设置页：${p}`));
    await waitPage(opt, SETUP_SHOWN, "“开始使用”卡显示三步")
      .then(async () => problems.push(...auditProblems(locale, await opt.ev(SETUP_AUDIT)).map(p => `“开始使用”卡：${p}`)))
      .catch(e => problems.push(`“开始使用”卡：${e.message}`));
    shots.push(await shoot(ctx, opt, join(SHOT_DIR, `${locale}-options.png`), { full: true }));
    const cat = await catalogDialog(ctx, opt, locale).catch(e => ({ problems: [`引擎库对话框：${e.message}`], shot: null }));
    problems.push(...cat.problems);
    if (cat.shot) shots.push(cat.shot);
  } finally { await opt.close(); }
  let pop = null;
  try {
    pop = await openPopup(ctx, locale, pairTab);
    problems.push(...auditProblems(locale, await pop.ev(POPUP_AUDIT)).map(p => `弹窗：${p}`));
    shots.push(await shoot(ctx, pop, join(SHOT_DIR, `${locale}-popup.png`), { clip: await bodyClip(pop) }));
  } catch (e) { problems.push(`弹窗：${e.message}`); }
  finally { await pop?.close(); }
  let go = null;
  try {
    go = await openGo(ctx, locale);
    problems.push(...auditProblems(locale, await go.ev(AUDIT)).map(p => `go 出错页：${p}`));
    shots.push(await shoot(ctx, go, join(SHOT_DIR, `${locale}-go-error.png`)));
  } catch (e) { problems.push(`go 出错页：${e.message}`); }
  finally { await go?.close(); }
  const v4 = await v04I18nChecks(ctx, locale); problems.push(...v4.problems); shots.push(...v4.shots);
  const missing = missingSince(ctx, n0);
  if (missing.length) problems.push(`控制台有 ${missing.length} 条 missing message：${missing.slice(0, 3).map(e => e.text).join("；")}`);
  const noCollector = ctx.consoleCollector ? "" : "（没有控制台收集器，未查 missing message）";
  return { name: locale, status: problems.length ? "fail" : "pass",
    detail: problems.length ? problems.join("；") : `lang ${htmlLang(locale)}，无原样 key、无溢出${noCollector}；截图 ${shots.join("、")}` };
}

// 在设置页的语言下拉框里依次选这些值（同一段脚本里连续派发 change，不等存储写完）
const pick = (page, values) => page.ev(`(() => { const s = document.getElementById("lang-select");
  for (const v of ${J(values)}) { s.value = v; s.dispatchEvent(new Event("change")); } return true; })()`);
const markNoReload = page => page.ev("globalThis.__e2eNoReload = 1");
const notReloaded = "globalThis.__e2eNoReload === 1";
const item = async (name, fn) => {
  try { return { name, ...(await fn()) }; } catch (e) { return { name, status: "fail", detail: e.message }; }
};

async function inPageSwitch(ctx, opt) {
  await setPref(ctx, "zh_CN");
  await waitPage(opt, showsLocale("zh_CN"), "设置页先回到 zh_CN");
  await markNoReload(opt);
  const t0 = Date.now();
  await pick(opt, ["es"]);
  await waitPage(opt, showsLocale("es", notReloaded), "不刷新、2 秒内切到 es", 2000);
  const ms = Date.now() - t0;
  if (ms > 2000) return { status: "fail", detail: `切到 es 用了 ${ms} ms，超过 2 秒` };
  const go = await openGo(ctx, "es");
  await go.close();
  return { status: "pass", detail: `${ms} ms 内 lang 变为 es、标题为“${msgIn("es", "options_title")}”，页面未刷新；新开的 go.html 出错页是西语` };
}

async function rapidSwitch(ctx, opt) {
  await markNoReload(opt);
  await pick(opt, ["en", "zh_TW"]);
  const edit = msgIn("zh_TW", "engine_edit");
  await waitPage(opt, showsLocale("zh_TW", `${notReloaded} && (() => { const b = [...document.querySelectorAll(${J(sel("engine_edit"))})];
    return b.length > 0 && b.every(el => el.textContent === ${J(edit)}); })()`), "连切 en → zh_TW 后停在 zh_TW（含“编辑”按钮）");
  await sleep(500); // 晚到的 en 不得在之后把页面改回去
  if (!(await opt.ev(showsLocale("zh_TW")))) return { status: "fail", detail: "停在 zh_TW 后又被改成别的语言" };
  return { status: "pass", detail: `最终 lang zh-TW，标题与“${edit}”按钮都是繁体` };
}

async function secondPageFollows(ctx, first) {
  await setPref(ctx, "zh_TW"); // 前一项失败时也保证起点不是 en，否则“跟随”会空过
  const second = await openOptions(ctx.browser);
  try {
    await waitPage(second, showsLocale("zh_TW"), "第二个设置页先显示 zh_TW");
    await waitPage(first, showsLocale("zh_TW"), "第一个设置页先显示 zh_TW");
    await markNoReload(second);
    await pick(first, ["en"]);
    await waitPage(second, showsLocale("en", notReloaded), "第二个设置页不刷新也变成 en");
    return { status: "pass", detail: "在第一个设置页切到 en，第二个设置页未刷新也变成 en" };
  } finally { await second.close(); }
}

// uiLocale = "auto"：t() 用的目录与 chrome.i18n.getMessage 读的是同一份，替换结果应逐 key 相同
async function sameAsChrome(ctx, opt) {
  await setPref(ctx, "auto");
  await waitPage(opt, `import("/chrome/i18n.js").then(m => m.currentPref() === "auto")`, "设置页的 i18n 模块切到 auto");
  const ui = await opt.ev(`chrome.i18n.getUILanguage()`);
  const locale = await opt.ev(`import("/lib/i18n.js").then(m => m.resolveLocale("auto", ${J(ui)}))`);
  const keys = Object.keys(catalog(locale));
  const diff = await opt.ev(`(async () => {
    const { t, currentLocale } = await import("/chrome/i18n.js");
    const args = ${J(FAKE_ARGS)};
    const bad = ${J(keys)}.filter(k => t(k, ...args) !== chrome.i18n.getMessage(k, args))
      .map(k => ({ k, t: t(k, ...args), c: chrome.i18n.getMessage(k, args) }));
    return { locale: currentLocale(), bad };
  })()`, { timeoutMs: 10000 });
  if (diff.locale !== locale) return { status: "fail", detail: `t() 的语言是 ${diff.locale}，应为 ${locale}（界面语言 ${ui}）` };
  if (diff.bad.length) {
    return { status: "fail", detail: `${diff.bad.length}/${keys.length} 个 key 不一致：${diff.bad.slice(0, 3).map(b => `${b.k}：t()“${b.t}”≠ getMessage“${b.c}”`).join("；")}` };
  }
  return { status: "pass", detail: `界面语言 ${ui} → ${locale}，${keys.length} 个 key 用相同假参数比较全部相同` };
}

export const I18N = {
  id: "I18N", title: "多语言：4 种语言的设置页（含引擎库对话框）、弹窗与出错页、页内切换、连切、多页跟随、与 chrome.i18n 一致（自动判定）", kind: "auto", needs: [],
  run: ctx => keepSetupDone(ctx, () => guarded(ctx, ["uiLocale"], async () => {
    const items = [];
    // 弹窗要有本扩展的一对才显示全部文字：先建一对（模拟引擎 A ｜ B），4 种语言共用它的左侧标签
    const { pair } = await pairOn(ctx, "i18n+popup");
    for (const l of LOCALES) items.push(await item(l, () => perLocale(ctx, l, pair[0].id)));
    await setPref(ctx, "zh_CN");
    const opt = await openOptions(ctx.browser);
    try {
      items.push(await item("页内切换到 es", () => inPageSwitch(ctx, opt)));
      items.push(await item("连切 en → zh_TW", () => rapidSwitch(ctx, opt)));
      items.push(await item("第二个设置页跟随", () => secondPageFollows(ctx, opt)));
      items.push(await item("auto：t() 与 chrome.i18n.getMessage 一致", () => sameAsChrome(ctx, opt)));
    } finally {
      await setPref(ctx, "zh_CN").catch(() => {});
      await opt.close();
    }
    return summarize(items);
  })),
};
