import { loadConfig } from "./chrome/config-store.js";
import { RULE_ID, buildRedirectRule, leftHosts } from "./lib/rules.js";
import { clearPair } from "./chrome/split-state.js";
import { ownedPair, switchRight } from "./chrome/right-switch.js";
import { nextRightEngine, cycleCandidates } from "./lib/cycle.js";
import { lastSplitWindow } from "./chrome/split-actions.js";
import { rebuildMenus } from "./chrome/menus.js";
import { handleMenuClick } from "./chrome/lookup-actions.js";
import { handleCompleteMessage } from "./chrome/complete-actions.js";
import { serialQueue } from "./lib/serial.js";
import { isRevealSetup } from "./lib/messages.js";
import { safeArgs } from "./lib/safe-error.js";

const log = (...args) => console.error("[split-search]", ...safeArgs(args));

// SW 全局串行链（spec 3.1“SW 里的串行”）：右键查询与 ⑦ 的 complete-split 共用，每次在链上重新判定再执行，
// 两次几乎同时的右键不会都去建分屏。
const swQueue = serialQueue();

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

// 快捷键：最后聚焦的窗口能分屏、其中的活动标签属于本扩展的一对时，右侧换成下一个参与轮换的引擎
// （查询对换的是查询一侧；图片查询对在以图搜图引擎里轮换，见 cycleCandidates）。
// 最后聚焦的是 PiP（lastSplitWindow 不回退）、不是本扩展的、没有可换的引擎，都什么也不做，也不弹任何东西。
async function cycleRight() {
  const win = await lastSplitWindow({ fallback: false });
  if (!win) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab) return;
  const cfg = await loadConfig();
  const pair = await ownedPair(tab, cfg.engines);
  if (!pair) return;
  const { engines, exclude } = cycleCandidates(cfg, pair.kind, pair.left.engineId);
  const next = nextRightEngine(engines, pair.right.engineId, exclude);
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
// 右键菜单：安装/重新加载/更新、浏览器启动（界面语言可能变了）和 sync 的任何变化都完整重建（spec 3.6）
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
  rebuildRules();
  rebuildMenus();
});
chrome.runtime.onStartup.addListener(() => {
  rebuildRules();
  rebuildMenus();
});
chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName !== "sync") return;
  rebuildRules();
  rebuildMenus();
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
// 右键查询（② ⑧）：经 swQueue 串行；同样返回处理完成的 promise 供测试等待
chrome.contextMenus.onClicked.addListener((info, tab) =>
  swQueue(() => handleMenuClick(info, tab)).catch(err => log("lookup failed", err)));
// ⑦ 补成分屏（弹窗发来 complete-split）：同样经 swQueue 串行。return true 后用 sendResponse 异步回复，
// 不依赖“监听器返回 Promise”。只有本扩展自己的页面能发进来（没有 onMessageExternal、没有 externally_connectable），
// 发送方和字段在 handleCompleteMessage 里校验。弹窗发给设置页的 reveal-setup 也会送到这里：不回复、不处理，由设置页回复。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (isRevealSetup(msg)) return undefined;
  swQueue(() => handleCompleteMessage(msg, sender)).then(sendResponse, (err) => {
    log("complete-split failed", err);
    sendResponse({ ok: false, code: "split_failed" });
  });
  return true;
});
