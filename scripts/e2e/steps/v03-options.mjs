// v0.3 设置页自动步骤：B16 右侧引擎库（spec 3.8 V2）、B17 快捷键的 auto 子项（spec 3.8 V5）。
// 存储改动由 guarded 写回步骤前的值；快捷键改动按 ext-shortcuts.mjs 的快照改回（收尾与下次启动兜底）。
import { CATALOG, CATEGORIES, catalogUrl } from "../../../src/lib/engine-catalog.js";
import { E2E_LOCALE, msg } from "../i18n.mjs";
import { openOptions, guarded, keySel } from "./optpage.mjs";
import { summarize } from "./util.mjs";
import { sub, verdict } from "./v03-lib.mjs";
import { COMMAND, TEST_KEYS, bindShortcut, clearShortcut, restoreShortcut } from "../ext-shortcuts.mjs";
import { RECORD } from "./b4.mjs";

const J = JSON.stringify;
export const ITEM_LIMIT = 8192; // chrome.storage.sync 单项上限（键名 + JSON 值），同 src/chrome/config-store.js
export const itemBytes = (key, value) => Buffer.byteLength(key + JSON.stringify(value));
const asEngine = (entry, locale = E2E_LOCALE) => ({ id: entry.id, name: entry.name, url: catalogUrl(entry, locale) });

// 纯逻辑：在 base 后面补填充引擎，使 customEngines 不超过 limit，但再追加 extra 就超过。填充网址的 host 是保留域 .example
export function fillToLimit(base, extra, limit = ITEM_LIMIT) {
  const filler = (n, pad = 0) => ({ id: `fill-${n}`, name: `Filler ${n}`, url: `https://filler.example/s?q=%s&p=${"x".repeat(pad)}` });
  const arr = [...base];
  const size = a => itemBytes("customEngines", a);
  for (let n = 1; size([...arr, filler(n)]) <= limit - 200; n++) arr.push(filler(n));
  const n = arr.length - base.length + 1;
  const pad = limit - 1 - size([...arr, filler(n)]);
  if (pad < 0) throw new Error("fillToLimit: 填不出接近上限的数组");
  arr.push(filler(n, pad));
  if (size(arr) > limit || size([...arr, extra]) <= limit) throw new Error("fillToLimit: 结果不在上限两侧");
  return arr;
}

// ---- 引擎库对话框（页内脚本）----
const OPEN_CATALOG = `document.getElementById("catalog-open").click();
  await sleep(50);
  const d = document.getElementById("catalog-dialog");
  return d.open && d.querySelectorAll(".catalog-row").length;`;
const CATALOG_STATE = `const d = document.getElementById("catalog-dialog");
  const keyLike = /^[a-z]+_[a-z0-9_]+$/;
  return { open: d.open,
    headings: [...d.querySelectorAll("#catalog-body h3")].map(h => ({ key: h.getAttribute("data-i18n"), text: h.textContent })),
    lists: [...d.querySelectorAll("#catalog-body ul.catalog-list")].map(u => [...u.querySelectorAll(".catalog-row")].map(r => {
      const b = r.querySelector("button");
      return { name: r.querySelector(".catalog-name").textContent, key: b?.getAttribute("data-i18n"), text: b?.textContent, disabled: !!b?.disabled };
    })),
    raw: [...d.querySelectorAll("[data-i18n]")].map(el => ({ key: el.getAttribute("data-i18n"), text: el.textContent.trim() }))
      .filter(x => x.text === x.key || keyLike.test(x.text)) };`;
// times > 1 时同步连点（模拟双击）：第一次点击就应禁用按钮，后面的点击不再发起添加
const clickAdd = (name, times = 1) => `const r = [...document.querySelectorAll("#catalog-dialog .catalog-row")].find(r => r.querySelector(".catalog-name").textContent === ${J(name)});
  const b = r?.querySelector("button"); if (!b || b.disabled) return false; b.focus(); for (let i = 0; i < ${times}; i++) b.click(); return true;`;
const notices = `return [...document.querySelectorAll("#notices .notice")].map(n => ({ kind: n.className, text: n.querySelector(".notice-text").textContent }));`;

// 纯逻辑：对话框的内容与引擎库数据核对（没有添加过任何条目时）。返回问题列表
export function catalogProblems(s, { catalog = CATALOG, categories = CATEGORIES, text = msg } = {}) {
  const p = [];
  if (!s.open) p.push("对话框没有打开");
  const cats = categories.filter(c => catalog.some(e => e.category === c.id));
  const heads = s.headings.map(h => h.key).join(",");
  if (heads !== cats.map(c => c.key).join(",")) p.push(`分类标题应为 ${cats.map(c => c.key).join(",")}，实际 ${heads}`);
  cats.forEach((c, i) => {
    const h = s.headings[i];
    if (h && h.text !== text(c.key)) p.push(`分类 ${c.key} 显示“${h.text}”，应为“${text(c.key)}”`);
    const want = catalog.filter(e => e.category === c.id).map(e => e.name);
    const got = (s.lists[i] ?? []).map(r => r.name);
    if (got.join("|") !== want.join("|")) p.push(`分类 ${c.key} 的条目应为 ${want.join("、")}，实际 ${got.join("、")}`);
    for (const r of s.lists[i] ?? []) {
      if (r.key !== "catalog_add" || r.text !== text("catalog_add") || r.disabled) p.push(`${r.name} 的按钮应为可点的“${text("catalog_add")}”，实际 ${r.key}“${r.text}”${r.disabled ? "（禁用）" : ""}`);
    }
  });
  for (const r of s.raw) p.push(`[data-i18n="${r.key}"] 显示的是 key 样的文字“${r.text}”`);
  return p;
}

// 子项包装：快捷键页结构认不出（infra）或原有绑定录不回去（unrestorable）记跳过并写明原因，其余异常记失败
const subX = (name, fn) => sub(name, async () => {
  try { return await fn(); }
  catch (e) {
    if (e.kind === "infra") return { status: "skip", detail: `测试设施问题：${e.message}` };
    if (e.kind === "unrestorable") return { status: "skip", detail: e.message };
    throw e;
  }
});

async function withPage(ctx, fn) {
  const page = await openOptions(ctx.browser);
  try { return await fn(page); } finally { await page.close(); }
}
const storedCustom = ctx => ctx.ext.eval(`chrome.storage.sync.get(["customEngines", "cycleExclude"])`);

const render = ctx => sub("(a) 引擎库对话框：逐个分类渲染、条目齐全、没有显示成 key 的文字", () => withPage(ctx, async page => {
  await page.until(OPEN_CATALOG);
  const s = await page.run(CATALOG_STATE);
  return verdict(catalogProblems(s), `${s.headings.length} 个分类（${s.headings.map(h => h.text).join("、")}）、${CATALOG.length} 个条目，按钮都是“${msg("catalog_add")}”`);
}));

// 添加一个非 AI、还没授权的条目（Bilibili：search.bilibili.com 不在一次性授权的 origin 里）
const ADD = CATALOG.find(e => e.id === "bilibili");
const addOne = ctx => sub(`(b) 连点两次添加 ${ADD.name}：只加一次、在引擎列表末尾，对话框显示“已添加”，不申请权限，没有“需授权”的持久警告`, () => withPage(ctx, async page => {
  const before = await storedCustom(ctx);
  // 引擎库条目按右侧用途处理：添加时不申请任何权限（chrome.permissions.request 调用次数应为 0）
  if (!(await page.run(`return ${RECORD};`))) return { status: "fail", detail: "chrome.permissions.request 的记录器没装上" };
  await page.until(OPEN_CATALOG);
  if (!(await page.run(clickAdd(ADD.name, 2)))) return { status: "fail", detail: `对话框里 ${ADD.name} 的“添加”按钮找不到或不可点` };
  await page.until(`return !!row(${J(ADD.id)})`, 5000);
  await page.until(`const b = [...document.querySelectorAll("#catalog-dialog .catalog-row")].find(r => r.dataset.entry === ${J(ADD.id)})?.querySelector("button");
    return b?.getAttribute("data-i18n") === "catalog_added";`, 5000).catch(() => {});
  const requests = await page.run(`return globalThis.__e2eReq;`);
  const r = await page.run(`const rw = row(${J(ADD.id)}), b = rw.querySelector(${keySel("engine_grant")});
    const dr = [...document.querySelectorAll("#catalog-dialog .catalog-row")].find(r => r.querySelector(".catalog-name").textContent === ${J(ADD.name)});
    const db = dr?.querySelector("button");
    return { last: ids().at(-1), grant: !!b, attention: !!b?.classList.contains("btn-attention"),
      dlg: { key: db?.getAttribute("data-i18n"), text: db?.textContent, disabled: !!db?.disabled }, open: document.getElementById("catalog-dialog").open,
      focus: document.activeElement?.closest?.("[data-entry]")?.dataset.entry ?? document.activeElement?.tagName ?? null };`);
  const ns = await page.run(notices);
  const after = await storedCustom(ctx);
  const want = asEngine(ADD);
  const p = [];
  if (!Array.isArray(requests) || requests.length) p.push(`添加时不应申请权限，实际 chrome.permissions.request 调用 ${J(requests)}`);
  if (r.last !== ADD.id) p.push(`引擎列表末尾应是 ${ADD.id}，实际 ${r.last}`);
  if (!r.open) p.push("添加后对话框被关掉了");
  if (r.focus !== ADD.id) p.push(`列表重建后焦点应留在 ${ADD.name} 这一行，实际在 ${r.focus}`);
  if (r.dlg.key !== "catalog_added" || r.dlg.text !== msg("catalog_added") || !r.dlg.disabled) p.push(`对话框里应显示禁用的“${msg("catalog_added")}”，实际 ${r.dlg.key}“${r.dlg.text}”`);
  if (!r.grant) p.push("引擎行上应保留“授权”按钮");
  else if (r.attention) p.push("引擎行的授权按钮不应高亮（btn-attention）");
  if (ns.some(n => n.text.includes(msg("notice_needs_grant")))) p.push(`出现了“需授权”的提示：${ns.map(n => n.text).join("；")}`);
  if (ns.some(n => n.kind.includes("notice-error"))) p.push(`连点两次“添加”不应出现错误提示：${ns.map(n => n.text).join("；")}`);
  if (ns.filter(n => n.text === msg("notice_catalog_added", ADD.name)).length > 1) p.push("连点两次“添加”出现了两条成功提示");
  if (!ns.some(n => n.text === msg("notice_catalog_added", ADD.name))) p.push(`没有“${msg("notice_catalog_added", ADD.name)}”的提示（实际 ${ns.map(n => n.text).join("；") || "无"}）`);
  if (J(after.customEngines?.at(-1)) !== J(want)) p.push(`存储里最后一个自定义引擎应为 ${J(want)}，实际 ${J(after.customEngines?.at(-1))}`);
  if (J(after.cycleExclude) !== J(before.cycleExclude)) p.push(`非 AI 条目不应改 cycleExclude：${J(before.cycleExclude)} → ${J(after.cycleExclude)}`);
  return verdict(p, `${ADD.name} 加在列表末尾（${want.url}），对话框显示“${msg("catalog_added")}”，授权按钮不高亮，只有“${msg("notice_catalog_added", ADD.name)}”提示，没有申请权限`);
}));

const AI = CATALOG.find(e => e.ai);
const addAi = ctx => (!AI
  ? { name: "(c) 添加 AI 条目：进 cycleExclude", status: "skip",
    detail: "引擎库里没有 ai: true 的条目，无从在页面上验证；addFromCatalog 的这条逻辑由 node 测试覆盖" }
  : sub(`(c) 添加 AI 条目 ${AI.name}：进 cycleExclude`, () => withPage(ctx, async page => {
    await page.until(OPEN_CATALOG);
    if (!(await page.run(clickAdd(AI.name)))) return { status: "fail", detail: `对话框里 ${AI.name} 的“添加”按钮找不到或不可点` };
    await page.until(`return !!row(${J(AI.id)})`, 5000);
    const { cycleExclude = [] } = await storedCustom(ctx);
    return verdict(cycleExclude.includes(AI.id) ? [] : [`cycleExclude 应含 ${AI.id}，实际 ${J(cycleExclude)}`], `cycleExclude = ${J(cycleExclude)}`);
  })));

const BIG = CATALOG.find(e => e.id === "github");
const tooLarge = ctx => sub(`(d) customEngines 接近 ${ITEM_LIMIT} 字节时添加 ${BIG.name}：拒绝写入并提示`, async () => {
  const { customEngines = [] } = await storedCustom(ctx);
  const big = fillToLimit(customEngines, asEngine(BIG));
  await ctx.ext.eval(`chrome.storage.sync.set({ customEngines: ${J(big)} }).then(() => true)`);
  return withPage(ctx, async page => {
    await page.until(`return !!row(${J(big.at(-1).id)})`, 10000);
    await page.until(OPEN_CATALOG);
    if (!(await page.run(clickAdd(BIG.name)))) return { status: "fail", detail: `对话框里 ${BIG.name} 的“添加”按钮找不到或不可点` };
    const want = msg("notice_save_failed", msg("err_config_too_large", "customEngines"));
    const shown = await page.until(`const n = [...document.querySelectorAll("#notices .notice-error .notice-text")].find(n => n.textContent === ${J(want)}); return n ? n.textContent : false;`, 5000)
      .catch(() => null);
    const after = await storedCustom(ctx);
    const p = [];
    if (!shown) p.push(`没有出现错误提示“${want}”（实际 ${(await page.run(notices)).map(n => n.text).join("；") || "无"}）`);
    if (J(after.customEngines) !== J(big)) p.push(`customEngines 被改动了（${after.customEngines?.length} 项，应为 ${big.length} 项）`);
    if (await page.run(`return !!row(${J(BIG.id)})`)) p.push(`引擎列表里出现了 ${BIG.id}`);
    return verdict(p, `写入前 ${itemBytes("customEngines", big)} 字节、再加一项 ${itemBytes("customEngines", [...big, asEngine(BIG)])} 字节：没有写入，提示“${want}”`);
  });
});

const B16 = {
  id: "B16", title: "右侧引擎库：对话框按分类渲染、添加后在列表末尾且不警告授权、超限拒绝写入（自动判定）", kind: "auto", needs: [],
  run: ctx => guarded(ctx, ["customEngines", "order", "cycleExclude"], async () => {
    const items = [await render(ctx), await addOne(ctx)];
    items.push(await addAi(ctx), await tooLarge(ctx));
    return summarize(items);
  }),
};

// ---- B17 快捷键 ----
const SHORTCUT_STATE = `const box = document.getElementById("shortcut");
  const unset = box.querySelector(${keySel("options_shortcut_unset")});
  return { unset: unset ? unset.textContent : null, key: box.querySelector(".shortcut-key")?.textContent ?? null,
    open: box.querySelector(${keySel("options_shortcut_open")})?.textContent ?? null };`;
const focusPage = page => page.run(`window.dispatchEvent(new Event("focus")); return true;`);

const declared = ctx => subX("(a) cycle-right 已声明、manifest 不写 suggested_key、当前没有快捷键", async () => {
  const how = await clearShortcut(ctx.browser, COMMAND); // 测试配置里原来有绑定就先清掉（记进快照，步骤结束改回）
  const r = await ctx.ext.eval(`(async () => ({ manifest: chrome.runtime.getManifest().commands ?? null,
    all: await chrome.commands.getAll(), desc: chrome.i18n.getMessage("cmd_cycle_right") }))()`);
  const p = [];
  const names = Object.keys(r.manifest ?? {});
  if (names.join(",") !== COMMAND) p.push(`manifest 的 commands 应只有 ${COMMAND}，实际 ${names.join(",") || "无"}`);
  for (const [n, c] of Object.entries(r.manifest ?? {})) if ("suggested_key" in c) p.push(`manifest 的 ${n} 写了 suggested_key`);
  const c = r.all.find(x => x.name === COMMAND);
  if (!c) p.push(`chrome.commands.getAll() 里没有 ${COMMAND}`);
  else {
    if (c.shortcut !== "") p.push(`${COMMAND} 应没有快捷键，实际“${c.shortcut}”`);
    if (c.description !== r.desc) p.push(`${COMMAND} 的描述应为“${r.desc}”，实际“${c.description}”`);
  }
  const act = r.all.find(x => x.name === "_execute_action");
  if (act?.shortcut) p.push(`_execute_action 不应绑定，实际“${act.shortcut}”`);
  const pre = how === "cleared" ? "（测试配置里原来有绑定，已先清除，步骤结束改回）" : "";
  return verdict(p, `${COMMAND}“${c?.description}”没有快捷键，manifest 没有 suggested_key${pre}`);
});

const rowShows = ctx => subX("(b) 设置页“快捷键”一行显示“未设置”；绑定后获得焦点即刷新，清除后恢复“未设置”", () => withPage(ctx, async page => {
  const unset = msg("options_shortcut_unset");
  const s0 = await page.until(`const s = (() => { ${SHORTCUT_STATE} })(); return s.unset !== null && s;`, 5000).catch(() => null);
  if (!s0) return { status: "fail", detail: `“快捷键”一行没有显示“${unset}”（实际 ${J(await page.run(SHORTCUT_STATE))}）` };
  const p = [];
  if (s0.unset !== unset) p.push(`应显示“${unset}”，实际“${s0.unset}”`);
  if (s0.open !== msg("options_shortcut_open")) p.push(`旁边应有“${msg("options_shortcut_open")}”按钮，实际 ${J(s0.open)}`);
  await bindShortcut(ctx.browser, COMMAND, TEST_KEYS);
  const bound = (await ctx.ext.eval("chrome.commands.getAll()")).find(x => x.name === COMMAND)?.shortcut;
  await focusPage(page);
  const s1 = await page.until(`const s = (() => { ${SHORTCUT_STATE} })(); return s.key === ${J(bound)} && s;`, 5000).catch(() => null);
  if (!s1) p.push(`绑定 ${TEST_KEYS} 后派发 focus，一行没有显示“${bound}”（实际 ${J(await page.run(SHORTCUT_STATE))}）`);
  // 清除阶段直接清掉绑定（不靠快照改回：运行前若本来就有绑定，改回的就不是“未设置”）；步骤结束仍按快照改回
  await clearShortcut(ctx.browser, COMMAND);
  await focusPage(page);
  const s2 = await page.until(`const s = (() => { ${SHORTCUT_STATE} })(); return s.unset === ${J(unset)} && s;`, 5000).catch(() => null);
  if (!s2) p.push(`清除绑定后派发 focus，一行没有恢复“${unset}”（实际 ${J(await page.run(SHORTCUT_STATE))}）`);
  return verdict(p, `显示“${unset}”与“${s0.open}”按钮；绑定后显示“${bound}”，清除后恢复“${unset}”`);
}));

// 快捷键卡的轮换清单（默认收起的 <details>，summary 带计数）；引擎行上关掉的显示“不参与轮换”标签
const CYCLE_STATE = `const d = document.querySelector("#cycle details"), box = document.getElementById("cycle-ec");
  const tag = row("ec")?.querySelector(${keySel("engine_tag_no_cycle")});
  return { open: d?.open ?? null, summary: d?.querySelector("summary")?.textContent.trim() ?? null, checked: box?.checked ?? null,
    inCard: !!box?.closest("[aria-labelledby=shortcut-title] fieldset"), label: box?.closest("label")?.textContent.trim() ?? null,
    name: row("ec")?.querySelector(".engine-name")?.textContent ?? null, tag: !!tag };`;

const toggle = ctx => sub("(c) 快捷键卡的轮换开关写入 cycleExclude", () => withPage(ctx, async page => {
  const ex = async () => (await storedCustom(ctx)).cycleExclude ?? [];
  const p = [];
  await page.until(`return !!document.getElementById("cycle-ec")`, 5000);
  const n = await page.run(`return document.querySelectorAll("#engines .engine-row").length`);
  const s0 = await page.run(CYCLE_STATE);
  if (s0.open !== false) p.push(`轮换清单应收在默认收起的 <details> 里，实际 ${s0.open === null ? "没有 <details>" : "已展开"}`);
  if (s0.summary !== msg("options_cycle_title", n, n)) p.push(`summary 应为“${msg("options_cycle_title", n, n)}”，实际 ${J(s0.summary)}`);
  if (!s0.inCard) p.push("#cycle-ec 应在快捷键卡的 fieldset 里");
  if (!s0.name || s0.label !== s0.name) p.push(`#cycle-ec 的 label 文字应是引擎名 ${J(s0.name)}，实际 ${J(s0.label)}`);
  if (!s0.checked) p.push("ec 的开关初始应为打开（基线没有 cycleExclude）");
  if (s0.tag) p.push("ec 还在轮换里，行上不该有“不参与轮换”标签");
  // 先给焦点再点（元素.click() 不移焦点）：重渲染换掉了这个节点，焦点应回到新建的 #cycle-ec（spec 3.4）
  await page.run(`document.querySelector("#cycle details").open = true; const b = document.getElementById("cycle-ec"); b.__ssOld = true; b.focus(); b.click(); return true;`);
  const off = await page.until(`return (await chrome.storage.sync.get("cycleExclude")).cycleExclude?.includes("ec") ?? false`, 5000).then(() => true, () => false);
  if (!off) p.push(`关掉 ec 的开关后 cycleExclude 应含 ec，实际 ${J(await ex())}`);
  await page.until(`return !document.getElementById("cycle-ec")?.checked`, 5000).catch(() => p.push("关掉后重画的开关不是关的"));
  const s1 = await page.until(`const s = (() => { ${CYCLE_STATE} })(); return s.tag && s;`, 5000).catch(() => page.run(CYCLE_STATE));
  if (!s1.tag) p.push(`关掉后 ec 的行上应有“${msg("engine_tag_no_cycle")}”标签`);
  if (s1.summary !== msg("options_cycle_title", n - 1, n)) p.push(`关掉后 summary 应为“${msg("options_cycle_title", n - 1, n)}”，实际 ${J(s1.summary)}`);
  if (s1.open !== true) p.push("重渲染后 <details> 应仍展开");
  const f = await page.until(`const a = document.activeElement; return a?.id === "cycle-ec" && !a.__ssOld && { id: a.id };`, 5000).catch(() => page.run(`const a = document.activeElement; return { id: a?.id || a?.tagName || null, old: !!a?.__ssOld };`));
  if (f.id !== "cycle-ec" || f.old) p.push(`重渲染后焦点应在新建的 #cycle-ec 上，实际 ${J(f)}`);
  await page.run(`document.getElementById("cycle-ec").click(); return true;`);
  const on = await page.until(`return !((await chrome.storage.sync.get("cycleExclude")).cycleExclude ?? []).includes("ec")`, 5000).then(() => true, () => false);
  if (!on) p.push(`再打开后 cycleExclude 不应含 ec，实际 ${J(await ex())}`);
  return verdict(p, `清单默认收起、summary“${s0.summary}”、开关在快捷键卡里；关掉 ec → cycleExclude 含 ec、行上出现“${msg("engine_tag_no_cycle")}”、summary 少 1、清单仍展开、焦点回到新的 #cycle-ec；再打开 → 不含（${J(await ex())}）`);
}));

const B17 = {
  id: "B17", title: "快捷键：命令已声明且默认不绑定、设置页显示“未设置”并随焦点刷新、轮换开关写入 cycleExclude（自动判定）", kind: "auto", needs: [],
  run: ctx => guarded(ctx, ["cycleExclude"], async () => {
    try {
      const a = await declared(ctx);
      const b = a.status === "pass" ? await rowShows(ctx) : { name: "(b) 设置页“快捷键”一行", status: "skip", detail: "(a) 没通过，快捷键状态不确定" };
      return summarize([a, b, await toggle(ctx)]);
    } finally { await restoreShortcut(ctx.browser).catch(e => ctx.log?.(`  改回快捷键失败（收尾会再试）：${e.message}`)); }
  }),
};

export const V03_OPTIONS_STEPS = [B16, B17];
