// 分屏动作：对 chrome.tabs / chrome.windows / chrome.storage.session 的薄封装。
// 每个分支返回当前标签接下来该做什么：
//   { replaceWith: url }  当前标签 location.replace(url)
//   { leave: true }       当前标签回到之前的页面（history.back 或关闭），由 go.js 执行
// 分支内的关键 chrome 调用失败时直接抛出，由 go.js 兜底打开左侧搜索。
import { sideOf } from "../lib/split-decision.js";

const log = (...args) => console.error("[split-search]", ...args);

// 在 withTab 右侧相邻位置新建标签，并尽量与 withTab 组成分屏。
// 分屏 API 抛错时 Chrome 会自己关掉失败的新标签，这里退化为普通相邻标签。
export async function createPaired(url, withTab) {
  const base = { url, index: withTab.index + 1, windowId: withTab.windowId, active: false };
  try {
    return await chrome.tabs.create({ ...base, splitWithTabId: withTab.id });
  } catch (err) {
    log("splitWithTabId 失败，改为普通标签", err);
    return await chrome.tabs.create(base);
  }
}

// 记录本扩展创建的标签对：一次写两个方向，不做读-改-写。
export async function recordPair(a, b) {
  try {
    await chrome.storage.session.set({ ["split:" + a]: b, ["split:" + b]: a });
  } catch (err) {
    log("记录分屏标签对失败", err);
  }
}

// 当前标签不在分屏中：右侧新建并与当前标签组成分屏，当前标签打开左侧。
export async function openNew({ tab, leftUrl, rightUrl }) {
  const right = await createPaired(rightUrl, tab);
  await recordPair(tab.id, right.id);
  return { replaceWith: leftUrl };
}

// 当前标签在本扩展的分屏中：就地更新两侧，左右位置不变。
export async function reuse({ tab, peer, leftUrl, rightUrl }) {
  const side = sideOf(tab.index, peer.index);
  await chrome.tabs.update(peer.id, { url: side === "left" ? rightUrl : leftUrl });
  await recordPair(tab.id, peer.id);
  return { replaceWith: side === "left" ? leftUrl : rightUrl };
}

// 当前标签在其他分屏中：另一侧不动，在该分屏右侧相邻位置新建一对标签。
export async function openForeign({ tab, splitTabs, leftUrl, rightUrl }) {
  const maxIndex = Math.max(tab.index, ...splitTabs.map(t => t.index));
  const newLeft = await chrome.tabs.create({
    url: leftUrl, index: maxIndex + 1, windowId: tab.windowId, active: true,
  });
  // 左侧已打开；右侧失败只记录，不再让当前标签兜底打开左侧（否则会出现两个左侧）。
  try {
    const right = await createPaired(rightUrl, newLeft);
    await recordPair(newLeft.id, right.id);
  } catch (err) {
    log("其他分屏：创建右侧失败", err);
  }
  return { leave: true };
}

// 当前窗口不是 normal（popup/app）：不能在这里调用分屏 API，改到一个 normal 窗口里新建一对。
export async function openInOtherWindow({ leftUrl, rightUrl }) {
  let target = null;
  try {
    target = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch (err) {
    log("没有可用的普通窗口，新建一个", err);
  }
  let newLeft;
  if (target) {
    newLeft = await chrome.tabs.create({ url: leftUrl, windowId: target.id, active: true });
  } else {
    const created = await chrome.windows.create({ type: "normal", url: leftUrl });
    newLeft = created.tabs[0];
  }
  try {
    const right = await createPaired(rightUrl, newLeft);
    await recordPair(newLeft.id, right.id);
  } catch (err) {
    log("其他窗口：创建右侧失败", err);
  }
  // 新分屏建在已有的后台窗口里时，把该窗口切到前台；新建的窗口本来就在前台
  if (target) {
    try {
      await chrome.windows.update(target.id, { focused: true });
    } catch (err) {
      log("其他窗口：切到前台失败", err);
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
    log("关闭当前标签失败，保留本页", err);
    return "kept";
  }
}

export const ACTIONS = {
  new: openNew,
  reuse,
  foreign: openForeign,
  "other-window": openInOtherWindow,
};
