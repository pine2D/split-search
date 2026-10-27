// I18N 步骤（i18n.mjs）在每种语言下调用的 v0.5 检查：设置页“按关键词换右侧”规则区（展开、几种行）与规则对话框的两种单选状态，
// 以及带规则标记的工具栏弹窗（#rule-note，经 withRulePopup）。沿用 i18n-audit.mjs 的自查（lang、原样 key、溢出）与截图；
// “换回”按钮要求一行。截图存 .e2e/i18n/<语言>-options-rules.png、<语言>-popup-rule.png。rightRules 由 guarded 写回。
import { join } from "node:path";
import { guarded, openOptions } from "./optpage.mjs";
import { withRulePopup, engineName } from "./v05-lib.mjs";
import { msgIn } from "../i18n.mjs";
import { audit, auditProblems, lineCount, lineProblems, waitPage, shoot, bodyClip, htmlLang, SHOT_DIR } from "./i18n-audit.mjs";

const J = JSON.stringify;

// 几种行：普通、keep、被挡住（百科全书被 r1 的“百科”挡住，右侧等于默认右侧）、引擎已删除（暂不生效）
const SAMPLE_RULES = [
  { id: "r1", when: "words", words: ["wiki", "百科"], engine: "ec" },
  { id: "r2", when: "script", script: "han", keep: true },
  { id: "r3", when: "words", words: ["百科全书"], engine: "eb" },
  { id: "r4", when: "words", words: ["gone"], engine: "zz-gone" },
];
const BOX = `[...document.querySelectorAll("#pair-body details.disclosure")].find(d => d.querySelector('summary [data-i18n="options_rules_summary"]'))`;
const AREA_AUDIT = audit({ scope: "#pair-body ", items: "button, label, summary", box: "#pair-body" });
const DIALOG_AUDIT = audit({ scope: "#rule-dialog ", items: "button, label, legend, select", box: "#rule-dialog" });

// 默认组合卡在文档里的矩形（先滚到可视区）
const cardClip = page => page.ev(`(() => { const el = document.getElementById("pair-body").closest("section"); el.scrollIntoView({ block: "start" });
  const r = el.getBoundingClientRect();
  return { x: Math.floor(r.x + scrollX), y: Math.floor(r.y + scrollY), width: Math.ceil(r.width), height: Math.ceil(r.height), scale: 1 }; })()`);

const rulesArea = (ctx, locale) => guarded(ctx, ["rightRules"], async () => {
  await ctx.ext.eval(`chrome.storage.sync.set({ rightRules: ${J(SAMPLE_RULES)} }).then(() => true)`);
  const opt = await openOptions(ctx.browser);
  try {
    await waitPage(opt, `document.documentElement.lang === ${J(htmlLang(locale))} && (() => { const d = ${BOX};
      return !!d && d.querySelector("summary").textContent.trim() === ${J(msgIn(locale, "options_rules_summary", SAMPLE_RULES.length))}
        && document.querySelectorAll("#rule-list > li[data-id]").length === ${SAMPLE_RULES.length}; })()`, `规则区按 ${locale} 渲染出 ${SAMPLE_RULES.length} 条`);
    await opt.ev(`${BOX}.open = true`);
    const problems = auditProblems(locale, await opt.ev(AREA_AUDIT)).map(p => `规则区：${p}`);
    const shots = [await shoot(ctx, opt, join(SHOT_DIR, `${locale}-options-rules.png`), { clip: await cardClip(opt), beyond: true })];
    // 对话框：“这些词”与“某种文字”两种状态各查一次
    for (const [radio, what] of [["rule-when-words", "这些词"], ["rule-when-script", "某种文字"]]) {
      await waitPage(opt, `(() => { const d = document.getElementById("rule-dialog"); if (!d.open) document.getElementById("rule-add").click();
        const r = document.getElementById(${J(radio)}); if (!r.checked) r.click();
        return d.open && document.getElementById("rule-dlg-title").textContent === ${J(msgIn(locale, "options_rules_dialog_add"))}
          && document.getElementById(${J(radio === "rule-when-words" ? "rule-words" : "rule-script")}).checkVisibility(); })()`, `规则对话框（${what}）`);
      problems.push(...auditProblems(locale, await opt.ev(DIALOG_AUDIT)).map(p => `规则对话框（${what}）：${p}`));
    }
    await opt.ev(`document.getElementById("rule-dlg-cancel").click(); true`);
    return { problems, shots };
  } finally { await opt.close(); }
});

const popupRule = (ctx, locale) => withRulePopup(ctx, async page => {
  const want = msgIn(locale, "popup_rule_word", "wiki", engineName(ctx.port, "ec"));
  await waitPage(page, `document.documentElement.lang === ${J(htmlLang(locale))} && document.getElementById("rule-note").checkVisibility()
    && document.getElementById("rule-note-text").textContent === ${J(want)}
    && document.getElementById("rule-revert").textContent === ${J(msgIn(locale, "popup_rule_revert", engineName(ctx.port, "eb")))}`,
  `弹窗显示规则说明（lang ${htmlLang(locale)}）`);
  const problems = [...auditProblems(locale, await page.ev(audit({ box: "body" }))), ...lineProblems(await page.ev(lineCount(["#rule-revert"])))]
    .map(p => `弹窗规则说明：${p}`);
  const shots = [await shoot(ctx, page, join(SHOT_DIR, `${locale}-popup-rule.png`), { clip: await bodyClip(page), beyond: true })];
  return { problems, shots };
});

// 返回 { problems, shots }；某一块打不开记成问题，不抛出。guarded 写回失败时返回 { status, detail }，也记成问题
export async function v05I18nChecks(ctx, locale) {
  const problems = [], shots = [];
  for (const [what, fn] of [["规则区", rulesArea], ["弹窗规则说明", popupRule]]) {
    try {
      const r = await fn(ctx, locale);
      if (r?.status) { problems.push(`${what}：${r.detail}`); continue; }
      problems.push(...r.problems);
      shots.push(...r.shots);
    } catch (e) { problems.push(`${what}：${e.message}`); }
  }
  return { problems, shots };
}
