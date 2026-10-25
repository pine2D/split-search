// 分屏流程自动步骤（二）：再次触发的公共断言、T5 的重启子项、T10（后退/前进与会话恢复）。
// ids、fmt、expectForeign 在 v03-lib.mjs（放在那里避免 v03-lib ↔ flow-restart 循环引用）。
// 重启经 ctx.restartBrowser（run.mjs 提供）：同一配置 + --restore-last-session，storage 随配置保留。
import { EXT_ID } from "../config.mjs";
import {
  splitPairs, trigger, expectPair, findPair, resetTabs, navigate, waitState, waitTarget, pageTargets,
  evalIn, GO_PREFIX, sleep, summarize,
} from "./util.mjs";
import { ids, fmt, expectForeign } from "./v03-lib.mjs";

const OPT_PREFIX = `chrome-extension://${EXT_ID}/options/`;
// 标签数不算设置页（它是扩展 API 的执行环境，重启后可能被重建）；go.html 仍计入
const countTabs = st => st.tabs.filter(t => !(t.url || "").startsWith(OPT_PREFIX)).length;
const byUrls = (st, port, q) => {
  const [l, r] = expectPair(port, q);
  return splitPairs(st).find(p => p[0].url === l && p[1].url === r);
};

// 在分屏的某一侧再次触发，断言：分屏数不变、标签总数不变、左右仍是同两个标签且顺序不变、两侧都换成新关键词
export async function retrigger(ctx, pair, side, q) {
  const { port } = ctx;
  const tab = side === "left" ? pair[0] : pair[1];
  const st0 = await ctx.ext.state();
  const target = await waitTarget(ctx, t => t.url === tab.url, `${side === "left" ? "左" : "右"}侧页面 ${tab.url}`);
  await navigate(ctx, target.targetId, trigger(port, q));
  const now = await waitState(ctx, st => findPair(st, port, q), `两侧都更新为 ${q}`);
  const st = await ctx.ext.state();
  const problems = [];
  if (splitPairs(st).length !== splitPairs(st0).length) problems.push(`分屏数从 ${splitPairs(st0).length} 变成 ${splitPairs(st).length}`);
  if (countTabs(st) !== countTabs(st0)) problems.push(`标签数从 ${countTabs(st0)} 变成 ${countTabs(st)}`);
  if (now[0].id !== pair[0].id || now[1].id !== pair[1].id) problems.push(`左右标签应保持 ${ids(pair)}，实际 ${ids(now)}`);
  return { pair: now, problems };
}

// 重启浏览器并等上次的分屏恢复；恢复不了返回 null 和原因
async function restartAndFind(ctx, q) {
  Object.assign(ctx, await ctx.restartBrowser({ restoreSession: true }));
  try {
    return { pair: await waitState(ctx, st => byUrls(st, ctx.port, q), `重启后恢复分屏 ${expectPair(ctx.port, q).join(" ｜ ")}`, { timeoutMs: 30000 }) };
  } catch (e) { return { pair: null, why: e.message }; }
}

// T5 的重启子项：恢复后在左侧再触发一次。此时 storage.session 已清空，两侧都没有记录，兜底最多判出
// fallback-own，按 foreign 处理（spec 3.1“兜底”）：恢复的分屏两侧都不动，在右边新开一对
export async function T5_RESTART(ctx, qPrev, qNext, prevSplitViewId) {
  const name = "重启后在左侧触发：不覆盖，在旁边新开一对";
  const { pair, why } = await restartAndFind(ctx, qPrev);
  if (!pair) return { name, status: "skip", detail: `重启后分屏没有恢复，无法验证（${why}）` };
  // 恢复的标签可能还没加载完，等两侧加载完成再触发
  await waitState(ctx, st => findPair(st, ctx.port, qPrev), "恢复的分屏加载完成", { timeoutMs: 30000 });
  const r = await expectForeign(ctx, pair[0], pair[1], qNext);
  return { name, status: r.problems.length ? "fail" : "pass",
    detail: r.problems.length ? r.problems.join("；") : `分屏已恢复（splitViewId ${pair[0].splitViewId}，${pair[0].splitViewId === prevSplitViewId ? "与重启前相同" : `重启前为 ${prevSplitViewId}`}），两侧 ${fmt(pair)} 未被改写；在旁边新开一对 ${ids(r.now)}：${fmt(r.now)}` };
}

// 一段观察期内分屏数与标签数都不变、也没有 go.html 页面
async function steady(ctx, want, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    const st = await ctx.ext.state();
    const go = (await pageTargets(ctx.browser)).filter(t => t.url.startsWith(GO_PREFIX));
    const problems = [];
    if (splitPairs(st).length !== want.pairs) problems.push(`分屏数应为 ${want.pairs}，实际 ${splitPairs(st).length}`);
    if (countTabs(st) > want.tabs) problems.push(`标签数应不超过 ${want.tabs}，实际 ${countTabs(st)}`);
    if (go.length) problems.push(`出现 go.html：${go.map(t => t.url).join("、")}`);
    if (problems.length || Date.now() >= end) return problems;
    await sleep(250);
  }
}

const T10 = {
  id: "T10", title: "左侧后退/前进不重复分屏；恢复会话不重新执行 go.html", kind: "auto", needs: [], timeoutMs: 180000, restarts: true,
  async run(ctx) {
    const { port } = ctx;
    const base = await resetTabs(ctx);
    const q = "t10+nav";
    await navigate(ctx, base.targetId, trigger(port, q));
    const pair = await waitState(ctx, st => findPair(st, port, q), `分屏 ${expectPair(port, q).join(" ｜ ")}`);
    const st0 = await ctx.ext.state();
    const want = { pairs: splitPairs(st0).length, tabs: countTabs(st0) };
    const items = [];

    // 后退回 site-x，再前进回左侧结果页（go.html 已被 location.replace 替换，不在历史里）
    const nav = [];
    await evalIn(ctx, base.targetId, "setTimeout(() => history.back(), 0), true");
    await waitState(ctx, st => st.tabs.some(t => t.id === pair[0].id && t.url === base.url && t.status === "complete"), `左侧后退到 ${base.url}`);
    nav.push("后退到 site-x");
    await evalIn(ctx, base.targetId, "setTimeout(() => history.forward(), 0), true");
    await waitState(ctx, st => st.tabs.some(t => t.id === pair[0].id && t.url === pair[0].url && t.status === "complete"), `左侧前进回 ${pair[0].url}`);
    nav.push("前进回左侧结果页");
    const p1 = await steady(ctx, want);
    items.push({ name: "后退/前进", status: p1.length ? "fail" : "pass",
      detail: p1.length ? p1.join("；") : `${nav.join("，")}；分屏数 ${want.pairs}、标签数 ${want.tabs} 不变，没有 go.html` });

    const { pair: restored, why } = await restartAndFind(ctx, q);
    if (!restored) {
      items.push({ name: "恢复会话", status: "skip", detail: `重启后分屏没有恢复，无法验证（${why}）` });
    } else {
      await waitState(ctx, st => findPair(st, port, q), "恢复的分屏加载完成", { timeoutMs: 30000 });
      const p2 = await steady(ctx, want, 3000);
      items.push({ name: "恢复会话", status: p2.length ? "fail" : "pass",
        detail: p2.length ? p2.join("；") : `分屏已恢复（${fmt(restored)}），标签数 ${want.tabs} 未增加，go.html 没有重新执行` });
    }
    return summarize(items);
  },
};

export const RESTART_STEPS = [T10];
