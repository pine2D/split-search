// 引擎列表、已隐藏的预置引擎、新增 / 编辑对话框。
import { h, ht, authButton, clearFieldErrors, showFieldErrors, confirmStep } from "./ui.js";
import { canBeLeft, describeTemplate, isPresetId } from "./edits.js";
import { PRESETS } from "../lib/engines.js";
import { suggestId, takenIn } from "../lib/engine-id.js";
import { t, setI18nText } from "../chrome/i18n.js";
import { icon } from "../ui/icons.js";

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
  // 预置引擎的网址是已知的默认值，不显示；用户改过（与预置模板不同）就显示出来
  const showUrl = !preset || PRESETS.find(p => p.id === e.id).url !== e.url;

  const tags = [
    !left && ht("span", { class: "tag" }, "engine_tag_right_only"),
    e.id === leftId && ht("span", { class: "tag tag-accent" }, "engine_tag_default_left"),
    e.id === rightId && ht("span", { class: "tag tag-accent" }, "engine_tag_default_right"),
  ];

  // 状态图标在文字之外（--ok 与主色同属绿色系，不能只靠颜色区分）；文字在 data-i18n 的 span 里，切换语言时只重写它
  const status = h("span", { class: "perm " + (isGranted ? "perm-ok" : "perm-missing") },
    icon(isGranted ? "check-circle" : "alert-circle", { size: 14 }),
    isGranted ? ht("span", null, "engine_granted")
      : ht("span", null, e.id === leftId ? "engine_not_granted_required" : "engine_not_granted"));
  const auth = isGranted ? null : authButton([e], ["engine_grant"], {
    cls: "btn btn-small" + (attention.has(e.id) || e.id === leftId ? " btn-attention" : ""),
    onDone: ctx.refresh,
  });

  // 组合在用的引擎不能隐藏 / 删除：原因写成行内小字（按钮禁用后拿不到焦点，悬停提示也不是人人看得到）。
  // id 让重渲染后焦点能回到这个按钮（撤销隐藏后，options.js 的 render）
  const reason = inPair ? ht("p", { class: "hint row-reason", id: `reason-${e.id}` },
    preset ? "engine_in_pair_hide" : "engine_in_pair_delete") : null;
  const removeProps = { type: "button", id: `remove-${e.id}`, disabled: inPair, "aria-describedby": reason ? `reason-${e.id}` : null };
  // 隐藏随时能恢复，不确认（提示里带“撤销”）；删除要点两次（ui.js 的 confirmStep）
  const removeBtn = preset
    ? ht("button", { ...removeProps, class: "btn btn-small", onclick: () => actions.hide(e) }, "engine_hide")
    : confirmStep(ht("button", { ...removeProps, class: "btn btn-small btn-danger" }, "engine_delete"),
      "engine_delete", "engine_delete_confirm", () => actions.remove(e));

  // id 让重渲染后焦点能回到这个开关（options.js 的 render）
  const cycle = h("input", { type: "checkbox", id: `cycle-${e.id}`, "aria-label": t("engine_cycle_aria", e.name) });
  cycle.checked = !cfg.cycleExclude.includes(e.id);
  cycle.addEventListener("change", () => actions.setCycle(e.id, cycle.checked));

  return h("li", { class: "engine-row" + (inPair ? " in-pair" : ""), "data-id": e.id },
    h("div", { class: "engine-main" },
      h("div", { class: "engine-title" },
        h("strong", { class: "engine-name" }, e.name),
        tags),
      showUrl && h("div", { class: "engine-url mono" }, e.url),
      e.leftDiscouraged && ht("div", { class: "hint hint-warn" }, "engine_left_discouraged_hint"),
      h("label", { class: "check-row cycle-row" }, cycle, ht("span", null, "engine_cycle_label"))),
    h("div", { class: "engine-side" },
      h("div", { class: "perm-line" }, status, auth),
      h("div", { class: "row-actions" },
        h("button", { type: "button", class: "btn btn-small btn-icon", disabled: index === 0,
          title: t("engine_move_up"), "aria-label": t("engine_move_up_label", e.name), "data-move": "up",
          onclick: () => actions.move(e.id, -1) }, icon("arrow-up")),
        h("button", { type: "button", class: "btn btn-small btn-icon", disabled: index === total - 1,
          title: t("engine_move_down"), "aria-label": t("engine_move_down_label", e.name), "data-move": "down",
          onclick: () => actions.move(e.id, 1) }, icon("arrow-down")),
        ht("button", { type: "button", class: "btn btn-small", onclick: () => openEngineDialog("edit", e) },
          "engine_edit"),
        removeBtn),
      reason));
}

export function renderHiddenList(ctx) {
  const { cfg, actions } = ctx;
  if (!cfg.hidden.length) return ht("p", { class: "muted" }, "engine_hidden_empty");
  return h("ul", { class: "hidden-list" }, cfg.hidden.map(e =>
    h("li", { class: "hidden-row" },
      h("span", null, h("strong", null, e.name), " ", h("code", { class: "engine-id" }, e.id)),
      ht("button", { type: "button", class: "btn btn-small", onclick: () => actions.restore(e) }, "engine_restore"))));
}

// ---- 新增 / 编辑对话框（静态 DOM，不随列表重渲染，编辑中的内容不会丢） ----
// 字段顺序：名称 → 网址 → “高级”里的 id。新增时 id 按名称自动生成（lib/engine-id.js，名称生成不出就用网址的 host），
// 用户改过 id 之后不再跟随；清空 id 又恢复跟随。编辑时 id 只读显示，不能改。

let dialogState = null; // { mode, id, idEdited }
let currentCfg = () => null;
const field = (name) => document.getElementById(`dlg-${name}`);

function followName() {
  if (dialogState?.mode !== "add" || dialogState.idEdited) return;
  const name = field("name").value.trim();
  const url = field("url").value.trim();
  const cfg = currentCfg();
  field("id").value = (name || url) && cfg ? suggestId(name, url, takenIn(cfg)) : "";
}

// getCfg：设置页最近一次渲染用的配置（算 id 是否已被占用）
export function setupEngineDialog(actions, getCfg) {
  currentCfg = getCfg;
  const dlg = document.getElementById("engine-dialog");
  const form = document.getElementById("engine-form");
  field("name").addEventListener("input", followName);
  field("url").addEventListener("input", () => { showTemplateHint(field("url").value); followName(); });
  field("id").addEventListener("input", () => {
    if (!dialogState) return;
    dialogState.idEdited = field("id").value.trim() !== "";
    if (!dialogState.idEdited) followName();
  });
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
      else {
        // id 的错误在收起的“高级”里：先展开，错误看得见、输入框也能拿到焦点
        if (result.errors?.id) document.getElementById("dlg-advanced").open = true;
        showFieldErrors(form, result.errors, field);
      }
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
  dialogState = { mode, id: engine?.id ?? null, idEdited: false };
  clearFieldErrors(form);
  const isEdit = mode === "edit";
  // 按模式写不同 key：切换语言时 applyI18n 按当前 key 和参数重写，不会改回“新增”或丢引擎名
  if (isEdit) setI18nText(document.getElementById("dlg-title"), "options_dlg_title_edit", engine.name);
  else setI18nText(document.getElementById("dlg-title"), "options_dlg_title_add");
  field("id").value = isEdit ? engine.id : "";
  field("name").value = isEdit ? engine.name : "";
  field("url").value = isEdit ? engine.url : "";
  const advanced = document.getElementById("dlg-advanced");
  advanced.hidden = isEdit;
  advanced.open = false;
  const readonly = document.getElementById("dlg-id-readonly");
  readonly.hidden = !isEdit;
  if (isEdit) setI18nText(readonly, "options_dlg_id_readonly", engine.id);
  else clearI18nText(readonly);
  const preset = isEdit ? PRESETS.find(p => p.id === engine.id) : null;
  const presetHint = document.getElementById("dlg-preset-hint");
  presetHint.hidden = !preset;
  if (preset) setI18nText(presetHint, "options_dlg_preset_hint", preset.name, preset.url);
  else clearI18nText(presetHint);
  document.getElementById("dlg-edit-hint").hidden = !isEdit;
  showTemplateHint(field("url").value);
  dlg.showModal();
  field("name").focus();
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
