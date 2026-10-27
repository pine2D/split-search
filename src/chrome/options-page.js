// 找已开的设置页、打开设置页的某个 tab（弹窗与 go.html 出错页共用）。runtime.getContexts 不需要 tabs 权限；
// 挑哪个页见 lib/messages.js 的 pickOptionsTab（优先调用方所在窗口里的，其次第一个）
import { pickOptionsTab } from "../lib/messages.js";
import { tabHash } from "../lib/options-route.js";

const OPTIONS_PAGE = "options/options.html";

async function lookup() {
  const optionsUrl = chrome.runtime.getURL(OPTIONS_PAGE);
  const [contexts, win] = await Promise.all([chrome.runtime.getContexts({ contextTypes: ["TAB"] }), chrome.windows.getCurrent()]);
  const found = pickOptionsTab(contexts, { optionsUrl, windowId: win?.id });
  return { optionsUrl, found, documentUrl: found && contexts.find(c => c.tabId === found.tabId)?.documentUrl };
}

// 已开的设置页 { tabId, windowId }，没有返回 null
export async function findOptionsTab() {
  return (await lookup()).found;
}

// key 是 lib/options-route.js 的 TAB_KEYS 之一，null 时照旧 runtime.openOptionsPage()（已开的页保持当前 tab）。
// 已开着设置页：切成活动标签、窗口拿焦点，网址换成 #tab-<key>（同一文档内改 hash，设置页的 hashchange 换 tab，不重载）；
// 网址已经是它就不导航（已在那个 tab）。没有设置页、或找页与切换出错（如那一页刚被关掉）：新开 options.html#tab-<key>
export async function openOptionsTab(key) {
  if (!key) return chrome.runtime.openOptionsPage();
  const url = chrome.runtime.getURL(OPTIONS_PAGE) + tabHash(key);
  try {
    const { found, documentUrl } = await lookup();
    if (found) {
      // 窗口拿不到焦点不算失败（页面已经切过去了），只有切页本身失败才新开
      chrome.windows.update(found.windowId, { focused: true }).catch(() => {});
      await chrome.tabs.update(found.tabId, documentUrl === url ? { active: true } : { url, active: true });
      return undefined;
    }
  } catch {
    // 落到下面新开一页
  }
  return chrome.tabs.create({ url });
}
