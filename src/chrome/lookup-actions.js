// 右键查询（② 选中文字、⑧ 以图搜图）的执行：在 SW 里运行，对 chrome.tabs / chrome.windows 的薄封装。
// 判定见 lib/lookup-decision.js（spec 3.3 判定表），记录经 split-state.js 写入 storage.session。
// 只读 OnClickData 的 menuItemId、selectionText、editable、mediaType、srcUrl（经 lookupInput），不读 pageUrl、frameUrl。
// 只改写记录确认是本扩展查询结果的那一侧（当前标签是查询对的 page 一侧时的 lookup 标签），用户的页面一律不导航。
// join、other-window、beside-* 与 split-actions.js 的 join、openInOtherWindow、openForeign 相似，有意另写：
// 这里不导航当前标签、记录角色是 page/lookup、新标签的 active 语义不同（ledger P-C16）。
import { lookupInput } from "../lib/lookup-input.js";
import { decideLookup, besideIndex } from "../lib/lookup-decision.js";
import { splitWindowType } from "../lib/window-kind.js";
import { isNarrow } from "../lib/narrow.js";
import { engineById } from "../lib/engines.js";
import { expandTemplate } from "../lib/trigger.js";
import { loadConfig } from "./config-store.js";
import { inspectTab, writePair, clearPair } from "./split-state.js";
import { openRight, confirmedSplitViewId, lastSplitWindow } from "./split-actions.js";

const log = (...args) => console.error("[split-search]", ...args);
// 预期的忽略只记 info 级，只带 reason，不带选中文字、图片网址或任何网址
const ignored = (reason) => {
  console.info("[split-search]", "lookup ignored", reason);
  return { action: "ignore" };
};

// 查询对整对改写：当前标签是 page（engine 为 ""），对侧是 lookup
function writeLookupPair(ctx, peerId, splitViewId, mode) {
  const { tab, engine, query, input } = ctx;
  return writePair({
    a: tab.id, b: peerId, splitViewId, mode, engineA: "", engineB: engine.id, query,
    roleA: "page", roleB: "lookup", input,
  });
}

// 第 8 行：宽窗口与当前标签组成分屏（新标签在后台），窄窗口开相邻标签并激活
function openNewPair(ctx) {
  const { tab, url, narrow, engine, query, input } = ctx;
  return openRight(tab, url, narrow, {
    leftId: "", rightId: engine.id, query, roleA: "page", roleB: "lookup", input, active: narrow,
  });
}

// 第 3、5 行：就地更新查询标签；tabs.update 抛错（查询标签刚被关掉）时退回新建。
// 新建前先清掉这一对的旧记录：旧查询标签万一还在，它的记录不会继续指向当前标签
async function updateLookup(ctx, props, onUpdated) {
  try {
    await chrome.tabs.update(ctx.peer.id, props);
  } catch (err) {
    log("failed to update the lookup tab, opening a new one", err);
    await clearPair(ctx.tab.id);
    await openNewPair(ctx);
    return;
  }
  await onUpdated();
}

// 第 6 行（同 v0.3 的 join）：更新查询标签（抛错同第 5 行退回新建），再按 [左, 右] 拼成分屏，复核一致记 split。
// createSplit 抛错 → 第 5 行（激活查询标签、记 adjacent）；成功但复核两次都不一致 → 清掉这一对的记录，
// 不写 adjacent（两个标签可能已在分屏里，记成相邻对会让它被误判）。
async function joinPair(ctx) {
  const { tab, peer } = ctx;
  await updateLookup(ctx, { url: ctx.url }, async () => {
    const [left, right] = tab.index < peer.index ? [tab.id, peer.id] : [peer.id, tab.id];
    try {
      await chrome.tabs.createSplit([left, right]);
    } catch (err) {
      log("failed to join the lookup pair into a split view, keeping it as an adjacent pair", err);
      try {
        await chrome.tabs.update(peer.id, { active: true });
      } catch (e) {
        log("failed to activate the lookup tab", e);
      }
      await writeLookupPair(ctx, peer.id, -1, "adjacent");
      return;
    }
    const v = await confirmedSplitViewId(left, right);
    if (v === -1) await clearPair(tab.id);
    else await writeLookupPair(ctx, peer.id, v, "split");
  });
}

// 第 2 行：当前窗口不能分屏（popup/app/PiP）。在最后聚焦的能分屏的窗口开普通标签并聚焦它，没有就新建窗口；不写记录
async function openInNormalWindow({ url }) {
  const target = await lastSplitWindow();
  if (!target) {
    await chrome.windows.create({ type: "normal", url });
    return;
  }
  await chrome.tabs.create({ url, windowId: target.id, active: true });
  try {
    await chrome.windows.update(target.id, { focused: true });
  } catch (err) {
    log("lookup: failed to focus the other window", err);
  }
}

// 第 4、7 行：在分屏或相邻对的右边开普通标签（active），不写记录
async function openBeside(action, ctx) {
  const { tab, url } = ctx;
  const index = besideIndex(action, ctx);
  await chrome.tabs.create({ url, index, windowId: tab.windowId, active: true });
}

const RUN = {
  "other-window": openInNormalWindow,
  "reuse-split": (ctx) => updateLookup(ctx, { url: ctx.url },
    () => writeLookupPair(ctx, ctx.peer.id, ctx.splitViewId, "split")),
  "beside-split": (ctx) => openBeside("beside-split", ctx),
  "reuse-adjacent": (ctx) => updateLookup(ctx, { url: ctx.url, active: true },
    () => writeLookupPair(ctx, ctx.peer.id, -1, "adjacent")),
  join: joinPair,
  "beside-pair": (ctx) => openBeside("beside-pair", ctx),
  new: openNewPair,
};

// contextMenus.onClicked 的处理：每次重新读标签、窗口和记录再判定（SW 串行链上调用，见 background.js）。
// 返回 { action }：decideLookup 给出的动作（执行中退回新建等不改它）。API 抛错原样抛出，由调用方记日志。
export async function handleMenuClick(info, tab) {
  const picked = lookupInput(info.menuItemId, info);
  if (!picked.ok) return ignored(picked.reason);
  if (!tab || !Number.isInteger(tab.id) || tab.id < 0) return ignored("no_tab");
  let fresh;
  try {
    fresh = await chrome.tabs.get(tab.id);
  } catch {
    return ignored("tab_gone");
  }
  const cfg = await loadConfig();
  const { input, query } = picked;
  const engine = engineById(cfg, input, input === "image" ? cfg.imageEngine : cfg.lookupEngine);
  const url = expandTemplate(engine.url, query);
  const win = await chrome.windows.get(fresh.windowId, { populate: true });
  // 右键路径传空的引擎列表：兜底不比对对侧网址（spec 3.3）
  const { splitViewId, splitTabs, peer, record, ownership } = await inspectTab(fresh, []);
  const narrow = isNarrow(win.width, cfg.narrowFallback);
  const action = decideLookup({
    hasTab: true, inputOk: true, windowType: splitWindowType(win), splitViewId, ownership,
    role: record?.role, narrow,
  });
  await RUN[action]({ tab: fresh, splitViewId, splitTabs, peer, url, engine, query, input, narrow });
  return { action };
}
