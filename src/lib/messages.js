// 扩展页面之间的消息校验与“找已开的设置页”。纯逻辑，不得引用 chrome。
// complete-split：弹窗发给 SW（spec 3.2“SW 校验”）；reveal-setup：弹窗发给已开的设置页（ui-polish spec 第 4 节）。

export const REVEAL_SETUP = "reveal-setup";

// 只比 protocol + "//" + host + pathname，不比查询串和 fragment（e2e 的 ?tabId= 接缝、设置页的 #setup 照样算）。
// 不用 URL.origin：chrome-extension: 网址在 Node 里的 origin 是 "null"，在 Chrome 里才是扩展 origin。
function pageKey(s) {
  if (typeof s !== "string") return null;
  try {
    const u = new URL(s);
    return u.protocol + "//" + u.host + u.pathname;
  } catch {
    return null;
  }
}

// 发送方是本扩展的 popup/popup.html（extId 是 chrome.runtime.id，popupUrl 是 runtime.getURL("popup/popup.html")）
function fromPopup(sender, extId, popupUrl) {
  if (typeof extId !== "string" || !extId || sender?.id !== extId) return false;
  const want = pageKey(popupUrl);
  return want !== null && pageKey(sender.url) === want;
}

// msg 应为 { type: "complete-split", tabId, engineId }；sender 是 runtime.onMessage 的发送方。
// engines 是未隐藏的文字引擎。
export function validateCompleteMessage(msg, sender, { extId, popupUrl, engines }) {
  const reject = { ok: false, code: "message_rejected" };
  if (!fromPopup(sender, extId, popupUrl)) return reject;
  if (!msg || typeof msg !== "object" || msg.type !== "complete-split") return reject;
  const { tabId, engineId } = msg;
  if (!Number.isInteger(tabId) || tabId < 0) return reject;
  if (typeof engineId !== "string" || !engines.some(e => e.id === engineId)) return reject;
  return { ok: true, tabId, engineId };
}

// SW 遇到 reveal-setup 不回复、不处理：只看 type
export const isRevealSetup = msg => !!msg && typeof msg === "object" && msg.type === REVEAL_SETUP;

// 设置页收到 { type: "reveal-setup", tabId }：消息会送到本扩展所有页面，只有弹窗选中的那个设置页
// （tabId 是本页所在标签，读不到时为 null）处理，发送方必须是本扩展的弹窗
export function acceptRevealSetup(msg, sender, { extId, popupUrl, tabId }) {
  if (!isRevealSetup(msg) || !fromPopup(sender, extId, popupUrl)) return false;
  return Number.isInteger(tabId) && msg.tabId === tabId;
}

// 弹窗找已开的设置页：contexts 是 runtime.getContexts({ contextTypes: ["TAB"] }) 的结果
// （documentUrls 过滤要求网址连 fragment 一字不差，实测；所以不用它，这里按路径比）。
// 优先 windowId（弹窗所在窗口）里的，其次第一个；没有返回 null
export function pickOptionsTab(contexts, { optionsUrl, windowId }) {
  const want = pageKey(optionsUrl);
  if (want === null || !Array.isArray(contexts)) return null;
  const tabs = contexts.filter(c => c?.contextType === "TAB" && Number.isInteger(c.tabId) && c.tabId >= 0
    && Number.isInteger(c.windowId) && c.windowId >= 0 && pageKey(c.documentUrl) === want);
  const hit = tabs.find(c => c.windowId === windowId) ?? tabs[0];
  return hit ? { tabId: hit.tabId, windowId: hit.windowId } : null;
}
