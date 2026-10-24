import { test } from "node:test";
import assert from "node:assert/strict";
import { createXinput } from "../scripts/e2e/xinput.mjs";
import {
  idle, dragText, cursorHome, held, releaseAfterClose, REASON_CURSOR, REASON_BUSY, REASON_STUCK,
} from "../scripts/e2e/gesture.mjs";
import { omnibox, menuRows, contextMenuPick } from "../scripts/e2e/gesture-ui.mjs";
import { releaseHeldSync } from "../scripts/e2e/gesture-guard.mjs";

const ROOT = "1080", WID = "12582915"; // 0xC00003：测试 Chrome 的 X 客户端 0xC00000

// 假 X 服务器：mousemove 改指针位置，getmouselocation 按 windowAt(x, y, st) 报窗口；记录全部调用
function sim({ windowAt = () => WID, active = () => WID, windows = () => [WID], visible = null, stack = null, tree, jitter = false } = {}) {
  // 默认：xwininfo 读得到，根下只有测试窗口（叠放核对通过）；tree: null 表示读不到
  if (tree === undefined) tree = stack ? null : () => ({ kids: [{ id: WID, x: 0, y: 0, w: 4000, h: 4000 }] });
  const st = { x: 5, y: 5, down: false, calls: [], n: 0 };
  const exec = async (cmd, args) => {
    st.calls.push([cmd, ...args]);
    if (cmd === "xprop" && stack) return `_NET_CLIENT_LIST_STACKING(WINDOW): window id # ${stack(st).map(w => `0x${Number(w).toString(16)}`).join(", ")}\n`;
    if (cmd === "xwininfo" && tree) return xwininfoOut(tree(st), args);
    if (cmd !== "xdotool") throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
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

// 假 xwininfo：t = { kids: [{ id, x, y, w, h, inner?: [id], map? }]（从上到下，与真实打印顺序一致）, parents: { 窗口: 父窗口 } }
const hex = id => `0x${Number(id).toString(16)}`;
const line = k => `     ${hex(k.id)} (has no name): ()  ${k.w}x${k.h}+${k.x}+${k.y}  +${k.x}+${k.y}`;
function xwininfoOut(t, args) {
  if (!t) throw new Error("xwininfo 读不到");
  if (args[0] === "-root") return ["  Parent window id: 0x0 (none)", ...t.kids.map(line)].join("\n") + "\n";
  const id = args[1], k = t.kids.find(x => x.id === id);
  if (args[2] === "-children") {
    const inner = (k?.inner ?? []).map(c => ({ id: c, x: 0, y: 0, w: 1, h: 1 }));
    return [`  Parent window id: ${hex(t.parents?.[id] ?? ROOT)}`, ...inner.map(line)].join("\n") + "\n";
  }
  return `  Map State: ${k?.map ?? "IsViewable"}\n`;
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
  assert.deepEqual(keys, ["ctrl+l", ..."sse2e xkw abc", "Delete", "Return"], "地址栏文字逐字符输入");
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

// ---- 裁定 I1：前台与叠放顺序 ----
const F = "4194409"; // 别的应用（不同 X 客户端）
const dragArgs = { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 2, stepMs: 0, dwellMs: 0 };

test("I1：拖拽中前台换成别的应用的窗口 → 不在落点松开；回到起点时前台已恢复 → 在起点松开", async () => {
  const { st, xi } = sim({ active: s => (s.down && s.y < 30 ? F : WID) });
  st.y = 300;
  await assert.rejects(dragText(mkCtx(xi), dragArgs), e => /前台换成了别的应用的窗口（4194409）/.test(e.message) && /已回到起点松开/.test(e.message));
  const u = ups(st);
  assert.equal(u.length, 1);
  assert.deepEqual(lastMoveBefore(st, u[0][1]).slice(2), ["200", "170"]);
});

test("I1：前台一直是别的应用 → 起点也不松开，stuck", async () => {
  const { st, xi } = sim({ active: s => (s.down ? F : WID) });
  st.y = 300;
  await assert.rejects(dragText(mkCtx(xi), dragArgs), e => e.kind === "stuck");
  assert.equal(ups(st).length, 0);
  held.current = null;
});

test("I1：叠放顺序里别的应用（按下前就在）被提到测试窗口上面 → 不在落点松开；起点核对时已回到下面 → 在起点松开", async () => {
  const { st, xi } = sim({ stack: s => (s.down && s.y < 30 ? [WID, F] : [F, WID]) });
  st.y = 300;
  await assert.rejects(dragText(mkCtx(xi), dragArgs), e => /别的应用的窗口（4194409）被提到了测试窗口上面/.test(e.message));
  const u = ups(st);
  assert.equal(u.length, 1);
  assert.deepEqual(lastMoveBefore(st, u[0][1]).slice(2), ["200", "170"]);
});

test("I1：叠放顺序一开始读得到、拖拽中读不到 → 中止；一直在上面 → stuck", async () => {
  const a = sim({ stack: s => (s.down ? [] : [F, WID]) });
  a.st.y = 300;
  await assert.rejects(dragText(mkCtx(a.xi), dragArgs), e => e.kind === "stuck" && /读不到测试窗口的叠放位置/.test(e.message));
  assert.equal(ups(a.st).length, 0);
  held.current = null;
  const b = sim({ stack: s => (s.down ? [WID, F] : [F, WID]) });
  b.st.y = 300;
  await assert.rejects(dragText(mkCtx(b.xi), dragArgs), e => e.kind === "stuck");
  assert.equal(ups(b.st).length, 0);
  held.current = null;
});

test("N-1：按下前读不到叠放顺序（xwininfo 偶发失败、也没有 EWMH 后备）→ 环境问题，不按下", async () => {
  const { st, xi } = sim({ tree: null });
  st.y = 300;
  await assert.rejects(dragText(mkCtx(xi), dragArgs), e => e.kind === "env" && /按下前读不到/.test(e.message));
  assert.ok(st.calls.some(c => c[0] === "xprop"), "试过 EWMH 后备");
  assert.equal(st.calls.some(c => c[1] === "mousedown"), false);
});

test("I1：外来窗口快照在落点预检之前取——预检之后冒出来的窗口也算新的，不按下", async () => {
  let seenDrop = false;
  // 指针一到落点（预检）就冒出 F；它在按下前的核对时必须被认成“新”的
  const { st, xi } = sim({ windowAt: (x, y) => { if (y < 30) seenDrop = true; return WID; }, visible: () => (seenDrop ? [WID, F] : [WID]) });
  st.y = 300;
  await assert.rejects(dragText(mkCtx(xi), dragArgs), /别的应用的新窗口（4194409）/);
  assert.equal(st.calls.some(c => c[1] === "mousedown"), false);
});

test("M-1：落点是 root 时回到确认过的光标位置复查——那里也成了 root（光标被移走）→ skip", async () => {
  let moved = 0;
  const { st, xi } = sim({ windowAt: () => (moved > 0 ? ROOT : WID) });
  st.y = 300;
  const orig = xi.move;
  xi.move = async (...a) => { moved++; return orig(...a); };
  await assert.rejects(dragText(mkCtx(xi), dragArgs), e => e.kind === "skip" && e.message.startsWith(REASON_CURSOR));
  assert.equal(st.calls.some(c => c[1] === "mousedown"), false);
});

test("releaseHeldSync：起点核对通过才 mouseup；前台是别的应用 → stuck，不松开", () => {
  const mk = active => {
    const calls = [];
    const exec = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args[0] === "getmouselocation") return `X=200\nY=170\nSCREEN=0\nWINDOW=${WID}\n`;
      if (args[0] === "search") return `${WID}\n`;
      if (args[0] === "getactivewindow") return `${active}\n`;
      return "";
    };
    held.current = { origin: ORIGIN, guard: { wid: WID, image: null, pid: 4242, before: new Set([WID]), active0: WID, above0: null } };
    return { calls, exec };
  };
  const ok = mk(WID);
  assert.equal(releaseHeldSync({ exec: ok.exec }), "released");
  assert.ok(ok.calls.some(c => c[1] === "mouseup"));
  const bad = mk(F);
  assert.equal(releaseHeldSync({ exec: bad.exec }), "stuck");
  assert.equal(bad.calls.some(c => c[1] === "mouseup"), false);
  held.current = null;
});

test("contextMenuPick：右键后冒出多个新窗口 → 在测试窗口里点一下关闭菜单，不在菜单上点", async () => {
  let clicked3 = false;
  const { st, xi } = sim({ windows: () => (clicked3 ? [WID, "12582990", "12582991"] : [WID]) });
  st.y = 300;
  const origClick = xi.click;
  xi.click = async (b, o) => { await origClick(b, o); if (b === 3) clicked3 = true; };
  await assert.rejects(contextMenuPick(mkCtx(xi), { at: { x: 200, y: 170 }, itemIndex: 2, expectItems: 4, wid: WID }), e => e.kind === "env");
  const clicks = st.calls.map((c, i) => [c, i]).filter(([c]) => c[1] === "click");
  assert.deepEqual(clicks.map(([c]) => c.at(-1)), ["3", "1"]);
  const [, i1] = clicks[1];
  assert.deepEqual(lastMoveBefore(st, i1).slice(2), ["200", "570"]);
  assert.equal(st.calls[i1 - 1][1], "getmouselocation", "点之前核对指针在测试窗口里");
});

// ---- fix round 2：xwininfo 叠放顺序（WSLg 没有 _NET_CLIENT_LIST_STACKING）----
const FRAME_T = String(0x27db55), FRAME_F = String(0x27dbf7); // Weston 框架窗口（WM 客户端）
const kidsWith = top => ({ kids: top, parents: { [WID]: FRAME_T } });
const frameT = { id: FRAME_T, x: 0, y: 0, w: 2400, h: 1500, inner: [WID] };
const coverDrop = o => ({ id: FRAME_F, x: 400, y: 0, w: 300, h: 100, inner: [F], ...o }); // 盖住落点 (501,20)，不盖起点 (200,170)

test("叠放：按下前就在下面的别的应用被提到测试窗口上面并盖住落点 → 不在落点松开，回起点松开", async () => {
  const { st, xi } = sim({ tree: s => kidsWith(s.down && s.y < 30 ? [coverDrop(), frameT] : [frameT, coverDrop()]) });
  st.y = 300;
  await assert.rejects(dragText(mkCtx(xi), dragArgs), e => /别的应用的窗口（2612215，300x100\+400\+0）被提到了测试窗口上面并盖住了落点/.test(e.message));
  const u = ups(st);
  assert.equal(u.length, 1);
  assert.deepEqual(lastMoveBefore(st, u[0][1]).slice(2), ["200", "170"]);
});

test("叠放：提上来的窗口不盖住落点、没映射、或属于测试 Chrome（框架里是自家窗口 / 同一客户端的拖拽图像）→ 都不算，照常松开", async () => {
  const cases = [
    coverDrop({ x: 1500 }),                                   // 不盖住落点
    coverDrop({ map: "IsUnMapped" }),                          // 没映射
    coverDrop({ inner: ["12582990"] }),                        // 框架里是测试 Chrome 的窗口（如设置页）
    { id: "12582958", x: 450, y: 0, w: 120, h: 60 },           // 同一客户端的拖拽图像（根的直接子窗口）
  ];
  for (const top of cases) {
    const { st, xi } = sim({ tree: s => kidsWith(s.down ? [top, frameT] : [frameT, top]) });
    st.y = 300;
    await dragText(mkCtx(xi), dragArgs);
    const u = ups(st);
    assert.equal(u.length, 1, JSON.stringify(top));
    assert.deepEqual(lastMoveBefore(st, u[0][1]).slice(2), ["501", "20"]);
  }
});

test("叠放：快照在落点预检之前取——预检之后才被提上来的也算", async () => {
  let seen = false;
  const { st, xi } = sim({ windowAt: (x, y) => { if (y < 30) seen = true; return WID; }, tree: () => kidsWith(seen ? [coverDrop(), frameT] : [frameT, coverDrop()]) });
  st.y = 300;
  // 起点没被盖住，所以会按下；但到落点核对时它被认成“新提上来的”，不在落点松开（快照若在预检之后取，就会漏掉它）
  await assert.rejects(dragText(mkCtx(xi), dragArgs), /被提到了测试窗口上面/);
  const u = ups(st);
  assert.equal(u.length, 1);
  assert.deepEqual(lastMoveBefore(st, u[0][1]).slice(2), ["200", "170"]);
});

test("叠放：一开始读得到、拖拽中读不到 → 中止；起点也读不到 → stuck", async () => {
  const { st, xi } = sim({ tree: s => (s.down ? null : kidsWith([frameT])) });
  st.y = 300;
  await assert.rejects(dragText(mkCtx(xi), dragArgs), e => e.kind === "stuck" && /读不到测试窗口在叠放顺序里的位置/.test(e.message));
  assert.equal(ups(st).length, 0);
  held.current = null;
});
