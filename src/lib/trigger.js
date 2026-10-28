// 触发网址的生成与解析。纯逻辑，不得引用 chrome。
import { ID_PATTERN, validateTemplate } from "./engines.js";
import { fail, codedError } from "./errors.js";

export const MARKER = "_ss";

export function buildTriggerTemplate(left, rightId) {
  const v = validateTemplate(left.url);
  if (!v.ok || !v.canBeLeft) throw codedError("not_left", left.name);
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
  try { u = new URL(originalUrl); } catch { return fail("bad_url"); }
  const raw = u.searchParams.get(MARKER);
  const ids = raw === null ? [] : raw.split(",");
  if (ids.length !== 2 || !ids.every(id => ID_PATTERN.test(id))) {
    return fail("marker_format");
  }
  const [left, right] = ids.map(id => engines.find(e => e.id === id));
  for (const [i, e] of [left, right].entries()) {
    if (!e) return fail("unknown_engine", ids[i]);
  }
  const v = validateTemplate(left.url);
  if (!v.ok || !v.canBeLeft) return fail("not_left", left.name);
  if (!u.searchParams.has(v.leftParam)) {
    return fail("template_mismatch");
  }
  return { ok: true, left, right, query: u.searchParams.get(v.leftParam) };
}

export function expandTemplate(template, query) {
  if (query === "") return new URL(template.replace("%s", "x")).origin + "/";
  return template.replaceAll("%s", encodeURIComponent(query));
}

// 只换查询参数的值，其余段、顺序和 # 之后逐字保留；参数必须恰好出现一次
export function replaceQuery(originalUrl, param, query) {
  const q = originalUrl.indexOf("?");
  if (q === -1 || typeof param !== "string") throw new Error("replaceQuery: parameter not found once");
  const head = originalUrl.slice(0, q + 1);
  let rest = originalUrl.slice(q + 1);
  let hash = "";
  const h = rest.indexOf("#");
  if (h !== -1) { hash = rest.slice(h); rest = rest.slice(0, h); }
  const parts = rest.split("&");
  const nameOf = (p) => { const i = p.indexOf("="); return i === -1 ? p : p.slice(0, i); };
  const hits = parts.filter(p => nameOf(p) === param).length;
  if (hits !== 1) throw new Error("replaceQuery: parameter not found once");
  const next = parts.map(p => nameOf(p) === param ? `${param}=${encodeURIComponent(query)}` : p);
  return head + next.join("&") + hash;
}
