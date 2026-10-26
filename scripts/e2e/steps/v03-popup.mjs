// v0.3 自动步骤 T18（spec 3.8 V4，工具栏弹窗）；popupPage 也给 B2（options-b.mjs）用。
// 弹窗页经 Target.createTarget 打开 popup.html?tabId=<标签>（测试接缝，见 src/lib/popup-view.js）。
import { EXT_ID, mockEngines } from "../config.mjs";
import { expandTemplate } from "../../../src/lib/trigger.js";
import { siteX, nonce, resetTabs, waitState, summarize } from "./util.mjs";
import { sub, verdict, queryOf, readRecords, pairOn, tabUrl } from "./v03-lib.mjs";
import { msg } from "../i18n.mjs";

export const POPUP_URL = `chrome-extension://${EXT_ID}/popup/popup.html`;

// 页面里读出各块的 hidden 与文字（判定交给 popupStateOf，那里有 node 测试）
const POPUP_SNAPSHOT = `(() => {
  const $ = id => document.getElementById(id), main = document.querySelector("main");
  const box = id => ({ hidden: !$(id) || $(id).hidden, text: $(id)?.textContent ?? "" });
  const buttons = list => [...document.querySelectorAll("#" + list + " button")]
    .map(b => ({ engine: b.dataset.engine, disabled: b.disabled, suggested: b.classList.contains("suggested") }));
  if (!main) return null;
  return { loading: main.classList.contains("loading"), pair: box("pair"), notOurs: box("not-ours"), complete: box("complete"),
    query: $("query").textContent, left: $("left-engine").textContent, right: $("right-engine").textContent,
    choices: buttons("choices"), detected: $("complete-detected")?.textContent ?? "", completeChoices: buttons("complete-choices"),
    note: box("complete-note"), error: box("error"),
    idle: box("idle"), idlePair: $("idle-pair")?.hidden === false ? [...document.querySelectorAll("#idle-panes dd")].map(d => d.textContent) : [],
    idleTier: $("idle")?.hidden === false ? $("idle").dataset.tier ?? null : null,
    idleShown: ["idle-setup", "idle-try", "idle-setup-note"].filter(id => $(id) && !$(id).hidden),
    footer: !document.querySelector("footer")?.hidden,
    shortcut: { key: document.querySelector("#shortcut kbd")?.textContent ?? "", setButton: !!$("shortcut-open") } };
})()`;

// 纯函数：弹窗渲染完成（去掉 loading，显示了本扩展的一对、补成分屏区、说明文字或分屏外的引导）后的内容；还没渲染完返回 null。
// 分屏外的引导分三档（idleTier：setup | try | ready，见 src/lib/popup-view.js 的 idleView）；setup 档不显示说明文字
export function popupStateOf(snap) {
  if (!snap || snap.loading || (snap.pair.hidden && snap.notOurs.hidden && snap.complete.hidden && snap.idle?.hidden !== false)) return null;
  // 只看显示中的那一块：补成之后 #complete 隐藏了，里面的按钮仍是禁用的
  const shown = [...(snap.pair.hidden ? [] : snap.choices), ...(snap.complete.hidden ? [] : snap.completeChoices)];
  return { ours: !snap.pair.hidden, notOurs: !snap.notOurs.hidden, notOursText: snap.notOurs.text, complete: !snap.complete.hidden,
    query: snap.query, left: snap.left, right: snap.right,
    choices: snap.choices.map(b => b.engine),
    detected: snap.detected, completeChoices: snap.completeChoices.map(b => b.engine),
    suggested: snap.completeChoices.find(b => b.suggested)?.engine ?? null,
    busy: shown.some(b => b.disabled),
    note: snap.note.hidden ? "" : snap.note.text, error: snap.error.hidden ? "" : snap.error.text,
    // 分屏外：#idle 的一句“怎么试”与默认组合左右两个引擎名；底部快捷键（组合键，或“设置快捷键”按钮）
    idle: snap.idle ? !snap.idle.hidden : false, idleText: snap.idle && !snap.idle.hidden ? snap.idle.text : "",
    idlePair: snap.idlePair ?? [], shortcut: snap.shortcut ?? { key: "", setButton: false },
    idleTier: snap.idleTier ?? null, idleShown: snap.idleShown ?? [], footer: snap.footer !== false };
}

// 一个不在分屏里、也不是结果页的普通标签（模拟网站 X，已授权），给弹窗看分屏外的状态：popup.html?tabId=<它>
export async function plainTab(ctx, windowId) {
  const url = siteX(ctx.port, `/idle?n=${nonce()}`);
  const id = await ctx.ext.eval(`chrome.tabs.create({ ${windowId == null ? "" : `windowId: ${windowId}, `}url: ${JSON.stringify(url)}, active: false }).then(t => t.id)`);
  await waitState(ctx, st => st.tabs.some(t => t.id === id && t.status === "complete"), "普通标签加载完成");
  return id;
}

// 打开（或接管已有的）弹窗页，返回 { targetId, sid, ev(expr), read(), until(pred), click(id), close() }
export async function popupPage(ctx, { url, targetId } = {}) {
  const { client } = ctx.browser;
  if (!targetId) ({ targetId } = await client.send("Target.createTarget", { url, background: true }));
  const sid = await ctx.browser.attach(targetId);
  const ev = expr => ctx.browser.evaluate(sid, expr, { timeoutMs: 5000 });
  const state = async () => popupStateOf(await ev(POPUP_SNAPSHOT));
  const page = {
    targetId, sid, ev,
    read: () => ctx.browser.waitFor(state, { timeoutMs: 10000, intervalMs: 150 }),
    // 等到 pred(state) 为真（换右侧后弹窗会重绘）
    until: (pred, what) => ctx.browser.waitFor(async () => { const s = await state(); return s && !s.busy && pred(s) && s; }, { timeoutMs: 10000, intervalMs: 150 })
      .catch(e => { throw new Error(`弹窗没有等到：${what}（${e.message}）`); }),
    // list：换右侧的 #choices，或补成分屏的 #complete-choices
    click: (id, list = "choices") => ev(`(() => { const b = document.querySelector('#${list} button[data-engine="${id}"]'); if (!b) return false; b.click(); return true; })()`),
    close: async () => {
      await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
      await client.send("Target.closeTarget", { targetId }).catch(() => {});
    },
  };
  return page;
}

const engineName = (port, id) => mockEngines(port).find(e => e.id === id)?.name;

const NAME_A = "(a) 本扩展分屏：显示关键词与左右引擎（与记录一致）";
const NAME_B = "(b) 点一个引擎：右侧换成它的展开网址（特殊字符关键词逐字相同），右侧记录更新、左侧记录不变，弹窗随之更新";

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
  if (s.choices.includes("eb") || s.choices.includes("ea") || !s.choices.includes("ec")) {
    p.push(`可换的引擎应不含当前右侧 eb 和左侧 ea、含 ec，实际 ${s.choices.join(",")}`);
  }
  if (s.idle) p.push("本扩展的一对不该显示分屏外的说明");
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
  const recs = await readRecords(ctx, [L.id, R.id]);
  const rec = recs[R.id], left = recs[L.id];
  if (rec?.engine !== "ec") p.push(`右侧记录的 engine 应为 ec，实际 ${rec?.engine}`);
  if (rec?.query !== query) p.push(`右侧记录的 query 应保持 ${JSON.stringify(query)}，实际 ${JSON.stringify(rec?.query)}`);
  if (left?.engine !== "ea" || left?.query !== query) p.push(`左侧记录应保持 engine ea、query ${JSON.stringify(query)}，实际 ${JSON.stringify(left)}`);
  if (tabUrl(st, L.id) !== L.url) p.push(`左侧应保持 ${L.url}，实际 ${tabUrl(st, L.id)}`);
  if (st.tabs.find(t => t.id === R.id)?.splitViewId !== L.splitViewId) p.push("换右侧后分屏被拆开了");
  const s2 = await page.until(x => x.right === ec.name, `右侧显示“${ec.name}”`).catch(e => { p.push(e.message); return null; });
  if (s2 && (s2.choices.includes("ec") || s2.choices.includes("ea") || !s2.choices.includes("eb"))) {
    p.push(`换完后可换的引擎应不含 ec 和左侧 ea、含 eb，实际 ${s2.choices.join(",")}`);
  }
  if (s2?.error) p.push(`弹窗显示错误：${s2.error}`);
  return { problems: p, detail: `关键词 ${JSON.stringify(query)}：点 ${ec.name} 后右侧 ${R.id} 打开 ${url}（与 expandTemplate 逐字相同），右侧记录 engine 为 ec，左侧记录仍是 ea、关键词不变，弹窗右侧显示 ${ec.name}` };
}

// (a)(b) 共用一个本扩展分屏和一个弹窗页；(a) 不过时 (b) 记跳过
// 特殊字符关键词（& # + 空格 中文）：换右侧后的网址必须与 go.html 首次打开时的 expandTemplate 结果逐字相同
export const T18_QUERY = "a&b #c+d 中文";
// 触发网址里 q 的写法：Chrome 网站搜索在 query 里把空格编成 +，其余照 encodeURIComponent
export const encodeQ = query => encodeURIComponent(query).replace(/%20/g, "+");

async function ownPair(ctx) {
  const query = T18_QUERY;
  const q = encodeQ(query);
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

const foreignPair = ctx => sub("(c) 不是本扩展的分屏：显示说明文字、怎么试和当前默认组合；底部快捷键状态与 chrome.commands 一致", async () => {
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
    if (!s.idle || !s.idleShown.includes("idle-try")) p.push(`说明下面应有“${msg("popup_idle_hint")}”`);
    if (!["try", "ready"].includes(s.idleTier)) p.push(`模拟引擎 A 已授权，分屏外应是 try 或 ready 档，实际 ${s.idleTier}`);
    if (s.idleShown.includes("idle-setup")) p.push("左侧已授权，不该显示“完成设置”");
    const pair = await ctx.ext.eval(`chrome.storage.sync.get("defaultPair").then(r => r.defaultPair ?? null)`);
    const names = (pair ?? []).map(id => engineName(ctx.port, id));
    if (!names.length || names.some(n => !n)) p.push(`默认组合应是模拟引擎（基线），实际 ${JSON.stringify(pair)}`);
    else if (s.idlePair.join("|") !== names.join("|")) p.push(`默认组合应显示 ${names.join(" ｜ ")}，实际 ${s.idlePair.join(" ｜ ") || "(没有)"}`);
    const key = await ctx.ext.eval(`chrome.commands.getAll().then(cs => cs.find(c => c.name === "cycle-right")?.shortcut || "")`);
    if (key ? s.shortcut.key !== key : !s.shortcut.setButton) {
      p.push(`底部快捷键应${key ? `显示 ${key}` : "显示“设置快捷键”按钮"}，实际 ${JSON.stringify(s.shortcut)}`);
    }
    return verdict(p, `用户分屏 ${made.a}｜${made.b}：弹窗显示“${s.notOursText}”（${s.idleTier} 档）与默认组合 ${s.idlePair.join(" ｜ ")}；底部快捷键 ${key || "未绑定（显示“设置快捷键”）"}`);
  } finally { await page.close(); }
});

const T18 = {
  id: "T18", title: "工具栏弹窗：显示本扩展分屏的关键词与左右引擎、点引擎换右侧（候选不含左右两侧）；不是本扩展的分屏显示说明与默认组合（自动判定）", kind: "auto", needs: [],
  async run(ctx) {
    return summarize([...(await ownPair(ctx)), await foreignPair(ctx)]);
  },
};

export const V03_POPUP_STEPS = [T18];
