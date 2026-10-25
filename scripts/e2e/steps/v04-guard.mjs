// v0.4 不覆盖用户页面的回归（spec 3.14 末段）：T23（auto）测 go.html 与弹窗的改写路径 (d)(e)(f)(h)；
// T24（xauto，真实右键，v04-guard-x.mjs）测右键路径 (a)(b)(c)(g) 与可选的 (d') 快捷键、(i) 无痕。
// 每个子项给不该被动的标签写页面标记，结束时按 CDP 网址与标记核对（guardProblems）：网址相同但页面重载过，标记就没了。
// 查询对用 auto 办法构造（makeQueryPair：扩展页里 tabs.create({ splitWithTabId }) 再写 page/lookup 记录），不经真实右键；
// 网页一侧在 page-u（没有授权的 host），扩展读不到它的网址，一律从 CDP 读。
import { expandTemplate } from "../../../src/lib/trigger.js";
import { resetTabs, navigate, waitState, waitTarget, evalIn, findPair, expectPair, trigger, nonce, sleep, summarize } from "./util.mjs";
import { verdict, readRecords, checkPairRecords, queryOf, ids } from "./v03-lib.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import { markPage, cdpUrl, openTabIn, ownershipOf, subInfra } from "./v04-lib.mjs";
import { articleUrl, mock } from "./v04-lookup-lib.mjs";
import { HOSTS } from "../config.mjs";
import { infra } from "../ext-webui.mjs";

const J = JSON.stringify;
const tabOf = (st, id) => st.tabs.find(t => t.id === id);

// 纯函数：before / after 是 { [tabId]: { url, mark } }（mark 是页面里读回的标记，读不到为 null）。
// 列出被导航（网址变了）、被重载（网址相同、标记丢了）或不见了的标签，每个标签一条
export function guardProblems(before, after) {
  const p = [];
  for (const [id, b] of Object.entries(before)) {
    const a = after?.[id];
    if (!a) p.push(`标签 ${id} 不见了（之前在 ${b.url}）`);
    else if (a.url !== b.url) p.push(`标签 ${id} 被导航：${b.url} → ${a.url}`);
    else if (a.mark !== b.mark) p.push(`标签 ${id} 被重载：网址仍是 ${b.url}，页面标记丢了`);
  }
  return p;
}

// tabs: [{ id, targetId }]。读 CDP 网址与页面标记；目标不见了的标签不进快照
export async function snapTabs(ctx, tabs) {
  const out = {};
  for (const t of tabs) {
    const url = await cdpUrl(ctx, t.targetId);
    if (url === undefined) continue;
    out[t.id] = { url, mark: await evalIn(ctx, t.targetId, "globalThis.__ssMark ?? null").catch(() => null) };
  }
  return out;
}

// 给每个标签写标记，返回快照（之后交给 guardCheck）
export async function guardTabs(ctx, tabs) {
  for (const t of tabs) await markPage(ctx, t.targetId);
  return snapTabs(ctx, tabs);
}

// 等一会儿（晚到的导航也要看得见）再核对；返回问题列表
export async function guardCheck(ctx, tabs, before, { settleMs = 500 } = {}) {
  await sleep(settleMs);
  return guardProblems(before, await snapTabs(ctx, tabs));
}

// 在 P（已加载的网页标签 { id, targetId, url }）旁边建查询对：查询一侧是 engine 的 query 搜索，与 P 组成分屏，
// 两条记录 page（P，engine ""）↔ lookup，input "text"。返回 { L: { id, targetId, url }, splitViewId, query, engine }
export async function makeQueryPair(ctx, P, { query, engine = "eb" }) {
  const url = expandTemplate(mock(ctx.port, engine).url, query);
  const made = await ctx.ext.eval(`(async () => {
    const { makeRecords } = await import("/lib/split-owner.js");
    const p = await chrome.tabs.get(${P.id});
    const l = await chrome.tabs.create({ url: ${J(url)}, splitWithTabId: p.id, index: p.index + 1, windowId: p.windowId, active: false });
    let v = -1;
    for (let i = 0; i < 20 && v === -1; i++) {
      const [a, b] = await Promise.all([chrome.tabs.get(p.id), chrome.tabs.get(l.id)]);
      if (a.splitViewId !== -1 && a.splitViewId === b.splitViewId) v = a.splitViewId;
      else await new Promise(r => setTimeout(r, 100));
    }
    if (v !== -1) await chrome.storage.session.set(makeRecords({ a: p.id, b: l.id, splitViewId: v, mode: "split",
      engineA: "", engineB: ${J(engine)}, query: ${J(query)}, roleA: "page", roleB: "lookup", input: "text" }));
    return { id: l.id, splitViewId: v };
  })()`);
  if (made.splitViewId === -1) throw infra(`tabs.create({ splitWithTabId: ${P.id} }) 没有组成分屏，构造不出查询对`);
  const { targetId } = await waitTarget(ctx, t => t.url === url, url);
  await waitState(ctx, st => tabOf(st, made.id)?.status === "complete", `查询标签 ${made.id} 加载完成`);
  return { L: { id: made.id, targetId, url }, splitViewId: made.splitViewId, query, engine };
}

// 查询对的两条记录应为 page ↔ lookup（engine ""、lookupEngine），返回问题列表
export const queryRecords = async (ctx, P, L, { splitViewId, query, engine = "eb" }) => checkPairRecords(await readRecords(ctx, [P.id, L.id]), P, L,
  { mode: "split", splitViewId, roles: ["page", "lookup"], input: "text", engines: ["", engine], query });

// 现场：整理标签（site-x 标签 base 当旁观者）→ 新开网页 pageUrl（缺省 page-u 文章页）→ 建查询对。
// 先断言这一对判 own（构造本身对不对），返回 { base, P, L, splitViewId, query }
export async function queryScene(ctx, word, { pageUrl = articleUrl(ctx.port) } = {}) {
  const base = await resetTabs(ctx);
  const P = await openTabIn(ctx, base.windowId, pageUrl);
  const query = `${word} ${nonce()}`;
  const qp = await makeQueryPair(ctx, P, { query });
  const own = await ownershipOf(ctx, P.id);
  if (own !== "own") throw infra(`构造的查询对 ${P.id}｜${qp.L.id} 判 ${own}，不是 own`);
  return { base: { id: base.tabId, targetId: base.targetId }, P, ...qp };
}

// X（扩展读得到网址的标签）导航到触发网址 q，期望 go.html 走 foreign：在 pairIds 这一对右边新开 ea ｜ eb，
// X 经 history.back() 回到原网址，这一对仍在同一个分屏里。返回 { problems, now }
async function foreignOn(ctx, X, pairIds, q) {
  await navigate(ctx, X.targetId, trigger(ctx.port, q));
  const now = await waitState(ctx, st => findPair(st, ctx.port, q), `新分屏 ${expectPair(ctx.port, q).join(" ｜ ")}`, { timeoutMs: 20000 });
  const p = [];
  const st = await waitState(ctx, s => tabOf(s, X.id)?.url === X.url && tabOf(s, X.id).status === "complete" && s, `被触发的标签 ${X.id} 回到 ${X.url}`)
    .catch(async e => { p.push(e.message); return ctx.ext.state(); });
  if (now.some(t => pairIds.includes(t.id))) p.push(`新分屏不应使用原来的标签：${ids(now)}`);
  const old = pairIds.map(id => tabOf(st, id));
  const at = Math.max(...old.map(t => t?.index ?? -1)) + 1;
  if (now[0].index !== at) p.push(`新分屏应紧挨在原分屏右边（左侧 index ${at}），实际 ${now[0].index}`);
  if (old.some(t => !t) || old[0].splitViewId === -1 || old[0].splitViewId !== old[1].splitViewId) p.push(`原来的一对 ${pairIds.join("｜")} 不在同一个分屏里了`);
  return { problems: p, now };
}

// (d) 对调两侧后经 popup.html?tabId=<网页> 换右侧
const swapPopup = ctx => subInfra("(d) 查询对用 tabs.move 对调两侧后，popup.html?tabId=<网页> 点模拟引擎 C：换的是查询标签（现在在左边），网页网址与标记不变", async () => {
  const sc = await queryScene(ctx, "tdswap");
  const { P, L, splitViewId: v, query } = sc;
  const p0 = tabOf(await ctx.ext.state(), P.id);
  await ctx.ext.eval(`chrome.tabs.move(${L.id}, { index: ${p0.index} }).then(() => true)`);
  await waitState(ctx, st => tabOf(st, L.id)?.index < tabOf(st, P.id)?.index && [P.id, L.id].every(id => tabOf(st, id).splitViewId === v),
    `对调后查询标签 ${L.id} 在左、仍在分屏 ${v}`);
  const guard = [P, sc.base];
  const before = await guardTabs(ctx, guard);
  const ec = mock(ctx.port, "ec");
  const url = expandTemplate(ec.url, query);
  const page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${P.id}` });
  try {
    const s = await page.read();
    if (!s.ours) return { status: "fail", detail: `弹窗应显示本扩展的一对，实际显示说明“${s.notOursText}”` };
    if (!(await page.click("ec"))) return { status: "fail", detail: `弹窗里找不到模拟引擎 C 的按钮（可换的引擎 ${s.choices.join(",")}）` };
    const p = [];
    await waitState(ctx, st => tabOf(st, L.id)?.url === url && tabOf(st, L.id).status === "complete", `查询标签 ${L.id} 打开 ${url}`).catch(e => p.push(e.message));
    p.push(...await guardCheck(ctx, guard, before));
    p.push(...await queryRecords(ctx, P, L, { splitViewId: v, query, engine: "ec" }));
    const st = await ctx.ext.state();
    if (![P.id, L.id].every(id => tabOf(st, id)?.splitViewId === v)) p.push("换右侧后分屏被拆开了");
    await page.until(x => x.right === ec.name, `弹窗的查询一侧显示“${ec.name}”`).catch(e => p.push(e.message));
    return verdict(p, `对调后查询标签 ${L.id} 在左；弹窗点 C 后它换成 ${url}，网页 ${P.id} 网址与标记不变，记录仍是 page↔lookup（lookup 的 engine 为 ec）`);
  } finally { await page.close(); }
});

// (e) 查询标签导航到触发网址：记录 role 是 lookup，go.html 不改写对侧，走 foreign
const lookupTrigger = ctx => subInfra("(e) 查询标签导航到触发网址：go.html 走 foreign，网页不变，旁边新开一对", async () => {
  const sc = await queryScene(ctx, "telook");
  const { P, L } = sc;
  const guard = [P, sc.base];
  const before = await guardTabs(ctx, guard);
  const q = `te2+${nonce()}`;
  const r = await foreignOn(ctx, L, [P.id, L.id], q);
  const p = [...r.problems, ...await guardCheck(ctx, guard, before), ...await queryRecords(ctx, P, L, sc)];
  return verdict(p, `查询标签 ${L.id} 上触发 ${q}：在旁边新开 ${ids(r.now)}，查询标签回到原网址，网页 ${P.id} 网址与标记不变，原记录仍是 page↔lookup`);
});

// (f) 网页一侧导航到触发网址：记录 role 是 page，走 reuse，两侧都改成搜索对
const pageTrigger = ctx => subInfra("(f) 网页一侧导航到触发网址：go.html 走 reuse，就地换成 A ｜ B，两条记录都改成 search", async () => {
  const sc = await queryScene(ctx, "tfpage");
  const { P, L } = sc;
  const guard = [sc.base];
  const before = await guardTabs(ctx, guard);
  const n0 = (await ctx.ext.state()).tabs.length;
  const q = `tf2+${nonce()}`;
  await navigate(ctx, P.targetId, trigger(ctx.port, q));
  const pair = await waitState(ctx, st => findPair(st, ctx.port, q), `${P.id}｜${L.id} 就地换成 ${expectPair(ctx.port, q).join(" ｜ ")}`, { timeoutMs: 20000 });
  const p = [];
  if (pair[0].id !== P.id || pair[1].id !== L.id) p.push(`应就地复用 ${P.id}｜${L.id}，实际 ${ids(pair)}`);
  const n1 = (await ctx.ext.state()).tabs.length;
  if (n1 !== n0) p.push(`标签数从 ${n0} 变成 ${n1}`);
  p.push(...await guardCheck(ctx, guard, before));
  p.push(...checkPairRecords(await readRecords(ctx, [pair[0].id, pair[1].id]), pair[0], pair[1],
    { mode: "split", splitViewId: pair[0].splitViewId, engines: ["ea", "eb"], query: queryOf(q) }));
  return verdict(p, `网页 ${P.id} 上触发 ${q}：${ids(pair)} 就地换成 A ｜ B，标签数 ${n0} 不变，两条记录都是 search`);
});

// (h) 兜底不覆盖：网页一侧像搜索页、两侧都没有记录（判 fallback-own），查询一侧触发 → foreign
const fallbackForeign = (name, pageUrlOf) => ctx => subInfra(name, async () => {
  const sc = await queryScene(ctx, "thfall", { pageUrl: pageUrlOf(ctx.port) });
  const { P, L } = sc;
  await ctx.ext.eval("chrome.storage.session.clear().then(() => true)");
  const own = await ownershipOf(ctx, L.id);
  if (own !== "fallback-own") return { status: "fail", detail: `前提不成立：清空 storage.session 后查询一侧应判 fallback-own（网页 ${P.url} 像搜索页），实际 ${own}` };
  const guard = [P, sc.base];
  const before = await guardTabs(ctx, guard);
  const q = `th2+${nonce()}`;
  const r = await foreignOn(ctx, L, [P.id, L.id], q);
  const p = [...r.problems, ...await guardCheck(ctx, guard, before)];
  return verdict(p, `网页 ${P.url}，两侧没有记录（判 fallback-own）；查询标签 ${L.id} 上触发 ${q}：在旁边新开 ${ids(r.now)}，查询标签回到原网址，网页网址与标记不变`);
});

const T23 = {
  id: "T23", title: "不覆盖用户页面（go.html 与弹窗）：对调后换右侧、查询一侧或网页一侧触发、兜底不覆盖（自动判定）",
  kind: "auto", needs: [], timeoutMs: 180000,
  async run(ctx) {
    return summarize([
      await swapPopup(ctx), await lookupTrigger(ctx), await pageTrigger(ctx),
      await fallbackForeign("(h) 兜底：网页是模拟引擎 A 的结果页、清空 storage.session 后查询一侧触发 → foreign，原分屏两侧不动", port => `http://${HOSTS.a}:${port}/search?q=thpage${nonce()}`)(ctx),
      await fallbackForeign("(h) 兜底：网页是路径模板引擎 C 的 /wiki/x、清空 storage.session 后查询一侧触发 → foreign，原分屏两侧不动", port => `http://${HOSTS.c}:${port}/wiki/x`)(ctx),
    ]);
  },
};

export const V04_GUARD_STEPS = [T23];
