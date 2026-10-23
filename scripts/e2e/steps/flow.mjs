// 分屏流程自动步骤（一）：CORE-NEW CORE-EXISTING T5 T6 T7。
// 触发方式：Target.createTarget 新开标签 ≈ 拖到两个标签之间；在已有标签上 Page.navigate ≈ 拖到该标签上。
// 模拟引擎 ea | eb，默认组合 ["ea","eb"]（run.mjs 已写入）。每步开始先 resetTabs 整理现场。
import {
  splitPairs, trigger, siteX, expectPair, findPair, nonce, resetTabs, navigate, openTab, waitState,
  waitTarget, pageTargets, evalIn, GO_PREFIX, summarize,
} from "./util.mjs";
import { T5_RESTART, retrigger, ids, fmt } from "./flow-restart.mjs";
import { FLOW_STEPS_2 } from "./flow-more.mjs";

const fail = detail => ({ status: "fail", detail });

const CORE_NEW = {
  id: "CORE-NEW", title: "新标签打开触发网址：出现 ea ｜ eb 分屏", kind: "auto", needs: [],
  async run(ctx) {
    const { port } = ctx;
    await resetTabs(ctx);
    const q = "hello+world";
    await openTab(ctx, trigger(port, q));
    const pair = await waitState(ctx, st => findPair(st, port, q), `分屏 ${expectPair(port, q).join(" ｜ ")}`);
    const st = await ctx.ext.state();
    const problems = [];
    if (splitPairs(st).length !== 1) problems.push(`应只有 1 个分屏，实际 ${splitPairs(st).length} 个`);
    if (pair[0].url.includes("_ss")) problems.push(`左侧网址不应含 _ss：${pair[0].url}`);
    if (pair[1].index !== pair[0].index + 1) problems.push(`右侧应紧邻左侧（位置 ${pair[0].index} / ${pair[1].index}）`);
    if ((await pageTargets(ctx.browser)).some(t => t.url.startsWith(GO_PREFIX))) problems.push("go.html 仍然留着");
    if (problems.length) return fail(problems.join("；"));
    return { status: "pass", detail: `新分屏：${fmt(pair)}（标签 ${ids(pair)}）` };
  },
};

const CORE_EXISTING = {
  id: "CORE-EXISTING", title: "已有标签上跳转触发网址：该标签变左侧，右侧新开", kind: "auto", needs: [],
  async run(ctx) {
    const { port } = ctx;
    const base = await resetTabs(ctx);
    const before = new Set((await ctx.ext.state()).tabs.map(t => t.id));
    const q = "existing+tab";
    await navigate(ctx, base.targetId, trigger(port, q));
    const pair = await waitState(ctx, st => findPair(st, port, q), `分屏 ${expectPair(port, q).join(" ｜ ")}`);
    const problems = [];
    if (pair[0].id !== base.tabId) problems.push(`左侧应是原来的 site-x 标签 ${base.tabId}，实际 ${pair[0].id}`);
    if (before.has(pair[1].id)) problems.push(`右侧应是新开的标签，实际是已有标签 ${pair[1].id}`);
    const n = splitPairs(await ctx.ext.state()).length;
    if (n !== 1) problems.push(`应只有 1 个分屏，实际 ${n} 个`);
    if (problems.length) return fail(problems.join("；"));
    return { status: "pass", detail: `site-x 标签 ${base.tabId} 变成左侧，右侧为新标签 ${pair[1].id}：${fmt(pair)}` };
  },
};

const T5 = {
  id: "T5", title: "本扩展分屏内再次触发：就地更新；重启后仍就地更新", kind: "auto", needs: [], timeoutMs: 180000,
  async run(ctx) {
    const { port } = ctx;
    await resetTabs(ctx);
    await openTab(ctx, trigger(port, "t5+one"));
    let pair = await waitState(ctx, st => findPair(st, port, "t5+one"), "初始分屏 t5 one");
    const items = [];
    for (const [side, q] of [["left", "t5+two"], ["right", "t5+three"]]) {
      const r = await retrigger(ctx, pair, side, q);
      items.push({ name: `在${side === "left" ? "左" : "右"}侧触发 ${q}`, status: r.problems.length ? "fail" : "pass",
        detail: r.problems.length ? r.problems.join("；") : `仍是标签 ${ids(r.pair)}，${fmt(r.pair)}` });
      pair = r.pair;
    }
    items.push(await T5_RESTART(ctx, "t5+three", "t5+four", pair[0].splitViewId));
    return summarize(items);
  },
};

const T6 = {
  id: "T6", title: "手动建的分屏里触发：原分屏不动，新开一对，原标签回到原页面", kind: "auto", needs: [],
  async run(ctx) {
    const { port } = ctx;
    const base = await resetTabs(ctx);
    const n = nonce();
    const [u1, u2] = [siteX(port, `/manual-1?n=${n}`), siteX(port, `/manual-2?n=${n}`)];
    const made = await ctx.ext.eval(`(async () => {
      const a = await chrome.tabs.create({ windowId: ${base.windowId}, url: ${JSON.stringify(u1)}, active: true });
      const b = await chrome.tabs.create({ windowId: ${base.windowId}, url: ${JSON.stringify(u2)}, active: false });
      const splitViewId = await chrome.tabs.createSplit([a.id, b.id]);
      return { a: a.id, b: b.id, splitViewId };
    })()`);
    await waitState(ctx, st => ["a", "b"].every(k => st.tabs.some(t => t.id === made[k] && t.status === "complete" && t.splitViewId === made.splitViewId)),
      "手动分屏两侧加载完成");
    const t1 = await waitTarget(ctx, t => t.url === u1, u1);
    const q = "t6+manual";
    await navigate(ctx, t1.targetId, trigger(port, q));
    const pair = await waitState(ctx, st => findPair(st, port, q), `新分屏 ${expectPair(port, q).join(" ｜ ")}`);
    // 被触发的标签经 history.back() 回到原页面
    const st = await waitState(ctx, s => s.tabs.some(t => t.id === made.a && t.url === u1 && t.status === "complete") && s,
      `被触发的标签 ${made.a} 回到 ${u1}`).catch(async e => ({ err: e.message, ...(await ctx.ext.state()) }));
    const tab = id => st.tabs.find(t => t.id === id);
    const problems = [];
    if (st.err) problems.push(st.err);
    if (tab(made.b)?.url !== u2) problems.push(`手动分屏另一侧应保持 ${u2}，实际 ${tab(made.b)?.url ?? "（标签不见了）"}`);
    if (tab(made.a)?.splitViewId !== made.splitViewId || tab(made.b)?.splitViewId !== made.splitViewId) problems.push("手动分屏被拆开了");
    if ([made.a, made.b].includes(pair[0].id) || [made.a, made.b].includes(pair[1].id)) problems.push(`新分屏不应使用手动分屏的标签：${ids(pair)}`);
    if (splitPairs(st).length !== 2) problems.push(`应有 2 个分屏（手动 + 新开），实际 ${splitPairs(st).length} 个`);
    if (problems.length) return fail(problems.join("；"));
    return { status: "pass", detail: `手动分屏 ${made.a}｜${made.b} 未被覆盖，标签 ${made.a} 回到 ${u1}；新分屏 ${ids(pair)}：${fmt(pair)}` };
  },
};

const GO_STATE = `(() => {
  const err = document.getElementById("error"), btn = document.getElementById("left-only");
  const r = btn.getBoundingClientRect();
  return { error: !err.hidden, text: document.body.innerText, leftOnly: !btn.hidden && r.width > 0 && r.height > 0 };
})()`;

async function badMarker(ctx, ss, want) {
  const url = trigger(ctx.port, "test", ss);
  const { targetId } = await openTab(ctx, url);
  let s;
  try {
    s = await ctx.browser.waitFor(async () => {
      const t = (await pageTargets(ctx.browser)).find(x => x.targetId === targetId);
      if (!t?.url.startsWith(GO_PREFIX)) return null;
      const v = await evalIn(ctx, targetId, GO_STATE);
      return v.error ? v : null;
    }, { timeoutMs: 10000, intervalMs: 200 });
  } catch (e) {
    const t = (await pageTargets(ctx.browser)).find(x => x.targetId === targetId);
    return { name: `_ss=${ss}`, status: "fail", detail: `10 秒内没有在 go.html 上看到错误说明（当前页面 ${t?.url ?? "已关闭"}；${e.message}）` };
  }
  const t = (await pageTargets(ctx.browser)).find(x => x.targetId === targetId);
  const problems = [];
  if (!t?.url.startsWith(GO_PREFIX)) problems.push(`页面应停在 go.html，实际 ${t?.url}`);
  if (!s.text.includes(want)) problems.push(`正文应含“${want}”，实际：${s.text.replace(/\s+/g, " ").slice(0, 120)}`);
  if (!s.leftOnly) problems.push("“只打开左侧搜索”按钮不可见");
  return { name: `_ss=${ss}`, status: problems.length ? "fail" : "pass",
    detail: problems.length ? problems.join("；") : `停在 go.html，显示“${want}”，“只打开左侧搜索”可见` };
}

const T7 = {
  id: "T7", title: "_ss 写错：停在 go.html 显示错误与“只打开左侧搜索”", kind: "auto", needs: [],
  async run(ctx) {
    await resetTabs(ctx);
    const items = [await badMarker(ctx, "ea", "标记参数格式不对"), await badMarker(ctx, "ea,nope", "未知引擎：nope")];
    const n = splitPairs(await ctx.ext.state()).length;
    if (n) items.push({ name: "分屏", status: "fail", detail: `不应产生分屏，实际 ${n} 个` });
    return summarize(items);
  },
};

export const FLOW_STEPS = [CORE_NEW, CORE_EXISTING, T5, T6, T7, ...FLOW_STEPS_2];
