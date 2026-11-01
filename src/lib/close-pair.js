// 联动关闭的纯判定：只认明确的搜索对和一次性事件证据，不读取网址。
import { recordKey, parseRecord } from "./split-owner.js";

export const LINK_PREFIX = "linked:";
export const linkKey = (splitViewId) => LINK_PREFIX + splitViewId;
const tabId = (id) => Number.isInteger(id) && id >= 0;
const samePair = (a, b) => !!a && !!b && a.a === b.a && a.b === b.b && a.splitViewId === b.splitViewId;
export const validLink = (value) => Array.isArray(value) && value.length === 2 && value.every(tabId) && value[0] < value[1];
export const matchesLink = (pair, value) => validLink(value) && value[0] === pair.a && value[1] === pair.b;

// 身份用升序 id，不随原生“互换位置”变化；当前左右位置不授予关闭权。
export function searchPair(id, records) {
  const own = parseRecord(records[recordKey(id)]);
  if (!tabId(id) || !own || !tabId(own.peer) || own.peer === id) return null;
  const other = parseRecord(records[recordKey(own.peer)]);
  if (!other || other.peer !== id || own.role !== "search" || other.role !== "search" ||
      own.mode !== "split" || other.mode !== "split" || own.splitViewId < 0 ||
      own.splitViewId !== other.splitViewId || own.query !== other.query) return null;
  return { a: Math.min(id, own.peer), b: Math.max(id, own.peer), splitViewId: own.splitViewId };
}

// 两侧仍在：明确拆开；两侧都没了：不必联动。单次快照失败不提供证据。
export function observeClose(pair, updatedId, ids, previous) {
  if (!Array.isArray(ids) || ![pair.a, pair.b].includes(updatedId)) return { kind: "ignore" };
  const a = ids.includes(pair.a), b = ids.includes(pair.b);
  if (a === b) return { kind: "end" };
  const closed = a ? pair.b : pair.a, peer = a ? pair.a : pair.b;
  const seen = samePair(pair, previous) && previous.closed === closed ? previous.seen : [];
  return { kind: "pending", evidence: { ...pair, closed, peer, seen: [...new Set([...seen, updatedId])].sort((x, y) => x - y) } };
}

// 两侧的 -1 都在本实例里留下相同方向的证据，且最新记录与许可仍一致，才返回可关闭的对侧。
export function closingPeer(evidence, records, link) {
  if (!evidence || !samePair(evidence, searchPair(evidence.closed, records)) || !matchesLink(evidence, link)) return null;
  const { a, b, closed, peer, seen } = evidence;
  if (![a, b].includes(closed) || peer !== (closed === a ? b : a) ||
      !Array.isArray(seen) || seen.length !== 2 || !seen.includes(a) || !seen.includes(b)) return null;
  return peer;
}

// 在锁内按最新记录清理；peer 已经加入新对时保留它，许可只删包含已关闭标签的那些。
export function cleanupKeys(id, records) {
  const keys = [recordKey(id)];
  const own = parseRecord(records[recordKey(id)]);
  if (own && parseRecord(records[recordKey(own.peer)])?.peer === id) keys.push(recordKey(own.peer));
  for (const [key, value] of Object.entries(records)) {
    if (key.startsWith(LINK_PREFIX) && validLink(value) && value.includes(id)) keys.push(key);
  }
  return keys;
}
