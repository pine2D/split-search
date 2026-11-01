// 原生关闭搜索分屏的一侧时联动关闭另一侧。没有许可/完整证据就只清理，不根据网址推断。
import { linkKey, searchPair, observeClose, closingPeer } from "../lib/close-pair.js";
import { RECORD_PREFIX } from "../lib/split-owner.js";
import { withPairLock } from "./pair-lock.js";
import { readCloseState, linksIn, clearLinks, armPairs, consumePair } from "./close-store.js";
import { safeArgs } from "../lib/safe-error.js";

const KEY = "closePairTogether";
const log = (...args) => console.error("[split-search]", ...safeArgs(args));

// 必须在 SW 顶层调用：同步注册监听后才异步读取偏好。返回初始化 Promise，方便调用方等待/记录失败。
export function installClosePair(queue) {
  let enabled = null, revision = 0, motion = 0, preferenceReady;
  const pending = new Map();
  const blocked = new Set(); // 仅保留本实例撤销失败的许可；不把失败当作仍可关闭
  const current = rev => enabled === true && rev === revision;
  const forget = id => {
    for (const [closed, ev] of pending) if (closed === id || ev.peer === id) pending.delete(closed);
  };
  const run = (fn, required = false) => queue(async () => { await preferenceReady; return withPairLock(fn, { required }); })
    .catch(err => log("linked close skipped", err));

  async function end(pair) {
    forget(pair.a); forget(pair.b);
    blocked.add(pair.splitViewId);
    await chrome.storage.session.remove([linkKey(pair.splitViewId)]);
    blocked.delete(pair.splitViewId);
  }

  async function updated(id, v, snapshot, rev) {
    if (!current(rev)) return;
    const data = await readCloseState();
    for (const pair of linksIn(data, id)) {
      if (blocked.has(pair.splitViewId)) continue;
      if (v === pair.splitViewId) continue; // 创建时的事件，不是拆开
      if (v !== -1 || searchPair(pair.a, data)?.splitViewId !== pair.splitViewId) {
        await end(pair); continue;
      }
      const ids = await snapshot;
      if (!current(rev)) return;
      const previous = pending.get(pair.a) ?? pending.get(pair.b);
      const result = observeClose(pair, id, ids, previous);
      if (result.kind === "end") await end(pair);
      if (result.kind === "pending") pending.set(result.evidence.closed, { ...result.evidence, revision: rev });
    }
  }

  function onUpdated(id, change) {
    if (!("splitViewId" in change) || enabled === false) return;
    const rev = revision, v = change.splitViewId;
    // 在任何 await/排队/存储读取之前发送，避免分别查询两侧产生时间偏差；只使用 id。
    const snapshot = v === -1 ? chrome.tabs.query({}).then(ts => ts.map(t => t.id), err => {
      log("linked close snapshot unavailable", err); return null;
    }) : null;
    if (v !== -1) { motion++; forget(id); }
    return run(() => updated(id, v, snapshot, rev), true);
  }

  function onMoved(id) {
    motion++; forget(id); // 同步撤销正在 await tabs.get 的关闭判定
    if (enabled === false) return;
    return run(async () => {
      for (const pair of linksIn(await readCloseState(), id)) await end(pair);
    }, true);
  }

  function onRemoved(id, info) {
    const rev = revision;
    // 先进入 SW 队列，让之前的 -1 事件形成证据；再消费内存证据，等待跨上下文锁。
    return queue(async () => {
      await preferenceReady;
      const ev = pending.get(id); forget(id);
      const wasBlocked = ev && blocked.has(ev.splitViewId);
      if (ev) blocked.add(ev.splitViewId);
      try {
        await withPairLock(async () => {
          const moved = motion;
          const data = await readCloseState();
          const peer = current(rev) && ev?.revision === rev && !wasBlocked && !info.isWindowClosing
            ? closingPeer(ev, data, data[linkKey(ev.splitViewId)]) : null;
          // 删除成功才可发出关闭；新配对只按最新互指关系清理，不用事件时的旧记录删除。
          await consumePair(id, data);
          if (ev) blocked.delete(ev.splitViewId);
          if (peer === null) return;
          const pref = await chrome.storage.sync.get(KEY);
          if (pref[KEY] !== true || !current(rev)) return;
          const tab = await chrome.tabs.get(peer);
          if (tab.splitViewId !== -1 || tab.windowId !== info.windowId || !current(rev) || motion !== moved) return;
          // beforeunload 取消后 Promise 可能长期 pending：不 await、不 return、不自动重试。
          chrome.tabs.remove(peer).catch(err => log("linked close request failed", err));
        }, { required: enabled !== false });
      } catch (err) { log("linked close skipped", err); }
    });
  }

  function listenUpdates() {
    if (enabled === true && !chrome.tabs.onUpdated.hasListener(onUpdated)) chrome.tabs.onUpdated.addListener(onUpdated);
    if (enabled === false) chrome.tabs.onUpdated.removeListener(onUpdated);
  }

  async function configure(rev, reset) {
    if (rev !== revision) return;
    if (reset || enabled === false) await clearLinks();
    if (current(rev)) await armPairs(null, () => current(rev), blocked);
  }

  function onChanged(changes, area) {
    if (area === "sync" && KEY in changes) {
      const rev = ++revision;
      enabled = changes[KEY].newValue === true;
      pending.clear(); blocked.clear(); listenUpdates();
      return run(() => configure(rev, true));
    }
    if (area !== "session" || enabled === false) return;
    const ids = Object.keys(changes).filter(k => k.startsWith(RECORD_PREFIX)).map(k => Number(k.slice(RECORD_PREFIX.length)));
    if (!ids.length) return; // 不响应自己签发/消费 linked:* 的变化
    const rev = revision;
    return run(async () => { if (current(rev)) await armPairs(ids, () => current(rev), blocked); }, true);
  }

  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  chrome.tabs.onDetached.addListener(onMoved);
  chrome.tabs.onAttached.addListener(onMoved);
  chrome.storage.onChanged.addListener(onChanged);
  preferenceReady = chrome.storage.sync.get(KEY).then(pref => {
    if (revision !== 0) return;
    enabled = pref[KEY] === true;
    listenUpdates();
  }).catch(err => {
    if (revision === 0) { enabled = false; listenUpdates(); }
    log("linked close setting unavailable", err);
  });
  return preferenceReady.then(() => run(() => configure(0, false)));
}
