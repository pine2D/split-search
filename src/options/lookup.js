// 设置页“右键查询”卡片：查词引擎、以图搜图引擎的选择与列表，以及以图搜图的引擎库 / 新增对话框。
// 没有授权按钮，也没有轮换开关（以图搜图引擎不经过 DNR，不进快捷键轮换）。
import { h, ht, option, clearFieldErrors, showFieldErrors, focusedRow, restoreRowFocus } from "./ui.js";
import { IMAGE_PRESET, IMAGE_CATALOG } from "../lib/image-engines.js";
import { engineById, engineOrigin } from "../lib/engines.js";
import { t } from "../chrome/i18n.js";

const FOLLOW = "";
const $ = (id) => document.getElementById(id);

function originOf(engine) {
  try { return engineOrigin(engine); } catch { return engine.url; }
}

// cfg.lookupFollow：存储里没有可用的 lookupEngine，正在跟随默认组合的右侧（mergeConfig 给出）
function lookupSelect(cfg, actions) {
  const rightName = engineById(cfg, "text", cfg.defaultPair[1])?.name ?? "";
  const select = h("select", { id: "lookup-engine" },
    option(FOLLOW, t("options_lookup_follow", rightName), cfg.lookupFollow),
    cfg.engines.map(e => option(e.id, e.name, !cfg.lookupFollow && e.id === cfg.lookupEngine)));
  select.addEventListener("change", () => actions.setLookupEngine(select.value === FOLLOW ? null : select.value));
  return select;
}

function imageSelect(cfg, actions) {
  const select = h("select", { id: "image-engine" },
    cfg.imageEngines.map(e => option(e.id, e.name, e.id === cfg.imageEngine)));
  select.addEventListener("change", () => actions.setImageEngine(select.value));
  return select;
}

function imageRow(e, actions) {
  const builtin = e.id === IMAGE_PRESET.id;
  return h("li", { class: "engine-row" },
    h("div", { class: "engine-main" },
      h("div", { class: "engine-title" }, h("strong", { class: "engine-name" }, e.name), h("code", { class: "engine-id" }, e.id)),
      h("div", { class: "engine-url mono" }, originOf(e))),
    !builtin && h("div", { class: "engine-side" },
      ht("button", { type: "button", class: "btn btn-small btn-danger", onclick: () => actions.deleteImageEngine(e) }, "engine_delete")));
}

export function renderLookupCard(cfg, actions) {
  return h("div", { class: "lookup-card" },
    ht("p", { class: "hint" }, "options_lookup_intro"),
    h("div", { class: "pair-pickers" },
      h("label", null, ht("span", null, "options_lookup_engine_label"), lookupSelect(cfg, actions)),
      h("label", null, ht("span", null, "options_image_engine_label"), imageSelect(cfg, actions))),
    h("ul", { class: "engine-list" }, cfg.imageEngines.map(e => imageRow(e, actions))),
    h("div", { class: "section-actions lookup-actions" },
      ht("button", { type: "button", id: "image-catalog-open", class: "btn btn-small" }, "options_image_add_catalog"),
      ht("button", { type: "button", id: "image-add-open", class: "btn btn-small" }, "options_image_add_custom")),
    h("ul", { class: "caveats" },
      ht("li", null, "options_image_note_embedded"),
      ht("li", null, "options_image_note_login"),
      ht("li", null, "options_lookup_privacy")));
}

// ---- 以图搜图引擎库对话框 ----

let lastCfg = null;
const pending = new Set(); // 正在添加的条目：按钮保持禁用，连点也只发一次添加
let focusEntry = null;     // 刚点过的条目：按钮一禁用焦点就丢了，重建列表后把焦点还给这一行（同 catalog.js）

function catalogRow(entry, cfg, actions) {
  const added = cfg.imageEngines.some(e => e.url === entry.url);
  const aria = t(added ? "catalog_added_aria" : "catalog_add_aria", entry.name);
  const button = ht("button", { type: "button", class: "btn btn-small", disabled: added || pending.has(entry.id), "aria-label": aria },
    added ? "catalog_added" : "catalog_add");
  button.addEventListener("click", () => {
    if (pending.has(entry.id)) return;
    pending.add(entry.id);
    focusEntry = entry.id;
    button.disabled = true;
    Promise.resolve(actions.addImageFromCatalog(entry)).finally(() => pending.delete(entry.id));
  });
  return h("li", { class: "catalog-row", tabindex: "-1", "data-entry": entry.id },
    h("strong", { class: "catalog-name" }, entry.name), button);
}

let actionsRef = null;
function renderCatalogBody() {
  if (!lastCfg || !actionsRef) return;
  const body = $("image-catalog-body");
  const want = focusEntry ?? focusedRow(body);
  focusEntry = null;
  body.replaceChildren(
    h("ul", { class: "catalog-list" }, IMAGE_CATALOG.map(e => catalogRow(e, lastCfg, actionsRef))));
  restoreRowFocus(body, want);
}

// 每次渲染后调用：对话框开着就按最新配置刷新“添加 / 已添加”
export function refreshImageCatalog(cfg) {
  lastCfg = cfg;
  if ($("image-catalog-dialog")?.open) renderCatalogBody();
}

// ---- 新增对话框 ----

export function setupLookupDialogs(actions) {
  actionsRef = actions;
  const catalog = $("image-catalog-dialog");
  const dlg = $("image-dialog");
  const form = $("image-form");
  // 按钮在卡片里，卡片每次渲染都重建：监听挂在不会重建的卡片容器上
  $("lookup-body").addEventListener("click", (ev) => {
    const id = ev.target.closest?.("button")?.id;
    if (id === "image-catalog-open") { renderCatalogBody(); if (!catalog.open) catalog.showModal(); }
    else if (id === "image-add-open") { form.reset(); clearFieldErrors(form); dlg.showModal(); form.elements.name.focus(); }
  });
  $("image-catalog-close").addEventListener("click", () => catalog.close());
  $("image-cancel").addEventListener("click", () => dlg.close());
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearFieldErrors(form);
    const save = $("image-save");
    save.disabled = true;
    try {
      const result = await actions.addImageEngine({ name: form.elements.name.value, url: form.elements.url.value });
      if (result.ok) dlg.close();
      else showFieldErrors(form, result.errors);
    } catch (err) {
      showFieldErrors(form, { form: err });
    } finally {
      save.disabled = false;
    }
  });
}
