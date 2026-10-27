// B21 设置页 tab 与宽度（auto，设计稿 2026-10-27-options-tabs-design.md 5.4）。本文件是步骤入口与以下子项：
// (a) tab 栏与面板的 ARIA；(b) CDP 真实按键 →、End、Home、← 换 tab（焦点与选中一起移动），带修饰键的 → 与 ↓ 不处理；
// (c) 点 tab 写 #tab-<key>（replaceState，history.length 不变），刷新后仍在同一个 tab；
// (d) 默认 tab：卡片显示进 ①，#tab-* 优先，卡片不显示进 ②，认不出的 hash（含元素 id）不滚动；
// (e) 默认 tab 只判一次：停在 ① 时完成设置，卡片换成完成确认，仍在 ①；
// (i) “调整顺序”模式中切走：1 秒内写出 order，焦点留在新 tab 按钮上，切回时已退出模式；
// (j) 已开的设置页停在 ③ 时从弹窗点“打开设置”：不新开、不重载，仍是 ③。
// (m) 语言切换、(n) 地址栏手改 hash 见 b21-links.mjs；(l) 宽度见 b21-width.mjs；(f)(g)(h)(k) 跨 tab 链接与焦点兜底由后续任务补上。
// guarded 写回 defaultPair、uiLocale、customEngines、presetOverrides、order；keepSetupDone 写回 setupDone / setupTryTabs；
// 子项撤销过的授权记进 env.revoked，收尾用 requestGrant 恢复（之前授权过，Chrome 直接批准，不弹框）。
import { GRANT_TIMEOUT_MS, requestGrant, contains, activate } from "./guided.mjs";
import { OPTIONS_URL, openOptions, guarded, setReorder, showTab, sleep } from "./optpage.mjs";
import { keepSetupDone, setDone } from "./b19.mjs";
import { closeTarget } from "./b19-popup.mjs";
import { openOptionsFromPopup } from "./options-b.mjs";
import { POPUP_URL, popupPage, plainTab } from "./v03-popup.mjs";
import { sub, verdict } from "./v03-lib.mjs";
import { pageTargets, resetTabs, summarize } from "./util.mjs";
import { NOW, fmtNow, hashLocaleChecks } from "./b21-links.mjs";
import { widthCheck } from "./b21-width.mjs";
import { msg } from "../i18n.mjs";

const J = JSON.stringify;
const KEYS = ["add", "pair", "engines", "lookup"];

// 页内读 tab 栏与面板（交给 tabStateProblems）
const TAB_STATE = `(() => ({
  tabs: [...document.querySelectorAll('.tab[role="tab"]')].map(b => ({ id: b.id, selected: b.getAttribute("aria-selected"),
    tabindex: b.getAttribute("tabindex"), controls: b.getAttribute("aria-controls") })),
  panels: [...document.querySelectorAll('[role="tabpanel"]')].map(p => ({ id: p.id, labelledby: p.getAttribute("aria-labelledby"),
    hidden: p.hidden, visible: p.checkVisibility() })) }))()`;

// 纯判定：恰好 4 个 tab、4 个面板；只有 key 那个 aria-selected=true 且 tabindex=0；aria-controls 与面板一一对应；
// 面板名指向只包 tab 名的 #tabname-<key>（不指向按钮，设计稿 3.2）；只有选中的面板不 hidden、checkVisibility() 为 true
export function tabStateProblems(s, key) {
  const tabs = s?.tabs ?? [], panels = s?.panels ?? [], p = [];
  if (tabs.length !== KEYS.length) p.push(`应有 ${KEYS.length} 个 tab，实际 ${tabs.length}`);
  if (panels.length !== KEYS.length) p.push(`应有 ${KEYS.length} 个面板，实际 ${panels.length}`);
  const selected = tabs.filter(t => t.selected === "true");
  if (selected.length !== 1) p.push(`应恰好 1 个 tab aria-selected=true，实际 ${selected.length} 个`);
  for (const t of tabs) {
    const k = t.id.replace(/^tabbtn-/, ""), on = k === key;
    if (t.selected !== String(on)) p.push(`#${t.id} 的 aria-selected 应为 ${on}，实际 ${t.selected}`);
    if (t.tabindex !== (on ? "0" : "-1")) p.push(`#${t.id} 的 tabindex 应为 ${on ? 0 : -1}，实际 ${t.tabindex}`);
    if (t.controls !== `panel-${k}` || !panels.some(x => x.id === t.controls)) p.push(`#${t.id} 的 aria-controls 应指向存在的 #panel-${k}，实际 ${t.controls}`);
  }
  for (const x of panels) {
    const k = x.id.replace(/^panel-/, ""), on = k === key;
    if (x.labelledby !== `tabname-${k}`) p.push(`#${x.id} 的 aria-labelledby 应为 tabname-${k}，实际 ${x.labelledby}`);
    if (x.hidden === on) p.push(`#${x.id} 的 hidden 应为 ${!on}`);
    if (x.visible !== on) p.push(`#${x.id} 的 checkVisibility() 应为 ${on}`);
  }
  return p;
}

// 打开设置页（opts 交给 openOptions），读 NOW 后关掉
async function openRead(ctx, opts) {
  const page = await openOptions(ctx.browser, opts);
  try { return await page.ev(NOW); } finally { await page.close(); }
}

// CDP 可信按键（keyDown + keyUp）
const KEY_CODES = { ArrowRight: 39, ArrowLeft: 37, Home: 36, End: 35 };
async function press(ctx, page, key) {
  for (const type of ["keyDown", "keyUp"]) {
    await ctx.browser.client.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: KEY_CODES[key], nativeVirtualKeyCode: KEY_CODES[key] }, page.sid);
  }
}

// (a)(b)(c)：设置完成、已授权（卡片不显示），无 hash 打开，默认在 ②
async function ariaKeysHash(ctx) {
  await setDone(ctx, true);
  const page = await openOptions(ctx.browser);
  const items = [];
  try {
    items.push(await sub("(a) tab 栏与面板的 ARIA", async () => {
      const p = tabStateProblems(await page.ev(TAB_STATE), "pair");
      return verdict(p, "4 个 tab、4 个面板，只有 ② 选中且 tabindex=0，aria-controls/aria-labelledby 对应，隐藏面板 checkVisibility() 为 false");
    }));
    items.push(await sub("(b) 方向键、Home/End 换 tab，带修饰键的 → 与 ↓ 不处理", async () => {
      await activate(ctx, page.targetId);
      await page.ev(`document.getElementById("tabbtn-pair").focus(); true`);
      const p = [], seen = [];
      for (const [key, want] of [["ArrowRight", "engines"], ["End", "lookup"], ["Home", "add"], ["ArrowLeft", "lookup"]]) {
        await press(ctx, page, key);
        const n = await page.until(`const n = ${NOW}; return n.tab === ${J(want)} && n.focus === "tabbtn-" + ${J(want)} && n.panel && n;`, 2000)
          .catch(async () => page.ev(NOW));
        seen.push(`${key}→${n.tab}`);
        if (n.tab !== want || n.focus !== `tabbtn-${want}` || !n.panel) p.push(`按 ${key} 后应选中并聚焦 ${want}、面板可见：${fmtNow(n)}，面板${n.panel ? "可见" : "不可见"}`);
      }
      p.push(...tabStateProblems(await page.ev(TAB_STATE), "lookup"));
      const ignored = await page.ev(`(() => { const b = document.querySelector('[role="tab"][aria-selected="true"]');
        return [{ key: "ArrowRight", altKey: true }, { key: "ArrowRight", ctrlKey: true }, { key: "ArrowDown" }].map(o => {
          const e = new KeyboardEvent("keydown", { ...o, bubbles: true, cancelable: true }); b.dispatchEvent(e);
          return { o: JSON.stringify(o), prevented: e.defaultPrevented, sel: document.querySelector('[role="tab"][aria-selected="true"]').id }; }); })()`);
      for (const r of ignored) {
        if (r.prevented || r.sel !== "tabbtn-lookup") p.push(`${r.o} 不该被处理：defaultPrevented ${r.prevented}，选中 ${r.sel}`);
      }
      return verdict(p, `${seen.join("、")}，焦点跟着走；Alt+→、Ctrl+→、↓ 不换 tab、不 preventDefault`);
    }));
    items.push(await sub("(c) 点 tab 写 #tab-<key>、不增加历史，刷新后仍是它", async () => {
      const before = await page.ev(NOW);
      await page.ev(`document.getElementById("tabbtn-engines").click(); true`);
      const n = await page.ev(NOW);
      const p = [];
      if (n.tab !== "engines" || n.hash !== "#tab-engines") p.push(`点 #tabbtn-engines 后应选中 ③、hash #tab-engines：${fmtNow(n)}`);
      if (n.hist !== before.hist) p.push(`history.length 从 ${before.hist} 变成 ${n.hist}（应 replaceState）`);
      await page.reload();
      const r = await page.ev(NOW);
      if (r.tab !== "engines" || !r.panel) p.push(`刷新后应仍是 ③：${fmtNow(r)}`);
      return verdict(p, `hash ${n.hash}，history.length ${n.hist} 不变；刷新后 ${fmtNow(r)}`);
    }));
  } finally { await page.close(); }
  return items;
}

// (d) 默认 tab：[说明, setupDone, openOptions 参数, 期望 tab, 额外判定]
const DEFAULTS = [
  ["卡片显示、无 hash", null, {}, "add"],
  ["卡片显示、#tab-lookup", null, { tab: "lookup" }, "lookup"],
  ["卡片不显示、无 hash", true, {}, "pair"],
  ["卡片不显示、#setup", true, { hash: "#setup" }, "pair", n => n.focus === "BODY" || `焦点应仍是 BODY，实际 ${n.focus}`],
  ["卡片不显示、#foo", true, { hash: "#foo" }, "pair"],
  ["卡片不显示、#tab-foo", true, { hash: "#tab-foo" }, "pair"],
  ["卡片不显示、#engines", true, { hash: "#engines" }, "pair", n => n.scrollY === 0 || `不该按元素 id 滚动，scrollY ${n.scrollY}`],
  ["卡片不显示、#guide", true, { hash: "#guide" }, "pair", n => n.scrollY === 0 || `不该按元素 id 滚动，scrollY ${n.scrollY}`],
];
async function defaults(ctx) {
  const p = [], seen = [];
  for (const [what, done, opts, want, extra] of DEFAULTS) {
    await setDone(ctx, done);
    const n = await openRead(ctx, opts);
    seen.push(`${what}→${n.tab}`);
    if (n.tab !== want || !n.panel) p.push(`${what}应进 ${want}：${fmtNow(n)}`);
    const e = extra?.(n);
    if (typeof e === "string") p.push(`${what}：${e}`);
  }
  return verdict(p, seen.join("；"));
}

// (e) 停在 ① 时完成设置：卡片换成完成确认，tab 不跳
async function staysOnAdd(ctx) {
  await setDone(ctx, null);
  const page = await openOptions(ctx.browser);
  try {
    const n0 = await page.ev(NOW);
    if (n0.tab !== "add") return { status: "fail", detail: `卡片显示时应先进 ①：${fmtNow(n0)}` };
    await setDone(ctx, true);
    await page.until(`return document.getElementById("setup").dataset.mode === "done"`, 8000)
      .catch(() => { throw new Error("写 setupDone: true 后 8 秒内卡片没有换成完成确认"); });
    await sleep(300);
    const n = await page.ev(NOW);
    return verdict(n.tab === "add" && n.panel ? [] : [`完成后应仍在 ①：${fmtNow(n)}`], `卡片换成完成确认，仍在 ①（${fmtNow(n)}）`);
  } finally { await page.close(); }
}

// (i) “调整顺序”模式中切到 ②：1 秒内写出 order，焦点留在 #tabbtn-pair，切回 ③ 时已退出模式
async function reorderLeave(ctx) {
  const page = await openOptions(ctx.browser, { tab: "engines" });
  try {
    await setReorder(page, true);
    await page.run(`globalThis.__e2eOrderAt = null;
      chrome.storage.onChanged.addListener((c, a) => { if (a === "sync" && c.order && !globalThis.__e2eOrderAt) globalThis.__e2eOrderAt = Date.now(); });
      moveBtn(ids()[0], "down").click(); return true;`);
    const t0 = await page.ev(`Date.now()`);
    await showTab(page, "pair");
    const at = await page.until(`return globalThis.__e2eOrderAt`, 1500).catch(() => null);
    const n = await page.ev(NOW);
    const p = [];
    if (!at || at - t0 > 1000) p.push(at ? `切走后 ${at - t0} ms 才写出 order（应 ≤ 1000）` : "切走后 1.5 秒内没有写 order");
    if (n.focus !== "tabbtn-pair") p.push(`焦点应留在 #tabbtn-pair，实际 ${n.focus}`);
    await showTab(page, "engines");
    const still = await page.run(`return reordering() || document.getElementById("engines-reorder").textContent !== ${J(msg("engine_reorder"))}`);
    if (still) p.push("切回 ③ 时仍在“调整顺序”模式");
    return verdict(p, `切走后 ${at - t0} ms 写出 order，焦点在 #tabbtn-pair；切回 ③ 是平时的列表`);
  } finally { await page.close(); }
}

// (j) 已开的设置页停在 ③：从弹窗点“打开设置”，没有新标签、页面没重载、仍是 ③
async function openFromPopup(ctx, idleTab) {
  await setDone(ctx, true); // ready 档
  const page = await openOptions(ctx.browser, { tab: "engines" });
  let pop = null;
  const made = [];
  try {
    await page.ev(`globalThis.__e2eB21j = 1`);
    for (const t of await pageTargets(ctx.browser)) {
      if (t.url.startsWith(OPTIONS_URL) && t.targetId !== page.targetId) await closeTarget(ctx, t.targetId);
    }
    await ctx.browser.waitFor(async () => (await pageTargets(ctx.browser)).filter(t => t.url.startsWith(OPTIONS_URL)).length === 1,
      { timeoutMs: 5000, intervalMs: 150 }).catch(() => { throw new Error("5 秒内没能关掉其余设置页"); });
    pop = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${idleTab}` });
    await pop.read();
    const { problems: p, how } = await openOptionsFromPopup(ctx, pop, made);
    await sleep(500);
    const opts = (await pageTargets(ctx.browser)).filter(t => t.url.startsWith(OPTIONS_URL));
    if (how && how !== "activated") p.push(`应把已开的设置页切到前台，实际 ${how}`);
    if (opts.length !== 1) p.push(`应只有原来那一个设置页，实际 ${opts.length} 个`);
    const n = await page.ev(`({ ...${NOW}, mark: globalThis.__e2eB21j === 1 })`);
    if (!n.mark) p.push("原页的页面标记没了（被重载或导航了）");
    if (n.tab !== "engines" || n.hash !== "#tab-engines") p.push(`应仍是 ③、hash #tab-engines：${fmtNow(n)}`);
    return verdict(p, `“打开设置”把原页切到前台（${how}），页面标记还在，${fmtNow(n)}`);
  } finally {
    await pop?.close();
    if (made.length) await ctx.ext.eval(`chrome.tabs.remove(${J(made)}).then(() => true, () => false)`).catch(() => {});
    await page.close();
  }
}

// 子项撤销过的授权：收尾恢复。返回问题列表
async function restoreGrants(ctx, revoked) {
  if (!revoked.size) return [];
  const origins = [...revoked];
  const ok = await requestGrant(ctx, origins, { title: "B21 恢复授权" }).catch(() => false);
  return ok && (await contains(ctx.browser, origins)) === true ? [] : [`恢复 ${origins.join("、")} 的授权没有成功（由步骤后检查兜底）`];
}

export const B21 = {
  id: "B21", title: "设置页 tab 与宽度", kind: "auto", needs: [], restores: true, timeoutFactor: 2, timeoutExtraMs: GRANT_TIMEOUT_MS,
  run: ctx => keepSetupDone(ctx, () => guarded(ctx, ["defaultPair", "uiLocale", "customEngines", "presetOverrides", "order"], async () => {
    const env = { revoked: new Set() };
    const base = await resetTabs(ctx);
    const idleTab = await plainTab(ctx, base.windowId);
    const items = [];
    try {
      items.push(...await ariaKeysHash(ctx));
      items.push(await sub("(d) 默认 tab 按卡片与 hash，认不出的 hash 不滚动", () => defaults(ctx)));
      items.push(await sub("(e) 停在 ① 时完成设置，tab 不跳", () => staysOnAdd(ctx)));
      items.push(await sub("(i) “调整顺序”模式中切走：立即写出、焦点不抢、切回已退出", () => reorderLeave(ctx)));
      items.push(await sub("(j) 已开的设置页停在 ③ 时从弹窗“打开设置”", () => openFromPopup(ctx, idleTab)));
      items.push(...await hashLocaleChecks(ctx, env));
      items.push(await sub("(l) 宽度：四语同一条右边界、600 宽不溢出、引擎行不折", () => widthCheck(ctx)));
    } finally {
      const p = await restoreGrants(ctx, env.revoked);
      if (p.length) items.push({ name: "收尾：恢复授权", status: "fail", detail: p.join("；") });
      await ctx.ext.eval(`chrome.tabs.remove(${idleTab}).then(() => true, () => false)`).catch(() => {});
    }
    return summarize(items);
  })),
};
