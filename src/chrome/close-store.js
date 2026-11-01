// 联动许可的 session 存储。只有 SW 调用，调用方已经持有 pair-lock；错误交给调用方处理。
import { LINK_PREFIX, linkKey, validLink, matchesLink, searchPair, cleanupKeys } from "../lib/close-pair.js";
import { RECORD_PREFIX } from "../lib/split-owner.js";

export const readCloseState = () => chrome.storage.session.get(null);
export const consumePair = (id, data) => chrome.storage.session.remove(cleanupKeys(id, data));

export function linksIn(data, id) {
  const out = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(LINK_PREFIX) || !validLink(value) || (id !== undefined && !value.includes(id))) continue;
    const v = Number(key.slice(LINK_PREFIX.length));
    if (Number.isInteger(v) && v >= 0 && key === linkKey(v)) out.push({ a: value[0], b: value[1], splitViewId: v });
  }
  return out;
}

export async function clearLinks() {
  const keys = Object.keys(await readCloseState()).filter(k => k.startsWith(LINK_PREFIX));
  if (keys.length) await chrome.storage.session.remove(keys);
}

// 先清掉不再匹配记录的许可，再核实真实布局。冷启动时一侧可能已经关闭：
// 记录仍匹配的旧许可保留，交给同实例的关闭事件判定；不能在启动扫描时抢先清掉它。
export async function armPairs(ids, current, blocked) {
  const data = await readCloseState();
  if (!current()) return;
  const stale = linksIn(data).filter(p => !matchesLink(p, data[linkKey(p.splitViewId)]) ||
    searchPair(p.a, data)?.splitViewId !== p.splitViewId || searchPair(p.a, data)?.b !== p.b);
  if (stale.length) await chrome.storage.session.remove(stale.map(p => linkKey(p.splitViewId)));
  const candidates = ids ?? Object.keys(data).filter(k => k.startsWith(RECORD_PREFIX)).map(k => Number(k.slice(RECORD_PREFIX.length)));
  const seen = new Set(), patch = {};
  for (const id of candidates) {
    const pair = searchPair(id, data);
    if (!pair || seen.has(pair.splitViewId) || blocked.has(pair.splitViewId)) continue;
    seen.add(pair.splitViewId);
    if (matchesLink(pair, data[linkKey(pair.splitViewId)])) continue;
    const tabs = await chrome.tabs.query({ splitViewId: pair.splitViewId });
    if (tabs.length === 2 && tabs.every(t => t.splitViewId === pair.splitViewId) &&
        tabs[0].windowId === tabs[1].windowId && [pair.a, pair.b].every(n => tabs.some(t => t.id === n))) {
      patch[linkKey(pair.splitViewId)] = [pair.a, pair.b];
    }
  }
  if (current() && Object.keys(patch).length) await chrome.storage.session.set(patch);
}
