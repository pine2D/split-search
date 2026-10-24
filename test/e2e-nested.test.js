// 嵌套显示（Xephyr / Xvfb，没有窗口管理器）下的手势层：焦点查询退回 getwindowfocus、脚本自己把指针移进测试窗口、
// 慢节奏拖拽、新窗口点一下拿焦点、按模式区分的文案（plan 2026-10-24 Task 2）
import { test } from "node:test";
import assert from "node:assert/strict";
import { createXinput } from "../scripts/e2e/xinput.mjs";
import {
  cursorHome, readyMouse, dragText, moveTo, snap, held, NESTED_DRAG, nestedStepMs,
  REASON_SNAP, REASON_SNAP_NESTED, SNAP_GUIDE_NESTED, gestureError,
} from "../scripts/e2e/gesture.mjs";
import { omnibox } from "../scripts/e2e/gesture-ui.mjs";
import { newFocusedWindow } from "../scripts/e2e/screen.mjs";
import { releaseHeldSync } from "../scripts/e2e/gesture-guard.mjs";
import { withAttempts } from "../scripts/e2e/steps/xauto-lib.mjs";
import { startCard, NESTED_XAUTO_CARD } from "../scripts/e2e/runner.mjs";

const ROOT = "1080", WID = "12582915", OTHER = "4194409";
const NO_EWMH = "Your windowmanager claims not to support _NET_ACTIVE_WINDOW, so the attempt to query the active window aborted.\nxdo_get_active_window reported an error";
const noEwmhErr = () => Object.assign(new Error(`Command failed: xdotool getactivewindow\n${NO_EWMH}`), { code: 1, stdout: "", stderr: NO_EWMH });

// 假嵌套显示：指针起点在根窗口上（Xvfb 刚起来时用户光标根本不在这里）；测试窗口 rect 由 getwindowgeometry 报
function sim({ windowAt = (x, y) => (x >= 15 && y >= 0 ? WID : ROOT), focus = () => WID, active = null, windows = () => [WID] } = {}) {
  const st = { x: 0, y: 0, down: false, calls: [], clicks: [] };
  const exec = async (cmd, args) => {
    st.calls.push([cmd, ...args]);
    if (cmd === "xwininfo") {
      if (args[0] === "-root") return `  Parent window id: 0x0 (none)\n     0x${Number(WID).toString(16)} "t": ()  2399x1499+15+0  +15+0\n`;
      return args[2] === "-children" ? `  Parent window id: 0x${Number(ROOT).toString(16)}\n` : "  Map State: IsViewable\n";
    }
    if (cmd !== "xdotool") throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
    const [c, ...r] = args;
    switch (c) {
      case "mousemove": st.x = Number(r[0]); st.y = Number(r[1]); return "";
      case "getmouselocation": return `X=${st.x}\nY=${st.y}\nSCREEN=0\nWINDOW=${windowAt(st.x, st.y, st)}\n`;
      case "getwindowgeometry": return `Window ${r[0]}\n  Position: 15,0 (screen: 0)\n  Geometry: 2399x1499\n`;
      case "mousedown": st.down = true; return "";
      case "mouseup": st.down = false; return "";
      case "click": st.clicks.push([st.x, st.y]); return "";
      case "getactivewindow": if (active) return `${active(st)}\n`; throw noEwmhErr();
      case "getwindowfocus": return `${focus(st)}\n`;
      case "search": return `${windows(st).join("\n")}\n`;
      case "key": case "type": case "keyup": return "";
      default: throw new Error(`未预设：xdotool ${c}`);
    }
  };
  return { st, xi: createXinput({ exec, env: { DISPLAY: ":90" } }) };
}

// 假 browser：选区在屏幕 (200,170)；新窗口页面度量 inner 1600×900、无偏移、dpr 1 → 页面中心 (800,550)
function fakeBrowser({ onCreate } = {}) {
  const sent = [];
  return {
    sent, proc: { pid: 4242 },
    attach: async () => "S",
    evaluate: async (sid, expr) => (expr.includes("__e2e_sel")
      ? { x: 100, y: 50, w: 200, h: 40, sel: JSON.parse(/const text = (".*?");/.exec(expr)[1]), iw: 1600, ih: 900 }
      : { screenX: 0, screenY: 0, outerWidth: 1600, innerWidth: 1600, outerHeight: 1000, innerHeight: 900, dpr: 1 }),
    client: { send: async (m, p) => { sent.push([m, p]); if (m === "Target.createTarget") { onCreate?.(); return { targetId: "T" }; } return {}; } },
  };
}
const mkCtx = (xi, { nested = true, sleeps, rand, browser } = {}) => ({
  browser: browser ?? fakeBrowser(), log: () => {},
  gx: { xi, root: ROOT, nested, rand, sleep: async ms => { sleeps?.push(ms); }, profileDir: "/p", idleOpts: { sampleMs: 0, waitMs: 0 }, cursorOpts: { waitMs: 20, intervalMs: 1 } },
});

// ---- activeWindow：getactivewindow 不支持 → getwindowfocus，缓存在实例上 ----
test("activeWindow: 报不支持 _NET_ACTIVE_WINDOW → 改用 getwindowfocus，之后不再试 getactivewindow", async () => {
  const { st, xi } = sim({ focus: () => "777" });
  assert.equal(xi.focusMode(), "getactivewindow");
  assert.equal(await xi.activeWindow(), "777");
  assert.equal(xi.focusMode(), "getwindowfocus");
  assert.equal(await xi.activeWindow(), "777");
  assert.deepEqual(st.calls.map(c => c[1]), ["getactivewindow", "getwindowfocus", "getwindowfocus"]);
  await xi.assertActive("777");
  await assert.rejects(xi.assertActive("778"), /前台窗口不是测试窗口/);
});

test("activeWindow: 其他报错只这一次退回 getwindowfocus；getactivewindow 正常时不碰 getwindowfocus", async () => {
  let fail = true;
  const { st, xi } = sim({ active: () => { if (fail) throw Object.assign(new Error("Command failed"), { code: 1, stdout: "" }); return "55"; }, focus: () => "66" });
  assert.equal(await xi.activeWindow(), "66");
  assert.equal(xi.focusMode(), "getactivewindow");
  fail = false;
  assert.equal(await xi.activeWindow(), "55");
  assert.deepEqual(st.calls.map(c => c[1]), ["getactivewindow", "getwindowfocus", "getactivewindow"]);
});

test("activeWindow: getwindowfocus 也失败（焦点是 PointerRoot）→ null", async () => {
  const { xi } = sim({ focus: () => { throw Object.assign(new Error("BadWindow"), { code: 1 }); } });
  assert.equal(await xi.activeWindow(), null);
});

test("releaseHeldSync: getactivewindow 报错时用 getwindowfocus 核对前台", () => {
  const calls = [];
  const exec = (cmd, a) => {
    calls.push(a[0]);
    if (a[0] === "getmouselocation") return `X=1\nY=1\nWINDOW=${WID}\n`;
    if (a[0] === "search") return `${WID}\n`;
    if (a[0] === "getactivewindow") throw noEwmhErr();
    if (a[0] === "getwindowfocus") return `${OTHER}\n`;
    return "";
  };
  held.current = { origin: { x: 1, y: 1 }, guard: { wid: WID, image: null, pid: 1, before: new Set([WID]), active0: WID, tree: null, above0: null } };
  assert.equal(releaseHeldSync({ exec }), "stuck"); // 前台换成了别的应用的窗口：不松开
  assert.ok(calls.includes("getwindowfocus"));
  assert.equal(calls.includes("mouseup"), false);
  held.current = null;
});

// ---- 指针：nested 不等用户光标，直接移进测试窗口中心 ----
test("cursorHome nested: 指针在根窗口上也不等待、不出提示卡片，直接移到测试窗口中心并核对", async () => {
  const { st, xi } = sim();
  const cards = [];
  const ctx = { ...mkCtx(xi), guide: { setStep: s => cards.push(s) } };
  const p = await cursorHome(ctx, [WID], { waitMs: 60000 });
  assert.deepEqual([p.x, p.y, p.window], [15 + 1199, 749, WID]);
  assert.deepEqual(cards, []);
  assert.equal(st.calls.filter(c => c[1] === "getmouselocation").length, 1, "移动之前不读指针、不等");
});

test("readyMouse nested: 中心不在测试窗口上（被盖住）→ env，不按下", async () => {
  const { st, xi } = sim({ windowAt: () => OTHER });
  await assert.rejects(readyMouse(mkCtx(xi), WID), e => e.kind === "env" && /测试窗口中心 1214,749/.test(e.message));
  await assert.rejects(dragText(mkCtx(xi), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID }), e => e.kind === "env");
  assert.equal(st.calls.some(c => c[1] === "mousedown" || c[1] === "click"), false);
});

test("cursorHome host: 行为不变——光标不在测试窗口上就等待，不移动指针", async () => {
  const { st, xi } = sim({ windowAt: () => ROOT });
  await assert.rejects(cursorHome(mkCtx(xi, { nested: false }), [WID], { waitMs: 10, intervalMs: 1 }), e => e.kind === "skip");
  assert.equal(st.calls.some(c => c[1] === "mousemove"), false);
});

// ---- 拖拽节奏 ----
const sleepsAround = st => st.calls.findIndex(c => c[1] === "mousedown");
test("dragText nested: 按下后停 300ms，每步 60–100ms，松开前停留 800ms", async () => {
  for (const [rand, step] of [[() => 0, 60], [() => 1, 100], [() => 0.5, 80]]) {
    const { st, xi } = sim();
    const sleeps = [];
    await dragText(mkCtx(xi, { sleeps, rand }), { fromTargetId: "T", text: "abc def", to: { x: 500, y: 20 }, wid: WID, steps: 3, stepMs: 0, dwellMs: 0 });
    assert.ok(sleepsAround(st) > 0);
    assert.equal(st.down, false);
    // 4 次越过阈值 + 3 步路径，都用区间内的间隔；首尾是按下后的停顿与松开前的停留；最后 400 是松开后的等待
    // 开头的 0 是 idle 的静止采样（单测里 sampleMs 为 0）
    assert.deepEqual(sleeps, [0, NESTED_DRAG.downMs, ...Array(7).fill(step), NESTED_DRAG.dwellMs, 400]);
  }
  assert.deepEqual({ ...NESTED_DRAG }, { downMs: 300, stepMinMs: 60, stepMaxMs: 100, dwellMs: 800 });
  for (let i = 0; i < 50; i++) { const v = nestedStepMs(); assert.ok(v >= 60 && v <= 100, String(v)); }
});

test("dragText host: 节奏不变（150 / 30 / stepMs / dwellMs）", async () => {
  const { xi } = sim({ windowAt: () => WID });
  const sleeps = [];
  await dragText(mkCtx(xi, { nested: false, sleeps }), { fromTargetId: "T", text: "abc", to: { x: 500, y: 20 }, wid: WID, steps: 2, stepMs: 25, dwellMs: 300 });
  assert.deepEqual(sleeps, [0, 150, 30, 30, 30, 30, 25, 25, 300, 400]);
});

// ---- newFocusedWindow：焦点没过去就点一下 ----
// 新窗口在 createTarget 之后出现、closeTarget 之后消失
const twoWindows = b => () => (b.sent.some(s => s[0] === "Target.createTarget") && !b.sent.some(s => s[0] === "Target.closeTarget") ? ["10", "20"] : ["10"]);

test("newFocusedWindow nested: 焦点不在新窗口 → 在页面中心点一下（先断言指针在新窗口上）→ 拿到焦点", async () => {
  const b = fakeBrowser();
  const { st, xi } = sim({ windows: twoWindows(b), windowAt: () => "20", focus: s => (s.clicks.length ? "20" : "10") });
  const r = await newFocusedWindow(b, "http://x/", { xi, nested: true, timeoutMs: 1000, intervalMs: 1, clickAfterMs: 0 });
  assert.equal(r.wid, "20");
  assert.deepEqual(r.clicked, { x: 800, y: 550 });
  assert.deepEqual(st.clicks, [[800, 550]]);
  const ci = st.calls.findIndex(c => c[1] === "click");
  assert.equal(st.calls[ci - 1][1], "getmouselocation", "点击前紧挨着核对指针所在窗口");
});

test("newFocusedWindow nested: 指针不在新窗口上 → 不点，关掉新窗口并抛错", async () => {
  const b = fakeBrowser();
  const { st, xi } = sim({ windows: twoWindows(b), windowAt: () => "10", focus: () => "10" });
  await assert.rejects(newFocusedWindow(b, "http://x/", { xi, nested: true, timeoutMs: 1000, intervalMs: 1, clickAfterMs: 0 }), /指针不在测试窗口上/);
  assert.deepEqual(st.clicks, []);
  assert.ok(b.sent.some(([m]) => m === "Target.closeTarget"));
});

test("newFocusedWindow nested: 点过之后仍拿不到焦点 → 抛错写明点过，只点一次", async () => {
  const b = fakeBrowser();
  const { st, xi } = sim({ windows: twoWindows(b), windowAt: () => "20", focus: () => "10" });
  await assert.rejects(newFocusedWindow(b, "http://x/", { xi, nested: true, timeoutMs: 80, intervalMs: 1, clickAfterMs: 0 }),
    e => /新窗口未获得前台（已在页面中心 800,550 点过一下）/.test(e.message));
  assert.equal(st.clicks.length, 1);
  assert.ok(b.sent.some(([m]) => m === "Target.closeTarget"));
});

test("newFocusedWindow host: 焦点不在新窗口也不点击", async () => {
  const b = fakeBrowser();
  const { st, xi } = sim({ windows: twoWindows(b), windowAt: () => "20", active: () => "10" });
  await assert.rejects(newFocusedWindow(b, "http://x/", { xi, timeoutMs: 60, intervalMs: 1, clickAfterMs: 0 }), { message: "新窗口未获得前台" });
  assert.deepEqual(st.clicks, []);
});

test("omnibox nested: 新窗口点过仍没焦点 → env，一个键都不按", async () => {
  const b = fakeBrowser();
  const { st, xi } = sim({ windows: twoWindows(b), windowAt: () => "20", focus: () => "10" });
  const ctx = mkCtx(xi, { browser: b });
  ctx.gx.focusOpts = { timeoutMs: 80, intervalMs: 1, clickAfterMs: 0 };
  await assert.rejects(omnibox(ctx, { text: "xkw abc", url: "http://x/" }), e => e.kind === "env" && /嵌套显示里新窗口没拿到焦点/.test(e.message) && /未按任何键/.test(e.message));
  assert.equal(st.clicks.length, 1);
  assert.equal(st.calls.some(c => c[1] === "key" || c[1] === "type"), false);
});

// ---- 文案 ----
test("moveTo: 被拉回同一点——nested 写“被用户光标带走”，host 文案不变", async () => {
  const back = { x: 9, y: 9 };
  const { xi } = sim({ windowAt: () => WID });
  const pin = () => { xi.move = async () => {}; xi.pointer = async () => ({ ...back, window: WID }); };
  pin();
  snap.last = null;
  await assert.rejects(moveTo(xi, 100, 100, { nested: true }), e => e.kind === "env" && !e.message.startsWith(REASON_SNAP_NESTED));
  await assert.rejects(moveTo(xi, 100, 100, { nested: true }), e => e.message.startsWith(`${REASON_SNAP_NESTED}：`));
  await assert.rejects(moveTo(xi, 100, 100), e => e.message.startsWith(`${REASON_SNAP}：`));
  snap.last = null;
  assert.equal(REASON_SNAP_NESTED, "指针被用户光标带走（请把光标移出测试窗口 Xephyr）");
  assert.equal(REASON_SNAP, "指针被拉回真实光标位置（请把手从鼠标/触摸板上拿开）");
});

test("withAttempts nested: 被带走时向导页提示把光标移出 Xephyr 窗口", async () => {
  const cards = [];
  const ctx = { gx: { nested: true }, guide: { setStep: s => cards.push(s) }, log: () => {} };
  const r = await withAttempts(ctx, async n => {
    if (n === 1) throw gestureError("env", `${REASON_SNAP_NESTED}：移动后读回 9,9`);
    return { status: "pass", detail: "ok" };
  });
  assert.equal(r.status, "pass");
  assert.equal(cards[0].title, REASON_SNAP_NESTED);
  assert.equal(cards[0].instruction, SNAP_GUIDE_NESTED);
  assert.match(SNAP_GUIDE_NESTED, /把光标移出 Xephyr 窗口/);
});

test("startCard: nested 的 xauto 卡片写“请不要把光标停在 Xephyr 窗口上”；host 不变；其他种类不受影响", () => {
  const step = { id: "T3", title: "拖拽", kind: "xauto" };
  const n = startCard(step, { nested: true });
  assert.equal(NESTED_XAUTO_CARD, "自动操作中，请不要把光标停在 Xephyr 窗口上");
  assert.ok(n.instruction.startsWith(NESTED_XAUTO_CARD));
  assert.doesNotMatch(n.instruction, /把手从鼠标/);
  assert.deepEqual(startCard(step), startCard(step, { nested: false }));
  assert.match(startCard(step).instruction, /光标停在测试浏览器窗口里/);
  const auto = { id: "B2", title: "x", kind: "auto" };
  assert.deepEqual(startCard(auto, { nested: true }), startCard(auto));
});
