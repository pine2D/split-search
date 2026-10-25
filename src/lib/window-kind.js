// 窗口能否分屏：纯函数，不依赖扩展 API。
// Document Picture-in-Picture 窗口报 type: "normal"、alwaysOnTop: true，带自己的标签；
// 在它上面按 createPaired 的参数调用分屏 API（tabs.create 带 splitWithTabId）会让 Chrome 156 崩溃
// （spike S5，156.0.8078.47 实测）。所以 normal 且置顶的窗口单独归为 "pip"，不算可分屏。

// 窗口缺失 → "none"；normal 且 alwaysOnTop 为 true → "pip"；其余原样返回 win.type。
export function splitWindowType(win) {
  if (!win) return "none";
  if (win.type === "normal" && win.alwaysOnTop === true) return "pip";
  return win.type;
}

// 只有非置顶的 normal 窗口才能调分屏 API。
export function canSplitIn(win) {
  return splitWindowType(win) === "normal";
}
