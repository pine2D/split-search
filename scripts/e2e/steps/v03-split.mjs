// v0.3 自动步骤 T16（spec 3.8 V1）：分屏记录绑定 splitViewId。
// (a) 记录形状；(b) 拆开再拼回去后触发判“不是”；(c) tabs.move 对调后仍复用；(d) 关标签清记录、不误删对侧的新配对；
// (e) 重启后另一侧停在引擎的非搜索路径，兜底判“不是”。重启沿用 T5 的做法（ctx.restartBrowser）。
import { isDeepStrictEqual } from "node:util";
import { HOSTS } from "../config.mjs";
import {
  splitPairs, trigger, engineA, expectPair, findPair, siteX, nonce, navigate, waitState, waitTarget, summarize,
} from "./util.mjs";
import { retrigger, ids, fmt } from "./flow-restart.mjs";
import { sub, verdict, queryOf, readRecords, checkPairRecords, pairOn, tabUrl } from "./v03-lib.mjs";

const splitWant = (pair, q) => ({ mode: "split", splitViewId: pair[0].splitViewId, engines: ["ea", "eb"], query: queryOf(q) });

const shape = ctx => sub("(a) 触发后两条记录形状正确、splitViewId 一致", async () => {
  const q = "t16+rec";
  const { pair } = await pairOn(ctx, q);
  const recs = await readRecords(ctx, pair.map(t => t.id));
  const p = checkPairRecords(recs, pair[0], pair[1], splitWant(pair, q));
  if (pair[0].splitViewId === -1 || pair[0].splitViewId !== pair[1].splitViewId) p.push(`两侧 splitViewId 不一致：${pair[0].splitViewId} / ${pair[1].splitViewId}`);
  return verdict(p, `标签 ${ids(pair)} 互指，splitViewId ${pair[0].splitViewId}，mode split，engine ea / eb，query “${queryOf(q)}”`);
});

// 在已有的一对（不论是不是本扩展的）的 tab 上触发 q2，期望走 foreign：原来两个标签不被改写，新开一对。
// 返回问题列表与新的一对
async function expectForeign(ctx, tab, other, q2) {
  const st0 = await ctx.ext.state();
  const [urlT, urlO] = [tabUrl(st0, tab.id), tabUrl(st0, other.id)];
  const target = await waitTarget(ctx, t => t.url === urlT, urlT);
  await navigate(ctx, target.targetId, trigger(ctx.port, q2));
  const now = await waitState(ctx, st => findPair(st, ctx.port, q2), `新分屏 ${expectPair(ctx.port, q2).join(" ｜ ")}`);
  // 被触发的标签经 history.back() 回到原页面
  const st = await waitState(ctx, s => s.tabs.some(t => t.id === tab.id && t.url === urlT && t.status === "complete") && s,
    `被触发的标签 ${tab.id} 回到 ${urlT}`).catch(async e => ({ err: e.message, ...(await ctx.ext.state()) }));
  const p = [];
  if (st.err) p.push(st.err);
  if (tabUrl(st, other.id) !== urlO) p.push(`另一侧 ${other.id} 应保持 ${urlO}，实际 ${tabUrl(st, other.id) ?? "（标签不见了）"}`);
  const v = st.tabs.find(t => t.id === tab.id)?.splitViewId;
  if (v === -1 || v !== st.tabs.find(t => t.id === other.id)?.splitViewId) p.push("原来的一对不在同一个分屏里了");
  if ([tab.id, other.id].includes(now[0].id) || [tab.id, other.id].includes(now[1].id)) p.push(`新分屏不应使用原来的标签：${ids(now)}`);
  return { problems: p, now, st };
}

const rejoin = ctx => sub("(b) 拆开再拼回去后触发：判“不是”，走 foreign", async () => {
  const q = "t16+rejoin";
  const { pair } = await pairOn(ctx, q);
  const [L, R] = pair;
  const v1 = await ctx.ext.eval(`(async () => {
    await chrome.tabs.unsplit(${L.splitViewId});
    return chrome.tabs.createSplit([${L.id}, ${R.id}]);
  })()`);
  await waitState(ctx, st => [L.id, R.id].every(id => st.tabs.find(t => t.id === id)?.splitViewId === v1), `${ids(pair)} 拼回分屏 ${v1}`);
  if (v1 === L.splitViewId) return { status: "skip", detail: `createSplit 沿用了原来的 splitViewId ${v1}，构造不出“拼回去”的情况` };
  const r = await expectForeign(ctx, L, R, "t16+rejoin2");
  const recs = await readRecords(ctx, [L.id, R.id]);
  if (recs[L.id] !== undefined || recs[R.id] !== undefined) r.problems.push(`失效记录应被顺手清理，实际 ${JSON.stringify(recs)}`);
  return verdict(r.problems, `splitViewId ${L.splitViewId} → ${v1}；在左侧 ${L.id} 触发后新开一对 ${ids(r.now)}，原来两个标签未被改写（右侧仍是另一侧引擎的搜索页），失效记录已清理`);
});

const swap = ctx => sub("(c) tabs.move 对调两侧后触发：仍就地更新", async () => {
  const q = "t16+swap", q2 = "t16+swap2";
  const { pair } = await pairOn(ctx, q);
  const [L, R] = pair;
  await ctx.ext.eval(`chrome.tabs.move(${R.id}, { index: ${L.index} }).then(() => true)`);
  const swapped = await waitState(ctx, st => {
    const l = st.tabs.find(t => t.id === L.id), r = st.tabs.find(t => t.id === R.id);
    return l && r && r.index < l.index && r.splitViewId === L.splitViewId && l.splitViewId === L.splitViewId && [r, l];
  }, `对调后 ${R.id} 在左、仍在分屏 ${L.splitViewId}`);
  const res = await retrigger(ctx, swapped, "left", q2);
  const recs = await readRecords(ctx, [R.id, L.id]);
  res.problems.push(...checkPairRecords(recs, swapped[0], swapped[1], splitWant(swapped, q2)));
  return verdict(res.problems, `对调后标签 ${ids(swapped)} 仍在分屏 ${L.splitViewId}；在左侧触发后就地更新：${fmt(res.pair)}；记录按新位置写 ea / eb`);
});

// 轮询直到 pred(records) 为真
async function waitRecords(ctx, tabIds, pred, what) {
  return waitState(ctx, async () => { const r = await readRecords(ctx, tabIds); return pred(r) && r; }, what, { timeoutMs: 10000 });
}

// (d) 的两段都先断言两条记录确实在（否则“删掉了”可能只是本来就没写）；“对侧已重新配对”是直接写 storage.session 构造的
const cleanup = ctx => sub("(d) 关掉一侧清掉两条记录；对侧已重新配对（经 storage.session 构造）时不误删", async () => {
  const p = [];
  const { pair } = await pairOn(ctx, "t16+close");
  const pre = checkPairRecords(await readRecords(ctx, pair.map(t => t.id)), pair[0], pair[1], splitWant(pair, "t16+close"));
  if (pre.length) return verdict(pre.map(x => `关标签前：${x}`));
  await ctx.ext.eval(`chrome.tabs.remove(${pair[1].id}).then(() => true)`);
  await waitRecords(ctx, pair.map(t => t.id), r => r[pair[0].id] === undefined && r[pair[1].id] === undefined, `关掉 ${pair[1].id} 后两条记录都被删掉`)
    .catch(e => p.push(e.message));
  // 构造：A ↔ B 是本扩展的一对，之后 B 已和 C 重新配对（B、C 互指），A 的记录还指着 B。关掉 A 时只删 A 的
  const { pair: ab } = await pairOn(ctx, "t16+repair");
  const [A, B] = ab;
  const pre2 = checkPairRecords(await readRecords(ctx, [A.id, B.id]), A, B, splitWant(ab, "t16+repair"));
  if (pre2.length) return verdict([...p, ...pre2.map(x => `重新配对前 A ↔ B：${x}`)]);
  const C = await ctx.ext.eval(`chrome.tabs.create({ windowId: ${B.windowId}, url: ${JSON.stringify(siteX(ctx.port, `/repaired?n=${nonce()}`))}, active: false }).then(t => t.id)`);
  const made = { [`split:${B.id}`]: { peer: C, splitViewId: -1, mode: "adjacent", engine: "eb", query: "t16 repair" },
    [`split:${C}`]: { peer: B.id, splitViewId: -1, mode: "adjacent", engine: "ea", query: "t16 repair" } };
  await ctx.ext.eval(`chrome.storage.session.set(${JSON.stringify(made)}).then(() => true)`);
  const before = await readRecords(ctx, [A.id, B.id, C]);
  if (before[A.id]?.peer !== B.id) p.push(`关 A 前 A ${A.id} 的记录应仍指向 B ${B.id}，实际 ${JSON.stringify(before[A.id])}`);
  if (!isDeepStrictEqual(before[B.id], made[`split:${B.id}`]) || !isDeepStrictEqual(before[C], made[`split:${C}`])) {
    p.push(`构造的 B ↔ C 记录没写进去：${JSON.stringify([before[B.id], before[C]])}`);
  }
  if (p.length) {
    await ctx.ext.eval(`chrome.storage.session.remove(${JSON.stringify(Object.keys(made))}).then(() => true)`);
    return verdict(p);
  }
  await ctx.ext.eval(`chrome.tabs.remove(${A.id}).then(() => true)`);
  const r = await waitRecords(ctx, [A.id, B.id, C], x => x[A.id] === undefined, `关掉 ${A.id} 后它的记录被删掉`)
    .catch(e => { p.push(e.message); return null; });
  if (r) {
    if (!isDeepStrictEqual(r[B.id], made[`split:${B.id}`])) p.push(`B ${B.id} 的新配对记录被改动：${JSON.stringify(r[B.id])}`);
    if (!isDeepStrictEqual(r[C], made[`split:${C}`])) p.push(`C ${C} 的记录被改动：${JSON.stringify(r[C])}`);
  }
  await ctx.ext.eval(`chrome.storage.session.remove(${JSON.stringify(Object.keys(made))}).then(() => true)`);
  return verdict(p, `关前两条记录都在；关掉 ${pair[1].id} 后 ${ids(pair)} 的记录都已删除；B ${B.id} 与 C ${C} 的新配对（经 storage.session 构造）在、A 仍指向 B 时，关掉 A ${A.id} 只删了 A 的记录`);
});

// 重启后找恢复的一对：左侧是 left、右侧是 right（网址），两侧加载完成
const restoredPair = (st, left, right) => splitPairs(st).find(p => p[0].url === left && p[1].url === right
  && p.every(t => t.status === "complete"));

const reboot = ctx => sub("(e) 重启后另一侧停在引擎的非搜索路径：判“不是”", async () => {
  const q = "t16+boot";
  const { pair } = await pairOn(ctx, q);
  const about = `http://${HOSTS.b}:${ctx.port}/about?n=${nonce()}`;
  const right = await waitTarget(ctx, t => t.url === pair[1].url, pair[1].url);
  await navigate(ctx, right.targetId, about);
  await waitState(ctx, st => st.tabs.some(t => t.id === pair[1].id && t.url === about && t.status === "complete"), `右侧 ${pair[1].id} 打开 ${about}`);
  Object.assign(ctx, await ctx.restartBrowser({ restoreSession: true }));
  const left = engineA(ctx.port, q);
  let back;
  try { back = await waitState(ctx, st => restoredPair(st, left, about), `重启后恢复分屏 ${left} ｜ ${about}`, { timeoutMs: 30000 }); }
  catch (e) { return { status: "skip", detail: `重启后分屏没有恢复，无法验证兜底（${e.message}）` }; }
  const recs = await readRecords(ctx, back.map(t => t.id));
  if (Object.values(recs).some(v => v !== undefined)) return { status: "skip", detail: `重启后 storage.session 仍有记录（${JSON.stringify(recs)}），走不到兜底` };
  const r = await expectForeign(ctx, back[0], back[1], "t16+boot2");
  return verdict(r.problems, `恢复的分屏 ${ids(back)}（右侧停在 ${about}）没有记录；触发后新开一对 ${ids(r.now)}，原来两个标签未被改写`);
});

const T16 = {
  id: "T16", title: "分屏记录绑定 splitViewId：形状、拆开再拼回、对调、清理、重启兜底（自动判定）", kind: "auto", needs: [],
  timeoutMs: 180000, restarts: true,
  async run(ctx) {
    return summarize([await shape(ctx), await rejoin(ctx), await swap(ctx), await cleanup(ctx), await reboot(ctx)]);
  },
};

export const V03_SPLIT_STEPS = [T16];
