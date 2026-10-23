// 步骤注册表与过滤。步骤形状：
// { id, title, kind: "auto"|"assist"|"judge", needs: string[], timeoutMs?, run: async ctx => ({ status, detail }) }
// ctx = { browser, guide, ext, port, timeoutMs, abortSignal, signal, log, consoleErrors, consoleCollector,
//         restartBrowser({ restoreSession }) → 新的 { browser, ext, ... }，步骤应 Object.assign 到自己的 ctx，
//         install（安装引导的结果，B1 用）}
// 可选字段：timeoutFactor（单步超时的倍数，等人的步骤用）、cleanup（收尾提示要恢复的设置，见 setup.mjs）、
// last（排在最后）。needs 含 "kagi" 的步骤由 withNeeds 包一层，先确认 Kagi 已登录。
import { OPTIONS_STEPS } from "./options.mjs";
import { FLOW_STEPS } from "./flow.mjs";
import { ASSISTED_STEPS } from "./assisted.mjs";
import { ASSISTED_2 } from "./assisted-2.mjs";
import { T8 } from "./t8.mjs";
import { B1, withNeeds } from "./setup.mjs";

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

// last: true 的步骤（B15 汇总控制台错误）无论编号都排在最后，以覆盖此前所有步骤
export const sortSteps = steps => [...steps].sort((a, b) => (a.last ? 1 : 0) - (b.last ? 1 : 0) || compareStepIds(a.id, b.id));
export const STEPS = sortSteps([...OPTIONS_STEPS, ...FLOW_STEPS, B1, ...ASSISTED_STEPS, ...ASSISTED_2, T8].map(withNeeds));

export function selectSteps(steps, { autoOnly = false, only = null } = {}) {
  if (only) {
    const known = new Set(steps.map(s => s.id));
    const unknown = only.filter(id => !known.has(id));
    if (unknown.length) throw new Error(`未知步骤：${unknown.join(", ")}；可用：${[...known].join(", ")}`);
  }
  return steps.filter(s => (!autoOnly || s.kind === "auto") && (!only || only.includes(s.id)));
}
