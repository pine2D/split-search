// 分屏动作判定：纯函数，不依赖扩展 API。
export function sideOf(tabIndex, peerIndex) {
  return tabIndex < peerIndex ? "left" : "right";
}

export function decideSplit({ windowType, splitViewId, peer, recordedPeerId, engineOrigins }) {
  if (windowType !== "normal") return "other-window";
  if (splitViewId === -1) return "new";
  if (peer == null) return "foreign";
  if (recordedPeerId !== undefined && recordedPeerId === peer.id) return "reuse";
  if (typeof peer.url === "string") {
    try {
      if (engineOrigins.includes(new URL(peer.url).origin)) return "reuse";
    } catch {
      // 无法解析：按其他分屏处理
    }
  }
  return "foreign";
}
