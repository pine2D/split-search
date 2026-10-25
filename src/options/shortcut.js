// 设置页“快捷键”一行：显示 cycle-right 当前绑定的组合键，按钮打开 Chrome 的快捷键页。
// 绑定只能由用户在 chrome://extensions/shortcuts 里设置；manifest 不写 suggested_key（默认不绑定）。
import { h, ht } from "./ui.js";
import { safeArgs } from "../lib/safe-error.js";

const COMMAND = "cycle-right";
const SHORTCUTS_URL = "chrome://extensions/shortcuts";
const log = (...args) => console.error("[split-search]", ...safeArgs(args));
// 固定 id：重画这一行后设置页据此把焦点还给按钮
export const SHORTCUT_BUTTON_ID = "shortcut-open";

// 读不到命令列表时按“未设置”显示，只记日志
async function currentShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    return commands.find(c => c.name === COMMAND)?.shortcut || "";
  } catch (err) {
    log("failed to read the keyboard shortcut", err);
    return "";
  }
}

export async function renderShortcut() {
  const shortcut = await currentShortcut();
  const value = shortcut
    ? h("kbd", { class: "shortcut-key" }, shortcut)
    : ht("span", { class: "muted" }, "options_shortcut_unset");
  const open = () => chrome.tabs.create({ url: SHORTCUTS_URL }).catch(err => log("failed to open the shortcuts page", err));
  return h("div", { class: "shortcut-row" },
    h("span", { class: "shortcut-current" }, ht("span", null, "options_shortcut_label"), value),
    ht("button", { type: "button", id: SHORTCUT_BUTTON_ID, class: "btn btn-small", onclick: open }, "options_shortcut_open"));
}
