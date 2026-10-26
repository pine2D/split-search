// 设置页“快捷键”一行：显示 cycle-right 当前绑定的组合键，按钮打开 Chrome 的快捷键页（chrome/shortcuts.js，弹窗底部共用）。
import { h, ht } from "./ui.js";
import { currentShortcut, openShortcutsPage } from "../chrome/shortcuts.js";

// 固定 id：重画这一行后设置页据此把焦点还给按钮
export const SHORTCUT_BUTTON_ID = "shortcut-open";

export async function renderShortcut() {
  const shortcut = await currentShortcut();
  const value = shortcut
    ? h("kbd", { class: "shortcut-key" }, shortcut)
    : ht("span", { class: "muted" }, "options_shortcut_unset");
  return h("div", { class: "shortcut-row" },
    h("span", { class: "shortcut-current" }, ht("span", null, "options_shortcut_label"), value),
    ht("button", { type: "button", id: SHORTCUT_BUTTON_ID, class: "btn btn-small", onclick: openShortcutsPage }, "options_shortcut_open"));
}
