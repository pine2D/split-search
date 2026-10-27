// I18N（i18n.mjs）与 v0.4 的多语言检查（v04-i18n.mjs）共用的自查、等待和截图工具。
// 单独成模块，两边都只从这里取，不再互相引用（以前互相 import，谁在模块顶层用到对方的绑定就会撞上 TDZ）。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR } from "../ext.mjs";
import { sleep } from "./optpage.mjs";
import { activate } from "./guided.mjs";

const J = JSON.stringify;
export const SHOT_DIR = join(OUT_DIR, "i18n");
export const htmlLang = locale => locale.replace("_", "-");

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
