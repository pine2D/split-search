// I18N 步骤（i18n.mjs）在每种语言下调用的 v0.7 检查：规则对话框勾上“去掉这些词”（#rule-strip）的样子，
// 与引擎编辑表单改过后点外部弹出的保存确认（#discard-dialog，三个按钮要求一行）。沿用 i18n-audit.mjs 的自查与截图；
// 截图存 .e2e/i18n/<语言>-rule-dialog-strip.png、<语言>-discard-dialog.png。两处都不保存（取消 / “不保存”），存储不变。
import { join } from "node:path";
import { openOptions, showTab } from "./optpage.mjs";
import { msgIn } from "../i18n.mjs";
import { audit, auditProblems, lineCount, lineProblems, waitPage, shoot, htmlLang, SHOT_DIR } from "./i18n-audit.mjs";
import { clickEl, clickBackdrop } from "./v07-dialogs.mjs";
import { activate } from "./guided.mjs";

const J = JSON.stringify;
const RULE_AUDIT = audit({ scope: "#rule-dialog ", items: "button, label, legend, select", box: "#rule-dialog" });
const DISCARD_AUDIT = audit({ scope: "#discard-dialog ", items: "button, h2", box: "#discard-dialog" });
export const DISCARD_BUTTONS = ["#discard-keep", "#discard-drop", "#discard-save"];

async function ruleDialog(ctx, opt, locale) {
  await showTab(opt, "pair");
  await waitPage(opt, `(() => { const d = document.getElementById("rule-dialog"); if (!d.open) document.getElementById("rule-add").click();
    const s = document.getElementById("rule-strip"); if (d.open && !s.checked) s.click();
    return d.open && s.checked && s.checkVisibility()
      && document.querySelector('#rule-dialog [data-i18n="options_rules_strip_label"]').textContent === ${J(msgIn(locale, "options_rules_strip_label"))}; })()`,
  "规则对话框打开、“去掉这些词”勾上");
  await opt.ev(`document.getElementById("rule-strip").scrollIntoView({ block: "center" }); true`);
  const problems = auditProblems(locale, await opt.ev(RULE_AUDIT)).map(p => `规则对话框（去掉这些词）：${p}`);
  const shot = await shoot(ctx, opt, join(SHOT_DIR, `${locale}-rule-dialog-strip.png`));
  await opt.ev(`document.getElementById("rule-dlg-cancel").click(); true`);
  return { problems, shots: [shot] };
}

async function discardDialog(ctx, opt, locale) {
  await showTab(opt, "engines");
  await activate(ctx, opt.targetId);
  await clickEl(ctx, opt, "edit-ec");
  await waitPage(opt, `document.getElementById("engine-dialog").open`, "引擎编辑表单打开");
  await opt.ev(`(() => { const el = document.getElementById("dlg-name"); el.focus(); el.value += " x"; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await clickBackdrop(ctx, opt, "engine-dialog");
  try {
    await waitPage(opt, `document.getElementById("discard-dialog").open && document.documentElement.lang === ${J(htmlLang(locale))}
      && document.getElementById("discard-title").textContent === ${J(msgIn(locale, "options_discard_title"))}`, "保存确认按该语言打开");
    const problems = [...auditProblems(locale, await opt.ev(DISCARD_AUDIT)), ...lineProblems(await opt.ev(lineCount(DISCARD_BUTTONS)))]
      .map(p => `保存确认：${p}`);
    const shot = await shoot(ctx, opt, join(SHOT_DIR, `${locale}-discard-dialog.png`));
    return { problems, shots: [shot] };
  } finally {
    // “不保存”：两个对话框都关，存储不变
    await opt.ev(`(() => { if (document.getElementById("discard-dialog").open) document.getElementById("discard-drop").click();
      const d = document.getElementById("engine-dialog"); if (d.open) d.close(); return true; })()`).catch(() => {});
  }
}

// 返回 { problems, shots }；某一块打不开记成问题，不抛出
export async function v07I18nChecks(ctx, locale) {
  const problems = [], shots = [];
  const opt = await openOptions(ctx.browser, { tab: "pair" }).catch(e => { problems.push(`v0.7 设置页：${e.message}`); return null; });
  if (!opt) return { problems, shots };
  try {
    await waitPage(opt, `document.documentElement.lang === ${J(htmlLang(locale))}`, `设置页 lang ${htmlLang(locale)}`)
      .catch(e => problems.push(`v0.7 设置页：${e.message}`));
    for (const [what, fn] of [["规则对话框", ruleDialog], ["保存确认", discardDialog]]) {
      try {
        const r = await fn(ctx, opt, locale);
        problems.push(...r.problems);
        shots.push(...r.shots);
      } catch (e) { problems.push(`${what}：${e.message}`); }
    }
  } finally { await opt.close(); }
  return { problems, shots };
}
