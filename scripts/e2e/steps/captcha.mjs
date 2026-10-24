// 引擎人机验证页的识别（纯函数）。目前只有 Google：DNR 已重定向、go.html 已把左侧换成去掉 _ss 的搜索网址，
// Google 再 302 到 https://www.google.com/sorry/index?continue=<百分号编码的 /search?q=…>&q=<不透明令牌>。
// 这时分屏其实已经建好，只是左侧被验证页挡住；continue 解码后的搜索网址与期望一致才算（见 diag-google-dnr.md）。
export const G = "www.google.com";
const SORRY_HOST = /^(www|ipv4|ipv6)\.google\.com$/;
const parse = s => { try { return new URL(s); } catch { return null; } };
const qOf = u => (u.searchParams.get("q") ?? "").trim();
const hasSs = u => [...u.searchParams.keys()].some(k => k === "_ss" || k === "amp;_ss");

// 是 Google 人机验证页就返回 continue 解码后的网址（可能为空串），否则 null
export function sorryContinue(url) {
  const u = parse(url);
  if (!u || !SORRY_HOST.test(u.hostname) || !u.pathname.startsWith("/sorry")) return null;
  return u.searchParams.get("continue") ?? "";
}
export const isSorry = url => sorryContinue(url) !== null;

// Google 搜索结果页：路径 /search、关键词为 q（不传 q 不比较）、没有 _ss（有 _ss 说明 DNR 没生效）
function googleSearch(url, q) {
  const u = parse(url);
  return !!u && u.hostname === G && u.pathname === "/search" && !hasSs(u) && (q === undefined || qOf(u) === q);
}

// 左侧 Google 的状态："search"（到了结果页）| "sorry"（被验证页挡住，continue 是期望的搜索）| null（都不是）
export function googleLeft(url, q) {
  if (googleSearch(url, q)) return "search";
  const c = sorryContinue(url);
  return c && googleSearch(c, q) ? "sorry" : null;
}

// 写进说明的提示：分屏里有一侧停在 Google 人机验证页
export function sorryNote(pair) {
  const [l, r] = pair;
  if (isSorry(l?.url)) return "（分屏已建成，左侧被 Google 人机验证挡住）";
  if (isSorry(r?.url)) return "（分屏已建成，右侧被 Google 人机验证挡住）";
  return "";
}
