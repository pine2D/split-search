// 分屏动作判定：纯函数，不依赖扩展 API。
import { splitWindowType } from "./window-kind.js";
import { isNarrow } from "./narrow.js";

export function sideOf(tabIndex, peerIndex) {
  return tabIndex < peerIndex ? "left" : "right";
}

// ownership 来自 split-owner.js 的 judgeOwnership；narrow 为 narrow.js 的 isNarrow（窗口窄且开着降级开关）；
// role 是当前标签记录的 role（没有时按 search）。
// 只有确切的 own 才允许改写对侧：当前标签是查询对的 lookup 一侧时，对侧是用户的网页，按不是本扩展的处理；
// fallback-own（两侧都没有记录，只是对侧像搜索页）同样不改写任何一侧（spec 3.1“兜底”）。
// 本扩展的相邻对：窗口仍窄时就地复用（reuse）；窗口变宽或关掉开关后拼成真正的分屏（join）。
export function decideSplit({ windowType, splitViewId, peer, ownership, narrow, role }) {
  if (windowType !== "normal") return "other-window";
  const own = ownership === "own" && role !== "lookup";
  if (splitViewId === -1) {
    if (!own) return "new";
    return narrow === true ? "reuse" : "join";
  }
  if (peer == null) return "foreign";
  return own ? "reuse" : "foreign";
}

// go.js 的判定入口：ctx 来自 gatherContext（win 带 populate 的标签列表，其余见 split-state.js 的 inspectTab）。
// 窗口类型一律经 splitWindowType：PiP 报 type "normal"，直接传 ctx.win.type 会判成 new，
// 随后 createPaired 在 PiP 上调分屏 API，Chrome 156 崩溃。role 取自当前标签的记录（ctx.record）。
export function decideFor(ctx, narrowEnabled) {
  return decideSplit({
    windowType: splitWindowType(ctx.win),
    splitViewId: ctx.splitViewId,
    peer: ctx.peer,
    ownership: ctx.ownership,
    narrow: isNarrow(ctx.win?.width, narrowEnabled),
    role: ctx.record?.role,
  });
}
