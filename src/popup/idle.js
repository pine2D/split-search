// 弹窗的静态部分与分屏外状态：左右窗格（ui/panes.js 建）、分屏外的默认组合缩小版、底部的快捷键状态。
// 引擎名是用户数据，一律写 textContent；带 key 的文字写 data-i18n，切换语言时 applyI18n 重写。
import { pane, panes } from "../ui/panes.js";
import { engineById } from "../lib/engines.js";
import { t } from "../chrome/i18n.js";
import { currentShortcut, openShortcutsPage } from "../chrome/shortcuts.js";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, key = null) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) node.setAttribute(k, v);
  if (key) {
    node.setAttribute("data-i18n", key);
    node.textContent = t(key);
  }
  return node;
}

// 本扩展一对的左右窗格：dt/dd 的 id 由 popup.js 写入（行标签按搜索对 / 查询对换 key）。只建一次
export function buildPairPanes() {
  const side = (s) => pane(s, "dl", el("dt", { id: `${s}-label` }, `popup_${s}_label`), el("dd", { id: `${s}-engine` }));
  $("pair-panes").replaceWith(panes(side("left"), side("right")));
}

// 分屏外：一句“怎么试”，再列当前默认组合（缩小的窗格）。cfg 为 null（读配置失败）时只显示那句话
export function showIdle(cfg) {
  $("idle").hidden = false;
  const pair = cfg && cfg.defaultPair.map(id => engineById(cfg, "text", id));
  const ok = !!pair && pair.every(Boolean);
  $("idle-pair").hidden = !ok;
  if (!ok) return;
  const side = (s, engine) => {
    const dd = el("dd");
    dd.textContent = engine.name;
    return pane(s, "dl", el("dt", {}, s === "left" ? "common_left" : "common_right"), dd);
  };
  $("idle-panes").replaceChildren(panes(side("left", pair[0]), side("right", pair[1]), "panes-mini"));
}

export function hideIdle() {
  $("idle").hidden = true;
}

// 底部的快捷键状态（与设置页快捷键区相同做法）：已绑定显示组合键；未绑定显示“设置快捷键”按钮
export async function renderShortcut() {
  const shortcut = await currentShortcut();
  const box = $("shortcut");
  if (shortcut) {
    const kbd = el("kbd", { class: "shortcut-key" });
    kbd.textContent = shortcut;
    box.replaceChildren(el("span", { class: "muted" }, "popup_shortcut_label"), kbd);
  } else {
    const btn = el("button", { type: "button", id: "shortcut-open", class: "link-btn" }, "options_shortcut_open");
    btn.addEventListener("click", openShortcutsPage);
    box.replaceChildren(btn);
  }
}
