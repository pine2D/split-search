// v0.5 自动步骤 B20（设计稿 11.2）：设置页“默认组合”卡里的“按关键词换右侧”规则区与规则对话框。
// 1–11 步按顺序在同一个设置页上做，后一步沿用前一步留下的规则；按钮先 focus 再 click（模拟用户，焦点恢复按 activeElement 算）。
// 期望文字一律用 msg(key, …) 从 zh_CN 目录算。customEngines、rightRules、presetOverrides 由 guarded 写回。
import { guarded, openOptions, addCustom, openEdit, readKeys, sleep } from "./optpage.mjs";
import { summarize } from "./util.mjs";
import { sub, verdict } from "./v03-lib.mjs";
import { mockEngineD, engineName } from "./v05-lib.mjs";
import { rulesBytes } from "../../../src/lib/right-rules.js";
import { msg } from "../i18n.mjs";

const J = JSON.stringify;

// 页内脚本前缀（拼在 page.run 的 body 前面）
const P = `
const box = () => [...document.querySelectorAll("#pair-body details.disclosure")]
  .find(d => d.querySelector('summary [data-i18n="options_rules_title"], summary [data-i18n="options_rules_summary"]'));
const rrow = id => document.querySelector('#rule-list > li[data-id="' + id + '"]');
const dlg = () => document.getElementById("rule-dialog");
const press = id => { const b = document.getElementById(id); b.focus(); b.click(); return true; };
const err = n => { const el = document.querySelector('#rule-dialog .field-error[data-for="' + n + '"]'); return el && !el.hidden ? el.textContent : ""; };
const notes = () => [...document.querySelectorAll("#notices .notice-text")].map(n => n.textContent);
const focusId = () => document.activeElement?.id || document.activeElement?.tagName || "";
`;
const run = (page, body) => page.run(P + body);
const until = (page, body, what, ms = 5000) => page.until(P + body, ms).catch(() => { throw new Error(`没有等到：${what}`); });

const sortKeys = r => Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1)));
const same = (a, b) => J((a ?? []).map(sortKeys)) === J((b ?? []).map(sortKeys));
const rulesOf = async ctx => (await readKeys(ctx.ext, ["rightRules"])).rightRules;
// 等存储里的规则满足 pred（最多 5 秒），返回最后一次读到的
async function waitRules(ctx, pred) {
  const end = Date.now() + 5000;
  for (;;) {
    const r = await rulesOf(ctx);
    if (pred(r) || Date.now() > end) return r;
    await sleep(100);
  }
}
const setRules = (ctx, rules) => ctx.ext.eval(`chrome.storage.sync.set({ rightRules: ${J(rules)} }).then(() => true)`);

// 打开规则对话框（opener：新增按钮或某行的“编辑”），填表并保存。form 里没给的字段不动
async function openDialog(page, opener) {
  await run(page, `return press(${J(opener)});`);
  await until(page, `return dlg().open;`, `#${opener} 打开规则对话框`);
}
const fill = (page, { when, words, script, engine }) => run(page, `
  ${when ? `press(${J(when === "script" ? "rule-when-script" : "rule-when-words")});` : ""}
  ${words !== undefined ? `document.getElementById("rule-words").value = ${J(words)};` : ""}
  ${script !== undefined ? `document.getElementById("rule-script").value = ${J(script)};` : ""}
  ${engine !== undefined ? `document.getElementById("rule-engine").value = ${J(engine)};` : ""}
  return true;`);
const save = page => run(page, `return press("rule-dlg-save");`);
const cancel = page => run(page, `if (dlg().open) press("rule-dlg-cancel"); return true;`);

// 保存后对话框关掉、存储写入；返回存储里的规则
async function saveOk(ctx, page, what) {
  await save(page);
  await until(page, `return !dlg().open;`, `${what}：保存后对话框关掉（错误：${J(await run(page, `return [err("words"), err("engine"), err("form")];`))}）`);
  return rulesOf(ctx);
}
// 保存后报错：等 field 的错误文字出现，返回它
async function saveErr(page, field, what) {
  await save(page);
  return until(page, `return dlg().open && err(${J(field)});`, `${what}：#rule-dialog 的 ${field} 报错`);
}

// 5 条已有规则各 10 个、新增 1 条 10 个：每个词 32 个 4 字节 emoji（彼此不同），合计 60 个词，写回后超过 8000 字节
const emojiWord = k => String.fromCodePoint(0x1F400 + k) + "😀".repeat(31);
const bigRules = () => Array.from({ length: 5 }, (_, i) => ({ id: `r${10 + i}`, when: "words", words: Array.from({ length: 10 }, (_, j) => emojiWord(i * 10 + j)), engine: "ec" }));
const bigWords = () => Array.from({ length: 10 }, (_, j) => emojiWord(50 + j));

async function steps(ctx, page) {
  const { port } = ctx;
  const items = [];
  const step = async (name, fn) => { const r = await sub(name, fn); items.push(r); if (r.status === "fail") await cancel(page).catch(() => {}); };

  await step("1 没有规则：默认组合卡里有收起的规则区，summary 没有条数，展开后有空状态", async () => {
    const s = await run(page, `const d = box(); if (!d) return null;
      const r = { open: d.open, summary: d.querySelector("summary").textContent.trim() }; d.open = true;
      const e = document.getElementById("rule-empty");
      return { ...r, empty: e && e.checkVisibility() ? e.textContent : null, list: !!document.getElementById("rule-list") };`);
    if (!s) return { status: "fail", detail: "#pair-body 里找不到规则区（details.disclosure）" };
    const p = [];
    if (s.open) p.push("规则区应默认收起");
    if (s.summary !== msg("options_rules_title")) p.push(`summary 应为“${msg("options_rules_title")}”，实际“${s.summary}”`);
    if (s.empty !== msg("options_rules_empty")) p.push(`展开后应有空状态“${msg("options_rules_empty")}”，实际 ${J(s.empty)}`);
    if (s.list) p.push("0 条时不该有 #rule-list");
    return verdict(p, `收起，summary“${s.summary}”；展开后“${s.empty}”`);
  });

  await step("2 新增：焦点在选中的单选；右侧下拉不含左侧 ea、默认留空、第一项是“默认组合的右侧”；文字字段隐藏；没有删除按钮", async () => {
    await openDialog(page, "rule-add");
    const s = await run(page, `const sel = document.getElementById("rule-engine");
      return { focus: focusId(), checked: document.getElementById("rule-when-words").checked, values: [...sel.options].map(o => o.value),
        first: sel.options[1] ? { value: sel.options[1].value, text: sel.options[1].textContent } : null, value: sel.value,
        script: document.getElementById("rule-script").checkVisibility(), words: document.getElementById("rule-words").checkVisibility(),
        del: document.getElementById("rule-dlg-delete").checkVisibility(), danger: document.getElementById("rule-dlg-danger").checkVisibility() };`);
    const p = [];
    if (s.focus !== "rule-when-words" || !s.checked) p.push(`焦点应在选中的“这些词”单选上，实际 ${s.focus}（checked ${s.checked}）`);
    if (s.values.includes("ea")) p.push(`右侧下拉不该有默认左侧 ea：${s.values.join(",")}`);
    if (!s.values.includes("ec") || !s.values.includes("ed")) p.push(`右侧下拉应有 ec、ed：${s.values.join(",")}`);
    if (s.value !== "") p.push(`右侧下拉应默认留空，实际 ${J(s.value)}`);
    if (s.first?.value !== "@keep" || s.first?.text !== msg("options_rules_engine_keep")) p.push(`占位项之后第一项应是“${msg("options_rules_engine_keep")}”，实际 ${J(s.first)}`);
    if (s.script || !s.words) p.push(`选“这些词”时 #rule-script 应隐藏、#rule-words 可见，实际 script ${s.script}、words ${s.words}`);
    if (s.del || s.danger) p.push("新增对话框里删除按钮和危险区应隐藏");
    return verdict(p, `焦点 ${s.focus}；选项 ${s.values.join(",")}`);
  });

  await step("3 空提交：报 err_rule_no_words、#rule-words 带 aria-invalid、存储没变", async () => {
    const e = await saveErr(page, "words", "空提交");
    const s = await run(page, `return { invalid: document.getElementById("rule-words").getAttribute("aria-invalid") };`);
    const p = [];
    if (e !== msg("err_rule_no_words")) p.push(`词字段错误应为“${msg("err_rule_no_words")}”，实际“${e}”`);
    if (s.invalid !== "true") p.push(`#rule-words 应 aria-invalid="true"，实际 ${J(s.invalid)}`);
    const now = await rulesOf(ctx);
    if (now !== undefined) p.push(`存储不该写入，实际 ${J(now)}`);
    return verdict(p, `“${e}”`);
  });

  await step("4 填 ＷＩＫＩ，百科、选 ec 保存：存储里是规范化后的词；行文字、焦点、summary（1 条）", async () => {
    await fill(page, { words: "ＷＩＫＩ，百科", engine: "ec" });
    const now = await saveOk(ctx, page, "第一条规则");
    const p = [];
    const want = [{ id: "r1", when: "words", words: ["wiki", "百科"], engine: "ec" }];
    if (!same(now, want)) p.push(`存储应为 ${J(want)}，实际 ${J(now)}`);
    const s = await until(page, `return rrow("r1") && { text: rrow("r1").querySelector(".rule-text").textContent, focus: focusId(),
      summary: box().querySelector("summary").textContent.trim() };`, "r1 这一行出现");
    const words = msg("options_rules_words_row", ["wiki", "百科"].join(msg("options_rules_word_sep")));
    const target = msg("options_rules_target", engineName(port, "ec"));
    if (!s.text.includes(words) || !s.text.includes(target)) p.push(`行文字应含“${words}”“${target}”，实际“${s.text}”`);
    if (s.focus !== "rule-edit-r1") p.push(`焦点应在 #rule-edit-r1，实际 ${s.focus}`);
    if (s.summary !== msg("options_rules_summary", 1)) p.push(`summary 应为“${msg("options_rules_summary", 1)}”，实际“${s.summary}”`);
    return verdict(p, `行“${s.text}”，焦点 ${s.focus}，summary“${s.summary}”`);
  });

  await step("5 新增文字规则（汉字 → ed）再上移：存储顺序变；焦点留在同一按钮（现在 aria-disabled）；提示“已移到第 1 条”", async () => {
    await openDialog(page, "rule-add");
    await fill(page, { when: "script", script: "han", engine: "ed" });
    const vis = await run(page, `return { words: document.getElementById("rule-words").checkVisibility(), script: document.getElementById("rule-script").checkVisibility() };`);
    const p = [];
    if (vis.words || !vis.script) p.push(`切到“某种文字”后应只显示 #rule-script，实际 ${J(vis)}`);
    const now = await saveOk(ctx, page, "汉字规则");
    if (now?.[1]?.id !== "r2" || now[1].script !== "han" || now[1].engine !== "ed") p.push(`第二条应是 r2 han → ed，实际 ${J(now)}`);
    await until(page, `return !!rrow("r2");`, "r2 这一行出现");
    await run(page, `return press("rule-up-r2");`);
    const order = await waitRules(ctx, r => r?.[0]?.id === "r2");
    if (J(order?.map(r => r.id)) !== J(["r2", "r1"])) p.push(`上移后存储顺序应为 r2,r1，实际 ${J(order?.map(r => r.id))}`);
    const want = msg("notice_rule_moved", 1);
    // 提示先于重渲染出现：等列表按新顺序重建（第一行是 r2）后再读焦点
    const s = await until(page, `return notes().includes(${J(want)}) && document.querySelector("#rule-list > li")?.dataset.id === "r2" && { focus: focusId(),
      dis: document.getElementById("rule-up-r2")?.getAttribute("aria-disabled") };`, `提示“${want}”`).catch(e => { p.push(e.message); return null; });
    if (s && (s.focus !== "rule-up-r2" || s.dis !== "true")) p.push(`焦点应留在 #rule-up-r2 且它 aria-disabled="true"，实际 ${J(s)}`);
    return verdict(p, `顺序 r2,r1；焦点 ${s?.focus}（aria-disabled ${s?.dis}）；提示“${want}”`);
  });

  await step("6 太长：33 字的词报 err_rule_word_long；超过 8000 字节的规则报 err_rule_too_large；存储都没变", async () => {
    const p = [];
    const before = await rulesOf(ctx);
    await openDialog(page, "rule-add");
    await fill(page, { when: "words", words: "a".repeat(33), engine: "ec" });
    const e1 = await saveErr(page, "words", "33 字的词");
    if (e1 !== msg("err_rule_word_long", "a".repeat(12))) p.push(`应报“${msg("err_rule_word_long", "a".repeat(12))}”，实际“${e1}”`);
    if (!same(await rulesOf(ctx), before)) p.push("33 字的词：存储变了");
    await cancel(page);
    const big = bigRules(), more = { id: "r99", when: "words", words: bigWords(), engine: "ec" };
    if (!(rulesBytes(big) <= 8000 && rulesBytes([...big, more]) > 8000)) throw new Error(`构造不对：已有 ${rulesBytes(big)} 字节，加上后 ${rulesBytes([...big, more])} 字节`);
    await setRules(ctx, big);
    try {
      await until(page, `return !!rrow("r14");`, "5 条大规则渲染出来");
      await openDialog(page, "rule-add");
      await fill(page, { words: bigWords().join(", "), engine: "ec" });
      const e2 = await saveErr(page, "words", "超过 8000 字节");
      if (e2 !== msg("err_rule_too_large")) p.push(`应报“${msg("err_rule_too_large")}”，实际“${e2}”`);
      if (!same(await rulesOf(ctx), big)) p.push("超过 8000 字节：存储变了");
      await cancel(page);
      return verdict(p, `“${e1}”；已有 ${rulesBytes(big)} 字节、加上后 ${rulesBytes([...big, more])} 字节时“${e2}”`);
    } finally {
      await setRules(ctx, before);
      await until(page, `return !!rrow("r1") && !rrow("r14");`, "规则恢复成 r2,r1");
    }
  });

  await step("7 暂不生效：指向左侧 ea、指向已隐藏的 ddg 的规则，两行都有图标和“暂不生效”说明", async () => {
    const { presetOverrides = {} } = await readKeys(ctx.ext, ["presetOverrides"]);
    await ctx.ext.eval(`chrome.storage.sync.set({ presetOverrides: ${J({ ...presetOverrides, ddg: { ...presetOverrides.ddg, hidden: true } })} }).then(() => true)`);
    await setRules(ctx, [...await rulesOf(ctx), { id: "r3", when: "words", words: ["zz"], engine: "ea" }, { id: "r4", when: "words", words: ["dd"], engine: "ddg" }]);
    const s = await until(page, `const off = id => { const o = rrow(id)?.querySelector(".rule-off"); return o ? { text: o.textContent, icon: !!o.querySelector("svg") } : null; };
      return rrow("r4") && { r3: off("r3"), r4: off("r4") };`, "r3、r4 两行出现");
    const p = [];
    for (const [id, want] of [["r3", msg("options_rules_off_left", engineName(port, "ea"))], ["r4", msg("options_rules_off_hidden", "DuckDuckGo")]]) {
      if (!s[id] || s[id].text !== want || !s[id].icon) p.push(`${id} 应有图标和“${want}”，实际 ${J(s[id])}`);
    }
    return verdict(p, `r3“${s.r3?.text}”、r4“${s.r4?.text}”，都有图标`);
  });

  await step("8 被挡住：在汉字规则后面加 百科全书，行内提示它已被第 1 条（汉字）用掉", async () => {
    await setRules(ctx, [...await rulesOf(ctx), { id: "r5", when: "words", words: ["百科全书"], engine: "ec" }]);
    const want = msg("options_rules_shadowed", "百科全书", 1);
    const s = await until(page, `return rrow("r5") && [...rrow("r5").querySelectorAll(".rule-shadow")].map(e => e.textContent);`, "r5 这一行出现");
    return verdict(s.includes(want) ? [] : [`r5 应提示“${want}”，实际 ${J(s)}`], `“${want}”`);
  });

  await step("9 删除在对话框里：行内没有删除；点一次只出提醒、存储不变，再点关对话框、规则没了、焦点给相邻行的“编辑”", async () => {
    const p = [];
    const inline = await run(page, `return [...document.querySelectorAll("#rule-list button")].map(b => b.id).filter(id => !/^rule-(edit|up|down)-/.test(id));`);
    if (inline.length) p.push(`行内只该有编辑、上移、下移，多了 ${inline.join(",")}`);
    await openDialog(page, "rule-edit-r5");
    if (!(await run(page, `return document.getElementById("rule-dlg-delete").checkVisibility();`))) p.push("编辑对话框里应看得见 #rule-dlg-delete");
    await run(page, `return press("rule-dlg-delete");`);
    const once = await run(page, `return { hint: document.getElementById("rule-dlg-delete-hint").textContent, open: dlg().open };`);
    if (once.hint !== msg("options_rules_delete_hint") || !once.open) p.push(`点一次后提醒应为“${msg("options_rules_delete_hint")}”、对话框开着，实际 ${J(once)}`);
    if (!(await rulesOf(ctx)).some(r => r.id === "r5")) p.push("点一次就删了");
    await run(page, `document.getElementById("rule-dlg-delete").click(); return true;`);
    const s = await until(page, `return !dlg().open && !rrow("r5") && focusId() === "rule-edit-r4" && focusId();`, "对话框关掉、r5 没了、焦点在 #rule-edit-r4")
      .catch(async e => { p.push(`${e.message}，实际焦点 ${await run(page, "return focusId();")}`); return null; });
    if ((await rulesOf(ctx)).some(r => r.id === "r5")) p.push("点两次后存储里还有 r5");
    return verdict(p, `第一次“${once.hint}”，第二次删掉 r5，焦点 ${s}`);
  });

  await step("10 引擎对话框：ed 被 1 条规则用着，#dlg-rules-hint 写条数；删除 ed，规则一起删掉、提示含条数", async () => {
    const p = [];
    const users = (await rulesOf(ctx)).filter(r => r.engine === "ed").length;
    if (users !== 1) throw new Error(`前提不成立：应只有 1 条规则用 ed（第 5 步的 r2），实际 ${users}`);
    await openEdit(page, "ed");
    const hint = await run(page, `const h = document.getElementById("dlg-rules-hint"); return h.checkVisibility() ? h.textContent : null;`);
    if (hint !== msg("engine_rules_used_custom", 1)) p.push(`#dlg-rules-hint 应为“${msg("engine_rules_used_custom", 1)}”，实际 ${J(hint)}`);
    await run(page, `const b = document.getElementById("dlg-delete"); b.focus(); b.click(); await sleep(100); b.click(); return true;`);
    const want = msg("notice_deleted_with_rules", engineName(port, "ed"), 1);
    await until(page, `return !row("ed") && notes().includes(${J(want)});`, `提示“${want}”`).catch(e => p.push(e.message));
    const { rightRules, customEngines } = await readKeys(ctx.ext, ["rightRules", "customEngines"]);
    if (rightRules?.some(r => r.engine === "ed")) p.push(`删除 ed 后还有规则指向它：${J(rightRules)}`);
    if (customEngines?.some(e => e.id === "ed")) p.push("ed 没删掉");
    return verdict(p, `“${hint}”；删除后“${want}”，剩 ${J(rightRules?.map(r => r.id))}`);
  });

  await step("11 “默认组合的右侧”存成 keep；编辑指向已隐藏 ddg 的规则原样保存成功；编辑指向 ea 的规则必须重选", async () => {
    const p = [];
    await openDialog(page, "rule-add");
    await fill(page, { when: "words", words: "keepme", engine: "@keep" });
    const now = await saveOk(ctx, page, "keep 规则");
    const k = now.find(r => r.words?.[0] === "keepme");
    if (!k || k.keep !== true || "engine" in k) p.push(`应存成 keep: true、没有 engine，实际 ${J(k)}`);
    const want = msg("options_rules_target_keep", engineName(port, "eb"));
    const text = k && await until(page, `return rrow(${J(k.id)})?.querySelector(".rule-text").textContent;`, "keep 规则这一行");
    if (k && !text.includes(want)) p.push(`行文字应含“${want}”，实际“${text}”`);
    const r4 = now.find(r => r.id === "r4");
    await openDialog(page, "rule-edit-r4");
    const sel = await run(page, `const s = document.getElementById("rule-engine"); return { value: s.value, text: s.selectedOptions[0]?.textContent };`);
    const hiddenLabel = msg("options_rules_engine_hidden", "DuckDuckGo");
    if (sel.value !== "ddg" || sel.text !== hiddenLabel) p.push(`编辑 r4 应选中 ddg 并标“${hiddenLabel}”，实际 ${J(sel)}`);
    const after = await saveOk(ctx, page, "原样保存 r4");
    if (!same([after.find(r => r.id === "r4")], [r4])) p.push(`r4 原样保存后应不变，实际 ${J(after.find(r => r.id === "r4"))}`);
    await openDialog(page, "rule-edit-r3");
    const v3 = await run(page, `return document.getElementById("rule-engine").value;`);
    if (v3 !== "") p.push(`编辑指向 ea 的 r3，下拉应留空，实际 ${J(v3)}`);
    const e = await saveErr(page, "engine", "r3 直接保存");
    if (e !== msg("err_rule_engine")) p.push(`应报“${msg("err_rule_engine")}”，实际“${e}”`);
    await cancel(page);
    return verdict(p, `keep 规则行“${text}”；r4 选中“${sel.text}”原样保存；r3 留空，保存报“${e}”`);
  });
  return items;
}

const B20 = {
  id: "B20", title: "设置页“按关键词换右侧”：规则区、规则对话框、上移、删除、暂不生效与被挡提示、引擎对话框的规则条数（自动判定）",
  kind: "auto", needs: [], timeoutMs: 180000,
  run: ctx => guarded(ctx, ["customEngines", "rightRules", "presetOverrides"], async () => {
    await addCustom(ctx.ext, mockEngineD(ctx.port));
    await ctx.ext.eval(`chrome.storage.sync.remove("rightRules").then(() => true)`);
    const page = await openOptions(ctx.browser, { tab: "pair" });
    try { return summarize(await steps(ctx, page)); } finally { await page.close(); }
  }),
};

export const V05_OPTIONS_STEPS = [B20];
