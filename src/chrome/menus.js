// 右键菜单注册（spec 3.6）：每次都 removeAll 后重建两项，挂在自己的串行链上（与 DNR 重建分开）。
import { loadConfig } from "./config-store.js";
import { initI18n, setLocale, t } from "./i18n.js";
import { engineById } from "../lib/engines.js";
import { menuItems } from "../lib/menu-spec.js";
import { serialQueue } from "../lib/serial.js";
import { safeArgs } from "../lib/safe-error.js";

const log = (...args) => console.error("[split-search]", ...safeArgs(args));
const queue = serialQueue();

// 模块 SW 不能用顶层 await：第一次用到时才加载文案并缓存；失败清掉缓存，下次重试
let ready = null;
function ensureI18n() {
  ready ??= initI18n().catch((err) => { ready = null; throw err; });
  return ready;
}

// 等 create 的回调再继续，后一次重建的 removeAll 不会和这次的 create 交错；lastError 只记日志
function create(props) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => {
      const err = chrome.runtime.lastError;
      if (err) log("contextMenus.create failed", props.id, err);
      resolve();
    });
  });
}

async function doRebuild() {
  try {
    await ensureI18n();
    const cfg = await loadConfig();
    await setLocale(cfg.uiLocale);
    const items = menuItems({
      textEngine: engineById(cfg, "text", cfg.lookupEngine),
      imageEngine: engineById(cfg, "image", cfg.imageEngine),
    }, t);
    await chrome.contextMenus.removeAll();
    for (const props of items) await create(props);
  } catch (err) {
    log("rebuildMenus failed", err);
  }
}

// 任何一步失败只记日志，不抛
export function rebuildMenus() {
  return queue(doRebuild);
}
