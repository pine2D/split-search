// 真实输入手势（xdotool / XTEST）：公共部分与拖文字（右键菜单、地址栏在 gesture-ui.mjs）。每个手势：防干扰检查 → 窗口断言 → 执行 → 读回校验，
// 失败抛带原因的 Error（kind：skip 不重试直接跳过 / env 环境干扰可重试 / stuck 可能有按键卡住 / 其余判失败；步骤层的判定见 xauto-lib withAttempts）。
// 松开前的核对规则（拖拽图像、外来窗口、前台、叠放顺序）与按键清理在 gesture-guard.mjs。
// WSLg 事实（progress.md Task 2 裁定）：XWayland 的指针焦点跟着用户真实的 Windows 光标走。光标不在测试窗口上时，
// XTEST 移动后指针仍报 root（或用户自己的窗口），所以移动前先确认光标停在测试窗口里，绝不移动/劫持真实光标去“找”窗口。
// 嵌套显示（ctx.gx.nested：Xephyr/Xvfb，spec 2026-10-24）：指针不是用户的光标，不等“光标回家”，脚本自己把指针移进测试窗口；
// 拖拽用更慢的节奏（NESTED_DRAG）。读回不符、被拉回同一点两道防护照旧（用户光标停在 Xephyr 窗口上时，真实移动会被转发进来）。
// 依赖经 ctx.gx 注入：{ xi, root（X 根窗口 id）, sleep, profileDir, nested }；held 记录按下未松开的键，供中断时清理。
import { selectionCenter } from "./screen.mjs";
import { PROFILE_DIR } from "./config.mjs";
import { gestureError, held, describeWindow, dropGuard, guardSnapshot, cancelHeld, REASON_STUCK } from "./gesture-guard.mjs";

export { gestureError, held, sameClient, releaseAfterClose, releaseHeldSync, REASON_STUCK } from "./gesture-guard.mjs";

export const REASON_CURSOR = "光标不在测试窗口上";
export const REASON_BUSY = "检测到用户在操作鼠标";
export const CURSOR_GUIDE = "请把鼠标光标停在测试浏览器窗口里，然后别动";
// 读回连续两次被拉到同一个点（±SNAP_PX）：WSLg 在真实鼠标有任何物理移动（手搭在鼠标上、触摸板误触）时把 X 指针同步回
// 真实光标位置（progress.md Task 4 I4 实测 557,371、780,689）。和“用户在动鼠标”分开报，向导页提示把手拿开
export const REASON_SNAP = "指针被拉回真实光标位置（请把手从鼠标/触摸板上拿开）";
export const SNAP_GUIDE = "移动后的指针被拉回了真实光标所在的位置：WSLg 下手只要碰到鼠标或触摸板，X 指针就会同步回真实光标。"
  + "请把光标停在测试浏览器窗口里，然后把手从鼠标/触摸板上拿开，脚本会自动重试。";
// 嵌套模式的同一现象：用户光标停在 Xephyr 窗口上，真实移动被转发进嵌套显示，把指针带走
export const REASON_SNAP_NESTED = "指针被用户光标带走（请把光标移出测试窗口 Xephyr）";
export const SNAP_GUIDE_NESTED = "移动后的指针被你的光标带走了：光标停在 Xephyr 窗口上时，你的鼠标移动会被转发给测试浏览器。"
  + "请把光标移出 Xephyr 窗口，脚本会自动重试。";
// Xvfb 不可见、用户光标进不去：同一现象只能是脚本这边的问题（多半坐标被夹到屏幕边），不提示用户做什么
export const REASON_SNAP_XVFB = "指针两次被夹回同一点（Xvfb 不可见，不是你的光标造成的，多半是坐标在屏幕外）";
export const SNAP_GUIDE_XVFB = "移动后的指针两次停在同一个与命令不符的位置。Xvfb 嵌套显示不可见，你的鼠标影响不到它，不需要你做什么，脚本会自动重试。";
// nested：false（host）| "xvfb" | 其他真值（"xephyr"，或单测里的 true）
export const snapReason = nested => (nested === "xvfb" ? REASON_SNAP_XVFB : nested ? REASON_SNAP_NESTED : REASON_SNAP);
export const snapGuide = nested => (nested === "xvfb" ? SNAP_GUIDE_XVFB : nested ? SNAP_GUIDE_NESTED : SNAP_GUIDE);
export const isSnap = detail => [REASON_SNAP, REASON_SNAP_NESTED, REASON_SNAP_XVFB].some(r => String(detail).startsWith(r));
const SNAP_PX = 3, SNAP_MS = 10 * 60 * 1000;
// 上一次读回不符时读到的位置（全进程只有一个手势在跑；跨尝试保留，成功的读回不清掉它）
export const snap = { last: null };
export function snapBack(p, now = Date.now()) {
  const l = snap.last;
  snap.last = { x: p.x, y: p.y, at: now };
  return !!l && now - l.at <= SNAP_MS && Math.abs(l.x - p.x) <= SNAP_PX && Math.abs(l.y - p.y) <= SNAP_PX;
}

const realSleep = ms => new Promise(r => setTimeout(r, ms));
const stopped = ctx => !!(ctx.signal?.aborted || ctx.abortSignal?.aborted);
const checkStop = ctx => { if (stopped(ctx)) throw new Error("手势执行中步骤被中断"); };


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

// 嵌套模式：把指针移到测试窗口中心（没有窗口管理器、没有装饰，getwindowgeometry 的 Position 可信），读回核对；
// 指针不在测试窗口上（被别的窗口盖住、算错）→ env，调用方不会按下
async function pointerHome(ctx, wid) {
  const { xi } = deps(ctx);
  const pid = ctx.browser?.proc?.pid;
  const r = await xi.windowRect(wid);
  if (!Number.isInteger(r.x) || !Number.isInteger(r.y)) throw gestureError("env", `读不到测试窗口 ${wid} 的位置，未移动指针`);
  const x = r.x + Math.floor(r.width / 2), y = r.y + Math.floor(r.height / 2);
  if (x < 0 || y < 0) throw gestureError("env", `测试窗口中心 ${x},${y} 在屏幕外，未移动指针`);
  // 不走 moveTo：读回不符不计入 snapBack（坐标被夹回屏幕内时不能误报成“被用户光标带走”）
  await xi.move(x, y);
  const p = await xi.pointer();
  if (p.x !== x || p.y !== y) throw gestureError("env", `指针移到测试窗口中心 ${x},${y} 后读回 ${p.x},${p.y}（中心可能在屏幕外或窗口位置算错），未按下`);
  if (p.window !== String(wid)) {
    throw gestureError("env", `指针移到测试窗口中心 ${x},${y} 后不在测试窗口上（在窗口 ${p.window}，期望 ${wid}${await describeWindow(xi, p.window, pid, wid)}），未按下`);
  }
  return p;
}

// 光标是否停在测试窗口（wids 之一）里。不在：向导卡片 + 终端提示，最多等 waitMs，仍不在 → kind "skip"。
// 嵌套模式不等用户：直接把指针移进 wids[0] 的中心（pointerHome）
export async function cursorHome(ctx, wids, { waitMs = 30000, intervalMs = 500 } = {}) {
  const { xi, root, sleep, nested } = deps(ctx);
  if (nested) return pointerHome(ctx, wids[0]);
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
// 返回确认过的光标位置 home（moveToIn 遇到 root 时用它复查）
export async function readyMouse(ctx, wid) {
  const { xi, sleep } = deps(ctx);
  await cursorHome(ctx, [wid], ctx.gx.cursorOpts);
  if ((await idle(xi, { sleep, ...ctx.gx.idleOpts })) === "busy") throw gestureError("skip", REASON_BUSY);
  const p = await xi.pointer();
  return { x: p.x, y: p.y };
}

// 移动并读回位置：与命令不符（用户在动鼠标或被别的窗口截走）即中止
// nested：读回被拉回同一点时用嵌套模式的原因文案
export async function moveTo(xi, x, y, { nested = false } = {}) {
  await xi.move(x, y);
  const p = await xi.pointer();
  // 读回不符多半是用户在动鼠标（真实光标经过 WSLg 窗口会改 X 指针）：干扰，判环境问题（重试，最后仍这样判跳过）；
  // 连续两次被拉到同一个点 → 手搭在鼠标上，单独的原因
  if (p.x !== x || p.y !== y) {
    if (snapBack(p)) throw gestureError("env", `${snapReason(nested)}：移动后读回 ${p.x},${p.y}，与命令 ${x},${y} 不符，且和上一次不符时读回的位置相同，已中止`);
    throw gestureError("env", `移动后读回的指针位置 ${p.x},${p.y} 与命令 ${x},${y} 不符（用户可能在动鼠标），已中止`);
  }
  return p;
}
// 不在测试窗口上：被别的窗口盖住是环境干扰（env）。指针在根窗口上有歧义（Task 2：真实光标离开 WSLg 窗口后，XTEST 移动
// 也只报 root）：回到 readyMouse 时确认过的光标位置 home 复查（不碰真实光标，只动 X 指针）——那里也成了 root 说明光标被移走了，
// 判 skip（光标不在测试窗口上）；home 仍是测试窗口说明是这个坐标落在窗口外，多半算错，判失败
export async function moveToIn(xi, x, y, wid, what, { pid, root, home, nested } = {}) {
  const p = await moveTo(xi, x, y, { nested });
  if (p.window === String(wid)) return p;
  const msg = `${what}不在测试窗口上（指针在窗口 ${p.window}，期望 ${wid}${await describeWindow(xi, p.window, pid, wid)}），已中止`;
  if (!root || p.window !== root) throw gestureError("env", msg);
  if (home) {
    await xi.move(home.x, home.y);
    const h = await xi.pointer();
    if (h.window !== String(wid)) {
      // 嵌套模式的指针不是用户的光标：回到中心也不在测试窗口上，是被别的窗口盖住了
      if (nested) throw gestureError("env", `${msg}；回到测试窗口中心 ${home.x},${home.y} 也不在测试窗口上（在窗口 ${h.window}）`);
      throw gestureError("skip", `${REASON_CURSOR}（拖拽前光标被移出了测试窗口）`);
    }
  }
  throw gestureError("fail", msg);
}

// 卡住之后再试着松开（光标回到测试窗口里、别的窗口不再在上面时才会成功）
export const releaseHeld = ctx => cancelHeld(deps(ctx).xi, deps(ctx).sleep);

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// 嵌套模式的拖拽节奏（2026-10-24 在 Xephyr 上实测，spec §3）：按下后停 300ms，每步之间 60–100ms，松开前停留 800ms；
// 按 host 的快节奏（按下后 150ms、每步 30–50ms）有一次没能开始拖拽。Xvfb 用同一组值
export const NESTED_DRAG = Object.freeze({ downMs: 300, stepMinMs: 60, stepMaxMs: 100, dwellMs: 800 });
// 每步的间隔：区间内随机（rand 可注入，便于单测）
export const nestedStepMs = (rand = Math.random) => NESTED_DRAG.stepMinMs + Math.round(rand() * (NESTED_DRAG.stepMaxMs - NESTED_DRAG.stepMinMs));

// 选中 fromTargetId 页面里的 text，拖到屏幕坐标 to（标签栏上的落点由调用方实测）。wid：手势前取好的测试窗口 id。
// 嵌套模式忽略 stepMs/dwellMs，用 NESTED_DRAG
export async function dragText(ctx, { fromTargetId, text, to, wid, steps = 25, stepMs = 25, dwellMs = 300 }) {
  const { xi, sleep, root, nested, rand } = deps(ctx);
  if (!wid) throw new Error("dragText 需要事先取好的测试窗口 id");
  const t = nested ? { downMs: NESTED_DRAG.downMs, thresholdMs: () => nestedStepMs(rand), stepMs: () => nestedStepMs(rand), dwellMs: NESTED_DRAG.dwellMs }
    : { downMs: 150, thresholdMs: () => 30, stepMs: () => stepMs, dwellMs };
  const mv = (x, y) => moveTo(xi, x, y, { nested });
  const pid = pidOf(ctx);
  const home = await readyMouse(ctx, wid);
  const sel = await selectionCenter(ctx.browser, fromTargetId, text);
  const from = { x: sel.x, y: sel.y };
  checkStop(ctx);
  // 外来窗口快照在落点预检之前取：预检之后才冒出来的窗口也算“新”的
  const snap = await guardSnapshot(xi, { wid, root });
  await moveToIn(xi, to.x + 1, to.y, wid, "落点（按下前预检）", { pid, root, home, nested });
  await moveToIn(xi, from.x, from.y, wid, "选区起点", { pid, root, home, nested });
  const guard = await dropGuard(xi, { pid, wid, sel, snap });
  await guard.check(await xi.pointer(), "选区起点");
  await xi.down(1, { expectWindow: wid }); // 断言紧挨着按下，中间不 sleep
  held.current = { origin: from, guard };
  try {
    await sleep(t.downMs);
    for (let i = 1; i <= 4; i++) { checkStop(ctx); await mv(from.x + 3 * i, from.y + 2 * i); await sleep(t.thresholdMs()); } // 越过拖拽阈值
    const sx = from.x + 12, sy = from.y + 8;
    for (let i = 1; i <= steps; i++) {
      checkStop(ctx);
      await mv(lerp(sx, to.x, i / steps), lerp(sy, to.y, i / steps));
      await sleep(t.stepMs());
    }
    await sleep(t.dwellMs);
    checkStop(ctx);
    await guard.check(await mv(to.x + 1, to.y), "落点");
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
