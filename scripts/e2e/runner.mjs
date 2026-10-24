// 步骤执行器：逐个执行，异常/超时记为 fail 并附诊断（assist 步骤被跳过时也附），收到中断后剩余步骤记为 skip。
// 说明与诊断里的网址先脱敏（report.mjs 的 redact），再写进结果、终端和向导页
import { redact, redactDeep } from "./report.mjs";
import { collectCdp, formatCdp, tabSuffix } from "./diag.mjs";
// degrade：预期降级（T14 引擎的 SW 接管导航，按 G5 退化为普通左侧搜索），单独计数，不算失败
const STATUSES = new Set(["pass", "fail", "skip", "degrade"]);
const LOG_STATUS = { pass: "✔ 通过", fail: "✘ 失败", skip: "↷ 跳过", degrade: "↘ 预期降级" };
const ABORTED = "中断";

// 每步开始时向导页显示的卡片（无按钮）：auto 步骤提示别动浏览器（restarts 的步骤预告重启），xauto 提示把光标停在窗口里，
// 等人的步骤先显示“准备中”，说明由步骤自己随后给出。否则向导页会停在上一个人工步骤的说明和按钮上。
// nested（嵌套显示）：xauto 的指针不是用户的光标。Xephyr 只提醒别把光标停在 Xephyr 窗口上；Xvfb 不可见，什么都不用做
export const NESTED_XAUTO_CARD = "自动操作中，请不要把光标停在 Xephyr 窗口上";
export const XVFB_XAUTO_CARD = "自动操作在不可见的嵌套显示里进行，可以照常使用电脑";
export function startCard(step, { nested = false } = {}) {
  const title = `${step.id} ${step.title}`;
  if (step.kind === "auto") {
    return { title: `${title}（自动执行中）`, buttons: [],
      instruction: "脚本正在自动操作测试浏览器，请不要点击或切换标签，等这一步结束。"
        + (step.restarts ? "\n这一步会关闭并重新打开测试浏览器（恢复上次会话），窗口消失再出现属正常现象，不要按 Ctrl+C。" : "") };
  }
  if (step.kind === "xauto" && nested === "xvfb") {
    return { title: `${title}（自动操作中）`, buttons: [], instruction: `${XVFB_XAUTO_CARD}。脚本自己移动嵌套显示里的指针，等这一步结束即可。` };
  }
  if (step.kind === "xauto" && nested) {
    return { title: `${title}（自动操作中）`, buttons: [],
      instruction: `${NESTED_XAUTO_CARD}（Xephyr 会把你的鼠标移动转发给测试浏览器，手势会中止重来）。脚本自己移动测试显示里的指针，你可以照常使用电脑。` };
  }
  if (step.kind === "xauto") {
    return { title: `${title}（自动操作中）`, buttons: [],
      instruction: "脚本正在用真实的鼠标和键盘自动操作测试浏览器（会新开窗口、拖动文字、右键、在地址栏输入）。\n"
        + "请把鼠标光标停在测试浏览器窗口里，然后把手从鼠标/触摸板上拿开，不要碰鼠标键盘，等这一步结束"
        + "（WSLg 下手一碰鼠标，X 指针就会被拉回真实光标位置，手势会中止重来）。光标不在窗口里时这里会提示，等不到就跳过这一步。" };
  }
  return { title, buttons: [], instruction: "脚本正在准备这一步（整理标签），说明马上出现在这里。请先不要操作测试浏览器。" };
}

// cdp：diag.mjs 的 collectCdp 结果（可缺）。整段文字脱敏
export function formatDiag(state, cdp = null) {
  const lines = ["诊断（当前浏览器状态）："];
  for (const w of state.windows || []) lines.push(`窗口 ${w.id} ${w.type}${w.focused ? " 聚焦" : ""}`);
  for (const t of state.tabs || []) {
    lines.push(`  标签 ${t.id} 窗口=${t.windowId} 位置=${t.index} split=${t.splitViewId ?? "-"} 固定=${t.pinned ? "是" : "否"} 组=${t.groupId} ${t.status ?? ""} ${t.url || "(网址不可读)"}${tabSuffix(cdp, t)}`);
  }
  if (state.rules) lines.push(`  DNR 规则 ${state.rules.length} 条`);
  lines.push(...formatCdp(cdp));
  return redact(lines.join("\n"));
}

// 扩展状态与 CDP 目标各自读取：扩展读不到（停用、设置页打不开）时仍给出 CDP 目标和导航记录
async function diagnose(ctx) {
  if (!ctx.ext?.state) return { text: "诊断：无（未提供 state）" };
  let state = null, err = null, cdp = null;
  try { state = await withTimeout(ctx.ext.state(), 10000, "读取状态超时"); }
  catch (e) { err = e.message; }
  if (ctx.browser?.client) {
    cdp = await withTimeout(collectCdp(ctx, state), 15000, "读取 CDP 目标超时").catch(e => ({ error: e.message }));
  }
  const text = state ? formatDiag(state, cdp) : redact([`诊断：无法读取状态（扩展）：${err}`, ...formatCdp(cdp)].join("\n"));
  return { text, state: state || cdp ? { ...(state ?? {}), ...(cdp ? { cdp } : {}) } : null };
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

// 超时/中断后等步骤自己收尾的上限：步骤的 guarded 清理可能还在写 storage，
// 不能让下一步（或 run.mjs 的快照恢复）与它并发，否则恢复后的用户配置会被模拟数据覆盖
export const SETTLE_MS = 15000;

// results：可传入一个数组，运行器边跑边往里写（第二次 Ctrl+C 时 run.mjs 用它同步写部分报告）
export async function runSteps(steps, ctx, { timeoutMs, settleMs = SETTLE_MS, results = [] } = {}) {
  const total = steps.length;
  const log = ctx.log || (() => {});
  const abortSignal = ctx.abortSignal;
  ctx.guide?.setProgress?.(0, total);

  // run.mjs 以字符串作为中断原因（如“收到 SIGINT”“测试浏览器已退出”），写进说明
  const why = () => (typeof abortSignal?.reason === "string" ? abortSignal.reason : "");
  // ctx.stopReason()：浏览器已不可用（如重启失败）时返回原因；当前步骤照常记失败，剩余步骤跳过
  const stopped = () => ctx.stopReason?.() || null;
  for (const step of steps) {
    const base = { id: step.id, title: step.title, kind: step.kind };
    if (abortSignal?.aborted) {
      results.push({ ...base, status: "skip", detail: why() ? `${ABORTED}（${why()}）` : ABORTED, durationMs: 0 });
      continue;
    }
    if (stopped()) {
      results.push({ ...base, status: "skip", detail: `${ABORTED}（${stopped()}）`, durationMs: 0 });
      continue;
    }
    // timeoutFactor：assist/judge 步骤要等人（可能有多个子项、会重试），上限按单步超时的倍数放宽
    // timeoutExtraMs：步骤里有授权申请这类固定时长的等待（GRANT_TIMEOUT_MS），再加上它
    const limit = step.timeoutMs ?? (timeoutMs ?? ctx.timeoutMs ?? 120000) * (step.timeoutFactor ?? 1) + (step.timeoutExtraMs ?? 0);
    const stepAbort = new AbortController();
    const started = Date.now();
    log(`▶ ${step.id} ${step.title}`);
    ctx.onStepStart?.(step);
    ctx.guide?.setStep?.(startCard(step, { nested: ctx.gx?.nested ?? false }));

    let timer, onAbort;
    const running = Promise.resolve()
      .then(() => step.run({ ...ctx, signal: stepAbort.signal }))
      .then(value => ({ kind: "value", value }), error => ({ kind: "error", error }));
    const outcome = await new Promise(resolve => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), limit);
      onAbort = () => resolve({ kind: "abort" });
      abortSignal?.addEventListener("abort", onAbort, { once: true });
      running.then(resolve);
    });
    clearTimeout(timer);
    abortSignal?.removeEventListener("abort", onAbort);
    let unsettled = false;
    if (outcome.kind === "timeout" || outcome.kind === "abort") {
      stepAbort.abort();
      // 有上限地等步骤真正结束：到点仍未结束就不再等（guarded 看到 signal 已中断会跳过写回）
      let t2;
      const settled = await Promise.race([running.then(() => true), new Promise(r => { t2 = setTimeout(() => r(false), settleMs); })]);
      clearTimeout(t2);
      unsettled = !settled;
    }

    let status, detail, uncovered = null;
    if (outcome.kind === "abort") { status = "skip"; detail = `${ABORTED}（步骤执行中${why() ? "；" + why() : ""}）`; }
    else if (outcome.kind === "timeout") { status = "fail"; detail = `超时（${limit} ms 内未完成）`; }
    else if (outcome.kind === "error") { status = "fail"; detail = `异常：${outcome.error?.message ?? outcome.error}`; }
    else {
      const v = outcome.value;
      if (!v || typeof v !== "object" || !STATUSES.has(v.status)) {
        status = "fail"; detail = `步骤返回值不合法：${JSON.stringify(v)}`;
      } else { status = v.status; detail = String(v.detail ?? ""); uncovered = Array.isArray(v.uncovered) && v.uncovered.length ? v.uncovered : null; }
    }
    if (unsettled) detail += `；步骤在 ${settleMs} ms 收尾期限内仍未结束，已不再等待`;
    detail = redact(detail);

    const result = { ...base, status, detail, durationMs: Date.now() - started };
    // 子项里的跳过/预期降级（summarize 给出），报告的“未覆盖”小节逐条列出
    if (uncovered) result.uncovered = redactDeep(uncovered);
    // assist 步骤被跳过（用户点“跳过”或条件不满足）也附上当时的状态，便于事后判断为什么做不下去
    // noDiag：跳过是正常情况的步骤（B1 在扩展早已安装时），不附诊断
    const wantDiag = status === "fail" || (status === "skip" && step.kind === "assist" && !step.noDiag);
    if (wantDiag && !abortSignal?.aborted && !stopped()) {
      const d = await diagnose(ctx);
      result.detail = `${detail}\n${d.text}`;
      if (d.state) result.diag = redactDeep(d.state);
    }
    results.push(result);
    log(`  ${LOG_STATUS[status]}（${(result.durationMs / 1000).toFixed(1)}s）${detail ? "：" + detail.split("\n")[0] : ""}`);
    ctx.guide?.setResult?.(step.id, status, result.detail);
    ctx.guide?.setProgress?.(results.length, total);
    // afterStep（run.mjs 的授权/启用恢复检查）：不受单步超时限制，无论步骤结果如何、是否超时都执行；
    // 整次运行已被中断（Ctrl+C、浏览器退出）时不再执行，由下次运行的一次性授权检查兜底
    if (ctx.afterStep && !abortSignal?.aborted) {
      try { await ctx.afterStep(step, result); }
      catch (e) { log(`  步骤后的恢复检查出错：${e.message}`); }
    }
  }
  return results;
}
