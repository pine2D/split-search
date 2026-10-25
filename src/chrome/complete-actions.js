// ⑦ 把现有搜索补成分屏的执行（spec 3.2“执行放在 SW”）：在 SW 的串行链上运行，对 chrome.tabs / chrome.windows 的薄封装。
// 弹窗只发 { type: "complete-split", tabId, engineId }，不带网址和关键词：SW 重新读标签、重新识别、重新判定，
// 条件仍满足才建。当前标签（左侧）不导航，只在它右边新建右侧（后台）。只读标签的 url，不保存网址本身。
import { validateCompleteMessage } from "../lib/messages.js";
import { matchResultPage } from "../lib/result-match.js";
import { splitWindowType } from "../lib/window-kind.js";
import { isNarrow } from "../lib/narrow.js";
import { expandTemplate } from "../lib/trigger.js";
import { loadConfig } from "./config-store.js";
import { inspectTab } from "./split-state.js";
import { openRight } from "./split-actions.js";
import { safeArgs } from "../lib/safe-error.js";

const log = (...args) => console.error("[split-search]", ...safeArgs(args));
// 预期的拒绝只记 info 级，只带错误码，不带标签网址和关键词
const rejected = (code) => {
  console.info("[split-search]", "complete rejected", code);
  return { ok: false, code };
};

// 返回 { ok: true, mode: "split" | "adjacent" | "plain" } 或 { ok: false, code }。
// 读配置、窗口、记录时抛错原样抛出，由 background.js 的监听器记日志并回 split_failed。
export async function handleCompleteMessage(msg, sender) {
  const cfg = await loadConfig();
  const v = validateCompleteMessage(msg, sender, {
    extId: chrome.runtime.id, popupUrl: chrome.runtime.getURL("popup/popup.html"), engines: cfg.engines,
  });
  if (!v.ok) return rejected(v.code);
  // 标签关掉了（No tab with id），或跨 origin 导航让 activeTab 失效（url 为 undefined）：页面已经变了
  let tab;
  try {
    tab = await chrome.tabs.get(v.tabId);
  } catch {
    return rejected("not_results_page");
  }
  const match = matchResultPage(tab.url, cfg);
  if (!match) return rejected("not_results_page");
  // 弹窗的按钮本来就排除了识别出的引擎
  if (v.engineId === match.engine.id) return rejected("message_rejected");
  // 带 populate 读窗口：标签数用来区分 PiP 与窗口管理器置顶的普通窗口（window-kind.js）
  const win = await chrome.windows.get(tab.windowId, { populate: true });
  if (splitWindowType(win) !== "normal") return rejected("window_unsupported");
  // 已在分屏中，或已是本扩展的一对（如相邻对）：弹窗该显示的不是“补成分屏”，页面已经变了
  const { splitViewId, ownership } = await inspectTab(tab, cfg.engines);
  if (splitViewId !== -1 || ownership === "own") return rejected("not_results_page");
  const right = cfg.engines.find(e => e.id === v.engineId);
  try {
    const mode = await openRight(tab, expandTemplate(right.url, match.query), isNarrow(win.width, cfg.narrowFallback), {
      leftId: match.engine.id, rightId: right.id, query: match.query,
    });
    return { ok: true, mode };
  } catch (err) {
    log("complete: failed to open the right side", err);
    return { ok: false, code: "split_failed" };
  }
}
