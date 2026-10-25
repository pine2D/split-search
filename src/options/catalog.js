// 引擎库对话框：按分类列出条目，每条“名称 + 添加/已添加”。添加后的引擎与目录脱钩，是普通自定义引擎。
import { CATALOG, CATEGORIES, isAdded } from "../lib/engine-catalog.js";
import { h, ht } from "./ui.js";
import { currentLocale } from "../chrome/i18n.js";

let actionsRef = null;
let lastCfg = null;

const dialog = () => document.getElementById("catalog-dialog");

function entryRow(entry, cfg) {
  const added = isAdded(entry, currentLocale(), cfg.engines);
  return h("li", { class: "catalog-row" },
    h("strong", { class: "catalog-name" }, entry.name),
    added
      ? ht("button", { type: "button", class: "btn btn-small", disabled: true }, "catalog_added")
      : ht("button", { type: "button", class: "btn btn-small", onclick: () => actionsRef.addFromCatalog(entry) },
        "catalog_add"));
}

function renderBody(cfg) {
  const body = document.getElementById("catalog-body");
  body.replaceChildren(...CATEGORIES.flatMap(cat => {
    const rows = CATALOG.filter(e => e.category === cat.id).map(e => entryRow(e, cfg));
    return rows.length ? [ht("h3", null, cat.key), h("ul", { class: "catalog-list" }, rows)] : [];
  }));
}

export function setupCatalogDialog(actions) {
  actionsRef = actions;
  document.getElementById("catalog-open").addEventListener("click", () => { if (lastCfg) openCatalogDialog(lastCfg); });
  document.getElementById("catalog-close").addEventListener("click", () => dialog().close());
}

export function openCatalogDialog(cfg) {
  renderBody(cfg);
  if (!dialog().open) dialog().showModal();
}

// 每次渲染后调用：对话框开着就按最新配置刷新“添加/已添加”
export function refreshCatalog(cfg) {
  lastCfg = cfg;
  if (dialog()?.open) renderBody(cfg);
}
