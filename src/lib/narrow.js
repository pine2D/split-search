// 窄窗口判定：窗口宽度（windows.get 的 width，DIP，含边框）小于阈值时，右侧不再分屏。
export const NARROW_WIDTH = 960;

export function isNarrow(width, enabled) {
  return enabled === true && typeof width === "number" && Number.isFinite(width) && width < NARROW_WIDTH;
}
