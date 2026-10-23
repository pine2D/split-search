// 真实输入手势（xdotool / XTEST）：公共部分与拖文字（右键菜单、地址栏在 gesture-ui.mjs）。每个手势：防干扰检查 → 窗口断言 → 执行 → 读回校验，
// 失败抛带原因的 Error（kind：skip 不重试直接跳过 / env 环境问题可重试、最后仍不行判跳过 / stuck 可能有按键卡住 / 其余判失败）。
// WSLg 事实（progress.md Task 2 裁定）：XWayland 的指针焦点跟着用户真实的 Windows 光标走。光标不在测试窗口上时，
// XTEST 移动后指针仍报 root（或用户自己的窗口），所以移动前先确认光标停在测试窗口里，绝不移动/劫持真实光标去“找”窗口。
// 依赖经 ctx.gx 注入：{ xi, root（X 根窗口 id）, sleep, profileDir }；held 记录按下未松开的键，供中断时清理。
import { execFileSync } from "node:child_process";
import { selectionCenter } from "./screen.mjs";
import { PROFILE_DIR } from "./config.mjs";

export const REASON_CURSOR = "光标不在测试窗口上";
export const REASON_BUSY = "检测到用户在操作鼠标";
export const REASON_STUCK = "可能有按键卡住";
export const CURSOR_GUIDE = "请把鼠标光标停在测试浏览器窗口里，然后别动";

export function gestureError(kind, msg) { const e = new Error(msg); e.kind = kind; return e; }
const realSleep = ms => new Promise(r => setTimeout(r, ms));
const stopped = ctx => !!(ctx.signal?.aborted || ctx.abortSignal?.aborted);
const checkStop = ctx => { if (stopped(ctx)) throw new Error("手势执行中步骤被中断"); };

// 按下未松开的鼠标键（全进程只有一个手势在跑）：{ origin, guard }（guard：见 dropGuard）
export const held = { current: null };

// 防干扰：静止采样指针两次（相隔 sampleMs，不动鼠标）。位置变了等 waitMs 再采，连续 tries 次都在变 → "busy"
export async function idle(xi, { sleep = realSleep, sampleMs = 300, waitMs = 3000, tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    const a = await xi.pointer();
    await sleep(sampleMs);
    const b = await xi.pointer();
    if (a.x === b.x && a.y === b.y) return "ok";
    if (i < tries - 1) await sleep(waitMs);
  }
  return "busy";
}

export const deps = ctx => {
  const gx = ctx.gx;
  if (!gx?.xi) throw new Error("ctx.gx 未配置（xinput 不可用时不应执行 xauto 步骤）");
  return { sleep: realSleep, profileDir: PROFILE_DIR, ...gx };
};
export const pidOf = ctx => ctx.browser.proc.pid;

// 光标是否停在测试窗口（wids 之一）里。不在：向导卡片 + 终端提示，最多等 waitMs，仍不在 → kind "skip"
export async function cursorHome(ctx, wids, { waitMs = 30000, intervalMs = 500 } = {}) {
  const { xi, root, sleep } = deps(ctx);
  const where = p => (p.window === root ? "光标在桌面或其他 Windows 应用上" : `光标在别的窗口（${p.window}）上`);
  let p = await xi.pointer();
  if (wids.includes(p.window)) return p;
  const msg = `${CURSOR_GUIDE}（${where(p)}；最多等 ${Math.round(waitMs / 1000)} 秒，之后跳过这一步）`;
  ctx.log?.(`  ${REASON_CURSOR}：${msg}`);
  ctx.guide?.setStep?.({ title: `${REASON_CURSOR}`, instruction: msg, buttons: [] });
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    checkStop(ctx);
    await sleep(intervalMs);
    p = await xi.pointer();
    if (wids.includes(p.window)) { ctx.guide?.setStep?.({ title: "自动操作中", instruction: "请保持鼠标不动。", buttons: [] }); return p; }
  }
  throw gestureError("skip", `${REASON_CURSOR}（${where(p)}，等了 ${Math.round(waitMs / 1000)} 秒）`);
}

// 鼠标手势前：先确认光标在测试窗口里（不动鼠标），再确认用户没在动鼠标
export async function readyMouse(ctx, wid) {
  const { xi, sleep } = deps(ctx);
  await cursorHome(ctx, [wid], ctx.gx.cursorOpts);
  if ((await idle(xi, { sleep, ...ctx.gx.idleOpts })) === "busy") throw gestureError("skip", REASON_BUSY);
}

// 移动并读回位置：与命令不符（用户在动鼠标或被别的窗口截走）即中止
export async function moveTo(xi, x, y) {
  await xi.move(x, y);
  const p = await xi.pointer();
  // 读回不符多半是用户在动鼠标（真实光标经过 WSLg 窗口会改 X 指针）：干扰，判环境问题（重试，最后仍这样判跳过）
  if (p.x !== x || p.y !== y) throw gestureError("env", `移动后读回的指针位置 ${p.x},${p.y} 与命令 ${x},${y} 不符（用户可能在动鼠标），已中止`);
  return p;
}
// 指针下的窗口不是测试窗口时，说明它是谁（是否属于测试 Chrome、大小位置），便于区分拖拽图像/落点箭头这类自家浮层与别的应用
async function describeWindow(xi, w, pid, wid) {
  if (!pid || !/^\d+$/.test(w)) return "";
  const ours = sameClient(w, wid) || (await xi.pidWindows(pid).then(ws => ws.includes(w), () => null));
  const r = await xi.windowRect(w).catch(() => null);
  return `；窗口 ${w} ${ours === null ? "归属未知" : ours ? "属于测试 Chrome" : "不属于测试 Chrome"}${r ? `，${r.width}x${r.height}+${r.x}+${r.y}` : ""}`;
}
// 不在测试窗口上：指针在根窗口（下面什么都没有）多半是坐标算错，判失败；被别的窗口盖住是环境干扰，判 env
export async function moveToIn(xi, x, y, wid, what, pid, root) {
  const p = await moveTo(xi, x, y);
  if (p.window !== String(wid)) {
    throw gestureError(root && p.window === root ? "fail" : "env",
      `${what}不在测试窗口上（指针在窗口 ${p.window}，期望 ${wid}${await describeWindow(xi, p.window, pid, wid)}），已中止`);
  }
  return p;
}

// 拖拽中 Chrome 会在指针下放一个跟着走的拖拽图像窗口（XDND 反馈：测试 Chrome 自己的窗口，大小≈选区；实测 408x86），
// 这时 getmouselocation 报的是它，看不到下面的测试窗口，字面的“窗口 === 测试窗口”在落点永远不成立。所以：
// 1) 按下前先把指针移到落点预检，最上层必须是测试窗口（这时还没有拖拽图像）；
// 2) 按下后只接受测试窗口，或认定的拖拽图像窗口（按下后才出现、属于测试 Chrome、大小与选区相符），
//    并且屏幕上不能冒出别的应用的新窗口（它可能盖住落点）——两条都满足才松开。
// “属于测试 Chrome”：带它的 _NET_WM_PID，或与测试窗口是同一个 X 客户端连接（窗口 id 的客户端位相同；拖拽用的辅助窗口
// 没有 _NET_WM_PID，实测 0xC00027 与测试窗口 0xC00003 同属 0xC00000）。客户端位按最小的掩码 0x3FFFF 算（XWayland
// -maxclients 最大 2048），宁可把自家窗口误判成别人的（中止），也不会把别人的认成自家的
const CLIENT_SPAN = 0x40000;
export const sameClient = (a, b) => /^\d+$/.test(String(a)) && /^\d+$/.test(String(b))
  && Math.floor(Number(a) / CLIENT_SPAN) === Math.floor(Number(b) / CLIENT_SPAN);
async function oursSet(xi, pid, wid) {
  const byPid = new Set(await xi.pidWindows(pid));
  return w => byPid.has(w) || sameClient(w, wid);
}

function dropGuard(xi, { pid, wid, sel, before }) {
  const g = { image: null, before, pid, wid: String(wid) };
  const isImage = async w => {
    if (before.has(w) || !(await oursSet(xi, pid, wid))(w)) return false;
    const r = await xi.windowRect(w).catch(() => null);
    return !!r && Math.abs(r.width - sel.w) <= sel.w * 0.15 + 12 && Math.abs(r.height - sel.h) <= sel.h * 0.3 + 12;
  };
  g.check = async (p, what) => {
    if (p.window !== g.wid) {
      if (!g.image && (await isImage(p.window))) g.image = p.window;
      if (p.window !== g.image) {
        throw gestureError("env", `${what}不在测试窗口上（指针在窗口 ${p.window}，期望 ${wid}${await describeWindow(xi, p.window, pid, wid)}），已中止`);
      }
    }
    const ours = await oursSet(xi, pid, wid);
    const foreign = (await xi.visibleWindows()).filter(w => !before.has(w) && !ours(w));
    if (foreign.length) throw gestureError("env", `拖拽期间屏幕上出现了别的应用的新窗口（${foreign.join(",")}），可能盖住落点，已中止`);
  };
  return g;
}

// 已按下时中止：回到拖拽起点（按下前确认过是测试窗口）、按同样的规则核对后在原处松开（取消拖拽）。
// 只核对窗口不核对精确位置（用户在动鼠标时差几像素），试 3 次；核对不了 → stuck，按键保持按下（绝不在别的窗口上松开）
async function cancelHeld(xi, sleep) {
  const h = held.current;
  if (!h) return "none";
  for (let i = 0; i < 3; i++) {
    try {
      await xi.move(h.origin.x, h.origin.y);
      await h.guard.check(await xi.pointer(), "拖拽起点");
      await xi.up(1);
      held.current = null;
      return "released";
    } catch { await sleep(200); }
  }
  return "stuck";
}

// 卡住之后再试着松开（光标回到测试窗口里、别的新窗口消失时才会成功）
export const releaseHeld = ctx => cancelHeld(deps(ctx).xi, deps(ctx).sleep);

// 浏览器关闭之后仍按着（卡住且一直没能松开）：测试窗口已不在了，只有指针停在根窗口上（下面没有任何 X 应用）
// 才原地松开，否则不动它，返回 "stuck" 由调用方提示
export async function releaseAfterClose(xi, root) {
  if (!held.current) return "none";
  const p = await xi.pointer().catch(() => null);
  if (!p || p.window !== root) return "stuck";
  await xi.up(1, { expectWindow: root });
  held.current = null;
  return "released";
}

// 第二次 Ctrl+C 时同步的尽力清理：规则同 cancelHeld（起点是测试窗口或已认定的拖拽图像，且没有别的应用的新窗口）
export function releaseHeldSync({ env = process.env } = {}) {
  const h = held.current;
  if (!h) return "none";
  try {
    const x = (...a) => execFileSync("xdotool", a.map(String), { env, timeout: 2000, encoding: "utf8" });
    const list = (...a) => { try { return x("search", ...a).split("\n").filter(Boolean); } catch { return []; } };
    x("mousemove", h.origin.x, h.origin.y);
    const win = /WINDOW=(\d+)/.exec(x("getmouselocation", "--shell"))?.[1];
    if (win !== h.guard.wid && win !== h.guard.image) return "stuck";
    const ours = new Set(list("--all", "--pid", h.guard.pid, "--onlyvisible", "--name", ""));
    if (list("--onlyvisible", "--name", "").some(w => !h.guard.before.has(w) && !ours.has(w) && !sameClient(w, h.guard.wid))) return "stuck";
    x("mouseup", 1);
    held.current = null;
    return "released";
  } catch { return "stuck"; }
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// 选中 fromTargetId 页面里的 text，拖到屏幕坐标 to（标签栏上的落点由调用方实测）。wid：手势前取好的测试窗口 id
export async function dragText(ctx, { fromTargetId, text, to, wid, steps = 25, stepMs = 25, dwellMs = 300 }) {
  const { xi, sleep, root } = deps(ctx);
  if (!wid) throw new Error("dragText 需要事先取好的测试窗口 id");
  const pid = pidOf(ctx);
  await readyMouse(ctx, wid);
  const sel = await selectionCenter(ctx.browser, fromTargetId, text);
  const from = { x: sel.x, y: sel.y };
  checkStop(ctx);
  await moveToIn(xi, to.x + 1, to.y, wid, "落点（按下前预检）", pid, root);
  await moveToIn(xi, from.x, from.y, wid, "选区起点", pid, root);
  const guard = dropGuard(xi, { pid, wid, sel, before: new Set(await xi.visibleWindows()) });
  await guard.check(await xi.pointer(), "选区起点");
  await xi.down(1, { expectWindow: wid }); // 断言紧挨着按下，中间不 sleep
  held.current = { origin: from, guard };
  try {
    await sleep(150);
    for (let i = 1; i <= 4; i++) { checkStop(ctx); await moveTo(xi, from.x + 3 * i, from.y + 2 * i); await sleep(30); } // 越过拖拽阈值
    const sx = from.x + 12, sy = from.y + 8;
    for (let i = 1; i <= steps; i++) {
      checkStop(ctx);
      await moveTo(xi, lerp(sx, to.x, i / steps), lerp(sy, to.y, i / steps));
      await sleep(stepMs);
    }
    await sleep(dwellMs);
    checkStop(ctx);
    await guard.check(await moveTo(xi, to.x + 1, to.y), "落点");
    await xi.up(1); // 上一行刚核对完，中间不 sleep
    held.current = null;
  } catch (e) {
    const r = await cancelHeld(xi, sleep);
    if (r === "stuck") throw gestureError("stuck", `${REASON_STUCK}：拖拽中止后没能在测试窗口里的起点松开，左键可能仍按着（${e.message}）`);
    throw Object.assign(e, { message: `${e.message}；已回到起点松开（取消拖拽）` });
  }
  await sleep(400);
  return { from, to, dragImage: guard.image };
}
