// xauto 步骤（真实输入 + 自动判定）的公共部分：步骤构造、重试（每次完整重建现场，最多重试 2 次并记下第几次）、
// 测试窗口定位（页面标题 token → X 窗口 id，手势前取好、手势中不再找）、固定窗口尺寸、网站搜索专用条目、ASCII 校验。
// xauto 步骤形状：{ id, title, kind: "xauto", fallback: <assist/judge 步骤>, run }，xinput 不可用时由 selectSteps 换成 fallback。
import { sleep, evalIn, nonce } from "./util.mjs";
import { REASON_STUCK, held, releaseHeld } from "../gesture.mjs";
import { measureTab } from "../screen.mjs";

export const WIN_W = 1600, WIN_H = 1000;
const ASCII_RE = /^[\x20-\x7e]+$/;
export function assertAscii(s) {
  if (typeof s !== "string" || !ASCII_RE.test(s)) throw new Error(`xauto 只用 ASCII 关键词与查询：${JSON.stringify(String(s)).slice(0, 60)}`);
  return s;
}

// 模拟引擎 A|B 的专用网站搜索（ctx.se 只接受 sse2e 前缀）；T14 的真实引擎用 sse2e-<引擎 id>
export const mockEntry = port => ({ keyword: "sse2e", name: "sse2e", url: `http://engine-a.localhost:${port}/search?q=%s&_ss=ea,eb` });

// 把默认引擎设成专用条目（设置页在单独的后台窗口里，会抢走 X 前台：键盘手势要在这之后再新开窗口拿前台）
export async function useDefault(ctx, entry) {
  await ctx.se.ensure(entry);
  await ctx.se.makeDefault(entry.keyword);
}

// 固定为 normal 1600×1000（每次都检查，重启或用户动过窗口后也能恢复）
export async function fixWindow(ctx, targetId) {
  const { client } = ctx.browser;
  const { windowId, bounds } = await client.send("Browser.getWindowForTarget", { targetId });
  if (bounds.windowState !== "normal") await client.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  if (bounds.width !== WIN_W || bounds.height !== WIN_H) {
    await client.send("Browser.setWindowBounds", { windowId, bounds: { width: WIN_W, height: WIN_H } });
    await sleep(400);
  }
}

// 页面标题设成一次性 token，按标题找到它所在的 X 窗口（同一进程、WM_CLASS 含测试配置路径），唯一才返回
export async function testWindow(ctx, targetId, { timeoutMs = 4000 } = {}) {
  const token = `sse2e-win-${nonce()}${nonce()}`;
  await evalIn(ctx, targetId, `document.title = ${JSON.stringify(token)}; true`);
  const end = Date.now() + timeoutMs;
  for (;;) {
    const wid = await ctx.gx.xi.findWindowByTitle(ctx.browser.proc.pid, token, ctx.gx.profileDir);
    if (wid) return wid;
    if (Date.now() >= end) throw Object.assign(new Error("按页面标题找不到测试窗口（X 窗口标题没更新或不唯一）"), { kind: "env" });
    await sleep(150);
  }
}

// 激活 tabId 并测它在标签栏上的 [L,R]；之后把 backTo 标签切回前台（拖拽的选区在它的页面里）
export async function tabSpan(ctx, wid, tabId, backTo) {
  const m = await measureTab(ctx.browser, ctx.ext, wid, tabId, { xi: ctx.gx.xi });
  if (backTo !== undefined) {
    await ctx.ext.eval(`chrome.tabs.update(${backTo}, { active: true }).then(() => true)`);
    await sleep(300);
  }
  if (!m.rect) throw Object.assign(new Error(`标签栏测量不到唯一的当前标签区段（找到 ${m.segments.length} 段），环境不支持，不猜坐标`), { kind: "env" });
  return { L: m.rect[0], R: m.rect[1], y: m.y };
}

const stoppedCtx = ctx => !!(ctx.signal?.aborted || ctx.abortSignal?.aborted);

// 按键可能卡住：停掉剩余 xauto 步骤，请用户在测试窗口里点一下；期间光标回到测试窗口就由脚本在起点松开
async function stuckGuide(ctx) {
  ctx.gx.stop = REASON_STUCK;
  const msg = `${REASON_STUCK}：拖拽中途中止，脚本没能在测试窗口里松开鼠标左键。请把光标移到测试浏览器窗口里点一下鼠标左键。剩余的 xauto 步骤全部跳过。`;
  ctx.log?.(`  ${msg}`);
  ctx.guide?.setStep?.({ title: REASON_STUCK, instruction: msg, buttons: [] });
  const end = Date.now() + 30000;
  while (held.current && Date.now() < end && !stoppedCtx(ctx)) {
    await sleep(500);
    await releaseHeld(ctx).catch(() => {});
  }
  return held.current ? "按键可能仍按着" : "之后光标回到测试窗口，已在起点松开";
}

// 最多 max 次（每次 attempt(n) 都自己完整重建现场）。返回值：pass/skip 直接用；fail 或抛错 → 重试；
// 抛错 kind：skip（光标不在、用户在动鼠标）不重试；env（环境不支持、拿不到前台、被别的窗口干扰）重试；stuck → 停掉剩余 xauto 步骤。
// 裁定 I2：只要有一次尝试是真实失败（不是 env），这一步就判失败——之后的 env/skip 不能把它吞成跳过；
// 只有全部失败都是 env（或在任何真实失败之前就 skip）才判跳过。之后某次通过仍判通过（detail 记下之前的失败，作为不稳定信号）。
// final(r)：返回 true 的失败是确定结论（如 T14 的预期降级），不再重试。detail 第一行写明第几次尝试
export async function withAttempts(ctx, attempt, { max = 3, final = () => false } = {}) {
  const fails = [];
  let real = false;
  const prev = () => (fails.length ? `（之前：${fails.join("；")}）` : "");
  const realFail = (n, why) => ({ status: "fail", detail: `第 ${n} 次尝试${why}，但之前有真实失败${prev()}`, attempt: n });
  for (let n = 1; n <= max; n++) {
    if (ctx.gx?.stop) {
      const why = `${ctx.gx.stop}，剩余 xauto 步骤已停止`;
      return real ? realFail(n, `没做（${why}）`) : { status: "skip", detail: why };
    }
    let r;
    try { r = await attempt(n); }
    catch (e) {
      if (stoppedCtx(ctx)) throw e;
      if (e.kind === "skip") {
        if (real) return realFail(n, `跳过（${e.message}）`);
        return { status: "skip", detail: `跳过：${e.message}（第 ${n} 次尝试）${prev()}`, attempt: n, reason: e.message };
      }
      if (e.kind === "stuck") {
        const after = await stuckGuide(ctx);
        return { status: "fail", detail: `${e.message}；${after}（第 ${n} 次尝试）${prev()}`, attempt: n };
      }
      r = { status: "fail", detail: e.message, env: e.kind === "env" };
    }
    if (r.status === "skip" && real) return realFail(n, `跳过（${r.detail}）`);
    if (r.status === "pass" || r.status === "skip" || final(r)) {
      const verb = { pass: "通过", skip: "跳过", fail: "失败" }[r.status];
      return { ...r, detail: `第 ${n} 次尝试${verb}${prev()}：${r.detail}`, attempt: n };
    }
    if (!r.env) real = true;
    fails.push(`第 ${n} 次${r.env ? "（环境）" : ""} ${r.detail.split("\n")[0]}`);
  }
  return real ? { status: "fail", detail: `${max} 次尝试都没成功\n${fails.join("\n")}`, attempt: max }
    : { status: "skip", detail: `${max} 次尝试都没成功（都是环境干扰）\n${fails.join("\n")}`, attempt: max };
}

// 构造 xauto 步骤：timeoutMs 固定（与 --timeout 无关：手势本身不等人，只有光标提示最多等 30 秒/次）
export function xauto(def, fallback) {
  if (!fallback || fallback.id !== def.id) throw new Error(`xauto 步骤 ${def.id} 的回退步骤不对`);
  // 不带 cleanup：脚本自己建的 sse2e 条目和默认引擎在收尾时自动恢复，不需要用户动手
  return { needs: [], timeoutMs: 240000, ...def, kind: "xauto", fallback };
}
