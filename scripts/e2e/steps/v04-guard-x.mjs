// v0.4 步骤 T24（spec 3.14“不覆盖用户页面的回归”的右键子项）：真实右键点本扩展的文字项，结果一律开在分屏右边的普通标签，
// 分屏两侧的网址与页面标记都不变、不写任何记录（spec 3.3 判定表第 4 行）。
// (a) 用户分屏 page-u ｜ site-x；(b) 本扩展搜索对 A ｜ B 的左侧（在 A 的结果页正文里选词）；(c) 查询对的查询一侧（右栏）；
// (g) 清空 storage.session 后查询对的网页一侧。可选的 (d') 快捷键与 (i) 无痕在 v04-guard-more.mjs。
// xauto；回退是 judge：向导请用户在用户分屏的左侧右键查词，用户判断后脚本照 (a) 的断言核对。
import { expandTemplate } from "../../../src/lib/trigger.js";
import { resetTabs, navigate, waitState, waitTarget, findPair, expectPair, trigger, siteX, nonce, summarize, sleep } from "./util.mjs";
import { verdict, readRecords, checkPairRecords, queryOf } from "./v03-lib.mjs";
import { guarded } from "./optpage.mjs";
import { judge, focusGuide } from "./guided.mjs";
import { withAttempts, xauto } from "./xauto-lib.mjs";
import { primeClick } from "../gesture-ui.mjs";
import { metrics } from "../screen.mjs";
import { msg } from "../i18n.mjs";
import { openTabIn } from "./v04-lib.mjs";
import { articleUrl, selectIn, screenPoint, pickOurs, pickNote, item, mock, MENU_SETTLE_MS } from "./v04-lookup-lib.mjs";
import { guardTabs, guardCheck, makeQueryPair, queryRecords } from "./v04-guard.mjs";
import { xBase, cycleItem, incognitoItem, MORE_KEYS } from "./v04-guard-more.mjs";

const tabOf = (st, id) => st.tabs.find(t => t.id === id);

// 在 T 页面下方空白处点一下（窗口刚被抢走前台后第一次右键的菜单会立刻关掉，见 primeClick），再选中 spec 指定的文字、
// 在选区上右键点本扩展的文字项。split / side：T 在不在分屏里、在哪一栏。返回 { items（菜单行数）}
async function lookupOn(ctx, T, wid, spec, { split, side = "left" }) {
  const m = await metrics(ctx.browser, T.targetId);
  await primeClick(ctx, await screenPoint(ctx, T.targetId, wid, { x: m.innerWidth * 0.5, y: m.innerHeight * 0.9 }, { split, side }), wid);
  const s = await selectIn(ctx, T.targetId, spec);
  const at = await screenPoint(ctx, T.targetId, wid, s, { split, side });
  return { items: await pickOurs(ctx, "text", at, wid) };
}

// 结果应开在 pairIds 这一对右边的普通标签：网址 url、不在分屏里、index 为两侧最大 index + 1、在前台；两侧仍在分屏 v 里。
// 返回 { tab, problems }
async function besideTab(ctx, pairIds, url, v) {
  const st = await waitState(ctx, s => s.tabs.some(t => t.url === url && t.status === "complete" && !pairIds.includes(t.id)) && s,
    `结果开在新的普通标签 ${url}`, { timeoutMs: 20000 });
  const n = st.tabs.find(t => t.url === url && !pairIds.includes(t.id));
  const p = [];
  const at = Math.max(...pairIds.map(id => tabOf(st, id)?.index ?? -1)) + 1;
  if ((n.splitViewId ?? -1) !== -1) p.push(`结果标签 ${n.id} 不应在分屏里`);
  if (n.index !== at) p.push(`结果标签应在分屏右边（index ${at}），实际 ${n.index}`);
  if (!n.active) p.push(`结果标签 ${n.id} 应在前台`);
  if (!pairIds.every(id => tabOf(st, id)?.splitViewId === v)) p.push(`分屏 ${pairIds.join("｜")} 被拆开或换了 splitViewId`);
  return { tab: n, problems: p };
}

// 这些标签都没有记录；返回问题列表
async function noRecords(ctx, tabIds) {
  const recs = await readRecords(ctx, tabIds);
  return tabIds.filter(id => recs[id] !== undefined).map(id => `标签 ${id} 不应有记录，实际 ${JSON.stringify(recs[id])}`);
}

// 用户分屏：page-u 文章页 ｜ site-x，没有记录（judge 回退也用）
async function userSplit(ctx, base) {
  const P = await openTabIn(ctx, base.windowId, articleUrl(ctx.port));
  const S = await openTabIn(ctx, base.windowId, siteX(ctx.port, `/t24-user?n=${nonce()}`), { active: false });
  const v = await ctx.ext.eval(`chrome.tabs.createSplit([${P.id}, ${S.id}])`);
  await waitState(ctx, st => [P.id, S.id].every(id => tabOf(st, id)?.splitViewId === v), `用户分屏 ${P.id}｜${S.id} 建好`);
  return { P, S, v };
}

async function runA(ctx) {
  const { base, wid } = await xBase(ctx);
  const { P, S, v } = await userSplit(ctx, base);
  const guard = [P, S, base];
  const before = await guardTabs(ctx, guard);
  const m = await lookupOn(ctx, P, wid, { in: "#p1", word: "quick" }, { split: true });
  const url = expandTemplate(mock(ctx.port, "eb").url, "quick");
  const r = await besideTab(ctx, [P.id, S.id], url, v);
  const p = [...r.problems, ...await guardCheck(ctx, guard, before), ...await noRecords(ctx, [P.id, S.id, r.tab.id])];
  return verdict(p, `${pickNote("text", m.items)}；用户分屏 ${P.id}｜${S.id} 两侧网址与标记不变，结果在右边的普通标签 ${r.tab.id}（${url}），没有写记录`);
}

async function runB(ctx) {
  const { base, wid } = await xBase(ctx);
  const word = `tsearch${nonce()}`;
  await navigate(ctx, base.targetId, trigger(ctx.port, word));
  const [A, B] = await waitState(ctx, st => findPair(st, ctx.port, word), `分屏 ${expectPair(ctx.port, word).join(" ｜ ")}`, { timeoutMs: 20000 });
  const target = async t => ({ id: t.id, targetId: (await waitTarget(ctx, x => x.url === t.url, t.url)).targetId });
  const tA = await target(A), tB = await target(B);
  const guard = [tA, tB];
  const before = await guardTabs(ctx, guard);
  const m = await lookupOn(ctx, tA, wid, { in: "p", word }, { split: true });
  const url = expandTemplate(mock(ctx.port, "eb").url, word);
  const r = await besideTab(ctx, [A.id, B.id], url, A.splitViewId);
  const p = [...r.problems, ...await guardCheck(ctx, guard, before), ...await noRecords(ctx, [r.tab.id])];
  p.push(...checkPairRecords(await readRecords(ctx, [A.id, B.id]), A, B,
    { mode: "split", splitViewId: A.splitViewId, engines: ["ea", "eb"], query: queryOf(word) }));
  return verdict(p, `${pickNote("text", m.items)}；搜索对 ${A.id}｜${B.id} 两侧网址与标记不变、记录仍是 search，结果在右边的普通标签 ${r.tab.id}`);
}

// 查询对现场：page-u 文章页在左，查询一侧（模拟引擎 B 搜 "guard <n>"）在右
async function queryPairIn(ctx, base) {
  const P = await openTabIn(ctx, base.windowId, articleUrl(ctx.port));
  return { P, ...(await makeQueryPair(ctx, P, { query: `guard ${nonce()}` })) };
}

async function runC(ctx) {
  const { base, wid } = await xBase(ctx);
  const qp = await queryPairIn(ctx, base);
  const { P, L } = qp;
  const guard = [P, L, base];
  const before = await guardTabs(ctx, guard);
  const m = await lookupOn(ctx, L, wid, { in: "p", word: "guard" }, { split: true, side: "right" });
  const url = expandTemplate(mock(ctx.port, "eb").url, "guard");
  const r = await besideTab(ctx, [P.id, L.id], url, qp.splitViewId);
  const p = [...r.problems, ...await guardCheck(ctx, guard, before), ...await noRecords(ctx, [r.tab.id]), ...await queryRecords(ctx, P, L, qp)];
  return verdict(p, `${pickNote("text", m.items)}；在查询一侧 ${L.id} 选中 guard 右键：结果在右边的普通标签 ${r.tab.id}（${url}），网页与查询一侧网址和标记都不变，记录仍是 page↔lookup`);
}

async function runG(ctx) {
  const { base, wid } = await xBase(ctx);
  const qp = await queryPairIn(ctx, base);
  const { P, L } = qp;
  await ctx.ext.eval("chrome.storage.session.clear().then(() => true)");
  const guard = [P, L, base];
  const before = await guardTabs(ctx, guard);
  const m = await lookupOn(ctx, P, wid, { in: "#p2", word: "views" }, { split: true });
  const url = expandTemplate(mock(ctx.port, "eb").url, "views");
  const r = await besideTab(ctx, [P.id, L.id], url, qp.splitViewId);
  const p = [...r.problems, ...await guardCheck(ctx, guard, before), ...await noRecords(ctx, [P.id, L.id, r.tab.id])];
  return verdict(p, `${pickNote("text", m.items)}；清空 storage.session 后在网页一侧 ${P.id} 右键：结果在右边的普通标签 ${r.tab.id}，两侧网址与标记不变，没有写记录`);
}

// 每次尝试都从没有 lookupEngine 开始（查词引擎 = 默认组合右侧 eb）；删了键就等菜单重建完
async function dropLookupEngine(ctx) {
  if (!(await ctx.ext.eval(`chrome.storage.sync.get("lookupEngine").then(r => "lookupEngine" in r)`))) return;
  await ctx.ext.eval(`chrome.storage.sync.remove("lookupEngine").then(() => true)`);
  await sleep(MENU_SETTLE_MS);
}
const attempts = (ctx, fn) => () => withAttempts(ctx, async () => { await dropLookupEngine(ctx); return fn(ctx); });

// 回退：向导请用户在用户分屏的左侧（page-u）选词右键，点本扩展的菜单项；用户判通过后脚本照 (a) 核对
const T24_MANUAL = {
  id: "T24", title: "不覆盖用户页面（右键）：用户分屏里右键查词，结果开在旁边的普通标签（人工右键）", kind: "judge", needs: [], timeoutFactor: 3,
  run: ctx => guarded(ctx, ["lookupEngine"], async () => {
    await dropLookupEngine(ctx);
    const base = await resetTabs(ctx);
    const { P, S, v } = await userSplit(ctx, { windowId: base.windowId });
    const guard = [P, S, { id: base.tabId, targetId: base.targetId }];
    const before = await guardTabs(ctx, guard);
    await focusGuide(ctx);
    const eb = mock(ctx.port, "eb");
    const r = await judge(ctx, {
      title: "T24 不覆盖用户页面", timeoutMs: ctx.timeoutMs * 3,
      instruction: `切到标签“page-u article”（它和 site-x 组成了你自己的拆分视图），在第一段里选中 quick，右键，点“${msg("menu_lookup_text", eb.name).replace("%s", "…")}”。\n`
        + "期望：拆分视图两侧都不变，模拟引擎 B 的搜索开在拆分视图右边的一个普通新标签里。看到了点“通过”。",
    });
    if (r.status !== "pass") return r;
    const url = expandTemplate(eb.url, "quick");
    const b = await besideTab(ctx, [P.id, S.id], url, v).catch(e => ({ problems: [e.message] }));
    const p = [...b.problems, ...await guardCheck(ctx, guard, before), ...(b.tab ? await noRecords(ctx, [P.id, S.id, b.tab.id]) : [])];
    return verdict(p.map(x => `用户判通过，但脚本核对不符：${x}`), `用户分屏 ${P.id}｜${S.id} 两侧不变，结果在右边的普通标签 ${b.tab?.id}；(b)(c)(g)(d')(i) 只在自动版本里测`);
  }),
};

export const T24 = xauto({
  id: "T24", title: "不覆盖用户页面（右键）：用户分屏、本扩展搜索对、查询一侧、没有记录的查询对里右键都开普通标签；快捷键换的是查询标签；无痕不显示菜单项（真实鼠标键盘）",
  timeoutMs: 420000,
  run: ctx => guarded(ctx, ["lookupEngine", ...MORE_KEYS], async () => summarize([
    await item("(a) 用户分屏 page-u ｜ site-x 的左侧右键查词：两侧不变，结果在分屏右边的普通标签，不写记录", attempts(ctx, runA)),
    await item("(b) 本扩展搜索对 A ｜ B 的左侧（A 的结果页正文）右键：A、B 都不变，结果在新普通标签", attempts(ctx, runB)),
    await item("(c) 查询对的查询一侧（右栏）右键：新普通标签，两侧都不变", attempts(ctx, runC)),
    await item("(g) 清空 storage.session 后在查询对的网页一侧右键：新普通标签，两侧不变，不写记录", attempts(ctx, runG)),
    await item("(d') 查询对对调两侧后按快捷键 cycle-right：换的是查询标签，网页标记不变", () => cycleItem(ctx)),
    await item("(i) 无痕窗口：同一页面的选区上菜单比普通窗口少 1 项（本扩展项不出现）", () => incognitoItem(ctx)),
  ])),
}, T24_MANUAL);
