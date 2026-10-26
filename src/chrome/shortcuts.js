// 快捷键 cycle-right 的读取与 Chrome 快捷键页：设置页快捷键区和工具栏弹窗底部共用。
// 绑定只能由用户在 chrome://extensions/shortcuts 里设置；manifest 不写 suggested_key（默认不绑定）。
import { safeArgs } from "../lib/safe-error.js";

const COMMAND = "cycle-right";
const SHORTCUTS_URL = "chrome://extensions/shortcuts";
const log = (...args) => console.error("[split-search]", ...safeArgs(args));

// 当前绑定的组合键；没绑定或读不到命令列表时返回 ""（按“未设置”显示），读不到只记日志
export async function currentShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    return commands.find(c => c.name === COMMAND)?.shortcut || "";
  } catch (err) {
    log("failed to read the keyboard shortcut", err);
    return "";
  }
}

// 网页打不开 chrome:// 网址，扩展可以用 tabs.create 打开（不需要 tabs 权限）
export function openShortcutsPage() {
  return chrome.tabs.create({ url: SHORTCUTS_URL }).catch(err => log("failed to open the shortcuts page", err));
}
