import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCompleteMessage, isRevealSetup, acceptRevealSetup, pickOptionsTab } from "../src/lib/messages.js";
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

// ---- reveal-setup：弹窗让已开的设置页滚到“开始使用”卡 ----
const rctx = { extId: "abc", popupUrl: "chrome-extension://abc/popup/popup.html", tabId: 7 };
const reveal = { type: "reveal-setup", tabId: 7 };
test("isRevealSetup 只看 type", () => {
  assert.equal(isRevealSetup(reveal), true);
  assert.equal(isRevealSetup({ type: "reveal-setup" }), true);
  for (const m of [null, undefined, "reveal-setup", {}, { type: "complete-split" }, { type: "Reveal-setup" }]) assert.equal(isRevealSetup(m), false);
});
test("acceptRevealSetup：发送方是本扩展弹窗、tabId 是本页标签才接受", () => {
  assert.equal(acceptRevealSetup(reveal, sender, rctx), true);
  assert.equal(acceptRevealSetup(reveal, { id: "abc", url: "chrome-extension://abc/popup/popup.html" }, rctx), true);
  const bad = [
    [reveal, { ...sender, id: "evil" }], [reveal, { ...sender, url: "chrome-extension://abc/options/options.html" }],
    [reveal, { ...sender, url: "chrome-extension://evil/popup/popup.html" }], [reveal, { id: "abc" }], [reveal, null],
    [{ ...reveal, tabId: 8 }, sender], [{ ...reveal, tabId: "7" }, sender], [{ type: "reveal-setup" }, sender],
    [{ ...reveal, type: "complete-split" }, sender], [null, sender],
  ];
  for (const [m, s] of bad) assert.equal(acceptRevealSetup(m, s, rctx), false);
  // 本页标签 id 还没读到（null）、扩展 id 或弹窗网址不对，一律不接受
  assert.equal(acceptRevealSetup(reveal, sender, { ...rctx, tabId: null }), false);
  assert.equal(acceptRevealSetup(reveal, sender, { ...rctx, extId: "" }), false);
  assert.equal(acceptRevealSetup(reveal, sender, { ...rctx, popupUrl: "::" }), false);
});

const OPT = "chrome-extension://abc/options/options.html";
const tabCtx = (tabId, windowId, url = OPT) => ({ contextType: "TAB", tabId, windowId, documentUrl: url });
test("pickOptionsTab：带不带 hash 都算，优先当前窗口，其次第一个", () => {
  const list = [tabCtx(1, 10, OPT + "#guide"), tabCtx(2, 20, OPT + "#setup"), tabCtx(3, 20)];
  assert.deepEqual(pickOptionsTab(list, { optionsUrl: OPT, windowId: 20 }), { tabId: 2, windowId: 20 });
  assert.deepEqual(pickOptionsTab(list, { optionsUrl: OPT, windowId: 99 }), { tabId: 1, windowId: 10 });
  assert.deepEqual(pickOptionsTab(list, { optionsUrl: OPT, windowId: undefined }), { tabId: 1, windowId: 10 });
});
test("pickOptionsTab：别的页面、非标签上下文、id 不合法的都不算；没有返回 null", () => {
  const others = [
    tabCtx(1, 10, "chrome-extension://abc/popup/popup.html?tabId=3"), tabCtx(2, 10, "chrome-extension://abc/go.html?u=x"),
    tabCtx(3, 10, "chrome-extension://evil/options/options.html"), { ...tabCtx(4, 10), contextType: "POPUP" },
    tabCtx(-1, 10), tabCtx(5, -1), tabCtx("6", 10), { ...tabCtx(7, 10), documentUrl: undefined }, null,
  ];
  assert.equal(pickOptionsTab(others, { optionsUrl: OPT, windowId: 10 }), null);
  assert.equal(pickOptionsTab([], { optionsUrl: OPT, windowId: 10 }), null);
  assert.equal(pickOptionsTab(undefined, { optionsUrl: OPT, windowId: 10 }), null);
  assert.equal(pickOptionsTab([tabCtx(1, 10)], { optionsUrl: "::", windowId: 10 }), null);
});
