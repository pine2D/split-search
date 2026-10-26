// 分屏记录读写与归属检查：对 chrome.tabs / chrome.storage.session 的薄封装。
// 记录形状与归属规则见 lib/split-owner.js。storage 读写失败一律只记日志：
// 读失败当作没有记录，写失败不影响已经打开的页面。
import { recordKey, parseRecord, makeRecords, judgeOwnership, staleMarker } from "../lib/split-owner.js";
import { safeArgs } from "../lib/safe-error.js";

const log = (...args) => console.error("[split-search]", ...safeArgs(args));

// 记录写入（writePair / writeEngine / clearPair / markStale）在同一个上下文（页面或 SW）里串行执行：
// clearPair 先读后删，不串行时紧随其后的 writePair 会被它删掉。每个操作自己吞掉错误，链不会断。
// 跨上下文（go.html、弹窗、SW 各自一条链）仍可能交错；最坏结果是记录被删或被标成失效，
// 之后判成 stale / none（不覆盖、新开一对），方向是安全的，不会把别人的标签当成本扩展的。
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

export async function readRecord(tabId) {
  try {
    const key = recordKey(tabId);
    return parseRecord((await chrome.storage.session.get(key))[key]);
  } catch (err) {
    log("failed to read the split record", tabId, err);
    return null;
  }
}

// 一次 set 写两个方向，不做读-改-写。roleA/roleB/input 原样交给 makeRecords（不传时是搜索对）；
// 组合不合法时 makeRecords 抛错，这里记日志、一条都不写（之后按“没有记录”判定，不会覆盖任何标签）。
// 返回是否写成（true / false），不抛错
export function writePair({ a, b, splitViewId, mode, engineA, engineB, query, roleA, roleB, input }) {
  return serial(async () => {
    try {
      await chrome.storage.session.set(makeRecords({ a, b, splitViewId, mode, engineA, engineB, query, roleA, roleB, input }));
      return true;
    } catch (err) {
      log("failed to record the split tab pair", err);
      return false;
    }
  });
}

// 只改这一条记录显示的引擎，对侧记录不动
export function writeEngine(tabId, record, engine) {
  return serial(async () => {
    try {
      await chrome.storage.session.set({ [recordKey(tabId)]: { ...record, engine } });
    } catch (err) {
      log("failed to update the split record", tabId, err);
    }
  });
}

// 自己的记录，加上指回自己的对侧记录（不碰对侧和别的标签重新建立的记录）
async function pairRecords(tabId) {
  const own = await readRecord(tabId);
  const peerRecord = own ? await readRecord(own.peer) : null;
  return { own, peerRecord: peerRecord?.peer === tabId ? peerRecord : null };
}

// 删掉自己的记录；对侧记录只有指回自己时才一并删
export function clearPair(tabId) {
  return serial(async () => {
    const { own, peerRecord } = await pairRecords(tabId);
    const keys = [recordKey(tabId)];
    if (peerRecord) keys.push(recordKey(own.peer));
    try {
      await chrome.storage.session.remove(keys);
    } catch (err) {
      log("failed to clear the split record", tabId, err);
    }
  });
}

// 把自己的记录（和指回自己的对侧记录）改写成永久失效标记（见 split-owner.js 的 staleMarker）
function markStale(tabId) {
  return serial(async () => {
    const { own, peerRecord } = await pairRecords(tabId);
    if (!own) return;
    const next = { [recordKey(tabId)]: staleMarker(own) };
    if (peerRecord) next[recordKey(own.peer)] = staleMarker(peerRecord);
    try {
      await chrome.storage.session.set(next);
    } catch (err) {
      log("failed to mark the split record stale", tabId, err);
    }
  });
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
// 读到失效记录（stale）时，记录里的对侧已经关掉就顺手清理。对侧还在时保留记录：
// 用户拆开后再把这两个标签拼回去，它们仍判 stale（不是本扩展的），不会落到兜底被当成本扩展分屏覆盖。
// 相邻记录（adjacent）失效时还要改写成永久失效标记：否则拖开后再拖回相邻，又会重新判成 own（spec 3.3）。
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
  if (ownership === "stale" && record) {
    if (await recordedPeerGone(record, peer)) await clearPair(tab.id);
    else if (record.mode === "adjacent") await markStale(tab.id);
  }
  return { splitViewId, splitTabs, peer, record, peerRecord, ownership };
}
