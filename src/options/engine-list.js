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
  // 预置引擎的网址是已知的默认值，不显示；用户改过（与预置模板不同）就显示出来
  const showUrl = !isPresetId(e.id) || PRESETS.find(p => p.id === e.id).url !== e.url;

  const tags = [
    !left && ht("span", { class: "tag" }, "engine_tag_right_only"),
    e.id === leftId && ht("span", { class: "tag tag-accent" }, "engine_tag_default_left"),
    e.id === rightId && ht("span", { class: "tag tag-accent" }, "engine_tag_default_right"),
    cfg.cycleExclude.includes(e.id) && ht("span", { class: "tag" }, "engine_tag_no_cycle"),
  ];

  // 状态图标在文字之外（--ok 与主色同属绿色系，不能只靠颜色区分）；文字在 data-i18n 的 span 里，切换语言时只重写它
  // 只有默认组合的左侧必须授权：警示样式；其余没授权的引擎用中性样式（空心圆 + 灰字），不抢眼
  const required = e.id === leftId;
  const status = h("span", { class: "perm " + (isGranted ? "perm-ok" : required ? "perm-missing" : "perm-optional") },
    icon(isGranted ? "check-circle" : required ? "alert-circle" : "circle", { size: 14 }),
    ht("span", null, isGranted ? "engine_granted" : required ? "engine_not_granted_required" : "engine_not_granted_optional"));
  const auth = isGranted ? null : authButton([e], ["engine_grant"], {
    cls: "btn btn-small" + (attention.has(e.id) || e.id === leftId ? " btn-attention" : ""),
    onDone: ctx.refresh,
  });

  // 隐藏 / 删除在编辑对话框里（openEngineDialog）；轮换开关在快捷键卡（shortcut.js），行上只留“不参与轮换”标签。
  // ↑↓ 在单独的 .row-move 里：.row-actions 只有“编辑”，删除后焦点交给相邻行的“编辑”（actions.js 的 deleteWithFocus）。
  // 编辑按钮的 id 让重渲染后焦点能回到它（对话框保存、撤销隐藏后，options.js 的 render）
  return h("li", { class: "engine-row" + (inPair ? " in-pair" : ""), "data-id": e.id },
    h("div", { class: "engine-main" },
      h("div", { class: "engine-title" },
        h("strong", { class: "engine-name" }, e.name),
        tags),
      showUrl && h("div", { class: "engine-url mono" }, e.url),
      e.leftDiscouraged && ht("div", { class: "hint hint-warn" }, "engine_left_discouraged_hint")),
    h("div", { class: "engine-side" },
      h("div", { class: "perm-line" }, status, auth),
      h("div", { class: "row-move" },
        h("button", { type: "button", class: "btn btn-small btn-icon", disabled: index === 0,
          title: t("engine_move_up"), "aria-label": t("engine_move_up_label", e.name), "data-move": "up",
          onclick: () => actions.move(e.id, -1) }, icon("arrow-up")),
        h("button", { type: "button", class: "btn btn-small btn-icon", disabled: index === total - 1,
          title: t("engine_move_down"), "aria-label": t("engine_move_down_label", e.name), "data-move": "down",
          onclick: () => actions.move(e.id, 1) }, icon("arrow-down"))),
      h("div", { class: "row-actions" },
        ht("button", { type: "button", id: `edit-${e.id}`, class: "btn btn-small", "aria-label": t("engine_edit_label", e.name),
          onclick: () => openEngineDialog("edit", e) }, "engine_edit"))));
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

let dialogState = null; // { mode, id, engine（新增时为 null）, idEdited }
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
  setupDangerZone(dlg, actions);
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
  dialogState = { mode, id: engine?.id ?? null, engine: mode === "edit" ? engine : null, idEdited: false };
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
  showDangerZone(isEdit ? engine : null, !!preset);
  showTemplateHint(field("url").value);
  dlg.showModal();
  field("name").focus();
}

// 底栏左边的危险区：预置引擎只显示“隐藏”，自定义引擎只显示“删除”。两个是静态按钮：confirmStep 包装时就定死了文字的 key。
// 隐藏随时能恢复，不确认（提示里带“撤销”）；删除要点两次（ui.js 的 confirmStep），第一次点击经 #notices 播报。
// 按钮的处理函数从 dialogState.engine 取当前引擎；新增模式下它是 null，危险区整个藏起来，处理函数也直接返回
function setupDangerZone(dlg, actions) {
  const hide = field("hide");
  hide.addEventListener("click", () => {
    const e = dialogState?.engine;
    if (!e || hide.getAttribute("aria-disabled") === "true") return;
    dlg.close();
    actions.hide(e);
  });
  confirmStep(field("delete"), "engine_delete", "engine_delete_confirm", () => {
    const e = dialogState?.engine;
    if (!e) return;
    dlg.close();
    actions.remove(e);
  }, { armNotice: () => t("engine_delete_confirm_hint", dialogState?.engine?.name ?? "") });
}

// 默认组合在用的引擎：按钮照常显示、能拿到焦点，但 aria-disabled（读屏读“不可用”），下方可见原因写明出路，
// 经 aria-describedby 关联。点击由 setupDangerZone 与 confirmStep 拦下；对话框开着时别的页面改了默认组合，
// 按钮状态可能过期，edits.js 的 hideEngine / deleteEngine 仍会拒绝并提示原因
function showDangerZone(engine, preset) {
  const [hide, del, reason] = [field("hide"), field("delete"), field("remove-reason")];
  const target = engine ? (preset ? hide : del) : null;
  field("danger").hidden = !target;
  for (const b of [hide, del]) {
    b.hidden = b !== target;
    b.removeAttribute("aria-disabled");
    b.removeAttribute("aria-describedby");
  }
  const inPair = !!target && (currentCfg()?.defaultPair ?? []).includes(engine.id);
  reason.hidden = !inPair;
  if (!inPair) return clearI18nText(reason);
  target.setAttribute("aria-disabled", "true");
  target.setAttribute("aria-describedby", "dlg-remove-reason");
  setI18nText(reason, preset ? "engine_in_pair_hide" : "engine_in_pair_delete");
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
