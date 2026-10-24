import { mergeConfig } from "../lib/engines.js";

const MAX_ITEM_BYTES = 8192; // chrome.storage.sync 单项上限（键名 + JSON 值）
const defaultArea = () => globalThis.chrome?.storage.sync;

export async function loadRaw(area = defaultArea()) {
  return area.get(null);
}

export async function loadConfig(area = defaultArea()) {
  return mergeConfig(await loadRaw(area));
}

// 只写 patch 中的顶层键；先检查全部键，任一超限则不写入。
export async function saveKeys(patch, area = defaultArea()) {
  const enc = new TextEncoder();
  for (const [key, value] of Object.entries(patch)) {
    if (enc.encode(key + JSON.stringify(value)).length > MAX_ITEM_BYTES) {
      throw new Error(`配置过大，无法保存：${key}`);
    }
  }
  await area.set(patch);
}
