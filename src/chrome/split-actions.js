// 分屏动作：对 chrome.tabs / chrome.windows 的薄封装（记录经 split-state.js 写入 storage.session）。
// 每个分支返回当前标签接下来该做什么：
//   { replaceWith: url }  当前标签 location.replace(url)
//   { leave: true }       当前标签回到之前的页面（history.back 或关闭），由 go.js 执行
// 分支内的关键 chrome 调用失败时直接抛出，由 go.js 兜底打开左侧搜索。
import { sideOf } from "../lib/split-decision.js";
import { isNarrow } from "../lib/narrow.js";
import { writePair, clearPair } from "./split-state.js";

const log = (...args) => console.error("[split-search]", ...args);

// 两个标签真的在同一个分屏里才返回该 splitViewId，否则返回 -1。
// 两个标签都重新读一次，读到的值一致且不是 -1 才算数；任一读取抛错也算不一致。
async function readSplitViewId(aId, bId) {
  try {
    const [a, b] = await Promise.all([chrome.tabs.get(aId), chrome.tabs.get(bId)]);
    const v = a.splitViewId ?? -1;
    return v !== -1 && b.splitViewId === v ? v : -1;
  } catch (err) {
    log("failed to re-read the tabs after creating the split", err);
    return -1;
  }
}

// 分屏 API 已经成功返回后的复核：第一次读到不一致时，稍等再读一次（标签状态可能还没更新）。
const CONFIRM_RETRY_MS = 150;
async function confirmedSplitViewId(aId, bId) {
  const v = await readSplitViewId(aId, bId);
  if (v !== -1) return v;
  await new Promise(r => setTimeout(r, CONFIRM_RETRY_MS));
  const again = await readSplitViewId(aId, bId);
  if (again === -1) log("the two tabs did not end up in the same split view");
  return again;
}

// 在 withTab 右侧相邻位置新建标签，split 为 true 时尽量与 withTab 组成分屏。
// 分屏 API 抛错时 Chrome 会自己关掉失败的新标签，这里退化为普通相邻标签。
// 返回 { tab, splitViewId }：splitViewId 为 -1 表示没有建成分屏，调用方不写 split 记录。
export async function createPaired(url, withTab, { split = true } = {}) {
  const base = { url, index: withTab.index + 1, windowId: withTab.windowId, active: false };
  if (!split) return { tab: await chrome.tabs.create(base), splitViewId: -1 };
  let tab;
  try {
    tab = await chrome.tabs.create({ ...base, splitWithTabId: withTab.id });
  } catch (err) {
    log("splitWithTabId failed, falling back to a plain tab", err);
    return { tab: await chrome.tabs.create(base), splitViewId: -1 };
  }
  return { tab, splitViewId: await confirmedSplitViewId(withTab.id, tab.id) };
}

// 新建的一对写记录：真分屏写 split；窄窗口降级（adjacent）写 adjacent 记录；
// 想分屏却退化成普通标签时不写。left 显示 leftId，right 显示 rightId。
async function recordNewPair(left, paired, { leftId, rightId, query }, adjacent) {
  if (paired.splitViewId === -1 && !adjacent) return;
  await writePair({
    a: left.id, b: paired.tab.id, splitViewId: paired.splitViewId, mode: adjacent ? "adjacent" : "split",
    engineA: leftId, engineB: rightId, query,
  });
}

// 在 left 右侧新建右侧标签并记录；窄窗口时不分屏，改记相邻对。
async function openRight(left, rightUrl, narrow, ids) {
  const paired = await createPaired(rightUrl, left, { split: !narrow });
  await recordNewPair(left, paired, ids, narrow);
}

// 当前标签不在分屏中：右侧新建并与当前标签组成分屏（窄窗口则只在旁边开后台标签），当前标签打开左侧。
export async function openNew({ tab, win, leftUrl, rightUrl, leftId, rightId, query, narrowEnabled }) {
  await openRight(tab, rightUrl, isNarrow(win?.width, narrowEnabled), { leftId, rightId, query });
  return { replaceWith: leftUrl };
}

// 就地更新两侧，左右位置不变（index 小的在左）。对侧先换网址，再由 settle() 给出要记下的 splitViewId：
// 不是 -1 记 "split"，是 -1 记 "adjacent"；null 表示状态不明，删掉旧记录、不写新的
// （之后的触发按两个标签的实际状态判定）。返回当前标签要打开的网址。
async function refreshPair({ tab, peer, leftUrl, rightUrl, leftId, rightId, query }, settle) {
  const tabIsLeft = sideOf(tab.index, peer.index) === "left";
  await chrome.tabs.update(peer.id, { url: tabIsLeft ? rightUrl : leftUrl });
  const splitViewId = await settle(tabIsLeft);
  if (splitViewId === null) {
    await clearPair(tab.id);
    return { replaceWith: tabIsLeft ? leftUrl : rightUrl };
  }
  await writePair({
    a: tab.id, b: peer.id, splitViewId, mode: splitViewId !== -1 ? "split" : "adjacent",
    engineA: tabIsLeft ? leftId : rightId, engineB: tabIsLeft ? rightId : leftId, query,
  });
  return { replaceWith: tabIsLeft ? leftUrl : rightUrl };
}

// 当前标签在本扩展的分屏或相邻对中（相邻对只在窗口仍窄时走这里）：记录沿用现状，
// 分屏中是当前 splitViewId + "split"，相邻对是 -1 + "adjacent"。
export async function reuse(ctx) {
  return refreshPair(ctx, async () => ctx.splitViewId);
}

// 本扩展的相邻对，但窗口已经不窄（或关掉了降级开关）：更新对侧后用 createSplit 把这两个标签拼成分屏
// （createSplit(tabIds) 要求两个标签相邻，按 [左, 右] 传），复核两侧的 splitViewId 后改记 "split"。
// createSplit 抛错时只记日志，退回相邻对的复用（记 adjacent）；左侧照常打开。
// createSplit 成功但复核两次都不一致时，两个标签可能已经在分屏里：不写 adjacent 记录（那会让这一对
// 被当成相邻对、拖开即永久失效），清掉旧记录，之后的触发按实际状态（分屏兜底或新开一对）判定。
export async function join(ctx) {
  const { tab, peer } = ctx;
  return refreshPair(ctx, async (tabIsLeft) => {
    const [left, right] = tabIsLeft ? [tab.id, peer.id] : [peer.id, tab.id];
    try {
      await chrome.tabs.createSplit([left, right]);
    } catch (err) {
      log("failed to join the adjacent pair into a split view, keeping it as an adjacent pair", err);
      return -1;
    }
    const v = await confirmedSplitViewId(left, right);
    return v === -1 ? null : v;
  });
}

// 当前标签在其他分屏中：另一侧不动，在该分屏右侧相邻位置新建一对标签。
export async function openForeign({ tab, win, splitTabs, leftUrl, rightUrl, leftId, rightId, query, narrowEnabled }) {
  const maxIndex = Math.max(tab.index, ...splitTabs.map(t => t.index));
  const newLeft = await chrome.tabs.create({
    url: leftUrl, index: maxIndex + 1, windowId: tab.windowId, active: true,
  });
  // 左侧已打开；右侧失败只记录，不再让当前标签兜底打开左侧（否则会出现两个左侧）。
  try {
    await openRight(newLeft, rightUrl, isNarrow(win?.width, narrowEnabled), { leftId, rightId, query });
  } catch (err) {
    log("foreign split: failed to create the right side", err);
  }
  return { leave: true };
}

// 当前窗口不是 normal（popup/app）：不能在这里调用分屏 API，改到一个 normal 窗口里新建一对。
export async function openInOtherWindow({ leftUrl, rightUrl, leftId, rightId, query, narrowEnabled }) {
  let target = null;
  try {
    target = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch (err) {
    log("no normal window available, creating one", err);
  }
  let newLeft;
  let width = target?.width;
  if (target) {
    newLeft = await chrome.tabs.create({ url: leftUrl, windowId: target.id, active: true });
  } else {
    const created = await chrome.windows.create({ type: "normal", url: leftUrl });
    newLeft = created.tabs[0];
    width = created.width;
  }
  try {
    await openRight(newLeft, rightUrl, isNarrow(width, narrowEnabled), { leftId, rightId, query });
  } catch (err) {
    log("other window: failed to create the right side", err);
  }
  // 新分屏建在已有的后台窗口里时，把该窗口切到前台；新建的窗口本来就在前台
  if (target) {
    try {
      await chrome.windows.update(target.id, { focused: true });
    } catch (err) {
      log("other window: failed to focus it", err);
    }
  }
  return { replaceWith: leftUrl };
}

// 其他分屏分支之后：当前标签回到被替换之前的页面；没有历史就关闭，关不掉就保留本页。
// 返回 "back" | "closed" | "kept"。hist 默认是页面的 history，测试时可传入替身。
export async function leaveTab(tab, hist = globalThis.history) {
  if (hist.length > 1) {
    hist.back();
    return "back";
  }
  try {
    await chrome.tabs.remove(tab.id);
    return "closed";
  } catch (err) {
    log("failed to close the current tab, keeping this page", err);
    return "kept";
  }
}

export const ACTIONS = {
  new: openNew,
  reuse,
  join,
  foreign: openForeign,
  "other-window": openInOtherWindow,
};
