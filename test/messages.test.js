import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCompleteMessage } from "../src/lib/messages.js";
import { mergeConfig } from "../src/lib/engines.js";

const ctx = { extId: "abc", popupUrl: "chrome-extension://abc/popup/popup.html", engines: mergeConfig({}).engines };
const sender = { id: "abc", url: "chrome-extension://abc/popup/popup.html?tabId=5" };
const msg = { type: "complete-split", tabId: 5, engineId: "bing" };
test("合法消息", () => assert.deepEqual(validateCompleteMessage(msg, sender, ctx), { ok: true, tabId: 5, engineId: "bing" }));
test("sender.url 不带 ?tabId=、带 fragment、tabId 为 0 都算", () => {
  const s = { id: "abc", url: "chrome-extension://abc/popup/popup.html" };
  assert.deepEqual(validateCompleteMessage({ ...msg, tabId: 0 }, s, ctx), { ok: true, tabId: 0, engineId: "bing" });
  assert.equal(validateCompleteMessage(msg, { id: "abc", url: "chrome-extension://abc/popup/popup.html#x" }, ctx).ok, true);
});
test("发送方与字段不对一律拒绝", () => {
  const bad = [
    [msg, { ...sender, id: "evil" }], [msg, { ...sender, url: "chrome-extension://abc/options/options.html" }],
    [msg, { ...sender, url: "chrome-extension://abc/popup/popup.html.evil" }], [msg, { id: "abc" }],
    [msg, { ...sender, url: "chrome-extension://evil/popup/popup.html" }],
    [msg, { ...sender, url: "https://abc/popup/popup.html" }], [msg, { ...sender, url: "::" }],
    [msg, null], [msg, undefined],
    [{ ...msg, type: "x" }, sender], [{ ...msg, tabId: -1 }, sender], [{ ...msg, tabId: 1.5 }, sender],
    [{ ...msg, tabId: "5" }, sender], [{ ...msg, engineId: "lens" }, sender], [{ ...msg, engineId: "gone" }, sender], [null, sender],
    [{ ...msg, engineId: undefined }, sender], ["complete-split", sender],
  ];
  for (const [m, s] of bad) assert.deepEqual(validateCompleteMessage(m, s, ctx), { ok: false, code: "message_rejected" });
  const hidden = { ...ctx, engines: mergeConfig({ presetOverrides: { ddg: { hidden: true } } }).engines };
  assert.equal(validateCompleteMessage({ ...msg, engineId: "ddg" }, sender, hidden).ok, false);
});
test("popupUrl 解析失败也拒绝", () => {
  assert.equal(validateCompleteMessage(msg, sender, { ...ctx, popupUrl: "::" }).ok, false);
});
