// 分屏归属判定：纯函数，不依赖扩展 API。go.html、弹窗、快捷键、右键共用。
// 记录（storage.session 的 split:<tabId>）形状：
//   { peer, splitViewId, mode: "split" | "adjacent",
//     role: "search" | "page" | "lookup", input?: "text" | "image", engine, query }
// search：本扩展打开的搜索页（搜索对两侧都是它，不带 input）；page：用户的网页（查询对的左侧，engine 为 ""）；
// lookup：本扩展打开的查询结果（查询对的右侧）。查询对两侧写同一个 input 和 query。
import { PLACEHOLDER } from "./engines.js";

export const RECORD_PREFIX = "split:";

export function recordKey(tabId) {
  return RECORD_PREFIX + tabId;
}

// 形状不对（含旧版本的裸数字）一律当作没有记录。没有 role 的（v0.3 形状）按 search 解析；
// search 不带 input（存了也丢掉）；page、lookup 必须有合法的 input；engine 为 "" 当且仅当 role 是 page
export function parseRecord(value) {
  if (value === null || typeof value !== "object") return null;
  const { peer, splitViewId, mode, engine, query, role = "search", input } = value;
  if (!Number.isInteger(peer) || !Number.isInteger(splitViewId)) return null;
  if (mode !== "split" && mode !== "adjacent") return null;
  if (typeof engine !== "string" || typeof query !== "string") return null;
  if (role !== "search" && role !== "page" && role !== "lookup") return null;
  if ((engine === "") !== (role === "page")) return null;
  if (role === "search") return { peer, splitViewId, mode, role, engine, query };
  if (input !== "text" && input !== "image") return null;
  return { peer, splitViewId, mode, role, input, engine, query };
}

// 两条记录总是写 role；不是搜索对时两条写同一个 input，搜索对不写 input 键
export function makeRecords({ a, b, splitViewId, mode, engineA, engineB, query, roleA = "search", roleB = "search", input }) {
  const extra = roleA === "search" && roleB === "search" ? {} : { input };
  return {
    [recordKey(a)]: { peer: b, splitViewId, mode, role: roleA, ...extra, engine: engineA, query },
    [recordKey(b)]: { peer: a, splitViewId, mode, role: roleB, ...extra, engine: engineB, query },
  };
}

// 永久失效标记：mode "split" 配 splitViewId -1，parseRecord 接受、recordMatches 永远不认。
// 相邻对被拖开（或夹进别的标签）后改写成它：之后拖回相邻、或用户把这两个标签手动拼成分屏，都不再算本扩展的。
export function staleMarker(record) {
  return { ...record, mode: "split", splitViewId: -1 };
}

// 对侧网址像不像模板的搜索结果页：%s 在查询里比 origin+pathname，并要求网址带着 %s 所在的参数且值不为空
// （chatgpt.com/、claude.ai/new 这类输入框首页上可能有用户的草稿，不能当成搜索页）；
// %s 不在查询参数里（如在 # 后面）时无从核对，不认。在路径里比前缀。
// 路径前缀只有根路径 "/"（如 https://x.com/%s）时不认：那样同 origin 的任何页面都会算作搜索页
export function looksLikeSearchPage(url, template) {
  try {
    if (typeof template !== "string" || !template.includes("%s")) return false;
    const t = new URL(template.replace("%s", PLACEHOLDER));
    const u = new URL(url);
    if (u.origin !== t.origin) return false;
    const at = t.pathname.indexOf(PLACEHOLDER);
    if (at === -1) {
      if (u.pathname !== t.pathname) return false;
      const param = [...t.searchParams].find(([, v]) => v.includes(PLACEHOLDER))?.[0];
      return param !== undefined && Boolean(u.searchParams.get(param));
    }
    const prefix = t.pathname.slice(0, at);
    return prefix !== "/" && u.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

// 能和某个 role 配成一对的对侧 role：search 配 search，page 配 lookup
function partnerRole(role) {
  if (role === "search") return "search";
  if (role === "page") return "lookup";
  if (role === "lookup") return "page";
  return null;
}

// 两条记录互指，mode 与 splitViewId 一致，role 能配对（查询对两侧 input 相同），再按 mode 核对两个标签的实际位置。
// 没有 role 的记录按 search 看（同 parseRecord）
function recordMatches(tab, peer, record, peerRecord) {
  if (!peer || !peerRecord) return false;
  if (record.peer !== peer.id || peerRecord.peer !== tab.id) return false;
  if (peerRecord.mode !== record.mode || peerRecord.splitViewId !== record.splitViewId) return false;
  const role = record.role ?? "search";
  if (partnerRole(role) !== (peerRecord.role ?? "search")) return false;
  if (role !== "search" && record.input !== peerRecord.input) return false;
  if (record.mode === "split") {
    const v = record.splitViewId;
    return v !== -1 && tab.splitViewId === v && peer.splitViewId === v;
  }
  return tab.splitViewId === -1 && peer.splitViewId === -1 &&
    tab.windowId === peer.windowId && Math.abs(peer.index - tab.index) === 1;
}

export function judgeOwnership({ tab, peer, record, peerRecord, engines }) {
  if (record) return recordMatches(tab, peer, record, peerRecord) ? "own" : "stale";
  // 当前标签没记录、对侧却有：这一对拆开过或记录被连带清掉，同样不走兜底
  if (peerRecord) return "stale";
  // 兜底只认同一个分屏里的两个标签，不依赖调用方先筛过
  const v = peer?.splitViewId;
  if (!Number.isInteger(v) || v === -1 || v !== tab.splitViewId) return "none";
  if (typeof peer.url === "string" &&
      (engines || []).some(e => looksLikeSearchPage(peer.url, e.url))) return "fallback-own";
  return "none";
}
