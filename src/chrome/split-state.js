// 分屏记录读写与归属检查：对 chrome.tabs / chrome.storage.session 的薄封装。
// 记录形状与归属规则见 lib/split-owner.js。storage 读写失败一律只记日志：
// 读失败当作没有记录，写失败不影响已经打开的页面。
import { recordKey, parseRecord, makeRecords, judgeOwnership } from "../lib/split-owner.js";

const log = (...args) => console.error("[split-search]", ...args);

export async function readRecord(tabId) {
  try {
    const key = recordKey(tabId);
    return parseRecord((await chrome.storage.session.get(key))[key]);
  } catch (err) {
    log("failed to read the split record", tabId, err);
    return null;
  }
}

// 一次 set 写两个方向，不做读-改-写
export async function writePair({ a, b, splitViewId, mode, engineA, engineB, query }) {
  try {
    await chrome.storage.session.set(makeRecords({ a, b, splitViewId, mode, engineA, engineB, query }));
  } catch (err) {
    log("failed to record the split tab pair", err);
  }
}

// 只改这一条记录显示的引擎，对侧记录不动
export async function writeEngine(tabId, record, engine) {
  try {
    await chrome.storage.session.set({ [recordKey(tabId)]: { ...record, engine } });
  } catch (err) {
    log("failed to update the split record", tabId, err);
  }
}

// 删掉自己的记录；对侧记录只有指回自己时才一并删，避免误删对侧和别的标签重新建立的记录
export async function clearPair(tabId) {
  const keys = [recordKey(tabId)];
  const record = await readRecord(tabId);
  if (record) {
    const peerRecord = await readRecord(record.peer);
    if (peerRecord?.peer === tabId) keys.push(recordKey(record.peer));
  }
  try {
    await chrome.storage.session.remove(keys);
  } catch (err) {
    log("failed to clear the split record", tabId, err);
  }
}

// 判定只用到这几个字段；没有 host 权限时 url 为 undefined
function peerOf(t) {
  return { id: t.id, index: t.index, windowId: t.windowId, splitViewId: t.splitViewId ?? -1, url: t.url };
}

// 记录里的对侧标签是否已经不在了（tabs.get 不需要 tabs 权限）
async function recordedPeerGone(record, peer) {
  if (peer?.id === record.peer) return false;
  try {
    await chrome.tabs.get(record.peer);
    return false;
  } catch {
    return true;
  }
}

// 当前标签的对侧、两侧记录和归属。tabs.query({ splitViewId }) 不需要 tabs 权限，失败照常抛出。
// 读到失效记录（stale）时，只有记录里的对侧已经关掉才顺手清理。对侧还在时两条都保留：
// 用户拆开后再把这两个标签拼回去，它们仍判 stale（不是本扩展的），不会落到兜底被当成本扩展分屏覆盖。
export async function inspectTab(tab, engines) {
  const splitViewId = tab.splitViewId ?? -1;
  const record = await readRecord(tab.id);
  let splitTabs = [];
  let peer = null;
  if (splitViewId !== -1) {
    splitTabs = await chrome.tabs.query({ splitViewId });
    const other = splitTabs.find(t => t.id !== tab.id);
    peer = other ? peerOf(other) : null;
  } else if (record?.mode === "adjacent") {
    try {
      peer = peerOf(await chrome.tabs.get(record.peer));
    } catch {
      // 对侧已关掉（No tab with id）：当作没有对侧
      peer = null;
    }
  }
  const peerRecord = peer ? await readRecord(peer.id) : null;
  const ownership = judgeOwnership({
    tab: { ...tab, splitViewId }, peer, record, peerRecord, engines,
  });
  if (ownership === "stale" && await recordedPeerGone(record, peer)) await clearPair(tab.id);
  return { splitViewId, splitTabs, peer, record, peerRecord, ownership };
}
