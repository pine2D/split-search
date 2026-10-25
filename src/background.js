import { loadConfig } from "./chrome/config-store.js";
import { RULE_ID, buildRedirectRule, leftHosts } from "./lib/rules.js";
import { clearPair } from "./chrome/split-state.js";

async function doRebuild() {
  try {
    const { engines } = await loadConfig();
    const rule = buildRedirectRule(chrome.runtime.id, leftHosts(engines));
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: rule ? [rule] : [],
    });
  } catch (err) {
    console.error("[split-search] rebuildRules failed", err);
  }
}

// 串行化：后一次重建一定读到最新配置，旧配置不会后写覆盖新配置。
let chain = Promise.resolve();
function rebuildRules() {
  chain = chain.then(doRebuild, doRebuild);
  return chain;
}

// 监听器必须在顶层同步注册（MV3 service worker 要求）。
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
  rebuildRules();
});
chrome.runtime.onStartup.addListener(rebuildRules);
chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "sync") rebuildRules();
});
chrome.permissions.onAdded.addListener(rebuildRules);
chrome.permissions.onRemoved.addListener(rebuildRules);
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
// 标签关闭时删掉它的分屏记录；对侧记录只有指回它时才删。clearPair 自己吞掉错误。
chrome.tabs.onRemoved.addListener((tabId) => { clearPair(tabId); });
