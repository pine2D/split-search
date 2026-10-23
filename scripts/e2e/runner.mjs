// 步骤执行器：逐个执行，异常/超时记为 fail 并附诊断（assist 步骤被跳过时也附），收到中断后剩余步骤记为 skip。
// 说明与诊断里的网址先脱敏（report.mjs 的 redact），再写进结果、终端和向导页
import { redact, redactDeep } from "./report.mjs";
const STATUSES = new Set(["pass", "fail", "skip"]);
const ABORTED = "中断";

export function formatDiag(state) {
  const lines = ["诊断（当前浏览器状态）："];
  for (const w of state.windows || []) lines.push(`窗口 ${w.id} ${w.type}${w.focused ? " 聚焦" : ""}`);
  for (const t of state.tabs || []) {
    lines.push(`  标签 ${t.id} 窗口=${t.windowId} 位置=${t.index} split=${t.splitViewId ?? "-"} 固定=${t.pinned ? "是" : "否"} 组=${t.groupId} ${t.status ?? ""} ${redact(t.url) || "(网址不可读)"}`);
  }
  lines.push(`  DNR 规则 ${(state.rules || []).length} 条`);
  return lines.join("\n");
}

async function diagnose(ctx) {
  if (!ctx.ext?.state) return { text: "诊断：无（未提供 state）" };
  try {
    const state = await withTimeout(ctx.ext.state(), 10000, "读取状态超时");
    return { text: formatDiag(state), state };
  } catch (e) {
    return { text: `诊断：无法读取状态：${e.message}` };
  }
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

// 超时/中断后等步骤自己收尾的上限：步骤的 guarded 清理可能还在写 storage，
// 不能让下一步（或 run.mjs 的快照恢复）与它并发，否则恢复后的用户配置会被模拟数据覆盖
export const SETTLE_MS = 15000;

export async function runSteps(steps, ctx, { timeoutMs, settleMs = SETTLE_MS } = {}) {
  const results = [];
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

    let status, detail;
    if (outcome.kind === "abort") { status = "skip"; detail = `${ABORTED}（步骤执行中${why() ? "；" + why() : ""}）`; }
    else if (outcome.kind === "timeout") { status = "fail"; detail = `超时（${limit} ms 内未完成）`; }
    else if (outcome.kind === "error") { status = "fail"; detail = `异常：${outcome.error?.message ?? outcome.error}`; }
    else {
      const v = outcome.value;
      if (!v || typeof v !== "object" || !STATUSES.has(v.status)) {
        status = "fail"; detail = `步骤返回值不合法：${JSON.stringify(v)}`;
      } else { status = v.status; detail = String(v.detail ?? ""); }
    }
    if (unsettled) detail += `；步骤在 ${settleMs} ms 收尾期限内仍未结束，已不再等待`;
    detail = redact(detail);

    const result = { ...base, status, detail, durationMs: Date.now() - started };
    // assist 步骤被跳过（用户点“跳过”或条件不满足）也附上当时的状态，便于事后判断为什么做不下去
    const wantDiag = status === "fail" || (status === "skip" && step.kind === "assist");
    if (wantDiag && !abortSignal?.aborted && !stopped()) {
      const d = await diagnose(ctx);
      result.detail = `${detail}\n${d.text}`;
      if (d.state) result.diag = redactDeep(d.state);
    }
    results.push(result);
    log(`  ${status === "pass" ? "✔ 通过" : status === "fail" ? "✘ 失败" : "↷ 跳过"}（${(result.durationMs / 1000).toFixed(1)}s）${detail ? "：" + detail.split("\n")[0] : ""}`);
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
