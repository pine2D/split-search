// v0.3 自动步骤 T18（spec 3.8 V4，工具栏弹窗）；popupPage 也给 B2（options-b.mjs）用。
// 弹窗页经 Target.createTarget 打开 popup.html?tabId=<标签>（测试接缝，见 src/lib/popup-view.js）。
import { EXT_ID, mockEngines } from "../config.mjs";
import { expandTemplate } from "../../../src/lib/trigger.js";
import { siteX, nonce, resetTabs, waitState, summarize } from "./util.mjs";
import { sub, verdict, queryOf, readRecords, pairOn, tabUrl } from "./v03-lib.mjs";
import { msg } from "../i18n.mjs";

export const POPUP_URL = `chrome-extension://${EXT_ID}/popup/popup.html`;

// 弹窗渲染完成（去掉 loading，显示了本扩展的一对或说明文字）后读出的内容
const POPUP_STATE = `(() => {
  const $ = id => document.getElementById(id), main = document.querySelector("main");
  if (!main || main.classList.contains("loading") || ($("pair").hidden && $("not-ours").hidden)) return null;
  return { ours: !$("pair").hidden, notOurs: !$("not-ours").hidden, notOursText: $("not-ours").textContent,
    query: $("query").textContent, left: $("left-engine").textContent, right: $("right-engine").textContent,
    choices: [...document.querySelectorAll("#choices button")].map(b => b.dataset.engine),
    busy: [...document.querySelectorAll("#choices button")].some(b => b.disabled),
    error: $("error").hidden ? "" : $("error").textContent };
})()`;

// 打开（或接管已有的）弹窗页，返回 { targetId, sid, read(), click(id), close() }
export async function popupPage(ctx, { url, targetId } = {}) {
  const { client } = ctx.browser;
  if (!targetId) ({ targetId } = await client.send("Target.createTarget", { url, background: true }));
  const sid = await ctx.browser.attach(targetId);
  const ev = expr => ctx.browser.evaluate(sid, expr, { timeoutMs: 5000 });
  const page = {
    targetId,
    read: () => ctx.browser.waitFor(() => ev(POPUP_STATE), { timeoutMs: 10000, intervalMs: 150 }),
    // 等到 pred(state) 为真（换右侧后弹窗会重绘）
    until: (pred, what) => ctx.browser.waitFor(async () => { const s = await ev(POPUP_STATE); return s && !s.busy && pred(s) && s; }, { timeoutMs: 10000, intervalMs: 150 })
      .catch(e => { throw new Error(`弹窗没有等到：${what}（${e.message}）`); }),
    click: id => ev(`(() => { const b = document.querySelector('#choices button[data-engine="${id}"]'); if (!b) return false; b.click(); return true; })()`),
    close: async () => {
      await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
      await client.send("Target.closeTarget", { targetId }).catch(() => {});
    },
  };
  return page;
}

const engineName = (port, id) => mockEngines(port).find(e => e.id === id)?.name;

const NAME_A = "(a) 本扩展分屏：显示关键词与左右引擎（与记录一致）";
const NAME_B = "(b) 点一个引擎：右侧换成它的展开网址，记录与弹窗随之更新";

// (a) 显示：返回问题列表
async function checkShown(ctx, page, L, R, query) {
  const { port } = ctx;
  const s = await page.read();
  if (!s.ours) return [`弹窗应显示本扩展的一对，实际显示说明文字“${s.notOursText}”`];
  const recs = await readRecords(ctx, [L.id, R.id]);
  const p = [];
  const want = { query, left: engineName(port, recs[L.id]?.engine), right: engineName(port, recs[R.id]?.engine) };
  for (const [k, v] of Object.entries(want)) if (s[k] !== v) p.push(`弹窗的 ${k} 应为“${v}”（与记录一致），实际“${s[k]}”`);
  if (recs[L.id]?.engine !== "ea" || recs[R.id]?.engine !== "eb") p.push(`记录的引擎应为 ea / eb，实际 ${recs[L.id]?.engine} / ${recs[R.id]?.engine}`);
  if (s.choices.includes("eb") || !s.choices.includes("ec")) p.push(`可换的引擎应不含当前右侧 eb、含 ec，实际 ${s.choices.join(",")}`);
  return p;
}

// (b) 换成 ec：右侧网址变成 ec 模板的展开结果，右侧记录的 engine 更新，左侧不动，弹窗重绘
async function checkSwitch(ctx, page, L, R, query) {
  const ec = mockEngines(ctx.port).find(e => e.id === "ec");
  const url = expandTemplate(ec.url, query);
  if (!(await page.click("ec"))) return { problems: ["弹窗里找不到 ec 按钮"] };
  const p = [];
  const st = await waitState(ctx, x => x.tabs.some(t => t.id === R.id && t.url === url && t.status === "complete") && x, `右侧 ${R.id} 打开 ${url}`)
    .catch(async e => { p.push(e.message); return ctx.ext.state(); });
  const rec = (await readRecords(ctx, [R.id]))[R.id];
  if (rec?.engine !== "ec") p.push(`右侧记录的 engine 应为 ec，实际 ${rec?.engine}`);
  if (tabUrl(st, L.id) !== L.url) p.push(`左侧应保持 ${L.url}，实际 ${tabUrl(st, L.id)}`);
  if (st.tabs.find(t => t.id === R.id)?.splitViewId !== L.splitViewId) p.push("换右侧后分屏被拆开了");
  const s2 = await page.until(x => x.right === ec.name, `右侧显示“${ec.name}”`).catch(e => { p.push(e.message); return null; });
  if (s2 && (s2.choices.includes("ec") || !s2.choices.includes("eb"))) p.push(`换完后可换的引擎应不含 ec、含 eb，实际 ${s2.choices.join(",")}`);
  if (s2?.error) p.push(`弹窗显示错误：${s2.error}`);
  return { problems: p, detail: `点 ${ec.name} 后右侧 ${R.id} 打开 ${url}，记录 engine 为 ec，弹窗右侧显示 ${ec.name}` };
}

// (a)(b) 共用一个本扩展分屏和一个弹窗页；(a) 不过时 (b) 记跳过
async function ownPair(ctx) {
  const q = "t18+pop";
  const query = queryOf(q);
  let page = null;
  try {
    const { pair: [L, R] } = await pairOn(ctx, q);
    page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${L.id}` });
    const pa = await checkShown(ctx, page, L, R, query);
    const a = { name: NAME_A, ...verdict(pa, `弹窗显示“${query}”、${engineName(ctx.port, "ea")} ｜ ${engineName(ctx.port, "eb")}`) };
    if (pa.length) return [a, { name: NAME_B, status: "skip", detail: "(a) 没通过，弹窗的显示不对，不再点引擎" }];
    const r = await checkSwitch(ctx, page, L, R, query);
    return [a, { name: NAME_B, ...verdict(r.problems, r.detail) }];
  } catch (e) {
    return [{ name: "(a)(b) 本扩展分屏的弹窗", status: "fail", detail: `异常：${e.message}` }];
  } finally { await page?.close(); }
}

const foreignPair = ctx => sub("(c) 不是本扩展的分屏：显示说明文字", async () => {
  const base = await resetTabs(ctx);
  const n = nonce();
  const made = await ctx.ext.eval(`(async () => {
    const a = await chrome.tabs.create({ windowId: ${base.windowId}, url: ${JSON.stringify(siteX(ctx.port, `/popup-1?n=${n}`))}, active: true });
    const b = await chrome.tabs.create({ windowId: ${base.windowId}, url: ${JSON.stringify(siteX(ctx.port, `/popup-2?n=${n}`))}, active: false });
    return { a: a.id, b: b.id, splitViewId: await chrome.tabs.createSplit([a.id, b.id]) };
  })()`);
  await waitState(ctx, st => ["a", "b"].every(k => st.tabs.some(t => t.id === made[k] && t.status === "complete" && t.splitViewId === made.splitViewId)),
    "用户分屏两侧加载完成");
  const page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${made.a}` });
  try {
    const s = await page.read();
    const want = msg("popup_not_ours");
    const p = [];
    if (s.ours || !s.notOurs) p.push("弹窗应只显示说明文字，实际显示了一对");
    if (s.notOursText !== want) p.push(`说明文字应为“${want}”，实际“${s.notOursText}”`);
    return verdict(p, `用户分屏 ${made.a}｜${made.b}：弹窗显示“${s.notOursText}”`);
  } finally { await page.close(); }
});

const T18 = {
  id: "T18", title: "工具栏弹窗：显示本扩展分屏的关键词与左右引擎、点引擎换右侧；不是本扩展的分屏显示说明（自动判定）", kind: "auto", needs: [],
  async run(ctx) {
    return summarize([...(await ownPair(ctx)), await foreignPair(ctx)]);
  },
};

export const V03_POPUP_STEPS = [T18];
