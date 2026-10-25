// 分屏动作判定：纯函数，不依赖扩展 API。
export function sideOf(tabIndex, peerIndex) {
  return tabIndex < peerIndex ? "left" : "right";
}

// ownership 来自 split-owner.js 的 judgeOwnership；narrow 为 narrow.js 的 isNarrow（窗口窄且开着降级开关）。
// 本扩展的相邻对：窗口仍窄时就地复用（reuse）；窗口变宽或关掉开关后拼成真正的分屏（join）。
export function decideSplit({ windowType, splitViewId, peer, ownership, narrow }) {
  if (windowType !== "normal") return "other-window";
  if (splitViewId === -1) {
    if (ownership !== "own") return "new";
    return narrow === true ? "reuse" : "join";
  }
  if (peer == null) return "foreign";
  return ownership === "own" || ownership === "fallback-own" ? "reuse" : "foreign";
}
