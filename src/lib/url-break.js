// 网址的换行点（设置页的网址框在各段之间插 <wbr>，不让 overflow-wrap: anywhere 从单词中间断开）：
// 在 / ? & = , 之后切段，连续的分隔符算一处；开头的 scheme://（如 chrome://、https://）不单独成段。各段拼回就是原串。
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const SEP = /[/?&=,]+/g;

export function urlBreakParts(url) {
  if (typeof url !== "string" || !url) return [];
  const skip = SCHEME.exec(url)?.[0].length ?? 0;
  const parts = [];
  let start = 0;
  for (const m of url.slice(skip).matchAll(SEP)) {
    const end = skip + m.index + m[0].length;
    if (end >= url.length) break;
    parts.push(url.slice(start, end));
    start = end;
  }
  parts.push(url.slice(start));
  return parts;
}
