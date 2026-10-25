// 右键菜单的输入处理（spec 3.3、3.4）：纯函数，不引用 chrome。
// 只读 OnClickData 的 selectionText、editable、mediaType、srcUrl；不读 pageUrl、frameUrl。
import { MENU_TEXT, MENU_IMAGE } from "./menu-spec.js";

// Chrome 不截断 selectionText（S3），查询词上限就是 500 个码点。
export const SELECTION_MAX = 500;
// 几 MB 的选区会原样进 SW（S3）：先按码元粗截到 2 倍再按码点截到这么多，不对整串展开码点。
export const SELECTION_PRECUT = 10000;

const cutCodePoints = (s, n) => [...s].slice(0, n).join("");

// 粗截 → 去首尾空白 → 连续空白（含 NBSP、U+2003、U+3000）合并成一个空格 → 按码点截到 max → 去尾部空白。
// 粗截按码元取 2 倍 SELECTION_PRECUT，其中至少有 SELECTION_PRECUT 个码点，末尾被切开的代理项在按码点截时去掉。
export function normalizeSelection(text, max = SELECTION_MAX) {
  if (typeof text !== "string") return "";
  const rough = cutCodePoints(text.slice(0, 2 * SELECTION_PRECUT), SELECTION_PRECUT);
  const collapsed = rough.trim().replace(/\s+/gu, " ");
  return cutCodePoints(collapsed, max).trimEnd();
}

function httpUrl(src) {
  if (typeof src !== "string") return false;
  try {
    const { protocol } = new URL(src);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// → { ok: true, input: "text" | "image", query } 或 { ok: false, reason }。
// 文字：editable 为 true 时不处理（S6：可编辑区域里菜单项照样出现，密码框给的是掩码圆点）。
// 图片：query 是 srcUrl 原文；targetUrlPatterns 已拦住 data:/blob:（S7），这里再查一遍作保险。
export function lookupInput(menuItemId, info) {
  if (menuItemId === MENU_TEXT) {
    if (info.editable === true) return { ok: false, reason: "editable" };
    const query = normalizeSelection(info.selectionText);
    return query === "" ? { ok: false, reason: "empty" } : { ok: true, input: "text", query };
  }
  if (menuItemId === MENU_IMAGE) {
    if (info.mediaType !== "image") return { ok: false, reason: "not_image" };
    const src = info.srcUrl;
    return httpUrl(src) ? { ok: true, input: "image", query: src } : { ok: false, reason: "bad_src" };
  }
  return { ok: false, reason: "unknown_item" };
}
