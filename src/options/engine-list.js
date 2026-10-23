// 引擎列表、已隐藏的预置引擎、新增 / 编辑对话框。
import { h, authButton, notify } from "./ui.js";
import { canBeLeft, describeTemplate, isPresetId } from "./edits.js";
import { PRESETS } from "../lib/engines.js";

const SITE_SEARCH_HINT =
  "如果 Chrome 里有以它为左侧的网站搜索，请到 chrome://settings/searchEngines 一并删除，否则那条网站搜索会退化为普通搜索。";

// ctx: { cfg, granted: Map<id, boolean>, attention: Set<id>, actions, refresh }
export function renderEngineList(ctx) {
  const { cfg } = ctx;
  const ids = cfg.engines.map(e => e.id);
  const list = h("ol", { class: "engine-list" });
  cfg.engines.forEach((e, i) => list.append(engineRow(e, i, ids.length, ctx)));
  if (!ids.length) list.append(h("li", { class: "empty" }, "没有可用的引擎"));
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
    left ? h("span", { class: "tag tag-ok" }, "可作左侧") : h("span", { class: "tag" }, "仅右侧"),
    e.id === leftId && h("span", { class: "tag tag-accent" }, "默认左侧"),
    e.id === rightId && h("span", { class: "tag tag-accent" }, "默认右侧"),
    !preset && h("span", { class: "tag" }, "自定义"),
  ];

  const status = isGranted
    ? h("span", { class: "perm perm-ok" }, "已授权")
    : h("span", { class: "perm perm-missing" }, e.id === leftId ? "未授权（必需）" : "未授权");
  const auth = isGranted ? null : authButton([e], "授权", {
    cls: "btn btn-small" + (attention.has(e.id) || e.id === leftId ? " btn-attention" : ""),
    onDone: ctx.refresh,
  });

  const blockTitle = inPair ? "默认组合正在使用这个引擎" : null;
  const removeBtn = preset
    ? h("button", { type: "button", class: "btn btn-small", disabled: inPair, title: blockTitle,
        onclick: () => actions.hide(e) }, "隐藏")
    : h("button", { type: "button", class: "btn btn-small btn-danger", disabled: inPair, title: blockTitle,
        onclick: () => actions.remove(e) }, "删除");

  return h("li", { class: "engine-row" + (inPair ? " in-pair" : "") },
    h("div", { class: "engine-main" },
      h("div", { class: "engine-title" },
        h("strong", { class: "engine-name" }, e.name),
        h("code", { class: "engine-id" }, e.id),
        tags),
      h("div", { class: "engine-url mono" }, e.url),
      e.leftDiscouraged && h("div", { class: "hint hint-warn" },
        "建议仅作右侧：该站点的 Service Worker 可能接管导航，作左侧时分屏可能不触发。")),
    h("div", { class: "engine-side" },
      h("div", { class: "perm-line" }, status, auth),
      h("div", { class: "row-actions" },
        h("button", { type: "button", class: "btn btn-small btn-icon", disabled: index === 0,
          title: "上移", "aria-label": `上移 ${e.name}`, onclick: () => actions.move(e.id, -1) }, "↑"),
        h("button", { type: "button", class: "btn btn-small btn-icon", disabled: index === total - 1,
          title: "下移", "aria-label": `下移 ${e.name}`, onclick: () => actions.move(e.id, 1) }, "↓"),
        h("button", { type: "button", class: "btn btn-small", onclick: () => openEngineDialog("edit", e) },
          "编辑"),
        removeBtn)));
}

export function renderHiddenList(ctx) {
  const { cfg, actions } = ctx;
  if (!cfg.hidden.length) return h("p", { class: "muted" }, "没有隐藏的预置引擎。");
  return h("ul", { class: "hidden-list" }, cfg.hidden.map(e =>
    h("li", { class: "hidden-row" },
      h("span", null, h("strong", null, e.name), " ", h("code", { class: "engine-id" }, e.id)),
      h("button", { type: "button", class: "btn btn-small", onclick: () => actions.restore(e) }, "恢复"))));
}

export function confirmRemoval(e, verb) {
  return confirm(`${verb}“${e.name}”？\n\n${SITE_SEARCH_HINT}`);
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
    clearErrors(form);
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
      else showErrors(form, result.errors);
    } catch (err) {
      showErrors(form, { form: err?.message || String(err) });
    } finally {
      save.disabled = false;
    }
  });
}

export function openEngineDialog(mode, engine) {
  const dlg = document.getElementById("engine-dialog");
  const form = document.getElementById("engine-form");
  dialogState = { mode, id: engine?.id ?? null };
  clearErrors(form);
  const isEdit = mode === "edit";
  document.getElementById("dlg-title").textContent = isEdit ? `编辑引擎：${engine.name}` : "新增引擎";
  field("id").value = isEdit ? engine.id : "";
  field("id").readOnly = isEdit;
  field("name").value = isEdit ? engine.name : "";
  field("url").value = isEdit ? engine.url : "";
  document.getElementById("dlg-id-hint").textContent = isEdit
    ? "id 创建后不能修改（它写在已保存的网站搜索网址里）。"
    : "小写字母、数字和 -，1–20 个字符。创建后不能修改，会写进触发网址。";
  const preset = isEdit ? PRESETS.find(p => p.id === engine.id) : null;
  const presetHint = document.getElementById("dlg-preset-hint");
  presetHint.hidden = !preset;
  presetHint.textContent = preset ? `预置值：${preset.name}，${preset.url}（改回这两个值即恢复预置）` : "";
  document.getElementById("dlg-edit-hint").hidden = !isEdit;
  showTemplateHint(field("url").value);
  dlg.showModal();
  field(isEdit ? "name" : "id").focus();
}

function showTemplateHint(url) {
  const el = document.getElementById("dlg-url-status");
  if (!url.trim()) {
    el.textContent = "";
    el.className = "hint";
    return;
  }
  const d = describeTemplate(url);
  el.textContent = d.text;
  el.className = `hint hint-${d.level}`;
}

function clearErrors(form) {
  for (const el of form.querySelectorAll(".field-error")) {
    el.textContent = "";
    el.hidden = true;
  }
  for (const el of form.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
}

function showErrors(form, errors) {
  let first = null;
  for (const [name, msg] of Object.entries(errors || {})) {
    const el = form.querySelector(`.field-error[data-for="${name}"]`);
    if (!el) {
      notify(msg, "error");
      continue;
    }
    el.textContent = msg;
    el.hidden = false;
    const input = field(name);
    if (input) {
      input.setAttribute("aria-invalid", "true");
      first ??= input;
    }
  }
  first?.focus();
}
