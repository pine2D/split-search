// 触发处理页：解析 go.html?u=<原始网址>，判定分屏动作并执行。只做编排。
import { extractOriginalUrl, parseTrigger, expandTemplate, stripMarker } from "./lib/trigger.js";
import { decideSplit } from "./lib/split-decision.js";
import { engineOrigin } from "./lib/engines.js";
import { loadConfig } from "./chrome/config-store.js";
import { ACTIONS, leaveTab } from "./chrome/split-actions.js";

const log = (...args) => console.error("[split-search]", ...args);
const $ = (id) => document.getElementById(id);

function setStatus(text) {
  $("status").textContent = text;
}

function showError(message) {
  setStatus("无法打开分屏");
  $("error-message").textContent = message;
  $("error").hidden = false;
}

// “只打开左侧搜索”按钮：去掉 _ss 后的原始网址就是一次普通的左侧搜索；网址不可用时不显示
function offerLeftOnly(original) {
  const url = original === null ? null : safeOriginal(original);
  const btn = $("left-only");
  btn.hidden = !url;
  btn.onclick = url ? () => location.replace(url) : null;
}

// 读不到配置时的兜底：原始网址去掉 _ss 本身就是一次左侧搜索。
function safeOriginal(original) {
  try {
    const { protocol } = new URL(original);
    return protocol === "https:" || protocol === "http:" ? stripMarker(original) : null;
  } catch {
    return null;
  }
}

// 收集判定所需的上下文。tabs.query({ splitViewId }) 不需要 tabs 权限；
// 只有已授权 origin 上的标签才读得到 url。
async function gatherContext() {
  const tab = await chrome.tabs.getCurrent();
  if (!tab) throw new Error("tabs.getCurrent() 没有返回标签");
  const win = await chrome.windows.get(tab.windowId);
  const splitViewId = tab.splitViewId ?? -1;
  let splitTabs = [];
  let peer = null;
  if (splitViewId !== -1) {
    splitTabs = await chrome.tabs.query({ splitViewId });
    const other = splitTabs.find(t => t.id !== tab.id);
    peer = other ? { id: other.id, index: other.index, url: other.url } : null;
  }
  let recordedPeerId;
  try {
    recordedPeerId = (await chrome.storage.session.get("split:" + tab.id))["split:" + tab.id];
  } catch (err) {
    log("读取分屏记录失败", err);
  }
  return { tab, win, splitViewId, splitTabs, peer, recordedPeerId };
}

// 逐个计算引擎 origin：某个模板坏了只跳过它，不影响分屏
function originsOf(engines) {
  const origins = [];
  for (const e of engines) {
    try {
      origins.push(engineOrigin(e));
    } catch (err) {
      log("引擎网址无效，判定时跳过", e?.id, err);
    }
  }
  return origins;
}

async function split(engines, leftUrl, rightUrl) {
  const ctx = await gatherContext();
  const action = decideSplit({
    windowType: ctx.win.type,
    splitViewId: ctx.splitViewId,
    peer: ctx.peer,
    recordedPeerId: ctx.recordedPeerId,
    engineOrigins: originsOf(engines),
  });
  const outcome = await ACTIONS[action]({ ...ctx, leftUrl, rightUrl });
  if (!outcome.leave) {
    location.replace(outcome.replaceWith);
  } else if (await leaveTab(ctx.tab) === "kept") {
    setStatus("已在右侧新分屏中打开搜索结果，可以关闭本页。");
  }
}

async function main() {
  $("error").hidden = true;
  $("left-only").hidden = true;
  setStatus("正在打开分屏…");

  const original = extractOriginalUrl(location.search);
  if (original === null) {
    showError("没有收到触发网址。请从地址栏或拖拽搜索进入，不要直接打开本页。");
    return;
  }

  let engines;
  try {
    ({ engines } = await loadConfig());
  } catch (err) {
    log("读取配置失败", err);
    const fallback = safeOriginal(original);
    if (fallback) location.replace(fallback);
    else showError("读取配置失败，且触发网址无法识别。");
    return;
  }

  const parsed = parseTrigger(original, engines);
  if (!parsed.ok) {
    showError(parsed.error);
    offerLeftOnly(original);
    return;
  }

  const { left, right, query } = parsed;
  let leftUrl;
  try {
    leftUrl = query === "" ? expandTemplate(left.url, "") : stripMarker(original);
  } catch (err) {
    log("生成左侧网址失败", err);
    showError(`${left.name} 的网址模板无效，请到设置页检查。`);
    return;
  }

  try {
    const rightUrl = expandTemplate(right.url, query);
    await split(engines, leftUrl, rightUrl);
  } catch (err) {
    log("分屏失败，只打开左侧", err);
    location.replace(leftUrl);
  }
}

function start() {
  $("open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage().catch(err => log("打开设置失败", err));
  });

  // 防重入：后退/前进/刷新回到本页时不自动分屏，只给“重新执行”按钮。
  const navType = performance.getEntriesByType("navigation")[0]?.type;
  if (navType === "back_forward" || navType === "reload") {
    setStatus("本页不会自动重复打开分屏。");
    offerLeftOnly(extractOriginalUrl(location.search));
    const rerun = $("rerun");
    rerun.hidden = false;
    rerun.addEventListener("click", () => {
      rerun.hidden = true;
      main().catch(err => log("重新执行失败", err));
    }, { once: true });
    return;
  }
  main().catch(err => log("go.js 未处理的错误", err));
}

start();
