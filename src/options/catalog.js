// 引擎库对话框：按分类列出条目，每条“名称 + 添加/已添加”。添加后的引擎与目录脱钩，是普通自定义引擎。
import { CATALOG, CATEGORIES, isAdded } from "../lib/engine-catalog.js";
import { h, ht } from "./ui.js";
import { currentLocale, t } from "../chrome/i18n.js";

let actionsRef = null;
let lastCfg = null;
const pending = new Set(); // 正在添加的条目：按钮保持禁用，连点也只发一次添加
let focusEntry = null;     // 刚点过的条目：按钮一禁用焦点就丢了，重建列表后把焦点还给这一行

const dialog = () => document.getElementById("catalog-dialog");

function add(entry, button) {
  if (pending.has(entry.id)) return;
  pending.add(entry.id);
  focusEntry = entry.id;
  button.disabled = true;
  Promise.resolve(actionsRef.addFromCatalog(entry)).finally(() => pending.delete(entry.id));
}

// 按钮的无障碍名称带上引擎名（每行都叫“添加”分不清），并逐字包含看得见的文字
function entryRow(entry, cfg) {
  const added = isAdded(entry, currentLocale(), cfg.engines);
  const button = added
    ? ht("button", { type: "button", class: "btn btn-small", disabled: true, "aria-label": t("catalog_added_aria", entry.name) },
      "catalog_added")
    : ht("button", { type: "button", class: "btn btn-small", disabled: pending.has(entry.id), "aria-label": t("catalog_add_aria", entry.name) },
      "catalog_add");
  if (!added) button.addEventListener("click", () => add(entry, button));
  return h("li", { class: "catalog-row", tabindex: "-1", "data-entry": entry.id },
    h("strong", { class: "catalog-name" }, entry.name),
    button);
}

// 焦点在对话框的某一行里时，返回那一行的条目 id
function focusedEntry(body) {
  const row = document.activeElement?.closest?.("[data-entry]");
  return row && body.contains(row) ? row.dataset.entry : null;
}

function renderBody(cfg) {
  const body = document.getElementById("catalog-body");
  const want = focusEntry ?? focusedEntry(body);
  focusEntry = null;
  body.replaceChildren(...CATEGORIES.flatMap(cat => {
    const rows = CATALOG.filter(e => e.category === cat.id).map(e => entryRow(e, cfg));
    return rows.length ? [ht("h3", null, cat.key), h("ul", { class: "catalog-list" }, rows)] : [];
  }));
  // 重建会丢掉焦点：按钮还能点就回到按钮上（例如添加失败），已添加（禁用）就停在这一行，Tab 从这里继续
  const row = want ? [...body.querySelectorAll("[data-entry]")].find(r => r.dataset.entry === want) : null;
  if (row) {
    const button = row.querySelector("button");
    (button && !button.disabled ? button : row).focus();
  }
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
