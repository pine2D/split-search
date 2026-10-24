// 分屏流程自动步骤（三）：T13 源标签的各种处境（固定、标签组、窗口唯一标签、popup 窗口）。
// tabs.group 属于 tabs API，不需要 tabGroups 权限；若实测要求权限则记为跳过，绝不给扩展加权限。
import {
  splitPairs, trigger, siteX, expectPair, findPair, nonce, resetTabs, navigate, waitState, waitTarget, summarize,
} from "./util.mjs";
import { RESTART_STEPS, fmt } from "./flow-restart.mjs";

const PERM = /permission|权限/i;

// 运行一个子项：异常记为失败（附原因），返回 { name, status, detail }
async function sub(name, fn) {
  try { return { name, ...(await fn()) }; }
  catch (e) { return { name, status: "fail", detail: `异常：${e.message}` }; }
}
const verdict = (problems, ok) => (problems.length ? { status: "fail", detail: problems.join("；") } : { status: "pass", detail: ok });

// 在源标签上触发并等分屏出现
async function triggerOn(ctx, base, q) {
  await navigate(ctx, base.targetId, trigger(ctx.port, q));
  return waitState(ctx, st => findPair(st, ctx.port, q), `分屏 ${expectPair(ctx.port, q).join(" ｜ ")}`);
}

const pinned = ctx => sub("(a) 源标签是固定标签", async () => {
  const base = await resetTabs(ctx);
  await ctx.ext.eval(`chrome.tabs.update(${base.tabId}, { pinned: true }).then(() => true)`);
  const pair = await triggerOn(ctx, base, "t13+pinned");
  const p = [];
  if (pair[0].id !== base.tabId) p.push(`左侧应是源标签 ${base.tabId}，实际 ${pair[0].id}`);
  if (!pair[0].pinned || !pair[1].pinned) p.push(`两侧都应固定，实际 左=${pair[0].pinned} 右=${pair[1].pinned}`);
  return verdict(p, `两侧都是固定标签并组成分屏：${fmt(pair)}`);
});

// 把源标签（和可选的另一个标签）放进标签组后触发；needsPermission 时返回 skip
async function grouped(ctx, alone) {
  const base = await resetTabs(ctx);
  let extra = null;
  if (!alone) {
    extra = await ctx.ext.eval(`chrome.tabs.create({ windowId: ${base.windowId}, url: ${JSON.stringify(siteX(ctx.port, `/group-mate?n=${nonce()}`))}, active: false }).then(t => t.id)`);
  }
  const tabIds = alone ? [base.tabId] : [base.tabId, extra];
  let gid;
  try { gid = await ctx.ext.eval(`chrome.tabs.group({ tabIds: ${JSON.stringify(tabIds)} })`); }
  catch (e) {
    if (PERM.test(e.message)) return { status: "skip", detail: `chrome.tabs.group 需要额外权限（${e.message}），按约定不给扩展加权限` };
    throw e;
  }
  const pair = await triggerOn(ctx, base, alone ? "t13+group+alone" : "t13+group");
  const st = await ctx.ext.state();
  const p = [];
  if (pair[0].id !== base.tabId) p.push(`左侧应是源标签 ${base.tabId}，实际 ${pair[0].id}`);
  if (pair[0].groupId !== gid || pair[1].groupId !== gid) p.push(`两侧都应在组 ${gid} 里，实际 左=${pair[0].groupId} 右=${pair[1].groupId}`);
  if (!alone && st.tabs.find(t => t.id === extra)?.groupId !== gid) p.push(`组里的另一个标签 ${extra} 离开了组`);
  return verdict(p, `新标签进入同一个组 ${gid}${alone ? "（源标签原是组里唯一的标签）" : ""}：${fmt(pair)}`);
}

const onlyTab = ctx => sub("(d) 源标签是窗口里唯一的标签", async () => {
  await resetTabs(ctx);
  const url = siteX(ctx.port, `/alone?n=${nonce()}`);
  const w = await ctx.ext.eval(`chrome.windows.create({ type: "normal", url: ${JSON.stringify(url)} }).then(w => ({ id: w.id, tab: w.tabs[0].id }))`);
  await waitState(ctx, st => st.tabs.some(t => t.id === w.tab && t.status === "complete"), "新窗口的 site-x 加载完成");
  const n0 = (await ctx.ext.state()).tabs.filter(t => t.windowId === w.id).length;
  const target = await waitTarget(ctx, t => t.url === url, url);
  const pair = await triggerOn(ctx, { targetId: target.targetId }, "t13+alone");
  const st = await ctx.ext.state();
  const p = [];
  if (n0 !== 1) p.push(`触发前窗口应只有 1 个标签，实际 ${n0} 个`);
  if (pair[0].id !== w.tab || pair[0].windowId !== w.id || pair[1].windowId !== w.id) p.push(`分屏应在窗口 ${w.id} 里、左侧为标签 ${w.tab}，实际 ${pair[0].id}@${pair[0].windowId}`);
  const n1 = st.tabs.filter(t => t.windowId === w.id).length;
  if (n1 !== 2) p.push(`触发后窗口应有 2 个标签，实际 ${n1} 个`);
  return verdict(p, `窗口 ${w.id} 里唯一的标签变成左侧，与新标签组成分屏：${fmt(pair)}`);
});

const popup = ctx => sub("(e) 在 popup 窗口里触发", async () => {
  await resetTabs(ctx);
  const q = "t13+popup";
  const pw = await ctx.ext.eval(`chrome.windows.create({ type: "popup", url: ${JSON.stringify(trigger(ctx.port, q))} }).then(w => ({ id: w.id, tab: w.tabs[0].id }))`);
  const pair = await waitState(ctx, st => findPair(st, ctx.port, q), `normal 窗口里的分屏 ${expectPair(ctx.port, q).join(" ｜ ")}`);
  const [left] = expectPair(ctx.port, q);
  const st = await waitState(ctx, s => s.tabs.some(t => t.id === pw.tab && t.url === left && t.status === "complete") && s,
    `popup 窗口显示左侧页面 ${left}`);
  const win = id => st.windows.find(w => w.id === id);
  const p = [];
  if (win(pair[0].windowId)?.type !== "normal") p.push(`分屏应在 normal 窗口里，实际在 ${win(pair[0].windowId)?.type ?? "?"} 窗口 ${pair[0].windowId}`);
  if (win(pw.id)?.type !== "popup") p.push(`popup 窗口 ${pw.id} 不见了`);
  if (pair.some(t => t.windowId === pw.id)) p.push("popup 窗口里不应出现分屏");
  return verdict(p, `分屏建在 normal 窗口 ${pair[0].windowId}：${fmt(pair)}；popup 窗口 ${pw.id} 显示左侧页面`);
});

const T13 = {
  id: "T13", title: "源标签固定 / 在标签组 / 窗口唯一 / popup 窗口：不崩溃并按预期分屏", kind: "auto", needs: [], timeoutMs: 180000,
  async run(ctx) {
    const items = [
      await pinned(ctx),
      await sub("(b) 源标签在标签组中", () => grouped(ctx, false)),
      await sub("(c) 源标签是组里唯一的标签", () => grouped(ctx, true)),
      await onlyTab(ctx),
      await popup(ctx),
    ];
    // 收尾：关掉本步新建的窗口与标签（不留额外窗口）
    try {
      await resetTabs(ctx);
      const left = splitPairs(await ctx.ext.state()).length;
      if (left) items.push({ name: "收尾", status: "fail", detail: `收尾后仍有 ${left} 个分屏` });
    } catch (e) { items.push({ name: "收尾", status: "fail", detail: `整理现场失败：${e.message}` }); }
    return summarize(items);
  },
};

export const FLOW_STEPS_2 = [...RESTART_STEPS, T13];
