// 弹窗的静态部分与分屏外状态：左右窗格（ui/panes.js 建）、分屏外按设置进度分三档的引导（lib/popup-view.js 的 idleView）、
// 默认组合缩小版、底部的快捷键状态。
// 引擎名是用户数据，一律写 textContent；带 key 的文字写 data-i18n，切换语言时 applyI18n 重写。
import { pane, panes } from "../ui/panes.js";
import { engineById, originPattern } from "../lib/engines.js";
import { idleView } from "../lib/popup-view.js";
import { REVEAL_SETUP } from "../lib/messages.js";
import { safeArgs } from "../lib/safe-error.js";
import { t, setI18nText } from "../chrome/i18n.js";
import { currentShortcut, openShortcutsPage } from "../chrome/shortcuts.js";
import { readSetupDone } from "../chrome/setup-store.js";
import { findOptionsTab } from "../chrome/options-page.js"; // 已开的设置页：优先弹窗所在窗口里的，其次第一个

const $ = (id) => document.getElementById(id);
const log = (...args) => console.error("[split-search]", ...safeArgs(args));
const info = (...args) => console.info("[split-search]", ...safeArgs(args));
// 设置页的“开始使用”卡；新开的设置页按 #setup 滚到卡片并把焦点给它（卡片不显示时什么都不做）
const SETUP_PAGE = "options/options.html#setup";

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

// 默认组合左侧引擎的授权（与设置页同一个 originPattern）：读不出来（没有配置、查询抛错）返回 null，按“不知道”处理；
// 模板生成不了精确 origin 的引擎永远授权不了，与设置页一样算没授权
async function leftGranted(cfg) {
  const left = cfg && engineById(cfg, "text", cfg.defaultPair[0]);
  if (!left) return null;
  const pattern = originPattern(left);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch (err) {
    info("popup: checking the left engine's access failed", err);
    return null;
  }
}

// 分屏外显示哪一档要用的两项：{ leftGranted, setupDone }，读不出来的是 null（idleView 按 ready 处理）
export async function readSetupState(cfg) {
  const [granted, setupDone] = await Promise.all([leftGranted(cfg), readSetupDone()]);
  return { leftGranted: granted, setupDone };
}

function createSetup() {
  return Promise.resolve().then(() => chrome.tabs.create({ url: chrome.runtime.getURL(SETUP_PAGE) }))
    .catch((err) => log("popup: opening Get started failed", err));
}

// 有已开的设置页就切过去，再让它自己滚到卡片、焦点给标题（reveal-setup，设置页回复，SW 不回复）；
// 没有、或切换失败，退回新开 options.html#setup。三个调用同步发出、之后才等结果：
// 弹窗所在窗口换了活动标签时 Chrome 会立刻关掉弹窗（实测），逐个 await 的话后面的调用发不出去。
// 不等设置页回复；没有接收者等拒绝只记 info
async function openSetup() {
  let found = null;
  try {
    found = await findOptionsTab();
  } catch (err) {
    info("popup: looking for an open settings page failed", err);
  }
  if (!found) return createSetup();
  const switched = Promise.all([
    chrome.tabs.update(found.tabId, { active: true }),
    chrome.windows.update(found.windowId, { focused: true }),
  ]);
  chrome.runtime.sendMessage({ type: REVEAL_SETUP, tabId: found.tabId })
    .catch((err) => info("popup: asking the settings page to show Get started failed", err));
  try {
    await switched;
  } catch (err) {
    info("popup: switching to the open settings page failed", err);
    return createSetup();
  }
  return undefined;
}

// “完成设置”（setup 档的主按钮）与 try 档“去第 2 步”的入口都打开设置页的“开始使用”卡。只绑一次
export function bindIdle() {
  const open = () => { openSetup().catch((err) => log("popup: opening Get started failed", err)); };
  $("idle-setup-open").addEventListener("click", open);
  $("idle-setup-link").addEventListener("click", open);
}

// 分屏外：按 idleView 的档位显示引导，再列当前默认组合（缩小的窗格）。cfg 为 null（读配置失败）时不显示组合；
// setup 为 null（没读成）按 ready 处理
export function showIdle(cfg, setup) {
  const view = idleView(setup ?? {});
  $("idle").hidden = false;
  $("idle").dataset.tier = view.tier;
  $("not-ours").hidden = !view.notOurs;
  $("idle-setup").hidden = !view.setupButton;
  // regrant 时 leftGranted 一定读到了 false，左侧引擎一定存在；引擎名是用户数据，经占位符写入
  const left = view.regrant && engineById(cfg, "text", cfg.defaultPair[0]);
  if (left) setI18nText($("idle-setup-text"), "popup_setup_regrant", left.name);
  else setI18nText($("idle-setup-text"), "popup_setup_needed");
  $("idle-try").hidden = !view.tryHint;
  $("idle-setup-note").hidden = !view.setupLink;
  document.querySelector("footer").hidden = !view.footer;
  const pair = view.pair && cfg && cfg.defaultPair.map(id => engineById(cfg, "text", id));
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
  document.querySelector("footer").hidden = false;
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
