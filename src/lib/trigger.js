// 触发网址的生成与解析。纯逻辑，不得引用 chrome。
import { ID_PATTERN, validateTemplate } from "./engines.js";

export const MARKER = "_ss";

export function buildTriggerTemplate(left, rightId) {
  const v = validateTemplate(left.url);
  if (!v.ok || !v.canBeLeft) throw new Error(`${left.name} 不能作为左侧引擎`);
  const sep = left.url.includes("?") ? "&" : "?";
  return `${left.url}${sep}${MARKER}=${left.id},${rightId}`;
}

// go.html 只会以 go.html?u=<原始网址> 的形式被打开
export function extractOriginalUrl(search) {
  return typeof search === "string" && search.startsWith("?u=") ? search.slice(3) : null;
}

// 纯字符串操作删除全部 _ss 参数及各自紧邻的一个分隔符，其余原样保留
export function stripMarker(originalUrl) {
  const q = originalUrl.indexOf("?");
  if (q === -1) return originalUrl;
  const head = originalUrl.slice(0, q);
  let rest = originalUrl.slice(q + 1);
  let hash = "";
  const h = rest.indexOf("#");
  if (h !== -1) { hash = rest.slice(h); rest = rest.slice(0, h); }
  const parts = rest.split("&");
  const isMarker = (p) => p === MARKER || p.startsWith(MARKER + "=");
  if (!parts.some(isMarker)) return originalUrl;
  const kept = parts.filter(p => !isMarker(p)).join("&");
  return head + (kept ? "?" + kept : "") + hash;
}

export function parseTrigger(originalUrl, engines) {
  let u;
  try { u = new URL(originalUrl); } catch { return { ok: false, error: "网址格式不正确" }; }
  const raw = u.searchParams.get(MARKER);
  const ids = raw === null ? [] : raw.split(",");
  if (ids.length !== 2 || !ids.every(id => ID_PATTERN.test(id))) {
    return { ok: false, error: "标记参数格式不对" };
  }
  const [left, right] = ids.map(id => engines.find(e => e.id === id));
  for (const [i, e] of [left, right].entries()) {
    if (!e) return { ok: false, error: `未知引擎：${ids[i]}` };
  }
  const v = validateTemplate(left.url);
  if (!v.ok || !v.canBeLeft) return { ok: false, error: `${left.name} 不能作为左侧引擎` };
  if (!u.searchParams.has(v.leftParam)) {
    return { ok: false, error: "触发网址与当前模板不一致，请到设置页重新复制" };
  }
  return { ok: true, left, right, query: u.searchParams.get(v.leftParam) };
}

export function expandTemplate(template, query) {
  if (query === "") return new URL(template.replace("%s", "x")).origin + "/";
  return template.replaceAll("%s", encodeURIComponent(query));
}
