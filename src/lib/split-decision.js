// 分屏动作判定：纯函数，不依赖扩展 API。
export function sideOf(tabIndex, peerIndex) {
  return tabIndex < peerIndex ? "left" : "right";
}

// ownership 来自 split-owner.js 的 judgeOwnership
export function decideSplit({ windowType, splitViewId, peer, ownership }) {
  if (windowType !== "normal") return "other-window";
  if (splitViewId === -1) return ownership === "own" ? "reuse" : "new";
  if (peer == null) return "foreign";
  return ownership === "own" || ownership === "fallback-own" ? "reuse" : "foreign";
}
