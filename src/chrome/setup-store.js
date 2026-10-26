// “开始使用”卡的存储：storage.local 的布尔值 setupDone，storage.session 的 setupTryTabs（“试一下”打开的标签 id）。
// 判定见 lib/setup-state.js。go.html 写入一对搜索记录后经 noteSetupPair 写 setupDone，设置页只监听它的变化。
// 读写失败一律吞掉、只记 info 级日志：这条路径不能影响分屏流程。
import { countsAsSetup, addTryTab } from "../lib/setup-state.js";
import { safeArgs } from "../lib/safe-error.js";

export const DONE_KEY = "setupDone";
export const TRY_KEY = "setupTryTabs";
const NOTE_TIMEOUT_MS = 500; // go.html 最多为它等这么久，之后照常跳转（跳转会中断还没写完的这一步）

const info = (...args) => console.info("[split-search]", ...safeArgs(args));

// 读不出来返回 null（调用方按“不知道”处理）
export async function readSetupDone() {
  try {
    return (await chrome.storage.local.get(DONE_KEY))[DONE_KEY] === true;
  } catch (err) {
    info("failed to read the setup state", err);
    return null;
  }
}

async function note(tabIds) {
  const setupDone = await readSetupDone();
  if (setupDone !== false) return; // 已完成，或读不出来（不冒险写）
  let tryTabs;
  try {
    tryTabs = (await chrome.storage.session.get(TRY_KEY))[TRY_KEY];
  } catch (err) {
    info("failed to read the setup try tabs", err);
    return; // 读不出“试一下”的标签就不写：宁可晚一次完成，也不把“试一下”算成完成
  }
  if (!countsAsSetup({ setupDone, tryTabs, tabIds })) return;
  try {
    await chrome.storage.local.set({ [DONE_KEY]: true });
  } catch (err) {
    info("failed to save the setup state", err);
  }
}

// go.html 刚写入一对搜索记录：tabIds 是当前标签和这一对的两侧。从不抛错，最多等 NOTE_TIMEOUT_MS
export function noteSetupPair(tabIds, timeoutMs = NOTE_TIMEOUT_MS) {
  const run = note(tabIds).catch(err => info("failed to check the setup state", err));
  let timer;
  const cap = new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); });
  return Promise.race([run, cap]).finally(() => clearTimeout(timer));
}

// 设置页“试一下”：记下它打开的标签 id。失败只记日志（最坏是这次“试一下”被算成完成）
export async function rememberTryTab(tabId) {
  try {
    const list = (await chrome.storage.session.get(TRY_KEY))[TRY_KEY];
    await chrome.storage.session.set({ [TRY_KEY]: addTryTab(list, tabId) });
  } catch (err) {
    info("failed to remember the setup try tab", err);
  }
}
