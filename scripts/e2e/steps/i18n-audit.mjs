// I18N（i18n.mjs）与 v0.4 的多语言检查（v04-i18n.mjs）共用的自查、等待和截图工具。
// 单独成模块，两边都只从这里取，不再互相引用（以前互相 import，谁在模块顶层用到对方的绑定就会撞上 TDZ）。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR } from "../ext.mjs";
import { msgIn } from "../i18n.mjs";
import { TAB_KEYS } from "../../../src/lib/options-route.js";
import { sleep, showTab } from "./optpage.mjs";
import { activate } from "./guided.mjs";

const J = JSON.stringify;
export const SHOT_DIR = join(OUT_DIR, "i18n");
export const htmlLang = locale => locale.replace("_", "-");
// 展开设置页所有折叠区（整页，含隐藏 tab 里的），返回个数
export const OPEN_ALL = `document.querySelectorAll("details.disclosure").forEach(d => { d.open = true; }); document.querySelectorAll("details.disclosure").length`;

// 页面自查：lang、文字仍是 key 的 [data-i18n]、页面横向溢出、按钮/label 内容溢出
// 页面自查：原样显示的 key、横向溢出、元素内容溢出。scope 把查找限制在某个容器里（选择器前缀，带空格）；
// items 是逐个查内容溢出的元素；box 给出时横向溢出改看这个元素自己（scrollWidth > clientWidth），
// 用于对话框和弹窗：弹窗当作标签页打开时窗口比它宽，比 innerWidth 看不出溢出。
export const audit = ({ scope = "", items = "button, label", box = null } = {}) => `(() => {
  const keyLike = /^[a-z]+_[a-z0-9_]+$/;
  const all = sel => [...document.querySelectorAll(sel.split(",").map(x => ${J(scope)} + x.trim()).join(", "))];
  const raw = all("[data-i18n]")
    .map(el => ({ key: el.getAttribute("data-i18n"), text: el.textContent.trim() }))
    .filter(x => x.text === x.key || keyLike.test(x.text));
  const tight = all(${J(items)}).filter(el => el.scrollWidth > el.clientWidth + 1)
    .map(el => ({ tag: el.tagName.toLowerCase(), key: el.getAttribute("data-i18n") || el.id || el.className, sw: el.scrollWidth, cw: el.clientWidth }));
  const b = ${box ? `document.querySelector(${J(box)})` : "null"};
  return { lang: document.documentElement.lang, box: ${J(box)},
    scrollWidth: b ? b.scrollWidth : document.documentElement.scrollWidth, innerWidth: b ? b.clientWidth : innerWidth, raw, tight };
})()`;

// 纯逻辑：a = AUDIT 的结果，返回问题列表（空 = 通过）
export function auditProblems(locale, a) {
  const out = [];
  if (a.lang !== htmlLang(locale)) out.push(`lang 应为 ${htmlLang(locale)}，实际 ${a.lang}`);
  for (const r of a.raw) out.push(`[data-i18n="${r.key}"] 显示的是 key 样的文字“${r.text}”`);
  if (a.scrollWidth > a.innerWidth) {
    out.push(a.box ? `${a.box} 横向溢出：scrollWidth ${a.scrollWidth} > clientWidth ${a.innerWidth}`
      : `页面横向溢出：scrollWidth ${a.scrollWidth} > innerWidth ${a.innerWidth}`);
  }
  for (const t of a.tight) out.push(`${t.tag}（${t.key}）内容溢出：scrollWidth ${t.sw} > clientWidth ${t.cw} + 1`);
  return out;
}

// 要求单行的元素（如按钮）实际排成几行：取元素内容的 Range.getClientRects，按 top（差 2px 以内算同一行）计不同的行框。
// .btn 允许 overflow-wrap 换行，换行只会让按钮变高、scrollWidth 不变，上面的溢出检查看不出来，所以单独数行。
// 返回 [{ sel, lines }]，找不到元素或没有文字时 lines 为 0
export const lineCount = sels => `(${J(sels)}).map(sel => {
  const el = document.querySelector(sel);
  if (!el) return { sel, lines: 0 };
  const r = document.createRange(); r.selectNodeContents(el);
  const tops = [];
  for (const rc of r.getClientRects()) {
    if (rc.width > 0 && rc.height > 0 && !tops.some(t => Math.abs(t - rc.top) <= 2)) tops.push(rc.top);
  }
  return { sel, lines: tops.length };
})`;

// 纯逻辑：rows = lineCount 的结果，返回问题列表（空 = 都是一行）
export function lineProblems(rows) {
  const out = [];
  for (const { sel, lines } of rows) {
    if (lines === 0) out.push(`${sel} 找不到或没有文字`);
    else if (lines > 1) out.push(`${sel} 文字换成了 ${lines} 行（应为一行）`);
  }
  return out;
}

export async function waitPage(page, expr, what, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await page.ev(expr, { timeoutMs: 3000 }).catch(() => false)) return;
    if (Date.now() >= end) throw new Error(`${timeoutMs / 1000} 秒内没有等到：${what}`);
    await sleep(100);
  }
}

// beyond：clip 超出视口的部分也画出来（captureBeyondViewport），否则视口以下是空白
export async function shoot(ctx, page, file, { full = false, clip = null, beyond = false } = {}) {
  const { client } = ctx.browser;
  await activate(ctx, page.targetId);
  const params = { format: "png", ...(clip ? { clip } : {}), ...(beyond ? { captureBeyondViewport: true } : {}) };
  if (full) {
    const { cssContentSize: s } = await client.send("Page.getLayoutMetrics", {}, page.sid);
    Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(s.width), height: Math.ceil(s.height), scale: 1 } });
  }
  const { data } = await client.send("Page.captureScreenshot", params, page.sid, { timeoutMs: 15000 });
  mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

export const bodyClip = page => page.ev(`(() => { const r = document.body.getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height), scale: 1 }; })()`);

// 纯逻辑：s.visible 是 #panel-<key> 里 checkVisibility() 为 true 的后代个数。为 0 说明面板没显示出来，
// 这时面板里的溢出检查全会静默通过（隐藏元素的 scrollWidth、clientWidth 都是 0），判失败。
// 600 宽另给两个可选字段（没给就不查）：tabs 是每个 .tab 的 scrollWidth/clientWidth（多出 1px 以上算截字，同 audit），
// selectedInView 是选中的 tab 是否完全落在 .tablist 的可视范围里
export function tabAuditProblems(key, s) {
  const out = s.visible > 0 ? [] : [`#panel-${key} 里没有看得见的元素（面板没显示出来，溢出检查不作数）`];
  for (const t of s.tabs ?? []) {
    if (t.sw > t.cw + 1) out.push(`#${t.id} 截字：scrollWidth ${t.sw} > clientWidth ${t.cw} + 1`);
  }
  if (s.selectedInView === false) out.push(`选中 #tabbtn-${key} 后它没有完全落在 tab 栏的可视范围里`);
  return out;
}

// 设置页四个 tab 逐一审（1280 宽）：页头与 tab 栏各审一次；每个 tab 切过去、确认面板看得见、审面板、截 <locale>-options-<key>.png；
// 再展开所有折叠区（OPEN_ALL），逐个 tab 再审一遍、截 <locale>-options-<key>-open.png。
// 最后把视口模拟成 600 宽（折叠区仍展开），四个 tab 各审一次溢出（不截图），并核对每个 tab 不截字、选中的 tab 完全在 tab 栏可视范围里。
// 走完停在最后一个 tab（④），视口恢复
export async function auditTabs(ctx, opt, locale) {
  const problems = [], shots = [];
  for (const [name, scope] of [["页头", ".page-head "], ["tab 栏", ".tabbar "]]) {
    problems.push(...auditProblems(locale, await opt.ev(audit({ scope }))).map(p => `${name}：${p}`));
  }
  const name = key => `“${msgIn(locale, `options_tab_${key}`)}”tab`;
  for (const open of [false, true]) {
    if (open) await opt.ev(OPEN_ALL);
    for (const key of TAB_KEYS) {
      await showTab(opt, key);
      if (!open) {
        const visible = await opt.ev(`[...document.querySelectorAll(${J(`#panel-${key} *`)})].filter(el => el.checkVisibility()).length`);
        problems.push(...tabAuditProblems(key, { visible }));
      }
      const found = auditProblems(locale, await opt.ev(audit({ scope: `#panel-${key} ` })));
      problems.push(...found.map(p => `${name(key)}${open ? "（说明展开）" : ""}：${p}`));
      shots.push(await shoot(ctx, opt, join(SHOT_DIR, `${locale}-options-${key}${open ? "-open" : ""}.png`), { full: true }));
    }
  }
  problems.push(...(await narrowTabs(ctx, opt, locale)).map(([key, p]) => `600 宽 ${name(key)}：${p}`));
  return { problems, shots };
}

// 每个 .tab 的 scrollWidth/clientWidth，以及选中的 tab 是否完全落在 .tablist 的可视范围（±1px）
const TAB_FIT = `(() => { const list = document.querySelector(".tablist").getBoundingClientRect();
  const s = document.querySelector('.tab[aria-selected="true"]').getBoundingClientRect();
  return { tabs: [...document.querySelectorAll(".tab")].map(b => ({ id: b.id, sw: b.scrollWidth, cw: b.clientWidth })),
    selectedInView: s.left >= list.left - 1 && s.right <= list.right + 1 }; })()`;

async function narrowTabs(ctx, opt, locale) {
  const { client } = ctx.browser, out = [];
  await client.send("Emulation.setDeviceMetricsOverride", { width: 600, height: 1000, deviceScaleFactor: 0, mobile: false }, opt.sid);
  try {
    await waitPage(opt, "innerWidth === 600", "视口变成 600 宽", 3000);
    for (const key of TAB_KEYS) {
      await showTab(opt, key);
      const visible = await opt.ev(`[...document.querySelectorAll(${J(`#panel-${key} *`)})].filter(el => el.checkVisibility()).length`);
      const found = [...tabAuditProblems(key, { visible, ...await opt.ev(TAB_FIT) }),
        ...auditProblems(locale, await opt.ev(audit({ scope: `#panel-${key} ` })))];
      out.push(...found.map(p => [key, p]));
    }
  } finally { await client.send("Emulation.clearDeviceMetricsOverride", {}, opt.sid).catch(() => {}); }
  return out;
}
