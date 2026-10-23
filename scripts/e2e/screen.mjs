// 屏幕几何：CSS → X 屏幕坐标换算、页面选区位置、标签栏截图测量、新开并拿到前台的窗口。
// 依据 spike-xdotool.md §1.2–1.4（WSLg，dpr 1.5，Chrome 自绘标题栏，左右下无边框）。
import { withSession } from "./browser.mjs";
import { PROFILE_DIR } from "./config.mjs";
import defaultXi from "./xinput.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const M_KEYS = ["screenX", "screenY", "outerWidth", "innerWidth", "outerHeight", "innerHeight", "dpr"];

// X = round((screenX + (outerWidth − innerWidth) + clientX)·dpr)，Y 同理。
// 不要用 xdotool getwindowgeometry 的 Position（含 weston 的窗口装饰，偏 38/59 px）。
export function cssToScreen(m, x, y) {
  for (const k of M_KEYS) if (!Number.isFinite(m?.[k])) throw new Error(`页面度量缺少 ${k}`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`坐标不是数值：${x},${y}`);
  return {
    x: Math.round((m.screenX + (m.outerWidth - m.innerWidth) + x) * m.dpr),
    y: Math.round((m.screenY + (m.outerHeight - m.innerHeight) + y) * m.dpr),
  };
}

const MIN_SEGMENT = 90;   // 去掉 tab search 按钮等窄区段（spike：按钮约 35 px，标签约 345 px）
const LIGHTER_BY = 30;    // 比背景亮（RGB 之和）至少这么多才算

function checkBuf(rgb, width, rowsNeeded) {
  if (!Number.isInteger(width) || width <= 0) throw new Error(`宽度不合法：${width}`);
  if (!rgb || rgb.length < width * rowsNeeded * 3) throw new Error(`RGB 缓冲区长度不足：${rgb?.length ?? 0}，至少 ${width * rowsNeeded * 3}`);
}

// 该行出现最多的颜色当背景（标签栏未激活标签与背景同色）
export function rowBackground(rgb, width, y) {
  checkBuf(rgb, width, y + 1);
  const count = new Map();
  let best = null, bestN = 0;
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    const k = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    const n = (count.get(k) || 0) + 1;
    count.set(k, n);
    if (n > bestN) { bestN = n; best = k; }
  }
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

function rowSegments(rgb, width, y, bg, bgSum) {
  const segs = [];
  let s = -1;
  for (let x = 0; x <= width; x++) {
    let light = false;
    if (x < width) {
      const i = (y * width + x) * 3;
      const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
      light = !(r === bg[0] && g === bg[1] && b === bg[2]) && r + g + b > bgSum + LIGHTER_BY;
    }
    if (light && s < 0) s = x;
    else if (!light && s >= 0) { if (x - s >= MIN_SEGMENT) segs.push([s, x - 1]); s = -1; }
  }
  return segs;
}

// 在 rows=[from,to]（含两端）里逐行找比 bg 亮的连续区段，去掉宽度 <90 的；
// 取“最宽区段最宽”的那一行（当前标签圆角处较窄），返回该行的区段（窗口内 X 坐标）
export function scanTabSegments(rgb, width, rows, bg) {
  const [from, to] = rows;
  checkBuf(rgb, width, to + 1);
  const bgSum = bg[0] + bg[1] + bg[2];
  let best = [], bestW = 0;
  for (let y = from; y <= to; y++) {
    const segs = rowSegments(rgb, width, y, bg, bgSum);
    const w = Math.max(0, ...segs.map(([l, r]) => r - l + 1));
    if (w > bestW) { bestW = w; best = segs; }
  }
  return best;
}

// 唯一区段才返回（加上窗口在屏幕上的 X 原点）；0 个或多个 → null（不猜坐标）
export function uniqueSegment(segs, originX) {
  if (segs.length !== 1) return null;
  return [segs[0][0] + originX, segs[0][1] + originX];
}

// ---- 需要浏览器的部分 ----
async function inPage(browser, targetId, expr) {
  const sid = await browser.attach(targetId);
  return withSession(browser.client, sid, () => browser.evaluate(sid, expr, { timeoutMs: 5000 }));
}

export function metrics(browser, targetId) {
  return inPage(browser, targetId, `({ screenX, screenY, outerWidth, innerWidth, outerHeight, innerHeight, dpr: devicePixelRatio })`);
}

// 在页面顶部插入一段大号文字并选中它，返回选区中心的屏幕坐标
export async function selectionCenter(browser, targetId, text) {
  const r = await inPage(browser, targetId, `(() => {
    const text = ${JSON.stringify(String(text))};
    document.getElementById("__e2e_sel")?.remove();
    const p = document.createElement("p");
    p.id = "__e2e_sel";
    p.style.cssText = "font-size:48px;margin:24px;user-select:text;white-space:nowrap";
    p.textContent = text;
    document.body.prepend(p);
    const range = document.createRange();
    range.selectNodeContents(p.firstChild);
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    const b = range.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, sel: String(getSelection()), iw: innerWidth, ih: innerHeight };
  })()`);
  if (r.sel !== String(text)) throw new Error(`选区内容不符：${JSON.stringify(r.sel)}`);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (!(r.w > 0 && r.h > 0 && cx > 0 && cy > 0 && cx < r.iw && cy < r.ih)) throw new Error("选区不在可视区域内");
  return cssToScreen(await metrics(browser, targetId), cx, cy);
}

const STRIP_ROWS = [4, 40];   // 标签栏所在的窗口内行（X 像素）
const STRIP_HEIGHT = 80;
const BG_ROW = 8;

// 激活标签，截窗口顶部 80 行 RGB，测当前标签在屏幕上的 [L,R]。
// 返回 { rect: [L,R]|null, segments（窗口内）, originX, y（标签栏中线的屏幕 Y）, bg }。
export async function measureTab(browser, ext, wid, tabId, { xi = defaultXi, settleMs = 350 } = {}) {
  if (!Number.isInteger(tabId)) throw new Error(`标签 id 不合法：${tabId}`);
  const w = await ext.eval(`(async () => {
    await chrome.tabs.update(${tabId}, { active: true });
    const t = await chrome.tabs.get(${tabId});
    const w = await chrome.windows.get(t.windowId);
    return { left: w.left, top: w.top, width: w.width, state: w.state, dpr: devicePixelRatio };
  })()`);
  await sleep(settleMs);
  const { width } = await xi.windowSize(wid);
  // 核对 wid 就是这个标签所在的窗口（chrome.windows 的宽度是 CSS px）
  if (Math.abs(width - w.width * w.dpr) > 2) throw new Error(`窗口 ${wid} 宽 ${width}，与标签所在窗口（${w.width}×${w.dpr}）不符`);
  const rgb = await xi.captureRgb(wid, { width, height: STRIP_HEIGHT });
  const bg = rowBackground(rgb, width, BG_ROW);
  const segments = scanTabSegments(rgb, width, STRIP_ROWS, bg);
  const originX = Math.round(w.left * w.dpr);
  const originY = Math.round(w.top * w.dpr);
  return { rect: uniqueSegment(segments, originX), segments, originX, y: originY + Math.round(20 * w.dpr), bg, state: w.state };
}

export async function tabRect(browser, ext, wid, tabId, opts) {
  return (await measureTab(browser, ext, wid, tabId, opts)).rect;
}

// 新开窗口（Windows 前台随之切过来），断言 getactivewindow 就是它；否则关掉它并抛错。
// WSLg 下 windowactivate 无效，键盘手势只能在这样的窗口里做（spike §1.4：184–267ms 内拿到前台）。
export async function newFocusedWindow(browser, url, { xi = defaultXi, profileDir = PROFILE_DIR, timeoutMs = 5000, intervalMs = 100 } = {}) {
  const pid = browser.proc.pid;
  const before = new Set(await xi.listWindows(pid, profileDir));
  const t0 = Date.now();
  const { targetId } = await browser.client.send("Target.createTarget", { url, newWindow: true });
  let wid = null, act = null;
  try {
    while (Date.now() - t0 < timeoutMs) {
      wid = (await xi.listWindows(pid, profileDir)).find(w => !before.has(w)) ?? null;
      act = await xi.activeWindow();
      if (wid && act === wid) return { targetId, wid, focusMs: Date.now() - t0 };
      await sleep(intervalMs);
    }
  } catch (e) {
    await browser.client.send("Target.closeTarget", { targetId }).catch(() => {});
    throw e;
  }
  await browser.client.send("Target.closeTarget", { targetId }).catch(() => {});
  const err = new Error("新窗口未获得前台");
  err.detail = { wid, active: act };
  throw err;
}
