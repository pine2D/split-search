// 窗口能否分屏：纯函数，不依赖扩展 API。
// Document Picture-in-Picture 窗口报 type: "normal"、alwaysOnTop: true，带自己的标签；
// 在它上面按 createPaired 的参数调用分屏 API（tabs.create 带 splitWithTabId）会让 Chrome 156 崩溃
// （spike S5，156.0.8078.47 实测）。所以 normal 且置顶的窗口单独归为 "pip"，不算可分屏。
// 窗口管理器“置顶”的普通窗口（Linux X11 的 _NET_WM_STATE_ABOVE）也报 alwaysOnTop: true（156 实测），
// 靠标签数区分：PiP 只有一个标签，也加不进去（tabs.create 指定 PiP 会落到打开者的窗口）。
// 调用方读窗口时带 populate: true（不需要 tabs 权限）；读到多于一个标签才按普通窗口处理，
// 没有标签列表或只有一个标签都按 PiP 处理（宁可不分屏，也不在 PiP 上调分屏 API）。

// 窗口缺失 → "none"；normal、alwaysOnTop 为 true、标签不多于一个（或没有标签列表）→ "pip"；其余原样返回 win.type。
export function splitWindowType(win) {
  if (!win) return "none";
  if (win.type === "normal" && win.alwaysOnTop === true && !(win.tabs?.length > 1)) return "pip";
  return win.type;
}

// 只有 splitWindowType 为 "normal" 的窗口才能调分屏 API。
export function canSplitIn(win) {
  return splitWindowType(win) === "normal";
}

// 窗口里标签最近一次被使用的时间（lastAccessed 的最大值），没有就是 0。
const lastUsed = (win) => Math.max(0, ...(win.tabs ?? []).map(t => t.lastAccessed ?? 0));

// 挑一个能分屏的窗口：最后聚焦的（last）能分屏就用它；否则（PiP 获得焦点时 last 就是 PiP）在 all 里依次取
// focused 的、打开这个 PiP 的窗口（PiP 标签的 openerTabId 所在窗口）、没有最小化且最近用过的、最近用过的。
// all 需带 populate 的标签列表，没有标签时后两条退化为 all 里的顺序。都不能分屏 → null。
export function pickSplitWindow(last, all) {
  if (canSplitIn(last)) return last;
  const ok = (all ?? []).filter(canSplitIn);
  const opener = last?.tabs?.[0]?.openerTabId;
  const minimized = (w) => (w.state === "minimized" ? 1 : 0);
  return ok.find(w => w.focused)
    ?? (opener === undefined ? undefined : ok.find(w => w.tabs?.some(t => t.id === opener)))
    ?? [...ok].sort((a, b) => minimized(a) - minimized(b) || lastUsed(b) - lastUsed(a))[0]
    ?? null;
}
