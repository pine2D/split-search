// B21 的 hash 与语言子项（从 b21.mjs 拆出，免得单文件超过 300 行；步骤说明见 b21.mjs 文件头）：
// (m) 停在 ③ 时切换界面语言：tab 不变、hash 不变，tab 名与 ① 的读屏标记换成新语言；
// (n) 地址栏手改 hash：#setup（卡片不显示）、#tab-foo 什么都不做，#tab-lookup 换到 ④，#guide-steps 换到 ① 并写 #tab-add、焦点给 5 步说明的小标题。
// 跨 tab 链接与焦点兜底：(f) 页内链接切 tab 并定位；(g) #pair-changed 按 setupView 的 mode 选文案、何时清掉；
// (h) 改引擎网址后提示里的“查看触发网址”；(k) 授权成功、授权按钮消失后的焦点。
// (g)(k) 撤销的左侧授权记进 env.revoked，并在子项结束前就地恢复（之后的 (l) 要求卡片不显示），恢复不了才留给 b21.mjs 收尾。
import { HOSTS, mockEngines } from "../config.mjs";
import { openOptions, showTab, sleep, openEdit, fillDialog, readKeys, restoreKey } from "./optpage.mjs";
import { setDone } from "./b19.mjs";
import { trustedClick } from "./b4.mjs";
import { requestGrant, contains, activate, AUTO_GRANT_MS } from "./guided.mjs";
import { sub, verdict } from "./v03-lib.mjs";
import { msg, msgIn } from "../i18n.mjs";

const J = JSON.stringify;

// 当前选中的 tab（key）、hash、焦点、滚动位置、历史长度、选中的面板是否看得见（b21.mjs 也用）
export const NOW = `(() => { const a = document.activeElement, s = document.querySelector('[role="tab"][aria-selected="true"]');
  return { tab: s ? s.id.replace(/^tabbtn-/, "") : null, hash: location.hash, focus: a?.id || a?.tagName || "",
    scrollY: Math.round(scrollY), hist: history.length, panel: !!s && !!document.getElementById("panel-" + s.id.replace(/^tabbtn-/, ""))?.checkVisibility() }; })()`;
export const fmtNow = n => `tab ${n.tab}，hash ${J(n.hash)}，焦点 ${n.focus}`;

// (m) steps 档（① 带“未完成”标记）打开、切到 ③，把 uiLocale 写成 en（uiLocale 由 B21 的 guarded 写回）
async function localeKeepsTab(ctx) {
  await setDone(ctx, null);
  const page = await openOptions(ctx.browser);
  try {
    await showTab(page, "engines");
    await ctx.ext.eval(`chrome.storage.sync.set({ uiLocale: "en" }).then(() => true)`);
    const want = { name: msgIn("en", "options_tab_engines"), todo: msgIn("en", "options_tab_todo") };
    const READ = `({ ...${NOW}, lang: document.documentElement.lang, name: document.getElementById("tabname-engines").textContent,
      todo: document.querySelector("#tab-flag-add.todo .sr-only")?.textContent ?? null })`;
    const s = await page.until(`const s = ${READ}; return s.lang === "en" && s.name === ${J(want.name)} && s.todo === ${J(want.todo)} && s;`, 5000)
      .catch(() => page.ev(READ));
    const p = [];
    if (s.lang !== "en" || s.name !== want.name || s.todo !== want.todo) {
      p.push(`切到 en 后 lang 应为 en、tab 名“${want.name}”、① 的标记“${want.todo}”：lang ${s.lang}，“${s.name}”，“${s.todo}”`);
    }
    if (s.tab !== "engines" || s.hash !== "#tab-engines") p.push(`切换语言后应仍是 ③、hash #tab-engines：${fmtNow(s)}`);
    return verdict(p, `lang en，“${s.name}”，① 标记“${s.todo}”，${fmtNow(s)}`);
  } finally { await page.close(); }
}

// (n) 卡片不显示、已授权，停在 ③；每次改 hash 后等 100 ms 读一次
const HASHES = [
  ["#setup", n => n.tab === "engines" && n.focus === "BODY", "仍是 ③、焦点 BODY"],
  ["#tab-foo", n => n.tab === "engines", "仍是 ③"],
  ["#tab-lookup", n => n.tab === "lookup" && n.hash === "#tab-lookup", "换到 ④、hash #tab-lookup"],
  ["#guide-steps", n => n.tab === "add" && n.hash === "#tab-add" && n.focus === "guide-steps-title", "换到 ①、hash #tab-add、焦点 #guide-steps-title"],
];
async function manualHash(ctx) {
  await setDone(ctx, true);
  const page = await openOptions(ctx.browser, { tab: "engines" });
  try {
    await page.ev(`document.activeElement?.blur(); true`);
    const p = [], seen = [];
    for (const [hash, ok, want] of HASHES) {
      await page.ev(`location.hash = ${J(hash)}; true`);
      await sleep(100);
      const n = await page.ev(NOW);
      seen.push(`${hash}→${n.tab}`);
      if (!ok(n)) p.push(`改成 ${hash} 后应${want}：${fmtNow(n)}`);
    }
    return verdict(p, seen.join("；"));
  } finally { await page.close(); }
}

export async function hashLocaleChecks(ctx) {
  return [
    await sub("(m) 停在 ③ 时切换语言：tab 与 hash 不变，tab 名与标记换成新语言", () => localeKeepsTab(ctx)),
    await sub("(n) 地址栏手改 hash", () => manualHash(ctx)),
  ];
}

// ---- (f)(g)(h)(k) ----

const NAME = Object.fromEntries(mockEngines(0).map(e => [e.id, e.name]));
const originA = ctx => `http://${HOSTS.a}:${ctx.port}/*`;
const triggerA = (ctx, right) => `http://${HOSTS.a}:${ctx.port}/search?q=%s&_ss=ea,${right}`;
const setPair = (ctx, pair) => ctx.ext.eval(`chrome.storage.sync.set({ defaultPair: ${J(pair)} }).then(() => true)`);
const click = (page, selector) => page.ev(`(() => { const el = document.querySelector(${J(selector)}); el?.click(); return !!el; })()`);

// 清掉 #notices 再改默认组合的右侧（像用户在下拉框里选了它）
const setRight = (page, id) => page.ev(`(() => { document.getElementById("notices").replaceChildren();
  const s = document.getElementById("pair-right"); s.value = ${J(id)}; s.dispatchEvent(new Event("change")); return s.value === ${J(id)}; })()`);
const CHANGED = `(() => { const c = document.getElementById("pair-changed");
  return { mode: document.getElementById("setup").dataset.mode, notices: [...document.querySelectorAll("#notices .notice-text")].map(e => e.textContent),
    box: c && { text: c.querySelector("p")?.textContent ?? "", url: c.querySelector(".url-box")?.textContent ?? null, role: c.getAttribute("role"),
      links: [...c.querySelectorAll("a")].map(a => a.getAttribute("href") + " " + a.textContent) } }; })()`;
// 等 #pair-changed 显示（shown）或消失；notice：还要等到有保存提示（setRight 先清掉了旧的）；mode：卡片的档位
const waitChanged = (page, { shown, notice = false, mode = null }) => page.until(`const s = ${CHANGED};
  return (${notice} ? s.notices.length > 0 : true) && !!s.box === ${shown} && (${J(mode)} === null || s.mode === ${J(mode)}) && s;`, 5000);

// 撤销 / 恢复默认左侧（模拟引擎 A）的授权。恢复先等页面自己的授权按钮生效，没有就 requestGrant（之前授权过，不弹框）
async function revokeA(ctx, env) {
  env.revoked.add(originA(ctx));
  await ctx.ext.eval(`chrome.permissions.remove({ origins: ${J([originA(ctx)])} })`);
}
async function restoreA(ctx, env) {
  const o = originA(ctx);
  if (!env.revoked.has(o)) return true;
  const ok = (await contains(ctx.browser, [o])) === true || await requestGrant(ctx, [o], { title: "B21 恢复模拟引擎 A 的授权" }).catch(() => false);
  if (ok) env.revoked.delete(o);
  return ok;
}

// (f) steps 档：“更换组合”、第 5 步“搜索引擎”、② 末行指引；hidden 档：#pair-changed 里的“查看设置步骤”
async function crossLinks(ctx) {
  const p = [], seen = [];
  // ok 是页内表达式，可用 n（NOW 的读数）和 document
  const expect = async (what, ok, want) => {
    const r = await page.until(`const n = ${NOW}; return (${ok}) && n;`, 3000).then(n => ({ n, ok: true }), async () => ({ n: await page.ev(NOW), ok: false }));
    seen.push(`${what}→${fmtNow(r.n)}`);
    if (!r.ok) p.push(`${what}后应${want}：${fmtNow(r.n)}`);
  };
  await setDone(ctx, null);
  let page = await openOptions(ctx.browser);
  try {
    if (!(await click(page, "#setup-change-pair"))) p.push("第 2 步没有“更换组合”（#setup-change-pair）");
    await expect("“更换组合”", `n.tab === "pair" && n.hash === "#tab-pair" && n.focus === "pair-left"`, "进 ②、hash #tab-pair、焦点 #pair-left");
    await showTab(page, "add");
    await page.ev(`document.getElementById("guide-steps-details").open = true; true`);
    if (!(await click(page, '#guide-step-grant a[href="#tab-engines"]'))) p.push("第 5 步没有指向“搜索引擎”的链接");
    await expect("第 5 步“搜索引擎”", `n.tab === "engines" && n.hash === "#tab-engines" && n.focus === "edit-ea"`, "进 ③、焦点 #edit-ea（左侧已授权，没有授权按钮）");
    await showTab(page, "pair");
    if (!(await click(page, '#pair-body a[href="#tab-add"][data-reveal="generator"]'))) p.push("② 没有末行指引的链接");
    await expect("② 末行指引", `n.tab === "add" && n.hash === "#tab-add" && document.getElementById("guide-other").open
      && document.activeElement === document.querySelector("#guide-other > summary")`, "进 ①、hash #tab-add、“其他组合”展开、焦点在它的 summary");
    await page.close();
    await setDone(ctx, true);
    page = await openOptions(ctx.browser, { tab: "pair" });
    await setRight(page, "ec");
    await waitChanged(page, { shown: true }).catch(() => { throw new Error("hidden 档改右侧后 5 秒内没有出现 #pair-changed"); });
    if (!(await click(page, '#pair-changed a[href="#guide-steps"]'))) p.push("#pair-changed 里没有“查看设置步骤”");
    await expect("“查看设置步骤”", `n.tab === "add" && n.hash === "#tab-add" && n.focus === "guide-steps-title"`, "进 ①、hash #tab-add、焦点 #guide-steps-title");
  } finally { await page.close(); }
  return verdict(p, seen.join("；"));
}

// 读 #pair-changed 与保存提示，按期望核对。want：{ mode, notice, box: null | "setup" | [右侧 id] }
function changedProblems(ctx, s, what, want) {
  const p = [], box = s.box;
  if (want.mode && s.mode !== want.mode) p.push(`${what}：卡片 mode 应为 ${want.mode}，实际 ${s.mode}`);
  if (want.notice && !s.notices.includes(msg(want.notice))) p.push(`${what}：保存提示应为 ${want.notice}，实际 ${J(s.notices)}`);
  if (want.box === null) return box ? [...p, `${what}：#pair-changed 应消失`] : p;
  if (!box) return [...p, `${what}：没有 #pair-changed`];
  if (box.role !== null) p.push(`${what}：#pair-changed 不该有 role（实际 ${box.role}）`);
  if (want.box === "setup") {
    if (box.text !== msg("options_pair_changed_setup") || box.url !== null) p.push(`${what}：应是“开始使用”那句、没有网址框：“${box.text}”，网址框 ${box.url}`);
    if (!box.links.includes(`#setup ${msg("options_pair_changed_continue")}`)) p.push(`${what}：应有“继续设置”链接：${J(box.links)}`);
  } else {
    const [l, r] = want.box;
    if (box.text !== msg("options_pair_changed", msg("guide_pair_label", NAME[l], NAME[r]))) p.push(`${what}：应是替换文案：“${box.text}”`);
    if (box.url !== triggerA(ctx, r)) p.push(`${what}：网址框应为 ${triggerA(ctx, r)}，实际 ${box.url}`);
    if (!box.links.includes(`#guide-steps ${msg("options_pair_changed_steps")}`)) p.push(`${what}：应有“查看设置步骤”链接：${J(box.links)}`);
  }
  return p;
}

// (g) steps 改右侧 → 写 setupDone（不刷新）→ 再改 → 撤销左侧（regrant）→ 改回 from；再开两页核对“没保存过的页”与另一页改回
async function changedByMode(ctx, env) {
  const p = [], seen = [];
  const step = async (page, what, act, want) => {
    await act();
    const s = await waitChanged(page, { shown: want.box !== null, notice: !!want.notice, mode: want.mode }).catch(() => page.ev(CHANGED));
    seen.push(`${what}：mode ${s.mode}，${s.box ? "有" : "没有"} #pair-changed`);
    p.push(...changedProblems(ctx, s, what, want));
  };
  await setDone(ctx, null);
  const page = await openOptions(ctx.browser, { tab: "pair" });
  try {
    await step(page, "steps 改右侧", () => setRight(page, "ec"), { mode: "steps", notice: "notice_pair_saved_setup", box: "setup" });
    if (!(await click(page, '#pair-changed a[href="#setup"]'))) p.push("没有“继续设置”可点");
    const n = await page.until(`const n = ${NOW}; return n.tab === "add" && n.focus === "setup-title" && n;`, 3000).catch(() => page.ev(NOW));
    if (n.tab !== "add" || n.hash !== "#tab-add" || n.focus !== "setup-title") p.push(`点“继续设置”后应进 ①、hash #tab-add、焦点 #setup-title：${fmtNow(n)}`);
    await showTab(page, "pair");
    await step(page, "写 setupDone", () => setDone(ctx, true), { mode: "done", box: null });
    await step(page, "完成后再改右侧", () => setRight(page, "eb"), { notice: "notice_pair_saved", box: ["ea", "eb"] });
    await step(page, "撤销左侧授权", () => revokeA(ctx, env), { mode: "regrant", box: ["ea", "eb"] });
    await step(page, "改回原组合", () => setRight(page, "ec"), { notice: "notice_pair_saved_back", box: null });
  } finally {
    await page.close();
    if (!(await restoreA(ctx, env))) p.push("恢复模拟引擎 A 的授权没有成功");
  }
  // 没保存过的页不显示；另一页改回原组合，这一页的提示框跟着消失
  const p1 = await openOptions(ctx.browser, { tab: "pair" });
  let p2 = null;
  try {
    await step(p1, "hidden 档 p1 改右侧", () => setRight(p1, "eb"), { mode: "hidden", notice: "notice_pair_saved", box: ["ea", "eb"] });
    p2 = await openOptions(ctx.browser, { tab: "pair" });
    if (await p2.ev(`!!document.getElementById("pair-changed")`)) p.push("新开的 p2 不该有 #pair-changed（只在改过的那一页内存里）");
    await setRight(p2, "ec");
    await step(p1, "p2 改回 p1 记下的原组合", () => p2.until(`return document.querySelector("#notices .notice-text")`, 5000).catch(() => null), { box: null });
  } finally { await p2?.close(); await p1.close(); }
  return verdict(p, seen.join("；"));
}

// (h) 在 ③ 改默认左侧的网址模板（仍合法、同 origin）：sticky 提示带“查看触发网址”，点它进 ①、焦点给默认组合那条的复制按钮
async function templateChanged(ctx) {
  await setDone(ctx, true);
  const { customEngines } = await readKeys(ctx.ext, ["customEngines"]);
  const page = await openOptions(ctx.browser, { tab: "engines" });
  try {
    await openEdit(page, "ea");
    await fillDialog(page, { url: `http://${HOSTS.a}:${ctx.port}/search?q=%s&e2e=1` });
    const text = msg("notice_template_changed", NAME.ea);
    const FIND = `[...document.querySelectorAll("#notices .notice")].find(n => n.querySelector(".notice-text")?.textContent === ${J(text)})`;
    const btn = await page.until(`return ${FIND}?.querySelector(".notice-action")?.textContent ?? false`, 5000).catch(() => null);
    if (!btn) return { status: "fail", detail: `保存后 5 秒内没有出现“${text}”` };
    await sleep(4000); // 普通提示 3.5 秒消失，sticky 的留着
    const p = [];
    if (!(await page.ev(`!!${FIND}`))) p.push("网址变化的提示 4 秒后不见了（应 sticky）");
    if (btn !== msg("notice_template_changed_go")) p.push(`提示里的按钮应为“${msg("notice_template_changed_go")}”，实际“${btn}”`);
    await page.ev(`${FIND}?.querySelector(".notice-action")?.click(); true`);
    const n = await page.until(`const n = ${NOW}; return n.tab === "add" && n;`, 3000).catch(() => page.ev(NOW));
    const onCopy = await page.ev(`document.activeElement === document.querySelector("#triggers .trigger-default .url-line button")`);
    if (n.tab !== "add" || n.hash !== "#tab-add" || !onCopy) p.push(`点“${btn}”后应进 ①、hash #tab-add、焦点在默认组合那条的复制按钮：${fmtNow(n)}`);
    return verdict(p, `sticky 提示带“${btn}”，点后 ${fmtNow(n)}（默认组合的复制按钮）`);
  } finally {
    await page.close();
    await restoreKey(ctx.ext, "customEngines", customEngines);
  }
}

// (k) regrant 时在 ① 点 #setup-grant、在 ② 点 #pair-grant（CDP 可信点击，带用户激活）：授权成功、按钮消失后焦点分别给 #tabbtn-add、#pair-left
async function grantFocus(ctx, env) {
  const p = [], seen = [];
  const grantAt = async (page, id, want) => {
    await revokeA(ctx, env);
    // 先清掉右下角的提示（授权、撤销的播报），免得盖住按钮；点之前核对落点就是这个按钮
    const at = await page.until(`const b = document.getElementById(${J(id)}); if (!b?.checkVisibility()) return false;
      document.getElementById("notices").replaceChildren(); b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, hit: document.elementFromPoint(x, y) === b };`, 5000).catch(() => null);
    if (!at) return p.push(`撤销左侧授权后没有看得见的 #${id}`);
    if (!at.hit) return p.push(`#${id} 的中心点被别的元素盖住了（${Math.round(at.x)},${Math.round(at.y)}）`);
    await activate(ctx, page.targetId);
    await trustedClick(ctx.browser, page.sid, at);
    const ok = await ctx.browser.waitFor(async () => (await contains(ctx.browser, [originA(ctx)])) === true, { timeoutMs: AUTO_GRANT_MS, intervalMs: 300 })
      .then(() => true, () => false);
    if (!ok) return p.push(`点 #${id} 后 ${AUTO_GRANT_MS / 1000} 秒内授权没有生效`);
    env.revoked.delete(originA(ctx));
    const focus = await page.until(`return !document.getElementById(${J(id)}) && document.activeElement?.id === ${J(want)} && ${J(want)}`, 3000)
      .catch(() => page.ev(`document.activeElement?.id || document.activeElement?.tagName`));
    seen.push(`#${id}→${focus}`);
    if (focus !== want) p.push(`点 #${id} 授权成功后焦点应在 #${want}，实际 ${focus}`);
  };
  await setDone(ctx, true);
  const page = await openOptions(ctx.browser, { newWindow: true }); // 万一弹授权框，它挂在窗口上：关掉这个窗口就随之关闭
  try {
    await showTab(page, "add");
    await grantAt(page, "setup-grant", "tabbtn-add");
    await showTab(page, "pair");
    await grantAt(page, "pair-grant", "pair-left");
  } finally {
    await page.close();
    if (!(await restoreA(ctx, env))) p.push("恢复模拟引擎 A 的授权没有成功");
  }
  return verdict(p, seen.join("；"));
}

// 每项从默认组合 模拟引擎 A ｜ B 开始，结束前写回步骤开始时的值（B21 的 guarded 只在整步结束时写回）
export async function linkChecks(ctx, env) {
  const { defaultPair } = await readKeys(ctx.ext, ["defaultPair"]);
  const run = async (name, fn) => {
    try { await setPair(ctx, ["ea", "eb"]); return await sub(name, fn); } finally { await restoreKey(ctx.ext, "defaultPair", defaultPair); }
  };
  return [
    await run("(f) 跨 tab 链接：更换组合、第 5 步、② 末行指引、查看设置步骤", () => crossLinks(ctx)),
    await run("(g) #pair-changed 按 mode 选文案，改回原组合或离开 steps 时清掉", () => changedByMode(ctx, env)),
    await run("(h) 改引擎网址：sticky 提示带“查看触发网址”", () => templateChanged(ctx)),
    await run("(k) 授权成功后的焦点兜底", () => grantFocus(ctx, env)),
  ];
}
