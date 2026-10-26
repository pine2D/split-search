// I18N 步骤（i18n.mjs）在每种语言下调用的 v0.4 检查：工具栏弹窗的“补成分屏”区（#complete）与设置页“右键查询”卡片。
// 沿用 i18n-audit.mjs 的自查（lang、原样 key、溢出）与截图；截图存 .e2e/i18n/<语言>-popup-complete.png、<语言>-options-lookup.png。
// openResultTab 也给 B14 用（深色模式下的 #complete）。
import { join } from "node:path";
import { waitState, engineA, nonce } from "./util.mjs";
import { openOptions } from "./optpage.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import { mockEngines } from "../config.mjs";
import { msgIn, sel } from "../i18n.mjs";
import { audit, auditProblems, waitPage, shoot, bodyClip, htmlLang, SHOT_DIR } from "./i18n-audit.mjs";

const J = JSON.stringify;
const CARD = `[aria-labelledby="lookup-title"]`;

// 在设置页所在窗口的后台开一个模拟引擎 A 的结果页（已授权，扩展读得到网址；不在分屏里、没有记录 → 弹窗显示“补成分屏”区）。
// 返回 { id, query, close() }
export async function openResultTab(ctx) {
  const query = `complete${nonce()}`;
  const url = engineA(ctx.port, query);
  const id = await ctx.ext.eval(`chrome.tabs.create({ url: ${J(url)}, active: false }).then(t => t.id)`);
  await waitState(ctx, st => st.tabs.some(t => t.id === id && t.url === url && t.status === "complete"), `模拟引擎 A 结果页 ${url} 加载完成`);
  return { id, query, close: () => ctx.ext.eval(`chrome.tabs.remove(${id}).then(() => true, () => false)`).catch(() => false) };
}

// popup.html?tabId=<结果页>：等“补成分屏”区按 locale 显示出识别结果与提示（engine：识别出的引擎名）
export async function openCompletePopup(ctx, tab, { locale, engine }) {
  const page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${tab.id}` });
  try {
    await waitPage(page, `document.documentElement.lang === ${J(htmlLang(locale))} && !document.getElementById("complete").hidden
      && document.getElementById("complete-detected").textContent === ${J(msgIn(locale, "popup_complete_detected", engine, tab.query))}
      && document.getElementById("complete-title").textContent === ${J(msgIn(locale, "popup_complete_hint"))}
      && document.querySelectorAll("#complete-choices button").length > 0`, `弹窗显示“补成分屏”区（lang ${htmlLang(locale)}）`);
  } catch (e) { await page.close(); throw e; }
  return page;
}

// “右键查询”卡片在文档里的矩形（先滚到可视区，截图用文档坐标）
const cardClip = page => page.ev(`(() => { const el = document.querySelector(${J(CARD)}); el.scrollIntoView({ block: "start" });
  const r = el.getBoundingClientRect();
  return { x: Math.floor(r.x + scrollX), y: Math.floor(r.y + scrollY), width: Math.ceil(r.width), height: Math.ceil(r.height), scale: 1 }; })()`);

async function popupComplete(ctx, locale) {
  const tab = await openResultTab(ctx);
  let page = null;
  try {
    page = await openCompletePopup(ctx, tab, { locale, engine: mockEngines(ctx.port).find(e => e.id === "ea").name });
    const problems = auditProblems(locale, await page.ev(audit({ box: "body" }))).map(p => `弹窗“补成分屏”区：${p}`);
    const shot = await shoot(ctx, page, join(SHOT_DIR, `${locale}-popup-complete.png`), { clip: await bodyClip(page) });
    return { problems, shots: [shot] };
  } finally {
    await page?.close();
    await tab.close();
  }
}

async function lookupCard(ctx, locale) {
  const opt = await openOptions(ctx.browser);
  try {
    await waitPage(opt, `document.documentElement.lang === ${J(htmlLang(locale))}
      && document.querySelector(${J(`${CARD} ${sel("options_lookup_title")}`)})?.textContent === ${J(msgIn(locale, "options_lookup_title"))}
      && !!document.querySelector("#lookup-body .lookup-card #lookup-engine")`, `“右键查询”卡片按 ${locale} 渲染`);
    await opt.ev(`document.querySelectorAll(${J(`${CARD} details.disclosure`)}).forEach(d => { d.open = true; })`); // 说明展开后核对
    const a = await opt.ev(audit({ scope: `${CARD} `, items: "button, label, select, .engine-row", box: CARD }));
    const problems = auditProblems(locale, a).map(p => `“右键查询”卡片：${p}`);
    const shot = await shoot(ctx, opt, join(SHOT_DIR, `${locale}-options-lookup.png`), { clip: await cardClip(opt) });
    return { problems, shots: [shot] };
  } finally { await opt.close(); }
}

// 返回 { problems, shots }；某一块打不开记成问题，不抛出
export async function v04I18nChecks(ctx, locale) {
  const problems = [], shots = [];
  for (const [what, fn] of [["弹窗“补成分屏”区", popupComplete], ["“右键查询”卡片", lookupCard]]) {
    try {
      const r = await fn(ctx, locale);
      problems.push(...r.problems);
      shots.push(...r.shots);
    } catch (e) { problems.push(`${what}：${e.message}`); }
  }
  return { problems, shots };
}
