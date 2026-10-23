// 拖拽的“能不能松开”核对与按键清理（gesture.mjs 用）。
// 拖拽中 Chrome 会在指针下放一个跟着走的拖拽图像窗口（XDND 反馈：测试 Chrome 自己的窗口，大小≈选区；实测 408x86），
// getmouselocation 报的是它，看不到下面是谁（Task 4 裁定接受这项细化）。所以松开前要同时满足（裁定 I1）：
// 1) 指针下是测试窗口，或认定的拖拽图像窗口（按下后才出现、属于测试 Chrome、大小与选区相符）；
// 2) 屏幕上没有冒出别的应用的新窗口（快照在落点预检之前取）；
// 3) 前台窗口没有变成别的应用的窗口（WSLg 下窗口被提到上层通常伴随激活）；
// 4) 能读到根窗口的 _NET_CLIENT_LIST_STACKING（xprop）时：没有别的应用的窗口被提到测试窗口上面。读不到就只靠 3)。
// 任何一条不满足：不在落点松开，回起点按同样的规则核对后松开；起点也不行 → stuck，按键保持按下。
import { execFileSync } from "node:child_process";
import { parseStacking } from "./xinput.mjs";

export const REASON_STUCK = "可能有按键卡住";
export function gestureError(kind, msg) { const e = new Error(msg); e.kind = kind; return e; }

// 按下未松开的鼠标键（全进程只有一个手势在跑）：{ origin, guard }
export const held = { current: null };

// “属于测试 Chrome”：带它的 _NET_WM_PID，或与测试窗口是同一个 X 客户端连接（窗口 id 的客户端位相同；拖拽用的辅助窗口
// 没有 _NET_WM_PID，实测 0xC00027 与测试窗口 0xC00003 同属 0xC00000）。客户端位按最小的掩码 0x3FFFF 算（XWayland
// -maxclients 最大 2048），宁可把自家窗口误判成别人的（中止），也不会把别人的认成自家的
const CLIENT_SPAN = 0x40000;
export const sameClient = (a, b) => /^\d+$/.test(String(a)) && /^\d+$/.test(String(b))
  && Math.floor(Number(a) / CLIENT_SPAN) === Math.floor(Number(b) / CLIENT_SPAN);
async function oursFn(xi, pid, wid) {
  const byPid = new Set(await xi.pidWindows(pid));
  return w => byPid.has(w) || sameClient(w, wid);
}

// 指针下的窗口不是测试窗口时，说明它是谁（是否属于测试 Chrome、大小位置）
export async function describeWindow(xi, w, pid, wid) {
  if (!pid || !/^\d+$/.test(w)) return "";
  const ours = sameClient(w, wid) || (await xi.pidWindows(pid).then(ws => ws.includes(w), () => null));
  const r = await xi.windowRect(w).catch(() => null);
  return `；窗口 ${w} ${ours === null ? "归属未知" : ours ? "属于测试 Chrome" : "不属于测试 Chrome"}${r ? `，${r.width}x${r.height}+${r.x}+${r.y}` : ""}`;
}

// 叠放顺序里排在测试窗口上面的窗口（stack：从下到上；测试窗口不在列表里 → null，无法判断）
export function above(stack, wid) {
  const i = stack.indexOf(String(wid));
  return i < 0 ? null : stack.slice(i + 1);
}

// 落点预检之前调用：屏幕上已有的可见窗口
export async function guardSnapshot(xi) {
  return { before: new Set(await xi.visibleWindows()) };
}

// 按下前（指针已在起点）调用：再记下前台窗口与叠放顺序
export async function dropGuard(xi, { pid, wid, sel, snap }) {
  const g = { image: null, before: snap.before, pid, wid: String(wid) };
  g.active0 = await xi.activeWindow();
  g.stack0 = xi.stacking ? await xi.stacking() : null;
  const above0 = g.stack0 && above(g.stack0, wid);
  g.above0 = above0 ? new Set(above0) : null;
  const isImage = async (w, ours) => {
    if (g.before.has(w) || !ours(w)) return false;
    const r = await xi.windowRect(w).catch(() => null);
    return !!r && Math.abs(r.width - sel.w) <= sel.w * 0.15 + 12 && Math.abs(r.height - sel.h) <= sel.h * 0.3 + 12;
  };
  g.check = async (p, what) => {
    const ours = await oursFn(xi, pid, wid);
    if (p.window !== g.wid) {
      if (!g.image && (await isImage(p.window, ours))) g.image = p.window;
      if (p.window !== g.image) {
        throw gestureError("env", `${what}不在测试窗口上（指针在窗口 ${p.window}，期望 ${wid}${await describeWindow(xi, p.window, pid, wid)}），已中止`);
      }
    }
    const foreign = (await xi.visibleWindows()).filter(w => !g.before.has(w) && !ours(w));
    if (foreign.length) throw gestureError("env", `拖拽期间屏幕上出现了别的应用的新窗口（${foreign.join(",")}），可能盖住落点，已中止`);
    const act = await xi.activeWindow();
    if (act && act !== g.active0 && !ours(act)) throw gestureError("env", `拖拽期间前台换成了别的应用的窗口（${act}），它可能被提到了测试窗口上面，已中止`);
    if (g.above0) {
      const stack = await xi.stacking();
      const now = stack && above(stack, wid);
      if (!now) throw gestureError("env", "拖拽期间读不到测试窗口的叠放位置（_NET_CLIENT_LIST_STACKING），无法确认上面没有别的窗口，已中止");
      const raised = now.filter(w => !g.above0.has(w) && !ours(w));
      if (raised.length) throw gestureError("env", `拖拽期间别的应用的窗口（${raised.join(",")}）被提到了测试窗口上面，已中止`);
    }
  };
  return g;
}

// 已按下时中止：回到拖拽起点（按下前确认过是测试窗口）、按同样的规则核对后在原处松开（取消拖拽）。
// 只核对窗口不核对精确位置（用户在动鼠标时差几像素），试 3 次；核对不了 → stuck，按键保持按下（绝不在别的窗口上松开）
export async function cancelHeld(xi, sleep) {
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

// 第二次 Ctrl+C 时同步的尽力清理：规则同 cancelHeld（指针下是测试窗口或已认定的拖拽图像、没有别的应用的新窗口、
// 前台没换成别的应用、叠放顺序里没有别的应用被提上来）。exec 可注入，便于单测
export function releaseHeldSync({ env = process.env, exec = execFileSync } = {}) {
  const h = held.current;
  if (!h) return "none";
  const g = h.guard;
  try {
    const x = (...a) => exec("xdotool", a.map(String), { env, timeout: 2000, encoding: "utf8" });
    const list = (...a) => { try { return String(x("search", ...a)).split("\n").filter(Boolean); } catch { return []; } };
    x("mousemove", h.origin.x, h.origin.y);
    const win = /WINDOW=(\d+)/.exec(x("getmouselocation", "--shell"))?.[1];
    if (win !== g.wid && win !== g.image) return "stuck";
    const byPid = new Set(list("--all", "--pid", g.pid, "--onlyvisible", "--name", ""));
    const ours = w => byPid.has(w) || sameClient(w, g.wid);
    if (list("--onlyvisible", "--name", "").some(w => !g.before.has(w) && !ours(w))) return "stuck";
    let act = null;
    try { act = String(x("getactivewindow")).trim(); } catch { act = null; }
    if (act && act !== g.active0 && !ours(act)) return "stuck";
    if (g.above0) {
      const out = String(exec("xprop", ["-root", "_NET_CLIENT_LIST_STACKING"], { env, timeout: 2000, encoding: "utf8" }));
      const now = above(parseStacking(out) ?? [], g.wid);
      if (!now || now.some(w => !g.above0.has(w) && !ours(w))) return "stuck";
    }
    x("mouseup", 1);
    held.current = null;
    return "released";
  } catch { return "stuck"; }
}
