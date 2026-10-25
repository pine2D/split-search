// 步骤注册表与过滤。步骤形状：
// { id, title, kind: "auto"|"assist"|"judge"|"xauto", needs: string[], timeoutMs?, run: async ctx => ({ status, detail }) }
// xauto（真实鼠标/键盘 + 自动判定，steps/xauto*.mjs）带 fallback（同编号的 assist/judge 步骤）：xinput 不可用时换成 fallback
// ctx = { browser, guide, ext, port, timeoutMs, abortSignal, signal, log, consoleErrors, consoleCollector,
//         restartBrowser({ restoreSession }) → 新的 { browser, ext, ... }，步骤应 Object.assign 到自己的 ctx，
//         install（安装引导的结果，B1 用）, gx（xinput 可用时：{ xi, root, profileDir, stop }，xauto 步骤用；stop 为“可能有按键卡住”）}
// 可选字段：timeoutFactor（单步超时的倍数，等人的步骤用）、cleanup（收尾提示要恢复的设置，见 setup.mjs）、
// last（排在最后）。needs 含 "kagi" 的步骤由 withNeeds 包一层，先确认 Kagi 已登录。
import { OPTIONS_STEPS } from "./options.mjs";
import { FLOW_STEPS } from "./flow.mjs";
import { ASSISTED_STEPS } from "./assisted.mjs";
import { ASSISTED_2 } from "./assisted-2.mjs";
import { DRAG_STEPS } from "./assisted-drag.mjs";
import { T8 } from "./t8.mjs";
import { B14 } from "./b14.mjs";
import { B4 } from "./b4.mjs";
import { I18N } from "./i18n.mjs";
import { B1, withNeeds } from "./setup.mjs";
import { XAUTO_STEPS } from "./xauto.mjs";
import { XAUTO_T14 } from "./xauto-t14.mjs";
import { XAUTO_T12 } from "./xauto-t12.mjs";
import { V03_SPLIT_STEPS } from "./v03-split.mjs";
import { V03_NARROW_STEPS } from "./v03-narrow.mjs";
import { V03_POPUP_STEPS } from "./v03-popup.mjs";
import { V03_OPTIONS_STEPS } from "./v03-options.mjs";
import { XAUTO_T19 } from "./xauto-t19.mjs";

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
const XAUTO = [...XAUTO_STEPS, ...XAUTO_T12, ...XAUTO_T14, ...XAUTO_T19].map(x => ({ ...x, fallback: withNeeds(x.fallback) }));
const replaced = new Set(XAUTO.map(x => x.id));
const MANUAL = [...ASSISTED_STEPS, ...DRAG_STEPS, ...ASSISTED_2].filter(s => !replaced.has(s.id));
export const STEPS = sortSteps([...OPTIONS_STEPS, ...FLOW_STEPS, B1, B4, B14, ...MANUAL, T8, I18N,
  ...V03_SPLIT_STEPS, ...V03_NARROW_STEPS, ...V03_POPUP_STEPS, ...V03_OPTIONS_STEPS].map(withNeeds).concat(XAUTO));

// xinput：真实输入可用（xinput.available().ok）。可用 → xauto 版本，否则换成 fallback（不算失败）。
// autoOnly 只留不需要人的步骤：auto，以及（可用时的）xauto
export function selectSteps(steps, { autoOnly = false, only = null, xinput = false } = {}) {
  if (only) {
    const known = new Set(steps.map(s => s.id));
    const unknown = only.filter(id => !known.has(id));
    if (unknown.length) throw new Error(`未知步骤：${unknown.join(", ")}；可用：${[...known].join(", ")}`);
  }
  const resolved = steps.map(s => (s.kind === "xauto" && !xinput ? s.fallback : s));
  return resolved.filter(s => (!autoOnly || s.kind === "auto" || s.kind === "xauto") && (!only || only.includes(s.id)));
}
