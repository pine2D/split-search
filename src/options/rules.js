// “默认组合”卡里的“按关键词换右侧”：默认收起的规则区（renderRules）和规则对话框（setupRuleDialog）。
// 写入都经 actions（actions.js，串行写入链）；校验、选项、行文字的逻辑在 rule-edits.js。
import { h, ht, disclosure, confirmStep, clearFieldErrors, showFieldErrors } from "./ui.js";
import { engineChoices, targetLabel } from "./rule-edits.js";
import { SCRIPTS, SCRIPT_KEYS, shadowedWords } from "../lib/right-rules.js";
import { t, setI18nText } from "../chrome/i18n.js";
import { icon } from "../ui/icons.js";

const $ = (id) => document.getElementById(id);
const OFF_KEYS = { hidden: "options_rules_off_hidden", missing: "options_rules_off_missing", left: "options_rules_off_left" };

// ---- 规则区 ----

export function renderRules(cfg, actions) {
  const rules = cfg.rightRules;
  const n = rules.length;
  const posOf = new Map(rules.map((r, i) => [r.id, i + 1]));
  const shadows = shadowedWords(rules);
  // 列表不加 aria-labelledby：disclosure() 的 summary 没有 id，列表就在它下面
  const list = n > 0 && h("ol", { id: "rule-list", class: "rule-list" },
    rules.map((rule, i) => ruleRow(cfg, rule, i, n, shadows.filter(s => s.ruleId === rule.id), posOf, actions)));
  return disclosure("rules", n ? ["options_rules_summary", n] : "options_rules_title",
    ht("p", { class: "hint" }, "options_rules_intro"),
    ht("p", { class: "hint" }, "options_rules_privacy"),
    list,
    !n && ht("p", { id: "rule-empty", class: "muted" }, "options_rules_empty"),
    ht("button", { type: "button", id: "rule-add", class: "btn", onclick: () => openRuleDialog(null, "rule-add") }, "options_rules_add"));
}

function ruleRow(cfg, rule, index, total, shadows, posOf, actions) {
  const target = targetLabel(cfg, rule);
  const name = target.engineName ?? t("popup_engine_deleted");
  const cond = rule.when === "words"
    ? ht("span", null, "options_rules_words_row", rule.words.join(t("options_rules_word_sep")))
    : ht("span", null, "options_rules_script_row", t(SCRIPT_KEYS[rule.script]));
  // 暂不生效用图标加文字，不只靠颜色
  const off = rule.off && h("span", { class: "rule-off" }, icon("alert-circle", { size: 14 }),
    rule.off === "missing" ? ht("span", null, OFF_KEYS.missing) : ht("span", null, OFF_KEYS[rule.off], name));
  const shadowNotes = shadows.map(s => (s.word === null
    ? ht("span", { class: "rule-shadow" }, "options_rules_shadowed_rule", posOf.get(s.byRuleId))
    : ht("span", { class: "rule-shadow" }, "options_rules_shadowed", s.word, posOf.get(s.byRuleId))));
  const pos = index + 1;
  // 端点的上移 / 下移是可聚焦的 aria-disabled（不是 disabled）：移到头后焦点留在这个按钮上，点击什么都不做
  const move = (delta) => (ev) => {
    if (ev.currentTarget.getAttribute("aria-disabled") === "true") return;
    actions.moveRule(rule.id, delta);
  };
  return h("li", { class: "rule-row", "data-id": rule.id },
    h("div", { class: "rule-main" },
      h("span", { class: "rule-text" }, cond, " ", ht("span", null, target.key, name)),
      off, shadowNotes),
    h("div", { class: "rule-side" },
      // “编辑”在 .row-actions 里：删除后 deleteWithFocus 把焦点交给相邻行的这个按钮
      h("div", { class: "row-actions" },
        ht("button", { type: "button", id: `rule-edit-${rule.id}`, class: "btn btn-small",
          "aria-label": t("options_rules_edit_aria", pos), onclick: () => openRuleDialog(rule.id, `rule-edit-${rule.id}`) },
        "options_rules_edit")),
      h("div", { class: "row-move" },
        ht("button", { type: "button", id: `rule-up-${rule.id}`, class: "btn btn-small",
          "aria-label": t("options_rules_up_aria", pos), "aria-disabled": index === 0 ? "true" : null, onclick: move(-1) },
        "options_rules_up"),
        ht("button", { type: "button", id: `rule-down-${rule.id}`, class: "btn btn-small",
          "aria-label": t("options_rules_down_aria", pos), "aria-disabled": index === total - 1 ? "true" : null, onclick: move(1) },
        "options_rules_down"))));
}

// ---- 规则对话框（静态 DOM，不随规则区重渲染） ----

let dialogState = null; // { id（新增时为 null）, opener: 触发按钮的 id, done: 保存或删除后由它们自己安排焦点 }
let currentCfg = () => null;

const whenValue = () => ($("rule-when-script").checked ? "script" : "words");

function showWhenFields() {
  const script = whenValue() === "script";
  $("rule-words-field").hidden = script;
  $("rule-script-field").hidden = !script;
}

function fillEngines(cfg, rule) {
  const { options, selected } = engineChoices(cfg, rule);
  $("rule-engine").replaceChildren(...options.map(({ value, label }) =>
    (label.key ? ht("option", { value }, label.key, ...label.args) : h("option", { value }, label.text))));
  $("rule-engine").value = selected;
}

function clearText(el) {
  el.textContent = "";
  el.removeAttribute("data-i18n");
  el.removeAttribute("data-i18n-args");
}

// id：要编辑的规则（按最新配置取），null 表示新增；openerId：关掉后焦点还给它
function openRuleDialog(id, openerId) {
  const cfg = currentCfg();
  if (!cfg) return;
  const rule = id ? cfg.rightRules.find(r => r.id === id) ?? null : null;
  if (id && !rule) return;
  const dlg = $("rule-dialog");
  const form = $("rule-form");
  dialogState = { id: rule?.id ?? null, opener: openerId, done: false };
  clearFieldErrors(form);
  setI18nText($("rule-dlg-title"), rule ? "options_rules_dialog_edit" : "options_rules_dialog_add");
  const script = rule?.when === "script";
  $("rule-when-words").checked = !script;
  $("rule-when-script").checked = script;
  $("rule-words").value = rule?.when === "words" ? rule.words.join(", ") : "";
  $("rule-script").value = script ? rule.script : SCRIPTS[0];
  fillEngines(cfg, rule);
  showWhenFields();
  // 新增时危险区和删除按钮都藏起来，处理函数也按 dialogState.id 直接返回
  $("rule-dlg-danger").hidden = !rule;
  $("rule-dlg-delete").hidden = !rule;
  dlg.showModal();
  (script ? $("rule-when-script") : $("rule-when-words")).focus();
}

// getCfg：设置页最近一次渲染用的配置
export function setupRuleDialog(actions, getCfg) {
  currentCfg = getCfg;
  const dlg = $("rule-dialog");
  const form = $("rule-form");
  $("rule-script").replaceChildren(...SCRIPTS.map(s => ht("option", { value: s }, SCRIPT_KEYS[s])));
  for (const radio of [$("rule-when-words"), $("rule-when-script")]) radio.addEventListener("change", showWhenFields);
  $("rule-dlg-cancel").addEventListener("click", () => dlg.close());
  // Esc、取消关掉时焦点还给触发按钮（规则区可能已重渲染，原来的按钮不在了，按 id 找）
  dlg.addEventListener("close", () => {
    if (dialogState && !dialogState.done) $(dialogState.opener)?.focus();
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!dialogState) return;
    clearFieldErrors(form);
    const input = { when: whenValue(), words: $("rule-words").value, script: $("rule-script").value, engine: $("rule-engine").value };
    const save = $("rule-dlg-save");
    save.disabled = true;
    try {
      const result = dialogState.id ? await actions.editRule(dialogState.id, input) : await actions.addRule(input);
      if (result.ok) {
        dialogState.done = true;
        dlg.close();
        $(`rule-edit-${result.id}`)?.focus(); // actions 已等重渲染完
      } else {
        showFieldErrors(form, result.errors);
      }
    } catch (err) {
      showFieldErrors(form, { form: err });
    } finally {
      save.disabled = false;
    }
  });
  const del = $("rule-dlg-delete"), hint = $("rule-dlg-delete-hint");
  confirmStep(del, "options_rules_delete", "options_rules_delete_confirm", () => {
    const id = dialogState?.id;
    if (!id) return;
    dialogState.done = true;
    dlg.close();
    actions.removeRule(id); // 真的删掉了才提示“规则已删除”（removeNotice），焦点交给相邻行的“编辑”
  }, {
    onArm: () => {
      setI18nText(hint, "options_rules_delete_hint");
      del.setAttribute("aria-describedby", "rule-dlg-delete-hint");
    },
    onReset: () => {
      clearText(hint);
      del.removeAttribute("aria-describedby");
    },
  });
}
