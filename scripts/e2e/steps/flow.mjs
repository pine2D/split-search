// 分屏流程自动步骤（一）：CORE-NEW CORE-EXISTING T5 T6 T7。
// 触发方式：Target.createTarget 新开标签 ≈ 拖到两个标签之间；在已有标签上 Page.navigate ≈ 拖到该标签上。
// 模拟引擎 ea | eb，默认组合 ["ea","eb"]（run.mjs 已写入）。每步开始先 resetTabs 整理现场。
import {
  splitPairs, trigger, siteX, expectPair, findPair, nonce, resetTabs, navigate, openTab, waitState,
  waitTarget, pageTargets, evalIn, GO_PREFIX, summarize,
} from "./util.mjs";
import { T5_RESTART, retrigger } from "./flow-restart.mjs";
import { ids, fmt } from "./v03-lib.mjs";
import { FLOW_STEPS_2 } from "./flow-more.mjs";
import { msg } from "../i18n.mjs";

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
    if (pair[1].index !== pair[0].index + 1) problems.push(`右侧应紧挨左侧（位置 ${pair[0].index} / ${pair[1].index}）`);
    const n = splitPairs(await ctx.ext.state()).length;
    if (n !== 1) problems.push(`应只有 1 个分屏，实际 ${n} 个`);
    if (problems.length) return fail(problems.join("；"));
    return { status: "pass", detail: `site-x 标签 ${base.tabId} 变成左侧，右侧为新标签 ${pair[1].id}：${fmt(pair)}` };
  },
};

const T5 = {
  id: "T5", title: "本扩展分屏内再次触发：就地更新；重启后在旁边新开一对", kind: "auto", needs: [], timeoutMs: 180000, restarts: true,
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

// T6 子项一：手动分屏的一侧有历史（先打开 site-x 再触发）：新开一对在手动分屏右侧相邻，被触发的标签后退回原页面
async function withHistory(ctx) {
  const name = "有历史：被触发的标签回到原页面";
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
  const now = findPair(st, port, q) ?? pair;
  const problems = [];
  if (st.err) problems.push(st.err);
  if (tab(made.b)?.url !== u2) problems.push(`手动分屏另一侧应保持 ${u2}，实际 ${tab(made.b)?.url ?? "（标签不见了）"}`);
  if (tab(made.a)?.splitViewId !== made.splitViewId || tab(made.b)?.splitViewId !== made.splitViewId) problems.push("手动分屏被拆开了");
  if ([made.a, made.b].includes(now[0].id) || [made.a, made.b].includes(now[1].id)) problems.push(`新分屏不应使用手动分屏的标签：${ids(now)}`);
  if (splitPairs(st).length !== 2) problems.push(`应有 2 个分屏（手动 + 新开），实际 ${splitPairs(st).length} 个`);
  // spec 5.3：新一对的左侧在手动分屏两侧位置的最大值 + 1，右侧紧挨左侧
  const maxIndex = Math.max(tab(made.a)?.index ?? -1, tab(made.b)?.index ?? -1);
  if (now[0].index !== maxIndex + 1 || now[1].index !== now[0].index + 1) {
    problems.push(`新分屏应紧挨在手动分屏右侧（手动分屏最大位置 ${maxIndex}，新分屏位置 ${now[0].index} / ${now[1].index}）`);
  }
  if (problems.length) return { name, ...fail(problems.join("；")) };
  return { name, status: "pass", detail: `手动分屏 ${made.a}｜${made.b} 未被覆盖，标签 ${made.a} 回到 ${u1}；新分屏 ${ids(now)} 紧挨在右侧：${fmt(now)}` };
}

// T6 子项二：手动分屏的一侧没有历史（tabs.create 直接打开触发网址并与 b 组成分屏，go.html 是它唯一的历史）：
// 新开一对，go.html 所在标签被关闭，另一侧 b 保持原页面（只剩一个标签，分屏自动解除）
async function noHistory(ctx) {
  const name = "无历史：关闭被触发的标签";
  const { port } = ctx;
  const base = await resetTabs(ctx);
  const u2 = siteX(port, `/manual-3?n=${nonce()}`);
  const q = "t6+nohist";
  // 先等 b 加载完，再新建 a 与它组成分屏（a 直接打开触发网址）
  const bId = await ctx.ext.eval(`chrome.tabs.create({ windowId: ${base.windowId}, url: ${JSON.stringify(u2)}, active: true }).then(t => t.id)`);
  await waitState(ctx, st => st.tabs.some(t => t.id === bId && t.url === u2 && t.status === "complete"), `标签 ${bId} 加载完 ${u2}`);
  const made = await ctx.ext.eval(`(async () => {
    const a = await chrome.tabs.create({ windowId: ${base.windowId}, url: ${JSON.stringify(trigger(port, q))}, splitWithTabId: ${bId}, active: true });
    return { a: a.id, b: ${bId}, splitViewId: a.splitViewId ?? -1 };
  })()`);
  if (made.splitViewId === -1) return { name, status: "skip", detail: `tabs.create({ splitWithTabId }) 返回的标签 ${made.a} 不在分屏中，构造不出“手动分屏里无历史的标签”` };
  const pair = await waitState(ctx, st => findPair(st, port, q), `新分屏 ${expectPair(port, q).join(" ｜ ")}`);
  const st = await waitState(ctx, s => !s.tabs.some(t => t.id === made.a) && s.tabs.some(t => t.id === made.b && t.status === "complete") && s,
    `被触发的标签 ${made.a} 被关闭`)
    .catch(async e => ({ err: e.message, ...(await ctx.ext.state()) }));
  const a = st.tabs.find(t => t.id === made.a), b = st.tabs.find(t => t.id === made.b);
  const now = findPair(st, port, q) ?? pair;
  // 竞态：go.html 执行时标签还没进入分屏，会走“不在分屏中”分支，把它自己变成新分屏的左侧，到不了本分支
  if (a && now[0].id === made.a) {
    return { name, status: "skip", detail: `go.html 执行时标签 ${made.a} 还不在分屏中，走了“不在分屏中”分支（${fmt(now)}），没有到达“无历史就关闭”分支` };
  }
  const problems = [];
  if (st.err) problems.push(`${st.err}（标签 ${made.a} 现在是 ${a?.url ?? "-"}）`);
  if (b?.url !== u2) problems.push(`手动分屏另一侧应保持 ${u2}，实际 ${b?.url ?? "（标签不见了）"}`);
  if ([made.a, made.b].includes(now[0].id) || [made.a, made.b].includes(now[1].id)) problems.push(`新分屏不应使用手动分屏的标签：${ids(now)}`);
  if (b && now[0].index !== b.index + 1) problems.push(`新分屏应紧挨在 ${made.b} 右侧（位置 ${b.index}，新分屏左侧 ${now[0].index}）`);
  if (problems.length) return { name, ...fail(problems.join("；")) };
  return { name, status: "pass", detail: `标签 ${made.a}（只有 go.html 一条历史）已关闭，${made.b} 保持 ${u2}；新分屏 ${ids(now)} 紧挨在右侧：${fmt(now)}` };
}

const T6 = {
  id: "T6", title: "手动建的分屏里触发：原分屏不动，新开一对，原标签回到原页面（无历史则关闭）", kind: "auto", needs: [],
  async run(ctx) {
    return summarize([await withHistory(ctx), await noHistory(ctx)]);
  },
};

const GO_STATE = `(() => {
  const err = document.getElementById("error"), btn = document.getElementById("left-only");
  const r = btn.getBoundingClientRect();
  return { error: !err.hidden, text: document.body.innerText, leftOnly: !btn.hidden && r.width > 0 && r.height > 0 };
})()`;

// 防重入页面状态：#rerun 可见、状态行说明不会自动重复。__e2eOld 是导航前在旧页面上做的标记（还在 = 旧 DOM 或往返缓存）
const RERUN_STATE = `(() => {
  const b = document.getElementById("rerun"), r = b.getBoundingClientRect();
  return { old: !!globalThis.__e2eOld, rerun: !b.hidden && r.width > 0 && r.height > 0, status: document.getElementById("status").textContent,
    nav: performance.getEntriesByType("navigation")[0]?.type ?? "" };
})()`;

// spec 4.2 第 1 步：停在 go.html 的错误页上刷新 / 离开后再后退回来，不应自动分屏，只显示“重新执行”
async function antiReentry(ctx, targetId, how) {
  const name = how === "reload" ? "刷新错误页：防重入" : "后退回错误页：防重入";
  await evalIn(ctx, targetId, "globalThis.__e2eOld = 1, true");
  if (how === "reload") {
    const sid = await ctx.browser.attach(targetId);
    try { await ctx.browser.client.send("Page.reload", {}, sid); }
    finally { await ctx.browser.client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {}); }
  } else {
    const away = siteX(ctx.port, `/away?n=${nonce()}`);
    await navigate(ctx, targetId, away);
    await waitTarget(ctx, t => t.targetId === targetId && t.url === away, away);
    await evalIn(ctx, targetId, "setTimeout(() => history.back(), 0), true");
  }
  let v;
  try {
    v = await ctx.browser.waitFor(async () => {
      const t = (await pageTargets(ctx.browser)).find(x => x.targetId === targetId);
      if (!t?.url.startsWith(GO_PREFIX)) return null;
      const r = await evalIn(ctx, targetId, RERUN_STATE);
      // 刷新：等到没有标记的新文档；后退：带标记的就是从往返缓存恢复的旧文档，直接判断
      return (how === "back" && r.old) || (!r.old && r.rerun) ? r : null;
    }, { timeoutMs: 10000, intervalMs: 200 });
  } catch (e) {
    const t = (await pageTargets(ctx.browser)).find(x => x.targetId === targetId);
    return { name, status: "fail", detail: `10 秒内没有回到 go.html 并显示“重新执行”（当前页面 ${t?.url ?? "已关闭"}；${e.message}）` };
  }
  // 后退时页面从往返缓存恢复：脚本不重新执行，到不了防重入分支（刷新子项已覆盖该分支）
  if (v.old) return { name, status: "skip", detail: "后退时 go.html 从往返缓存（bfcache）恢复，页面脚本没有重新执行，到不了防重入分支（刷新子项已覆盖）" };
  const problems = [];
  if (!v.rerun) problems.push("“重新执行”按钮不可见");
  if (v.status !== msg("go_status_no_repeat")) problems.push(`状态行应为“${msg("go_status_no_repeat")}”，实际“${v.status}”`);
  const n = splitPairs(await ctx.ext.state()).length;
  if (n) problems.push(`不应产生分屏，实际 ${n} 个`);
  return { name, status: problems.length ? "fail" : "pass",
    detail: problems.length ? problems.join("；") : `导航类型 ${v.nav}：停在 go.html，显示“${v.status}”和“重新执行”，没有分屏` };
}

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
  return { name: `_ss=${ss}`, status: problems.length ? "fail" : "pass", targetId,
    detail: problems.length ? problems.join("；") : `停在 go.html，显示“${want}”，“只打开左侧搜索”可见` };
}

const T7 = {
  id: "T7", title: "_ss 写错：停在 go.html 显示错误与“只打开左侧搜索”；刷新/后退不自动分屏", kind: "auto", needs: [],
  async run(ctx) {
    await resetTabs(ctx);
    const items = [await badMarker(ctx, "ea", msg("err_marker_format")), await badMarker(ctx, "ea,nope", msg("err_unknown_engine", "nope"))];
    // 防重入：在第一个错误页上刷新，再离开后退回来（错误页没出现时这两项无从验证，记跳过）
    const first = items[0];
    for (const how of ["reload", "back"]) {
      if (first.status !== "pass") items.push({ name: how === "reload" ? "刷新错误页：防重入" : "后退回错误页：防重入", status: "skip", detail: "_ss=ea 的错误页没有出现，无法验证" });
      else items.push(await antiReentry(ctx, first.targetId, how).catch(e => ({ name: `防重入（${how}）`, status: "fail", detail: `异常：${e.message}` })));
    }
    for (const i of items) delete i.targetId;
    const n = splitPairs(await ctx.ext.state()).length;
    if (n) items.push({ name: "分屏", status: "fail", detail: `不应产生分屏，实际 ${n} 个` });
    return summarize(items);
  },
};

export const FLOW_STEPS = [CORE_NEW, CORE_EXISTING, T5, T6, T7, ...FLOW_STEPS_2];
