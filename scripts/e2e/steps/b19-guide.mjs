// B19 的“详细步骤”子项（从 b19.mjs 拆出，免得单文件超过 300 行）：detailsLink 左键点第 2 步的“详细步骤”，
// 核对两段展开、焦点、hash 不变、5 步说明顶边在视口内，之后 keepsFocus 核对无关的重渲染不重建折叠区、不丢焦点；
// hashOpen 直接打开 options.html#guide-steps（中键、Ctrl+点这个链接时的网址），效果应与左键点击相同。
import { openOptions, sleep } from "./optpage.mjs";
import { nonce } from "./util.mjs";

const J = JSON.stringify;

// 读“详细步骤”的效果：两段的展开状态、焦点是否在 5 步说明的 summary、5 步说明顶边与视口高
const LINK_STATE = `(() => { const a = document.activeElement, r = document.getElementById("guide-steps").getBoundingClientRect();
  const open = id => !!document.getElementById(id)?.open;
  return { def: open("guide-default"), steps: open("guide-steps-details"), focus: a?.tagName === "SUMMARY" && !!a.closest("#guide-steps-details"),
    hash: location.hash, top: Math.round(r.top), vh: innerHeight }; })()`;
const offscreen = s => s.top < -2 || s.top >= s.vh;

// 中键或 Ctrl+点“详细步骤”会在新标签打开 options.html#guide-steps：页面显示出来后效果应和左键点击一样
// （两段都展开、焦点在 5 步说明的 summary、5 步说明顶边在视口内）
export async function hashOpen(browser) {
  const page = await openOptions(browser, { hash: "#guide-steps" });
  try {
    await waitFor(page, `!!document.getElementById("guide-steps-details")?.open`, "直接打开 #guide-steps 后 5 步说明展开");
    const s = await page.ev(LINK_STATE);
    const p = [];
    if (!s.def) p.push("直接打开 #guide-steps 后默认组合一段应展开");
    if (!s.focus) p.push("直接打开 #guide-steps 后焦点应落在 5 步说明的 summary 上");
    if (offscreen(s)) p.push(`直接打开 #guide-steps 后 5 步说明的顶边应在视口内：top ${s.top}，视口高 ${s.vh}`);
    return { p, detail: `直接打开 #guide-steps：两段展开、焦点在 summary，5 步说明顶边 ${s.top}px` };
  } catch (e) {
    return { p: [e.message], detail: "" };
  } finally { await page.close().catch(() => {}); }
}

// 第 2 步的“详细步骤”：点了以后默认组合一段和 5 步说明都展开，页面滚到 5 步说明（容器顶边在视口内），网址的 hash 不变，
// 焦点落在 5 步说明的 summary 上（会改这一页的展开状态，放在 (a) 最后）。之后把焦点放到折叠区里第 1 步的复制按钮上，
// 写一个临时的 sync 键触发一次重渲染，核对折叠区没被重建、焦点还在那个按钮上
export async function detailsLink(page) {
  const hashBefore = await page.ev("location.hash");
  if (!(await page.ev(`(() => { const a = document.querySelector('#setup [data-step="add"] a.step-link'); if (!a) return false; a.click(); return true; })()`))) {
    return { p: ["第 2 步没有“详细步骤”链接"], detail: "" };
  }
  try {
    await waitFor(page, `["guide-default", "guide-steps-details"].every(id => document.getElementById(id)?.open)`, "点“详细步骤”后两段都展开");
  } catch (e) { return { p: [e.message], detail: "" }; }
  const after = await page.ev(LINK_STATE);
  const p = [];
  if (!after.focus) p.push("点“详细步骤”后焦点应落在 5 步说明的 summary 上");
  if (after.hash !== hashBefore) p.push(`点“详细步骤”不该改网址的 hash：之前 ${J(hashBefore)}，之后 ${J(after.hash)}`);
  if (offscreen(after)) p.push(`点“详细步骤”后 5 步说明的顶边应在视口内：top ${after.top}，视口高 ${after.vh}`);
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
