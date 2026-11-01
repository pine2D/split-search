// 不模拟 tabs.remove：在真实页面上取消 beforeunload，验证旧许可已消费且队列/锁都能继续工作。
import assert from "node:assert/strict";
import { search, gone, setLinked } from "./close-pair.mjs";
import { waitTarget, sleep } from "./util.mjs";

export async function cancelledClose(ctx) {
  const pair = await search(ctx), peer = pair[1];
  const target = await waitTarget(ctx, t => t.url === peer.url, "待取消关闭的页面");
  const { browser } = ctx, sid = await browser.attach(target.targetId);
  let count = 0, dialogs = 0;
  const onDialog = (_p, s) => {
    if (s !== sid) return;
    dialogs++;
    browser.client.send("Page.handleJavaScriptDialog", { accept: false }, sid).catch(() => {});
  };
  browser.client.on("Page.javascriptDialogOpening", onDialog);
  try {
    await browser.client.send("Page.enable", {}, sid);
    await ctx.ext.eval(`chrome.tabs.update(${peer.id}, { active: true })`);
    await browser.client.send("Page.bringToFront", {}, sid);
    await browser.evaluate(sid, `window.__closeCount = 0; window.onbeforeunload = e => { __closeCount++; e.preventDefault(); e.returnValue = ""; }; true`);
    await browser.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 50, y: 50, button: "left", clickCount: 1 }, sid);
    await browser.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 50, y: 50, button: "left", clickCount: 1 }, sid);
    assert.equal(await browser.evaluate(sid, "navigator.userActivation.hasBeenActive"), true);
    await ctx.ext.eval(`chrome.tabs.remove(${pair[0].id}).then(() => true)`);
    await browser.waitFor(() => browser.evaluate(sid, "window.__closeCount > 0"));
    await ctx.ext.eval(`chrome.tabs.get(${peer.id})`);
    const records = await ctx.ext.eval(`chrome.storage.session.get(["split:${pair[0].id}", "split:${peer.id}", "linked:${peer.splitViewId}"])`);
    assert.deepEqual(records, {});
    await setLinked(ctx, false); await setLinked(ctx, true); // 锁没有被 pending remove 占住
    // resetTabs 会尝试关闭旧页面，不能拿它来证明“不重试”；在另一普通标签上触发新搜索。
    const q = `after-cancel-${Date.now()}`;
    const { trigger, findPair, waitState } = await import("./util.mjs");
    await ctx.ext.eval(`chrome.tabs.create({ url: ${JSON.stringify(trigger(ctx.port, q))} })`);
    const next = await waitState(ctx, s => findPair(s, ctx.port, q), "取消关闭后新搜索仍建对");
    await browser.waitFor(() => ctx.ext.eval(`chrome.storage.session.get("linked:${next[0].splitViewId}").then(s => !!s["linked:${next[0].splitViewId}"])`));
    count = await browser.evaluate(sid, "window.__closeCount");
    assert.equal(count, 1);
    await sleep(350);
    assert.equal(await browser.evaluate(sid, "window.__closeCount"), count);
    await ctx.ext.eval(`chrome.tabs.remove(${next[0].id})`); await gone(ctx, next);
    assert.equal(dialogs <= 1, true); // tabs.remove 在 Chrome 156 会直接取消，通常没有对话框
  } finally {
    await browser.evaluate(sid, "window.onbeforeunload = null; true").catch(() => {});
    browser.client.off("Page.javascriptDialogOpening", onDialog);
    await browser.client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
  }
}
