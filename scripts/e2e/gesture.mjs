// 真实输入手势（xdotool / XTEST）：公共部分与拖文字（右键菜单、地址栏在 gesture-ui.mjs）。每个手势：防干扰检查 → 窗口断言 → 执行 → 读回校验，
// 失败抛带原因的 Error（kind：skip 不重试直接跳过 / env 环境干扰可重试 / stuck 可能有按键卡住 / 其余判失败；步骤层的判定见 xauto-lib withAttempts）。
// 松开前的核对规则（拖拽图像、外来窗口、前台、叠放顺序）与按键清理在 gesture-guard.mjs。
// WSLg 事实（progress.md Task 2 裁定）：XWayland 的指针焦点跟着用户真实的 Windows 光标走。光标不在测试窗口上时，
// XTEST 移动后指针仍报 root（或用户自己的窗口），所以移动前先确认光标停在测试窗口里，绝不移动/劫持真实光标去“找”窗口。
// 依赖经 ctx.gx 注入：{ xi, root（X 根窗口 id）, sleep, profileDir }；held 记录按下未松开的键，供中断时清理。
import { selectionCenter } from "./screen.mjs";
import { PROFILE_DIR } from "./config.mjs";
import { gestureError, held, describeWindow, dropGuard, guardSnapshot, cancelHeld, REASON_STUCK } from "./gesture-guard.mjs";

export { gestureError, held, sameClient, releaseAfterClose, releaseHeldSync, REASON_STUCK } from "./gesture-guard.mjs";

export const REASON_CURSOR = "光标不在测试窗口上";
export const REASON_BUSY = "检测到用户在操作鼠标";
export const CURSOR_GUIDE = "请把鼠标光标停在测试浏览器窗口里，然后别动";

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
// 返回确认过的光标位置 home（moveToIn 遇到 root 时用它复查）
export async function readyMouse(ctx, wid) {
  const { xi, sleep } = deps(ctx);
  await cursorHome(ctx, [wid], ctx.gx.cursorOpts);
  if ((await idle(xi, { sleep, ...ctx.gx.idleOpts })) === "busy") throw gestureError("skip", REASON_BUSY);
  const p = await xi.pointer();
  return { x: p.x, y: p.y };
}

// 移动并读回位置：与命令不符（用户在动鼠标或被别的窗口截走）即中止
export async function moveTo(xi, x, y) {
  await xi.move(x, y);
  const p = await xi.pointer();
  // 读回不符多半是用户在动鼠标（真实光标经过 WSLg 窗口会改 X 指针）：干扰，判环境问题（重试，最后仍这样判跳过）
  if (p.x !== x || p.y !== y) throw gestureError("env", `移动后读回的指针位置 ${p.x},${p.y} 与命令 ${x},${y} 不符（用户可能在动鼠标），已中止`);
  return p;
}
// 不在测试窗口上：被别的窗口盖住是环境干扰（env）。指针在根窗口上有歧义（Task 2：真实光标离开 WSLg 窗口后，XTEST 移动
// 也只报 root）：回到 readyMouse 时确认过的光标位置 home 复查（不碰真实光标，只动 X 指针）——那里也成了 root 说明光标被移走了，
// 判 skip（光标不在测试窗口上）；home 仍是测试窗口说明是这个坐标落在窗口外，多半算错，判失败
export async function moveToIn(xi, x, y, wid, what, { pid, root, home } = {}) {
  const p = await moveTo(xi, x, y);
  if (p.window === String(wid)) return p;
  const msg = `${what}不在测试窗口上（指针在窗口 ${p.window}，期望 ${wid}${await describeWindow(xi, p.window, pid, wid)}），已中止`;
  if (!root || p.window !== root) throw gestureError("env", msg);
  if (home) {
    await xi.move(home.x, home.y);
    const h = await xi.pointer();
    if (h.window !== String(wid)) throw gestureError("skip", `${REASON_CURSOR}（拖拽前光标被移出了测试窗口）`);
  }
  throw gestureError("fail", msg);
}

// 卡住之后再试着松开（光标回到测试窗口里、别的窗口不再在上面时才会成功）
export const releaseHeld = ctx => cancelHeld(deps(ctx).xi, deps(ctx).sleep);

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// 选中 fromTargetId 页面里的 text，拖到屏幕坐标 to（标签栏上的落点由调用方实测）。wid：手势前取好的测试窗口 id
export async function dragText(ctx, { fromTargetId, text, to, wid, steps = 25, stepMs = 25, dwellMs = 300 }) {
  const { xi, sleep, root } = deps(ctx);
  if (!wid) throw new Error("dragText 需要事先取好的测试窗口 id");
  const pid = pidOf(ctx);
  const home = await readyMouse(ctx, wid);
  const sel = await selectionCenter(ctx.browser, fromTargetId, text);
  const from = { x: sel.x, y: sel.y };
  checkStop(ctx);
  // 外来窗口快照在落点预检之前取：预检之后才冒出来的窗口也算“新”的
  const snap = await guardSnapshot(xi);
  await moveToIn(xi, to.x + 1, to.y, wid, "落点（按下前预检）", { pid, root, home });
  await moveToIn(xi, from.x, from.y, wid, "选区起点", { pid, root, home });
  const guard = await dropGuard(xi, { pid, wid, sel, snap });
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
