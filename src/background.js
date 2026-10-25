import { loadConfig } from "./chrome/config-store.js";
import { RULE_ID, buildRedirectRule, leftHosts } from "./lib/rules.js";
import { clearPair } from "./chrome/split-state.js";
import { ownedPair, switchRight } from "./chrome/right-switch.js";
import { nextRightEngine } from "./lib/cycle.js";
import { lastSplitWindow } from "./chrome/split-actions.js";

const log = (...args) => console.error("[split-search]", ...args);

async function doRebuild() {
  try {
    const { engines } = await loadConfig();
    const rule = buildRedirectRule(chrome.runtime.id, leftHosts(engines));
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: rule ? [rule] : [],
    });
  } catch (err) {
    log("rebuildRules failed", err);
  }
}

// 快捷键：最后聚焦的窗口能分屏、其中的活动标签属于本扩展的一对时，右侧换成下一个参与轮换的引擎。
// 最后聚焦的是 PiP（lastSplitWindow 不回退）、不是本扩展的、没有可换的引擎，都什么也不做，也不弹任何东西。
async function cycleRight() {
  const win = await lastSplitWindow({ fallback: false });
  if (!win) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab) return;
  const { engines, cycleExclude } = await loadConfig();
  const pair = await ownedPair(tab, engines);
  if (!pair) return;
  const next = nextRightEngine(engines, pair.right.engineId, cycleExclude);
  if (!next) return;
  await switchRight(pair, next);
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
// 点工具栏图标打开 action.default_popup（有弹窗时 action.onClicked 不再触发），设置页从弹窗进入。
// 标签关闭时删掉它的分屏记录；对侧记录只有指回它时才删。clearPair 自己吞掉错误。
chrome.tabs.onRemoved.addListener((tabId) => { clearPair(tabId); });
// 返回处理完成的 promise（Chrome 不用这个返回值），测试据此等它跑完
chrome.commands.onCommand.addListener((command) => {
  if (command !== "cycle-right") return undefined;
  return cycleRight().catch(err => log("cycle-right failed", err));
});
