// T27：真实扩展生命周期。通过触发网址建对，不直接伪造搜索记录或联动许可。
import assert from "node:assert/strict";
import { EXT_ID } from "../config.mjs";
import { guarded, openOptions, sleep } from "./optpage.mjs";
import { sub, pairOn, findAdjacent, sizeTo, restoreWindows } from "./v03-lib.mjs";
import { summarize, resetTabs, navigate, trigger, waitState, nonce } from "./util.mjs";
import { cancelledClose } from "./close-beforeunload.mjs";

const J = JSON.stringify;
export const links = ctx => ctx.ext.eval(`chrome.storage.session.get(null).then(s => Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith("linked:"))))`);
export const setLinked = (ctx, value) => ctx.ext.eval(`import("../chrome/config-store.js").then(m => m.saveKeys({ closePairTogether: ${value} })).then(() => true)`);
export const waitLink = (ctx, pair, present = true) => ctx.browser.waitFor(async () => {
  const s = await links(ctx), value = s[`linked:${pair[0].splitViewId}`];
  return present ? J(value) === J(pair.map(t => t.id).sort((a, b) => a - b)) : value === undefined;
});
export async function search(ctx) {
  const { pair } = await pairOn(ctx, `close-${nonce()}`);
  await waitLink(ctx, pair);
  return pair;
}
const remove = (ctx, id) => ctx.ext.eval(`chrome.tabs.remove(${id}).then(() => true)`);
export const gone = (ctx, pair) => waitState(ctx, s => pair.every(p => !s.tabs.some(t => t.id === p.id)), "两侧都已关闭", { timeoutMs: 6000 });

async function survives(ctx, closed, peer) {
  await ctx.browser.waitFor(() => ctx.ext.eval(`chrome.storage.session.get("split:${closed.id}").then(s => !s["split:${closed.id}"])`));
  // 等一个事件处理窗口，再确认对侧仍在；只断言立即存在会放过延迟误关。
  await sleep(350);
  assert.equal(await ctx.ext.eval(`chrome.tabs.get(${peer.id}).then(t => t.id, () => null)`), peer.id);
}

async function coldClose(ctx, side) {
  const pair = await search(ctx), opt = await openOptions(ctx.browser);
  try {
    await ctx.browser.client.send("ServiceWorker.enable", {}, opt.sid);
    await ctx.browser.client.send("ServiceWorker.stopAllWorkers", {}, opt.sid);
    await ctx.browser.waitFor(async () => !(await ctx.browser.targets()).some(t =>
      t.type === "service_worker" && t.url === `chrome-extension://${EXT_ID}/background.js`));
    await remove(ctx, pair[side].id);
    await gone(ctx, pair);
  } finally { await opt.close(); }
}

async function run(ctx) {
  const items = [], saved = new Map();
  const check = async (name, fn) => items.push(await sub(name, async () => { await fn(); return { status: "pass", detail: "标签与 session 状态符合预期" }; }));
  try {
    await check("(a) 缺省关闭；启用后已有搜索分屏可以联动", async () => {
      await ctx.ext.eval(`import("../chrome/config-store.js").then(m => m.removeKeys(["closePairTogether"]))`);
      const { pair: [a, b] } = await pairOn(ctx, `off-${nonce()}`);
      assert.deepEqual(await links(ctx), {});
      await remove(ctx, a.id); await survives(ctx, a, b);
      const { pair } = await pairOn(ctx, `existing-${nonce()}`);
      await setLinked(ctx, true); await waitLink(ctx, pair);
      await remove(ctx, pair[0].id); await gone(ctx, pair);
    });
    for (const side of [0, 1]) await check(`(b${side}) 开启：关闭${side ? "右" : "左"}侧`, async () => {
      const pair = await search(ctx); await remove(ctx, pair[side].id); await gone(ctx, pair);
    });
    await check("(c) 关闭设置后，已有分屏不联动", async () => {
      const pair = await search(ctx); await setLinked(ctx, false); await waitLink(ctx, pair, false);
      await remove(ctx, pair[0].id); await survives(ctx, ...pair);
      await setLinked(ctx, true);
    });
    await check("(d) 手动拆开撤销许可，再拼回不恢复", async () => {
      const pair = await search(ctx);
      await ctx.ext.eval(`chrome.tabs.unsplit(${pair[0].splitViewId})`); await waitLink(ctx, pair, false);
      await ctx.ext.eval(`chrome.tabs.createSplit(${J(pair.map(t => t.id))})`);
      await remove(ctx, pair[1].id); await survives(ctx, pair[1], pair[0]);
    });
    await check("(e) 用户手动建的分屏不联动", async () => {
      const base = await resetTabs(ctx);
      const b = await ctx.ext.eval(`chrome.tabs.create({ url: "about:blank", splitWithTabId: ${base.tabId}, windowId: ${base.windowId}, active: false })`);
      await remove(ctx, b.id); await survives(ctx, b, { id: base.tabId });
    });
    for (const side of [0, 1]) await check(`(f${side}) 右键查询对：关闭${side ? "查询" : "网页"}一侧不联动`, async () => {
      const base = await resetTabs(ctx);
      await ctx.ext.eval(`(async () => {
        const { withPairLock } = await import("../chrome/pair-lock.js");
        const { handleMenuClick } = await import("../chrome/lookup-actions.js");
        await withPairLock(() => handleMenuClick({ menuItemId: "ss-lookup-text", selectionText: "close-lookup", editable: false }, { id: ${base.tabId} }));
        return true;
      })()`);
      const rec = await ctx.ext.eval(`chrome.storage.session.get("split:${base.tabId}").then(s => s["split:${base.tabId}"])`);
      assert.equal(rec.role, "page"); assert.deepEqual(await links(ctx), {});
      const pair = [{ id: base.tabId }, { id: rec.peer }];
      await remove(ctx, pair[side].id); await survives(ctx, pair[side], pair[1 - side]);
    });
    await check("(g) 窄窗口相邻标签不联动", async () => {
      const base = await resetTabs(ctx); await sizeTo(ctx, base, 800, saved);
      await ctx.ext.eval(`chrome.storage.sync.set({ narrowFallback: true })`);
      const q = `adjacent-${nonce()}`;
      await navigate(ctx, base.targetId, trigger(ctx.port, q));
      const pair = await waitState(ctx, s => findAdjacent(s, ctx.port, q), "窄窗口相邻对");
      assert.deepEqual(await links(ctx), {});
      await remove(ctx, pair[0].id); await survives(ctx, ...pair);
      await ctx.ext.eval(`chrome.storage.sync.set({ narrowFallback: false })`);
      await restoreWindows(ctx, saved); saved.clear();
    });
    await check("(h) 对侧移到其他窗口后不联动", async () => {
      const pair = await search(ctx);
      const win = await ctx.ext.eval(`chrome.windows.create({ tabId: ${pair[1].id} })`);
      try {
        await waitLink(ctx, pair, false);
        await remove(ctx, pair[0].id); await survives(ctx, ...pair);
      } finally { await ctx.ext.eval(`chrome.windows.remove(${win.id})`); }
    });
    for (const side of [0, 1]) await check(`(i${side}) 后台被终止后，关闭${side ? "右" : "左"}侧仍联动`, () => coldClose(ctx, side));
    await check("(j) 对侧取消离开页面：不重复关闭，设置写入与新搜索仍可执行", () => cancelledClose(ctx));
  } finally {
    await setLinked(ctx, false); await restoreWindows(ctx, saved); await resetTabs(ctx);
  }
  return summarize(items);
}

export const CLOSE_PAIR_STEPS = [{
  id: "T27", title: "搜索分屏联动关闭：默认、左右关闭、解除、排除项、移动、后台冷启动与取消关闭", kind: "auto", needs: [], timeoutMs: 180000,
  run: ctx => guarded(ctx, ["closePairTogether", "narrowFallback"], () => run(ctx)),
}];
