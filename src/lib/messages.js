// 弹窗发给 SW 的消息校验（spec 3.2“SW 校验”）。纯逻辑，不得引用 chrome。

// 只比 protocol + "//" + host + pathname，不比查询串和 fragment（e2e 的 ?tabId= 接缝照样算）。
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

// msg 应为 { type: "complete-split", tabId, engineId }；sender 是 runtime.onMessage 的发送方。
// extId 是 chrome.runtime.id，popupUrl 是 runtime.getURL("popup/popup.html")，engines 是未隐藏的文字引擎。
export function validateCompleteMessage(msg, sender, { extId, popupUrl, engines }) {
  const reject = { ok: false, code: "message_rejected" };
  if (typeof extId !== "string" || !extId || sender?.id !== extId) return reject;
  const want = pageKey(popupUrl);
  if (want === null || pageKey(sender.url) !== want) return reject;
  if (!msg || typeof msg !== "object" || msg.type !== "complete-split") return reject;
  const { tabId, engineId } = msg;
  if (!Number.isInteger(tabId) || tabId < 0) return reject;
  if (typeof engineId !== "string" || !engines.some(e => e.id === engineId)) return reject;
  return { ok: true, tabId, engineId };
}
