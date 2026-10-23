// 步骤执行器：逐个执行，异常/超时记为 fail 并附诊断，收到中断后剩余步骤记为 skip
const STATUSES = new Set(["pass", "fail", "skip"]);
const ABORTED = "中断";

export function formatDiag(state) {
  const lines = ["诊断（当前浏览器状态）："];
  for (const w of state.windows || []) lines.push(`窗口 ${w.id} ${w.type}${w.focused ? " 聚焦" : ""}`);
  for (const t of state.tabs || []) {
    lines.push(`  标签 ${t.id} 窗口=${t.windowId} 位置=${t.index} split=${t.splitViewId ?? "-"} 固定=${t.pinned ? "是" : "否"} 组=${t.groupId} ${t.status ?? ""} ${t.url || "(网址不可读)"}`);
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

export async function runSteps(steps, ctx, { timeoutMs } = {}) {
  const results = [];
  const total = steps.length;
  const log = ctx.log || (() => {});
  const abortSignal = ctx.abortSignal;
  ctx.guide?.setProgress?.(0, total);

  // run.mjs 以字符串作为中断原因（如“收到 SIGINT”“测试浏览器已退出”），写进说明
  const why = () => (typeof abortSignal?.reason === "string" ? abortSignal.reason : "");
  for (const step of steps) {
    const base = { id: step.id, title: step.title, kind: step.kind };
    if (abortSignal?.aborted) {
      results.push({ ...base, status: "skip", detail: why() ? `${ABORTED}（${why()}）` : ABORTED, durationMs: 0 });
      continue;
    }
    const limit = step.timeoutMs ?? timeoutMs ?? ctx.timeoutMs ?? 120000;
    const stepAbort = new AbortController();
    const started = Date.now();
    log(`▶ ${step.id} ${step.title}`);

    let timer, onAbort;
    const outcome = await new Promise(resolve => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), limit);
      onAbort = () => resolve({ kind: "abort" });
      abortSignal?.addEventListener("abort", onAbort, { once: true });
      Promise.resolve()
        .then(() => step.run({ ...ctx, signal: stepAbort.signal }))
        .then(value => resolve({ kind: "value", value }), error => resolve({ kind: "error", error }));
    });
    clearTimeout(timer);
    abortSignal?.removeEventListener("abort", onAbort);
    if (outcome.kind !== "value") stepAbort.abort();

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

    const result = { ...base, status, detail, durationMs: Date.now() - started };
    if (status === "fail" && !abortSignal?.aborted) {
      const d = await diagnose(ctx);
      result.detail = `${detail}\n${d.text}`;
      if (d.state) result.diag = d.state;
    }
    results.push(result);
    log(`  ${status === "pass" ? "✔ 通过" : status === "fail" ? "✘ 失败" : "↷ 跳过"}（${(result.durationMs / 1000).toFixed(1)}s）${detail ? "：" + detail.split("\n")[0] : ""}`);
    ctx.guide?.setResult?.(step.id, status, result.detail);
    ctx.guide?.setProgress?.(results.length, total);
  }
  return results;
}
