import { test } from "node:test";
import assert from "node:assert/strict";
import { cssToScreen, scanTabSegments, rowBackground, uniqueSegment, newFocusedWindow } from "../scripts/e2e/screen.mjs";

// spike 实测（dpr 1.5）：screenX 8、screenY 36、outer/inner 1754/1754、1048/961
const M = { screenX: 8, screenY: 36, outerWidth: 1754, innerWidth: 1754, outerHeight: 1048, innerHeight: 961, dpr: 1.5 };

test("cssToScreen: spike 实测值", () => {
  // 页面左上角：X 侧 xwininfo 原点 12,54，加上 87 CSS 的工具栏高度（×1.5 = 130.5）
  assert.deepEqual(cssToScreen(M, 0, 0), { x: 12, y: 185 });
  assert.deepEqual(cssToScreen(M, 100, 50), { x: 162, y: 260 });
  assert.deepEqual(cssToScreen(M, 877, 480.5), { x: 1328, y: 905 });
});

test("cssToScreen: 缺字段或非数值 -> 抛错", () => {
  assert.throws(() => cssToScreen({ ...M, dpr: undefined }, 1, 1), /dpr/);
  assert.throws(() => cssToScreen(M, NaN, 1), /坐标/);
});

const BG = [221, 227, 233];
const WHITE = [255, 255, 255];
function canvas(width, height, fill = BG) {
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) buf.set(fill, i * 3);
  return buf;
}
function paint(buf, width, [x0, x1], [y0, y1], color) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buf.set(color, (y * width + x) * 3);
}
const W = 400, H = 50, ROWS = [4, 40];

test("scanTabSegments: 单个区段", () => {
  const b = canvas(W, H);
  paint(b, W, [100, 299], [10, 30], WHITE);
  assert.deepEqual(scanTabSegments(b, W, ROWS, BG), [[100, 299]]);
});

test("scanTabSegments: 多个区段", () => {
  const b = canvas(W, H);
  paint(b, W, [20, 150], [10, 30], WHITE);
  paint(b, W, [200, 390], [10, 30], [240, 244, 248]);
  assert.deepEqual(scanTabSegments(b, W, ROWS, BG), [[20, 150], [200, 390]]);
});

test("scanTabSegments: 宽度 <90 的区段（tab search 按钮）被去掉", () => {
  const b = canvas(W, H);
  paint(b, W, [5, 40], [8, 32], WHITE);
  paint(b, W, [100, 188], [8, 32], WHITE); // 89 宽
  paint(b, W, [200, 289], [8, 32], WHITE); // 90 宽
  assert.deepEqual(scanTabSegments(b, W, ROWS, BG), [[200, 289]]);
});

test("scanTabSegments: 取区段最宽的那一行（圆角处较窄）", () => {
  const b = canvas(W, H);
  paint(b, W, [110, 289], [6, 9], WHITE);
  paint(b, W, [100, 299], [10, 30], WHITE);
  assert.deepEqual(scanTabSegments(b, W, ROWS, BG), [[100, 299]]);
});

test("scanTabSegments: 无区段、比背景暗、只在扫描行外 -> []", () => {
  assert.deepEqual(scanTabSegments(canvas(W, H), W, ROWS, BG), []);
  const dark = canvas(W, H);
  paint(dark, W, [50, 350], [10, 30], [120, 120, 120]);
  assert.deepEqual(scanTabSegments(dark, W, ROWS, BG), []);
  const outside = canvas(W, H);
  paint(outside, W, [50, 350], [42, 49], WHITE);
  assert.deepEqual(scanTabSegments(outside, W, ROWS, BG), []);
  const faint = canvas(W, H);
  paint(faint, W, [50, 350], [10, 30], [230, 236, 240]); // 亮度只高 25，不够 30
  assert.deepEqual(scanTabSegments(faint, W, ROWS, BG), []);
});

test("scanTabSegments: 缓冲区长度不足 -> 抛错", () => {
  assert.throws(() => scanTabSegments(Buffer.alloc(10), W, ROWS, BG), /长度/);
});

test("rowBackground: 取该行出现最多的颜色", () => {
  const b = canvas(W, H);
  paint(b, W, [0, 150], [8, 8], WHITE);
  assert.deepEqual(rowBackground(b, W, 8), BG);
});

test("uniqueSegment: 唯一才返回并加上窗口原点；否则 null", () => {
  assert.deepEqual(uniqueSegment([[61, 406]], 12), [73, 418]);
  assert.equal(uniqueSegment([], 12), null);
  assert.equal(uniqueSegment([[1, 100], [200, 300]], 12), null);
});

// ---- newFocusedWindow（注入假 browser 与假 xinput）----
function fakeBrowser() {
  const sent = [];
  return {
    sent,
    proc: { pid: 4242 },
    client: { send: async (method, params) => { sent.push([method, params]); return method === "Target.createTarget" ? { targetId: "T1" } : {}; } },
  };
}

test("newFocusedWindow: 新窗口成为前台 -> 返回 targetId 与 wid", async () => {
  const b = fakeBrowser();
  let n = 0;
  const xi = {
    listWindows: async () => (b.sent.length ? ["10", "20"] : ["10"]),
    activeWindow: async () => (++n >= 2 ? "20" : "10"),
  };
  const r = await newFocusedWindow(b, "http://x/", { xi, timeoutMs: 1000, intervalMs: 5 });
  assert.equal(r.targetId, "T1");
  assert.equal(r.wid, "20");
  assert.equal(typeof r.focusMs, "number");
  assert.deepEqual(b.sent[0], ["Target.createTarget", { url: "http://x/", newWindow: true }]);
});

test("newFocusedWindow: 前台不是新窗口 -> 抛“新窗口未获得前台”并关掉它", async () => {
  const b = fakeBrowser();
  const xi = { listWindows: async () => (b.sent.length ? ["10", "20"] : ["10"]), activeWindow: async () => null };
  await assert.rejects(newFocusedWindow(b, "http://x/", { xi, timeoutMs: 60, intervalMs: 5 }), { message: "新窗口未获得前台" });
  assert.ok(b.sent.some(([m, p]) => m === "Target.closeTarget" && p.targetId === "T1"));
});
