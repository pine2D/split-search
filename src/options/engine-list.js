// 引擎列表、已隐藏的预置引擎、新增 / 编辑对话框。
import { h, ht, authButton, clearFieldErrors, showFieldErrors } from "./ui.js";
import { canBeLeft, describeTemplate, isPresetId } from "./edits.js";
import { PRESETS } from "../lib/engines.js";
import { t, setI18nText } from "../chrome/i18n.js";

// ctx: { cfg, granted: Map<id, boolean>, attention: Set<id>, actions, refresh }
export function renderEngineList(ctx) {
  const { cfg } = ctx;
  const ids = cfg.engines.map(e => e.id);
  const list = h("ol", { class: "engine-list" });
  cfg.engines.forEach((e, i) => list.append(engineRow(e, i, ids.length, ctx)));
  if (!ids.length) list.append(ht("li", { class: "empty" }, "engine_list_empty"));
  return list;
}

function engineRow(e, index, total, ctx) {
  const { cfg, granted, attention, actions } = ctx;
  const [leftId, rightId] = cfg.defaultPair;
  const left = canBeLeft(e);
  const isGranted = granted.get(e.id) === true;
  const inPair = e.id === leftId || e.id === rightId;
  const preset = isPresetId(e.id);

  const tags = [
    left ? ht("span", { class: "tag tag-ok" }, "engine_tag_left_ok") : ht("span", { class: "tag" }, "engine_tag_right_only"),
    e.id === leftId && ht("span", { class: "tag tag-accent" }, "engine_tag_default_left"),
    e.id === rightId && ht("span", { class: "tag tag-accent" }, "engine_tag_default_right"),
    !preset && ht("span", { class: "tag" }, "engine_tag_custom"),
  ];

  const status = isGranted
    ? ht("span", { class: "perm perm-ok" }, "engine_granted")
    : ht("span", { class: "perm perm-missing" }, e.id === leftId ? "engine_not_granted_required" : "engine_not_granted");
  const auth = isGranted ? null : authButton([e], ["engine_grant"], {
    cls: "btn btn-small" + (attention.has(e.id) || e.id === leftId ? " btn-attention" : ""),
    onDone: ctx.refresh,
  });

  const blockTitle = inPair ? t("engine_in_pair_title") : null;
  const removeBtn = preset
    ? ht("button", { type: "button", class: "btn btn-small", disabled: inPair, title: blockTitle,
        onclick: () => actions.hide(e) }, "engine_hide")
    : ht("button", { type: "button", class: "btn btn-small btn-danger", disabled: inPair, title: blockTitle,
        onclick: () => actions.remove(e) }, "engine_delete");

  // id 让重渲染后焦点能回到这个开关（options.js 的 render）
  const cycle = h("input", { type: "checkbox", id: `cycle-${e.id}`, "aria-label": t("engine_cycle_aria", e.name) });
  cycle.checked = !cfg.cycleExclude.includes(e.id);
  cycle.addEventListener("change", () => actions.setCycle(e.id, cycle.checked));

  return h("li", { class: "engine-row" + (inPair ? " in-pair" : "") },
    h("div", { class: "engine-main" },
      h("div", { class: "engine-title" },
        h("strong", { class: "engine-name" }, e.name),
        h("code", { class: "engine-id" }, e.id),
        tags),
      h("div", { class: "engine-url mono" }, e.url),
      e.leftDiscouraged && ht("div", { class: "hint hint-warn" }, "engine_left_discouraged_hint"),
      h("label", { class: "check-row cycle-row" }, cycle, ht("span", null, "engine_cycle_label"))),
    h("div", { class: "engine-side" },
      h("div", { class: "perm-line" }, status, auth),
      h("div", { class: "row-actions" },
        h("button", { type: "button", class: "btn btn-small btn-icon", disabled: index === 0,
          title: t("engine_move_up"), "aria-label": t("engine_move_up_label", e.name),
          onclick: () => actions.move(e.id, -1) }, "↑"),
        h("button", { type: "button", class: "btn btn-small btn-icon", disabled: index === total - 1,
          title: t("engine_move_down"), "aria-label": t("engine_move_down_label", e.name),
          onclick: () => actions.move(e.id, 1) }, "↓"),
        ht("button", { type: "button", class: "btn btn-small", onclick: () => openEngineDialog("edit", e) },
          "engine_edit"),
        removeBtn)));
}

export function renderHiddenList(ctx) {
  const { cfg, actions } = ctx;
  if (!cfg.hidden.length) return ht("p", { class: "muted" }, "engine_hidden_empty");
  return h("ul", { class: "hidden-list" }, cfg.hidden.map(e =>
    h("li", { class: "hidden-row" },
      h("span", null, h("strong", null, e.name), " ", h("code", { class: "engine-id" }, e.id)),
      ht("button", { type: "button", class: "btn btn-small", onclick: () => actions.restore(e) }, "engine_restore"))));
}

// key: "engine_confirm_hide" | "engine_confirm_delete"，都是带引擎名和网站搜索提示的完整句子
export function confirmRemoval(key, e) {
  return confirm(t(key, e.name));
}

// ---- 新增 / 编辑对话框（静态 DOM，不随列表重渲染，编辑中的内容不会丢） ----

let dialogState = null; // { mode, id }
const field = (name) => document.getElementById(`dlg-${name}`);

export function setupEngineDialog(actions) {
  const dlg = document.getElementById("engine-dialog");
  const form = document.getElementById("engine-form");
  field("url").addEventListener("input", () => showTemplateHint(field("url").value));
  document.getElementById("dlg-cancel").addEventListener("click", () => dlg.close());
  document.getElementById("add-engine").addEventListener("click", () => openEngineDialog("add", null));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!dialogState) return;
    clearFieldErrors(form);
    const input = {
      id: field("id").value,
      name: field("name").value,
      url: field("url").value,
    };
    const save = document.getElementById("dlg-save");
    save.disabled = true;
    try {
      const result = dialogState.mode === "add"
        ? await actions.add(input)
        : await actions.edit(dialogState.id, input);
      if (result.ok) dlg.close();
      else showFieldErrors(form, result.errors, field);
    } catch (err) {
      showFieldErrors(form, { form: err }, field);
    } finally {
      save.disabled = false;
    }
  });
}

export function openEngineDialog(mode, engine) {
  const dlg = document.getElementById("engine-dialog");
  const form = document.getElementById("engine-form");
  dialogState = { mode, id: engine?.id ?? null };
  clearFieldErrors(form);
  const isEdit = mode === "edit";
  // 按模式写不同 key：切换语言时 applyI18n 按当前 key 和参数重写，不会改回“新增”或丢引擎名
  if (isEdit) setI18nText(document.getElementById("dlg-title"), "options_dlg_title_edit", engine.name);
  else setI18nText(document.getElementById("dlg-title"), "options_dlg_title_add");
  field("id").value = isEdit ? engine.id : "";
  field("id").readOnly = isEdit;
  field("name").value = isEdit ? engine.name : "";
  field("url").value = isEdit ? engine.url : "";
  setI18nText(document.getElementById("dlg-id-hint"), isEdit ? "options_dlg_id_hint_edit" : "options_dlg_id_hint_add");
  const preset = isEdit ? PRESETS.find(p => p.id === engine.id) : null;
  const presetHint = document.getElementById("dlg-preset-hint");
  presetHint.hidden = !preset;
  if (preset) setI18nText(presetHint, "options_dlg_preset_hint", preset.name, preset.url);
  else clearI18nText(presetHint);
  document.getElementById("dlg-edit-hint").hidden = !isEdit;
  showTemplateHint(field("url").value);
  dlg.showModal();
  field(isEdit ? "name" : "id").focus();
}

function showTemplateHint(url) {
  const el = document.getElementById("dlg-url-status");
  if (!url.trim()) {
    clearI18nText(el);
    el.className = "hint";
    return;
  }
  const d = describeTemplate(url);
  if (d.msg) setI18nText(el, ...d.msg);
  else clearI18nText(el);
  el.className = `hint hint-${d.level}`;
}

function clearI18nText(el) {
  el.textContent = "";
  el.removeAttribute("data-i18n");
  el.removeAttribute("data-i18n-args");
}
