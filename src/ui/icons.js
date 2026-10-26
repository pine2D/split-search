// 界面里的小图标：手写的 SVG 路径，设置页和弹窗共用。统一 16×16 的 viewBox、1.75 的线宽、圆头，
// 颜色跟随 currentColor，一律 aria-hidden（可访问名称由所在按钮或旁边的文字提供）。不用 Unicode 字符充当图标。
const SVG_NS = "http://www.w3.org/2000/svg";

// 圆：圆心 (8,8)、半径 6.25，用两段弧画，和其他路径共用一个 <path>
const CIRCLE = "M14.25 8a6.25 6.25 0 1 1-12.5 0a6.25 6.25 0 1 1 12.5 0";

export const ICON_PATHS = {
  check: "M3.5 8.5l3 3 6-7",
  "check-circle": `${CIRCLE}M5.25 8.25l1.85 1.85 3.65-4.1`,
  "alert-circle": `${CIRCLE}M8 4.9v3.6M8 11.1v.01`,
  "alert-triangle": "M8 2.25l6.25 11H1.75zM8 6.4v3.1M8 11.4v.01",
  "x-circle": `${CIRCLE}M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5`,
  x: "M4 4l8 8M12 4l-8 8",
  "chevron-right": "M6 3.5l4.5 4.5L6 12.5",
  "arrow-up": "M8 13V3.5M4.25 7.25L8 3.5l3.75 3.75",
  "arrow-down": "M8 3v9.5M4.25 8.75L8 12.5l3.75-3.75",
};

export const ICON_STROKE = "1.75";

// name：ICON_PATHS 里的名字；size：渲染尺寸（CSS 像素）；cls：附加的 class
export function icon(name, { size = 16, cls = "" } = {}) {
  const d = ICON_PATHS[name];
  if (!d) throw new Error(`unknown icon: ${name}`);
  const svg = document.createElementNS(SVG_NS, "svg");
  const attrs = {
    viewBox: "0 0 16 16", width: String(size), height: String(size), fill: "none", stroke: "currentColor",
    "stroke-width": ICON_STROKE, "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true", focusable: "false", class: cls ? `icon ${cls}` : "icon",
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}
