// 右键查询（② 选中文字、⑧ 以图搜图）的判定表（spec 3.3）：纯函数，不引用 chrome。
// LookupAction 依次对应判定表第 1–8 行：
//   "ignore" | "other-window" | "reuse-split" | "beside-split" | "reuse-adjacent" | "join" | "beside-pair" | "new"

// hasTab：有 tab 且 tab.id >= 0；inputOk：lookupInput 的 ok；windowType：splitWindowType(win)（PiP 是 "pip"）；
// ownership、role 来自 inspectTab 与当前标签的记录；narrow：isNarrow(width, narrowFallback)。
// 已在任何分屏里（包括本扩展的分屏）只有“自己是查询对的网页一侧”才复用，其余一律在旁边开普通标签（用户决定 2）。
// 相邻查询对的 lookup 一侧同样开普通标签，不让查询结果变成新查询对的网页一侧（第 7 行）。
export function decideLookup({ hasTab, inputOk, windowType, splitViewId, ownership, role, narrow }) {
  if (!hasTab || !inputOk) return "ignore";
  if (windowType !== "normal") return "other-window";
  const own = ownership === "own";
  if (splitViewId !== -1) return own && role === "page" ? "reuse-split" : "beside-split";
  if (own && role === "page") return narrow === true ? "reuse-adjacent" : "join";
  if (own && role === "lookup") return "beside-pair";
  return "new";
}

// 普通标签的位置：beside-split 放在分屏右边（两侧最大 index + 1，同 openForeign）；
// beside-pair 放在这一对右边（两者较大 index + 1，避免插进这一对中间）。
export function besideIndex(action, { tab, splitTabs, peer }) {
  if (action === "beside-split") return Math.max(tab.index, ...splitTabs.map(t => t.index)) + 1;
  if (action === "beside-pair") return Math.max(tab.index, peer.index) + 1;
  throw new Error(`besideIndex: ${action}`);
}
