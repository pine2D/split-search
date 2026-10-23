// 步骤注册表与过滤。步骤形状：
// { id, title, kind: "auto"|"assist"|"judge", needs: string[], timeoutMs?, run: async ctx => ({ status, detail }) }
// ctx = { browser, guide, ext, port, timeoutMs, abortSignal, signal, log, consoleErrors }
// 后续任务各自在这里登记自己的步骤模块。
import { OPTIONS_STEPS } from "./options.mjs";

// B 系列在前，CORE-* 其次，T 系列最后；同类按数字排序
const GROUP = { B: 0, CORE: 1, T: 2 };
function key(id) {
  const m = /^([A-Z]+)-?(\d*)/.exec(id) || [];
  return [GROUP[m[1]] ?? 3, m[2] ? Number(m[2]) : 0];
}
export function compareStepIds(a, b) {
  const [ga, na] = key(a), [gb, nb] = key(b);
  return ga - gb || na - nb || (a < b ? -1 : a > b ? 1 : 0);
}

export const STEPS = [...OPTIONS_STEPS].sort((a, b) => compareStepIds(a.id, b.id));

export function selectSteps(steps, { autoOnly = false, only = null } = {}) {
  if (only) {
    const known = new Set(steps.map(s => s.id));
    const unknown = only.filter(id => !known.has(id));
    if (unknown.length) throw new Error(`未知步骤：${unknown.join(", ")}；可用：${[...known].join(", ")}`);
  }
  return steps.filter(s => (!autoOnly || s.kind === "auto") && (!only || only.includes(s.id)));
}
