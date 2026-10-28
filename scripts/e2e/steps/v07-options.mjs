// v0.7 自动步骤 B23：设置页的几处小改动。引擎库没有“百度”、没有空分类标题；默认组合卡左侧下拉里 Perplexity 带“建议作右侧”；
// 规则对话框的“去掉这些词”（#rule-strip）只跟“这些词”出现、切换后保持勾选，保存后存储与行内说明跟着变。
// 期望文字用 msg(key, …) 从 zh_CN 目录算。rightRules、presetOverrides 由 guarded 写回。
import { guarded, openOptions, readKeys, sleep, showTab } from "./optpage.mjs";
import { summarize } from "./util.mjs";
import { sub, verdict } from "./v03-lib.mjs";
import { msg } from "../i18n.mjs";

const J = JSON.stringify;
const P = `
const $ = id => document.getElementById(id);
const press = id => { const b = $(id); b.focus(); b.click(); return true; };
const rrow = id => document.querySelector('#rule-list > li[data-id="' + id + '"]');
`;
const run = (page, body) => page.run(P + body);
const until = (page, body, what, ms = 5000) => page.until(P + body, ms).catch(() => { throw new Error(`没有等到：${what}`); });

// 纯函数：引擎库对话框正文的结构 → 问题列表。sections = [{ title, rows }]（每个 h3 与紧跟的列表行数），names 是全部条目名
export function catalogProblems({ sections, names, entries }) {
  const p = [];
  for (const s of sections) if (!(s.rows > 0)) p.push(`分类“${s.title}”下面没有条目`);
  if (!sections.length) p.push("引擎库里没有任何分类");
  const baidu = names.filter(n => /百度|baidu/i.test(n));
  if (baidu.length || entries.includes("baidu")) p.push(`引擎库里不该有百度：${J(baidu)}`);
  return p;
}

const CATALOG = `return { open: $("catalog-dialog").open,
  sections: [...$("catalog-body").querySelectorAll("h3")].map(h => ({ title: h.textContent,
    rows: h.nextElementSibling?.matches("ul.catalog-list") ? h.nextElementSibling.querySelectorAll("li.catalog-row").length : 0 })),
  names: [...$("catalog-body").querySelectorAll(".catalog-row")].map(r => r.textContent),
  entries: [...$("catalog-body").querySelectorAll(".catalog-row")].map(r => r.dataset.entry) };`;

async function waitRules(ctx, pred) {
  const end = Date.now() + 5000;
  for (;;) {
    const r = (await readKeys(ctx.ext, ["rightRules"])).rightRules;
    if (pred(r) || Date.now() > end) return r;
    await sleep(100);
  }
}

const STRIP = `return { strip: $("rule-strip").checkVisibility(), checked: $("rule-strip").checked, hint: $("rule-strip-hint").checkVisibility() };`;

async function steps(ctx, page) {
  const items = [];
  const step = async (name, fn) => {
    const r = await sub(name, fn);
    items.push(r);
    if (r.status === "fail") await run(page, `for (const id of ["catalog-dialog", "rule-dialog"]) if ($(id).open) $(id).close(); return true;`).catch(() => {});
  };

  await step("(a) 引擎库：没有百度，每个分类标题下面都有条目", async () => {
    await showTab(page, "engines");
    await run(page, `return press("catalog-open");`);
    const s = await until(page, `const s = (() => { ${CATALOG} })(); return s.open && s.names.length > 0 && s;`, "引擎库对话框打开");
    await run(page, `return press("catalog-close");`);
    return verdict(catalogProblems(s), `${s.sections.length} 个分类：${s.sections.map(x => `${x.title}（${x.rows}）`).join("、")}`);
  });

  await step("(b) 默认组合卡左侧下拉：Perplexity 一项是 engine_left_discouraged_suffix 套上 Perplexity", async () => {
    await showTab(page, "pair");
    const want = msg("engine_left_discouraged_suffix", "Perplexity");
    const text = await until(page, `const o = [...$("pair-left").options].find(o => o.value === "perplexity"); return o && o.textContent;`, "#pair-left 里有 perplexity");
    return verdict(text === want ? [] : [`应为“${want}”，实际“${text}”`], `“${text}”`);
  });

  await step("(c) 规则对话框：“这些词”时 #rule-strip 可见，切到“某种文字”看不见，切回仍勾选", async () => {
    await run(page, `return press("rule-add");`);
    await until(page, `return $("rule-dialog").open;`, "规则对话框打开");
    const p = [];
    const a = await run(page, STRIP);
    if (!a.strip || !a.hint || a.checked) p.push(`新增时 #rule-strip 与说明应可见、默认不勾，实际 ${J(a)}`);
    await run(page, `$("rule-strip").click(); press("rule-when-script"); return true;`);
    const b = await run(page, STRIP);
    if (b.strip || b.hint) p.push(`切到“某种文字”后 #rule-strip 与说明应看不见，实际 ${J(b)}`);
    await run(page, `press("rule-when-words"); return true;`);
    const c = await run(page, STRIP);
    if (!c.strip || !c.checked) p.push(`切回“这些词”后应可见且仍勾选，实际 ${J(c)}`);
    return verdict(p, "可见 → 看不见 → 可见且仍勾选");
  });

  await step("(d) 勾选保存：存储里 strip: true，行内有 .rule-strip", async () => {
    await run(page, `$("rule-words").value = "vd"; $("rule-engine").value = "ec"; return press("rule-dlg-save");`);
    await until(page, `return !$("rule-dialog").open;`, "保存后对话框关掉");
    const rules = await waitRules(ctx, r => r?.length === 1);
    const p = [];
    const want = [{ id: "r1", when: "words", words: ["vd"], engine: "ec", strip: true }];
    const sorted = r => J(Object.fromEntries(Object.entries(r ?? {}).sort(([x], [y]) => (x < y ? -1 : 1))));
    if (rules?.length !== 1 || sorted(rules[0]) !== sorted(want[0])) p.push(`存储应为 ${J(want)}，实际 ${J(rules)}`);
    const note = await until(page, `const n = rrow("r1")?.querySelector(".rule-strip"); return n ? n.textContent : false;`, "r1 行内的 .rule-strip").catch(e => { p.push(e.message); return null; });
    if (note !== null && note !== msg("options_rules_strip_row")) p.push(`.rule-strip 应为“${msg("options_rules_strip_row")}”，实际“${note}”`);
    return verdict(p, `存储 ${J(rules)}；行内“${note}”`);
  });

  await step("(e) 编辑取消勾选再保存：存储里没有 strip 键，行内没有 .rule-strip", async () => {
    await run(page, `return press("rule-edit-r1");`);
    await until(page, `return $("rule-dialog").open && $("rule-strip").checked;`, "编辑对话框打开、#rule-strip 勾着");
    await run(page, `$("rule-strip").click(); return press("rule-dlg-save");`);
    await until(page, `return !$("rule-dialog").open;`, "保存后对话框关掉");
    const rules = await waitRules(ctx, r => r?.length === 1 && !("strip" in r[0]));
    const p = [];
    if (!rules?.length || "strip" in rules[0]) p.push(`取消勾选后存储里不该有 strip 键，实际 ${J(rules)}`);
    await until(page, `return !!rrow("r1") && !rrow("r1").querySelector(".rule-strip");`, "r1 行内没有 .rule-strip").catch(e => p.push(e.message));
    return verdict(p, `存储 ${J(rules)}`);
  });
  return items;
}

const B23 = {
  id: "B23", title: "设置页 v0.7 小改动：引擎库没有百度与空分类、左侧下拉的“建议作右侧”、规则的“去掉这些词”（自动判定）",
  kind: "auto", needs: [], timeoutMs: 90000,
  run: ctx => guarded(ctx, ["rightRules", "presetOverrides"], async () => {
    await ctx.ext.eval(`chrome.storage.sync.remove("rightRules").then(() => true)`);
    // Perplexity 被隐藏时左侧下拉里没有它：步骤里临时恢复显示
    const { presetOverrides = {} } = await readKeys(ctx.ext, ["presetOverrides"]);
    if (presetOverrides.perplexity?.hidden) {
      const { hidden, ...rest } = presetOverrides.perplexity;
      await ctx.ext.eval(`chrome.storage.sync.set({ presetOverrides: ${J({ ...presetOverrides, perplexity: rest })} }).then(() => true)`);
    }
    const page = await openOptions(ctx.browser, { tab: "pair" });
    try { return summarize(await steps(ctx, page)); } finally { await page.close(); }
  }),
};

export const V07_OPTIONS_STEPS = [B23];
