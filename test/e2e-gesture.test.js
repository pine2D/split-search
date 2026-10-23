import { test } from "node:test";
import assert from "node:assert/strict";
import { createXinput } from "../scripts/e2e/xinput.mjs";
import {
  idle, dragText, cursorHome, held, releaseAfterClose, REASON_CURSOR, REASON_BUSY, REASON_STUCK,
} from "../scripts/e2e/gesture.mjs";
import { omnibox, menuRows } from "../scripts/e2e/gesture-ui.mjs";

const ROOT = "1080", WID = "12582915"; // 0xC00003：测试 Chrome 的 X 客户端 0xC00000

// 假 X 服务器：mousemove 改指针位置，getmouselocation 按 windowAt(x, y, st) 报窗口；记录全部调用
function sim({ windowAt = () => WID, active = () => WID, windows = () => [WID], visible = null, jitter = false } = {}) {
  const st = { x: 5, y: 5, down: false, calls: [], n: 0 };
  const exec = async (cmd, args) => {
    st.calls.push([cmd, ...args]);
    if (cmd !== "xdotool") throw new Error(`未预设：${cmd}`);
    const [c, ...r] = args;
    switch (c) {
      case "mousemove": st.x = Number(r[0]); st.y = Number(r[1]); return "";
      case "getmouselocation": if (jitter) st.x += 1; return `X=${st.x}\nY=${st.y}\nSCREEN=0\nWINDOW=${windowAt(st.x, st.y, st)}\n`;
      case "mousedown": st.down = true; return "";
      case "mouseup": st.down = false; return "";
      case "click": return "";
      case "getactivewindow": return `${active(st)}\n`;
      case "search": return `${(!r.includes("--pid") && visible ? visible(st) : windows(st)).join("\n")}\n`;
      case "key": case "type": case "keyup": return "";
      default: throw new Error(`未预设：xdotool ${c}`);
    }
  };
  return { st, xi: createXinput({ exec, env: { DISPLAY: ":0" } }) };
}

// 假 browser：选区在 CSS (200,70)，页面度量 dpr 1、无工具栏偏移以外的东西 → 屏幕 (200,170)
function fakeBrowser({ onCreate } = {}) {
  return {
    proc: { pid: 4242 },
    attach: async () => "S",
    evaluate: async (sid, expr) => (expr.includes("__e2e_sel")
      ? { x: 100, y: 50, w: 200, h: 40, sel: JSON.parse(/const text = (".*?");/.exec(expr)[1]), iw: 1600, ih: 900 }
      : { screenX: 0, screenY: 0, outerWidth: 1600, innerWidth: 1600, outerHeight: 1000, innerHeight: 900, dpr: 1 }),
    client: { send: async m => { if (m === "Target.createTarget") { onCreate?.(); return { targetId: "T" }; } return {}; } },
  };
}
const fastSleep = async () => {};
const mkCtx = (xi, o = {}) => ({
  browser: fakeBrowser(o), log: () => {},
  gx: { xi, root: ROOT, sleep: fastSleep, profileDir: "/p", idleOpts: { sampleMs: 0, waitMs: 0 }, cursorOpts: { waitMs: 20, intervalMs: 1 } },
});
const ORIGIN = { x: 200, y: 170 };
const ups = st => st.calls.map((c, i) => [c, i]).filter(([c]) => c[1] === "mouseup");
const lastMoveBefore = (st, i) => st.calls.slice(0, i).reverse().find(c => c[1] === "mousemove");

test("idle: 静止 → ok；一次变化后静止 → ok；连续 3 次变化 → busy", async () => {
  const seq = pts => { let i = 0; return { pointer: async () => pts[Math.min(i++, pts.length - 1)] }; };
  const p = (x, y) => ({ x, y, window: WID });
  const sleeps = [];
  const sleep = async ms => { sleeps.push(ms); };
  assert.equal(await idle(seq([p(1, 1), p(1, 1)]), { sleep }), "ok");
  assert.deepEqual(sleeps, [300]);
  sleeps.length = 0;
  assert.equal(await idle(seq([p(1, 1), p(2, 2), p(2, 2), p(2, 2)]), { sleep }), "ok");
  assert.deepEqual(sleeps, [300, 3000, 300]);
  sleeps.length = 0;
  assert.equal(await idle(seq([p(1, 1), p(2, 1), p(3, 1), p(4, 1), p(5, 1), p(6, 1)]), { sleep }), "busy");
  assert.deepEqual(sleeps, [300, 3000, 300, 3000, 300]);
});

test("dragText: 正常 → 按下、移动、在落点松开；按键状态清空", async () => {
  const { st, xi } = sim();
  const ctx = mkCtx(xi);
  st.x = 50; st.y = 300;
  await dragText(ctx, { fromTargetId: "T", text: "abc def", to: { x: 500, y: 20 }, wid: WID, steps: 3, stepMs: 0, dwellMs: 0 });
  const [[, i]] = ups(st);
  assert.deepEqual(lastMoveBefore(st, i).slice(2), ["501", "20"]);
  assert.equal(st.down, false);
  assert.equal(held.current, null);
  const downAt = st.calls.findIndex(c => c[1] === "mousedown");
  assert.deepEqual(lastMoveBefore(st, downAt).slice(2), ["200", "170"]);
  // 按下前紧挨着读了一次指针（断言窗口），中间没有别的调用
  assert.equal(st.calls[downAt - 1][1], "getmouselocation");
});

test("dragText: 光标不在任何 X 窗口上（root）→ 等待后跳过，一次都不移动鼠标", async () => {
  const { st, xi } = sim({ windowAt: () => ROOT });
  const steps = [];
  const ctx = { ...mkCtx(xi), guide: { setStep: s => steps.push(s) } };
  await assert.rejects(dragText(ctx, { fromTargetId: "T", text: "abc", to: { x: 1, y: 1 }, wid: WID }),
    e => e.kind === "skip" && e.message.startsWith(REASON_CURSOR) && /桌面或其他 Windows 应用/.test(e.message));
  assert.equal(st.calls.some(c => c[1] === "mousemove" || c[1] === "mousedown"), false);
  assert.match(steps[0].instruction, /请把鼠标光标停在测试浏览器窗口里，然后别动/);
});

test("dragText: 用户在动鼠标 → 跳过（检测到用户在操作鼠标），不移动", async () => {
  const { st, xi } = sim({ jitter: true });
  await assert.rejects(dragText(mkCtx(xi), { fromTargetId: "T", text: "abc", to: { x: 1, y: 1 }, wid: WID }),
    e => e.kind === "skip" && e.message === REASON_BUSY);
  assert.equal(st.calls.some(c => c[1] === "mousemove"), false);
});

test("dragText: 起点不在测试窗口上 → 中止，不按下", async () => {
  const { st, xi } = sim({ windowAt: (x, y) => (x === 200 && y === 170 ? "4194409" : WID) });
  await assert.rejects(dragText(mkCtx(xi), { fromTargetId: "T", text: "abc", to: { x: 1, y: 1 }, wid: WID }), /选区起点不在测试窗口上/);
  assert.equal(st.calls.some(c => c[1] === "mousedown" || c[1] === "mouseup"), false);
});

test("dragText: 落点被别的窗口盖住 → 按下前的预检就中止，不按下", async () => {
  const { st, xi } = sim({ windowAt: (x, y) => (y < 30 ? "4194409" : WID) });
  st.y = 300; // 光标原本停在测试窗口里
  await assert.rejects(dragText(mkCtx(xi), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 3, stepMs: 0, dwellMs: 0 }),
    e => /落点（按下前预检）不在测试窗口上/.test(e.message) && e.kind === "env");
  assert.equal(st.calls.some(c => c[1] === "mousedown" || c[1] === "mouseup"), false);
  // 落点下面什么都没有（根窗口）：多半是坐标算错，判失败而不是环境干扰
  const r = sim({ windowAt: (x, y) => (y < 30 ? ROOT : WID) });
  r.st.y = 300;
  await assert.rejects(dragText(mkCtx(r.xi), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID }), e => e.kind === "fail");
});

test("dragText: 按下后落点冒出别的窗口 → 不在落点松开，回到起点核对后在原处松开", async () => {
  const { st, xi } = sim({ windowAt: (x, y, s) => (y < 30 && s.down ? "4194409" : WID) });
  st.y = 300;
  await assert.rejects(dragText(mkCtx(xi), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 3, stepMs: 0, dwellMs: 0 }),
    e => /落点不在测试窗口上/.test(e.message) && /已回到起点松开/.test(e.message));
  const u = ups(st);
  assert.equal(u.length, 1);
  assert.deepEqual(lastMoveBefore(st, u[0][1]).slice(2), ["200", "170"]);
  assert.equal(st.down, false);
  assert.equal(held.current, null);
});

test("dragText: 指针下是测试 Chrome 的拖拽图像窗口（按下后出现、大小≈选区）→ 照常在落点松开", async () => {
  const { st, xi } = sim({ windowAt: (x, y, s) => (s.down ? "12582958" : WID), windows: s => (s.down ? [WID, "12582958"] : [WID]) });
  st.y = 300;
  xi.windowRect = async () => ({ width: 205, height: 44, x: 0, y: 0 }); // 选区 200x40
  const r = await dragText(mkCtx(xi), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 2, stepMs: 0, dwellMs: 0 });
  assert.equal(r.dragImage, "12582958");
  const [[, i]] = ups(st);
  assert.deepEqual(lastMoveBefore(st, i).slice(2), ["501", "20"]);
  assert.equal(st.down, false);
});

test("dragText: 大小对不上的自家窗口、或别的应用冒出新窗口 → 都不认，取消拖拽", async () => {
  const a = sim({ windowAt: (x, y, s) => (s.down ? "12582958" : WID), windows: s => (s.down ? [WID, "12582958"] : [WID]) });
  a.st.y = 300;
  a.xi.windowRect = async () => ({ width: 600, height: 300, x: 0, y: 0 });
  await assert.rejects(dragText(mkCtx(a.xi), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 2, stepMs: 0, dwellMs: 0 }),
    e => e.kind === "stuck");
  assert.equal(ups(a.st).length, 0, "起点也只看得到这个窗口：保持按下，不乱松");
  held.current = null;
  const b = sim({ visible: s => (s.down ? [WID, "4194410"] : [WID]) });
  b.st.y = 300;
  await assert.rejects(dragText(mkCtx(b.xi), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 2, stepMs: 0, dwellMs: 0 }),
    e => e.kind === "stuck" && /别的应用的新窗口（4194410）/.test(e.message));
  assert.equal(ups(b.st).length, 0);
  held.current = null;
});

test("dragText: 起点也回不去 → stuck（可能有按键卡住），绝不在别的窗口上松开", async () => {
  const { st, xi } = sim({ windowAt: (x, y, s) => (s.down ? "4194409" : WID) });
  await assert.rejects(dragText(mkCtx(xi), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 2, stepMs: 0, dwellMs: 0 }),
    e => e.kind === "stuck" && e.message.startsWith(REASON_STUCK));
  assert.equal(ups(st).length, 0);
  assert.equal(st.down, true);
  assert.deepEqual(held.current.origin, ORIGIN);
  held.current = null;
});

test("dragText: 中途被中断 → 同样回到起点松开", async () => {
  const { st, xi } = sim();
  const ac = new AbortController();
  const ctx = { ...mkCtx(xi), signal: ac.signal };
  let n = 0;
  ctx.gx.sleep = async () => { if (++n === 3) ac.abort(); };
  await assert.rejects(dragText(ctx, { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 5, stepMs: 0, dwellMs: 0 }), /中断/);
  const u = ups(st);
  assert.equal(u.length, 1);
  assert.deepEqual(lastMoveBefore(st, u[0][1]).slice(2), ["200", "170"]);
});

test("omnibox: 新窗口拿到前台后才按键，每次按键前都核对前台", async () => {
  let made = false;
  const { st, xi } = sim({ windows: () => (made ? ["10", "20"] : ["10"]), active: () => (made ? "20" : "10") });
  const ctx = mkCtx(xi, { onCreate: () => { made = true; } });
  const r = await omnibox(ctx, { text: "sse2e xkw abc", url: "http://x/" });
  assert.equal(r.wid, "20");
  const keys = st.calls.filter(c => c[1] === "key" || c[1] === "type").map(c => c.at(-1));
  assert.deepEqual(keys, ["ctrl+l", "sse2e xkw abc", "Delete", "Return"]);
  for (const [i, c] of st.calls.entries()) if (c[1] === "key" || c[1] === "type") assert.equal(st.calls[i - 1][1], "getactivewindow");
});

test("omnibox: 前台中途被抢走 → 不再按键，松开修饰键，判环境问题", async () => {
  let made = false, typed = false;
  const { st, xi } = sim({ windows: () => (made ? ["10", "20"] : ["10"]), active: s => (typed ? "10" : made ? "20" : "10") });
  const ctx = mkCtx(xi, { onCreate: () => { made = true; } });
  const orig = xi.typeAscii;
  xi.typeAscii = async (...a) => { await orig(...a); typed = true; };
  await assert.rejects(omnibox(ctx, { text: "xdef abc", url: "http://x/", altEnter: true }), e => e.kind === "env" && /前台窗口/.test(e.message));
  const keys = st.calls.filter(c => c[1] === "key").map(c => c.at(-1));
  assert.deepEqual(keys, ["ctrl+l"]);
  assert.ok(st.calls.some(c => c[1] === "keyup"));
});

test("omnibox: 非 ASCII 查询被拒绝，不按任何键", async () => {
  let made = false;
  const { st, xi } = sim({ windows: () => (made ? ["10", "20"] : ["10"]), active: () => (made ? "20" : "10") });
  await assert.rejects(omnibox(mkCtx(xi, { onCreate: () => { made = true; } }), { text: "测试", url: "http://x/" }), /ASCII/);
  assert.equal(st.calls.some(c => c[1] === "type"), false);
});

test("cursorHome: 光标后来回到测试窗口 → 继续", async () => {
  let n = 0;
  const { xi } = sim({ windowAt: () => (++n > 3 ? WID : ROOT) });
  const p = await cursorHome(mkCtx(xi), [WID], { waitMs: 1000, intervalMs: 1 });
  assert.equal(p.window, WID);
});

test("menuRows: 白底上的深色文字行 → 每项中心与文字左边界；阴影和分隔线不算", () => {
  const W = 200, H = 120;
  const buf = Buffer.alloc(W * H * 3); // 全黑（菜单外的透明阴影）
  const fill = (x0, x1, y0, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buf.fill(v, (y * W + x) * 3, (y * W + x) * 3 + 3); };
  fill(10, 190, 5, 115, 255);                 // 白色菜单
  for (const c of [20, 45, 95]) fill(30, 80, c - 5, c + 5, 40);  // 三行文字
  fill(10, 190, 70, 70, 230);                 // 分隔线（浅色）
  assert.deepEqual(menuRows(buf, W, H), { centers: [20, 45, 95], left: 30 });
});

test("releaseAfterClose: 浏览器关掉后仍按着，只在指针停在根窗口上时原地松开", async () => {
  const a = sim({ windowAt: () => "4194411" });
  held.current = { wid: WID, origin: ORIGIN };
  assert.equal(await releaseAfterClose(a.xi, ROOT), "stuck");
  assert.equal(a.st.calls.some(c => c[1] === "mouseup" || c[1] === "mousemove"), false);
  const b = sim({ windowAt: () => ROOT });
  assert.equal(await releaseAfterClose(b.xi, ROOT), "released");
  assert.equal(held.current, null);
  assert.equal(b.st.calls.some(c => c[1] === "mousemove"), false, "不移动指针");
  assert.equal(await releaseAfterClose(b.xi, ROOT), "none");
});

test("dragText: 落点不是测试窗口时，说明那个窗口是不是测试 Chrome 的", async () => {
  const { st, xi } = sim({ windowAt: (x, y) => (y < 30 ? "12582958" : WID), windows: () => [WID, "12582958"] });
  st.y = 300;
  const orig = xi.windowRect;
  xi.windowRect = async w => (w === "12582958" ? { width: 60, height: 40, x: 480, y: 0 } : orig(w));
  await assert.rejects(dragText(mkCtx(xi), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 2, stepMs: 0, dwellMs: 0 }),
    /窗口 12582958 属于测试 Chrome，60x40\+480\+0/);
});

test("sameClient: 同一 X 客户端连接的窗口 id（按最小掩码 0x3FFFF）", async () => {
  const { sameClient } = await import("../scripts/e2e/gesture.mjs");
  assert.equal(sameClient("12582951", "12582915"), true);   // 0xC00027 / 0xC00003
  assert.equal(sameClient("14680067", "12582915"), false);  // 0xE00003：别的客户端
  assert.equal(sameClient("1080", "12582915"), false);
  assert.equal(sameClient("x", "12582915"), false);
});
