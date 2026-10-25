// v0.3 自动步骤 T17（spec 3.8 V3）：窄窗口降级。
// 用 CDP Browser.setWindowBounds 调窗口宽度（写法同 xauto-lib.mjs 的 fixWindow），扩展侧用 windows.get 读回（DIP，含边框）。
// (a) 默认开启（删掉 narrowFallback）+ 窄窗口：右侧是相邻的后台标签、写 adjacent 记录；同一标签再触发复用它
// (b) 窄窗口下的 foreign：用户分屏两侧不变 (c) 开关为 false：窄窗口照常分屏 (d) 宽窗口照常分屏
// (e)(f) 相邻对在窗口变宽 / 关掉开关后，同一标签再触发：这两个标签拼成分屏，记录改为 split，不新开标签。
// finally 恢复窗口尺寸；narrowFallback 由 guarded 写回步骤前的值。
import { NARROW_WIDTH } from "../../../src/lib/narrow.js";
import {
  splitPairs, trigger, siteX, expectPair, findPair, nonce, resetTabs, navigate, waitState, waitTarget, summarize, sleep,
} from "./util.mjs";
import { ids, fmt } from "./flow-restart.mjs";
import { guarded } from "./optpage.mjs";
import { sub, verdict, queryOf, readRecords, checkPairRecords, findAdjacent, tabUrl } from "./v03-lib.mjs";

const NARROW = 900; // 低于阈值 960；Xvfb 下实测能设到（原型里最小 500）
const WIDE = 1600;

const setNarrowPref = (ctx, v) => ctx.ext.eval(v === undefined
  ? `chrome.storage.sync.remove("narrowFallback").then(() => true)`
  : `chrome.storage.sync.set({ narrowFallback: ${v} }).then(() => true)`);

// 把 base 所在窗口设成 width 宽，返回扩展侧读回的宽度。saved 记下每个窗口改动前的 bounds，finally 里还原
async function sizeTo(ctx, base, width, saved) {
  const { client } = ctx.browser;
  const { windowId, bounds } = await client.send("Browser.getWindowForTarget", { targetId: base.targetId });
  if (!saved.has(windowId)) saved.set(windowId, bounds);
  if (bounds.windowState !== "normal") await client.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await client.send("Browser.setWindowBounds", { windowId, bounds: { width } });
  // 读回直到连续两次一致（窗口尺寸变化是异步的）
  let prev = null;
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const w = await ctx.ext.eval(`chrome.windows.get(${base.windowId}).then(w => w.width)`);
    if (w === prev && (w < NARROW_WIDTH) === (width < NARROW_WIDTH)) return w;
    prev = w;
  }
  return prev;
}

async function restoreWindows(ctx, saved) {
  const { client } = ctx.browser;
  for (const [windowId, b] of saved) {
    const bounds = b.windowState === "normal" ? { left: b.left, top: b.top, width: b.width, height: b.height } : { windowState: b.windowState };
    await client.send("Browser.setWindowBounds", { windowId, bounds }).catch(() => {});
  }
}

const adjRecordsWant = (q) => ({ mode: "adjacent", splitViewId: -1, engines: ["ea", "eb"], query: queryOf(q) });
const countTabs = st => st.tabs.filter(t => !(t.url || "").startsWith("chrome-extension://")).length;

// 窄窗口：准备好现场并把窗口设窄；设不到阈值以下时抛出带 skip 标记的错误
async function narrowBase(ctx, saved) {
  const base = await resetTabs(ctx);
  const w = await sizeTo(ctx, base, NARROW, saved);
  if (!(w < NARROW_WIDTH)) throw Object.assign(new Error(`窗口宽度设不到 ${NARROW_WIDTH} 以下（设 ${NARROW}，读回 ${w}）`), { skip: true });
  return { base, width: w };
}
const skipOr = fn => async () => {
  try { return await fn(); } catch (e) { if (e.skip) return { status: "skip", detail: e.message }; throw e; }
};

const adjacent = (ctx, saved) => sub("(a) 默认开启 + 窄窗口：右侧在相邻后台标签，同一标签再触发复用它", skipOr(async () => {
  const { port } = ctx;
  await setNarrowPref(ctx, undefined);
  const { base, width } = await narrowBase(ctx, saved);
  const q = "t17+narrow", q2 = "t17+narrow2";
  await navigate(ctx, base.targetId, trigger(port, q));
  const adj = await waitState(ctx, st => findAdjacent(st, port, q), `相邻对 ${expectPair(port, q).join(" ｜ ")}`);
  const st = await ctx.ext.state();
  const p = [];
  if (splitPairs(st).length) p.push(`不应有分屏，实际 ${splitPairs(st).length} 个`);
  if (adj[0].id !== base.tabId) p.push(`左侧应是被触发的标签 ${base.tabId}，实际 ${adj[0].id}`);
  if (adj[1].active) p.push(`右侧 ${adj[1].id} 应是后台标签`);
  p.push(...checkPairRecords(await readRecords(ctx, adj.map(t => t.id)), adj[0], adj[1], adjRecordsWant(q)));
  // 同一标签再触发：复用右边那个，不新开
  const n0 = countTabs(st);
  await navigate(ctx, base.targetId, trigger(port, q2));
  const adj2 = await waitState(ctx, s => findAdjacent(s, port, q2), `相邻对更新为 ${q2}`);
  const st2 = await ctx.ext.state();
  if (adj2[0].id !== adj[0].id || adj2[1].id !== adj[1].id) p.push(`再触发应复用 ${ids(adj)}，实际 ${ids(adj2)}`);
  if (countTabs(st2) !== n0) p.push(`标签数从 ${n0} 变成 ${countTabs(st2)}`);
  if (splitPairs(st2).length) p.push("再触发后出现了分屏");
  p.push(...checkPairRecords(await readRecords(ctx, adj2.map(t => t.id)), adj2[0], adj2[1], adjRecordsWant(q2)));
  return verdict(p, `窗口宽 ${width}：${ids(adj)} 是相邻对（右侧在后台），记录 mode adjacent；再触发就地更新为 ${fmt(adj2)}`);
}));

const foreign = (ctx, saved) => sub("(b) 窄窗口下在用户分屏里触发：用户分屏两侧不变", skipOr(async () => {
  const { port } = ctx;
  await setNarrowPref(ctx, undefined);
  const { base, width } = await narrowBase(ctx, saved);
  const n = nonce();
  const [u1, u2] = [siteX(port, `/narrow-1?n=${n}`), siteX(port, `/narrow-2?n=${n}`)];
  const made = await ctx.ext.eval(`(async () => {
    const a = await chrome.tabs.create({ windowId: ${base.windowId}, url: ${JSON.stringify(u1)}, active: true });
    const b = await chrome.tabs.create({ windowId: ${base.windowId}, url: ${JSON.stringify(u2)}, active: false });
    return { a: a.id, b: b.id, splitViewId: await chrome.tabs.createSplit([a.id, b.id]) };
  })()`);
  await waitState(ctx, st => ["a", "b"].every(k => st.tabs.some(t => t.id === made[k] && t.status === "complete" && t.splitViewId === made.splitViewId)),
    "用户分屏两侧加载完成");
  const t1 = await waitTarget(ctx, t => t.url === u1, u1);
  const q = "t17+foreign";
  await navigate(ctx, t1.targetId, trigger(port, q));
  const adj = await waitState(ctx, st => findAdjacent(st, port, q), `相邻对 ${expectPair(port, q).join(" ｜ ")}`);
  const st = await waitState(ctx, s => tabUrl(s, made.a) === u1 && s.tabs.find(t => t.id === made.a)?.status === "complete" && s,
    `被触发的标签 ${made.a} 回到 ${u1}`).catch(async e => ({ err: e.message, ...(await ctx.ext.state()) }));
  const p = [];
  if (st.err) p.push(st.err);
  if (tabUrl(st, made.b) !== u2) p.push(`用户分屏另一侧应保持 ${u2}，实际 ${tabUrl(st, made.b) ?? "（标签不见了）"}`);
  if (!["a", "b"].every(k => st.tabs.find(t => t.id === made[k])?.splitViewId === made.splitViewId)) p.push("用户分屏被拆开了");
  if ([made.a, made.b].some(id => adj.some(t => t.id === id))) p.push(`新的一对不应使用用户分屏的标签：${ids(adj)}`);
  if (adj[1].active) p.push(`右侧 ${adj[1].id} 应是后台标签`);
  if (splitPairs(st).length !== 1) p.push(`应只有用户的 1 个分屏，实际 ${splitPairs(st).length} 个`);
  p.push(...checkPairRecords(await readRecords(ctx, adj.map(t => t.id)), adj[0], adj[1], adjRecordsWant(q)));
  return verdict(p, `窗口宽 ${width}：用户分屏 ${made.a}｜${made.b} 未变，新开相邻对 ${ids(adj)}：${fmt(adj)}`);
}));

// 期望照常分屏：pref 为 narrowFallback 的值（undefined = 删掉键），width 为窗口宽度
const splits = (ctx, saved, name, pref, width, q) => sub(name, skipOr(async () => {
  const { port } = ctx;
  await setNarrowPref(ctx, pref);
  const base = await resetTabs(ctx);
  const w = await sizeTo(ctx, base, width, saved);
  if ((w < NARROW_WIDTH) !== (width < NARROW_WIDTH)) return { status: "skip", detail: `窗口宽度设不到 ${width}（读回 ${w}）` };
  await navigate(ctx, base.targetId, trigger(port, q));
  const pair = await waitState(ctx, st => findPair(st, port, q), `分屏 ${expectPair(port, q).join(" ｜ ")}`);
  const p = checkPairRecords(await readRecords(ctx, pair.map(t => t.id)), pair[0], pair[1],
    { mode: "split", splitViewId: pair[0].splitViewId, engines: ["ea", "eb"], query: queryOf(q) });
  return verdict(p, `窗口宽 ${w}、narrowFallback ${pref === undefined ? "缺省" : pref}：建了分屏 ${fmt(pair)}`);
}));

// 先在窄窗口建相邻对，再经 change() 改条件（窗口变宽或关掉开关），同一标签再触发，期望拼成分屏
const joins = (ctx, saved, name, change, q) => sub(name, skipOr(async () => {
  const { port } = ctx;
  await setNarrowPref(ctx, undefined);
  const { base } = await narrowBase(ctx, saved);
  await navigate(ctx, base.targetId, trigger(port, q));
  const adj = await waitState(ctx, st => findAdjacent(st, port, q), `相邻对 ${expectPair(port, q).join(" ｜ ")}`);
  const n0 = countTabs(await ctx.ext.state());
  const how = await change(base);
  const q2 = `${q}2`;
  await navigate(ctx, base.targetId, trigger(port, q2));
  const pair = await waitState(ctx, st => findPair(st, port, q2), `分屏 ${expectPair(port, q2).join(" ｜ ")}`);
  const st = await ctx.ext.state();
  const p = [];
  if (pair[0].id !== adj[0].id || pair[1].id !== adj[1].id) p.push(`分屏应由原来的相邻对 ${ids(adj)} 组成，实际 ${ids(pair)}`);
  if (countTabs(st) !== n0) p.push(`标签数从 ${n0} 变成 ${countTabs(st)}`);
  p.push(...checkPairRecords(await readRecords(ctx, pair.map(t => t.id)), pair[0], pair[1],
    { mode: "split", splitViewId: pair[0].splitViewId, engines: ["ea", "eb"], query: queryOf(q2) }));
  return verdict(p, `相邻对 ${ids(adj)}；${how}后再触发，拼成分屏 ${pair[0].splitViewId}：${fmt(pair)}，记录 mode split，没有新开标签`);
}));

const widen = (ctx, saved) => async base => {
  const w = await sizeTo(ctx, base, WIDE, saved);
  if (w < NARROW_WIDTH) throw Object.assign(new Error(`窗口宽度设不到 ${NARROW_WIDTH} 以上（设 ${WIDE}，读回 ${w}）`), { skip: true });
  return `窗口变宽到 ${w} `;
};
const switchOff = ctx => async () => { await setNarrowPref(ctx, false); return "把 narrowFallback 改为 false "; };

const T17 = {
  id: "T17", title: "窄窗口降级：右侧改在相邻后台标签、复用、不动用户分屏；关掉开关或宽窗口照常分屏，相邻对随之拼成分屏（自动判定）", kind: "auto", needs: [],
  timeoutMs: 180000,
  run: ctx => guarded(ctx, ["narrowFallback"], async () => {
    const saved = new Map();
    try {
      return summarize([
        await adjacent(ctx, saved),
        await foreign(ctx, saved),
        await splits(ctx, saved, "(c) 开关为 false + 窄窗口：照常分屏", false, NARROW, "t17+off"),
        await splits(ctx, saved, "(d) 默认开启 + 宽窗口：照常分屏", undefined, WIDE, "t17+wide"),
        await joins(ctx, saved, "(e) 相邻对在窗口变宽后再触发：拼成分屏", widen(ctx, saved), "t17+join"),
        await joins(ctx, saved, "(f) 相邻对在关掉开关后再触发：拼成分屏", switchOff(ctx), "t17+joinoff"),
      ]);
    } finally { await restoreWindows(ctx, saved); }
  }),
};

export const V03_NARROW_STEPS = [T17];
