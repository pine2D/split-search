// 设置页编排：读配置 → 实时查授权 → 渲染各区块；所有写入串行执行“loadRaw → 改整键 → saveKeys”。
import { loadRaw } from "../chrome/config-store.js";
import { mergeConfig } from "../lib/engines.js";
import { h, ht, notify, errorText, authButton, option, isGranted } from "./ui.js";
import { setDefaultPair, canBeLeft, setNarrowFallback } from "./edits.js";
import { write, act, actions, attention, bindActions, getPendingOrder } from "./actions.js";
import { renderLookupCard, setupLookupDialogs, refreshImageCatalog } from "./lookup.js";
import { renderEngineList, renderHiddenList, setupEngineDialog } from "./engine-list.js";
import { setupCatalogDialog, refreshCatalog } from "./catalog.js";
import { renderShortcut, SHORTCUT_BUTTON_ID } from "./shortcut.js";
import { renderTriggers, setupGuide } from "./guide.js";
import { renderSetup, loadSetupDone, initSetup } from "./setup.js";
import { applyRichText, renderLangPicker } from "./locale-ui.js";
import { initI18n, applyI18n, setLocale, currentPref, currentLocale, t } from "../chrome/i18n.js";
import { safeArgs } from "../lib/safe-error.js";

const $ = (id) => document.getElementById(id);
const log = (...args) => console.error("[split-search]", ...safeArgs(args));

// 目录加载前不得调用 t / ht / tNodes：凡是要用它们的路径都先 await i18nReady
const i18nReady = initI18n().catch(log);
bindActions({ render: () => render(), current: () => current });

// 重建后焦点原来的元素没了（授权成功后授权按钮消失）：焦点交给这一步的状态行
const FOCUS_FALLBACK = { "setup-grant": "setup-grant-status", "setup-grant-right": "setup-grant-status" };

let renderSeq = 0;
let current = null;          // 最近一次渲染用的 cfg
// 静态文字最近一次按哪种语言写入；初值 undefined 保证第一次渲染一定写入（即使目录没加载成功）。
// 不能用“setLocale 已调用过”代替：调过 setLocale 的渲染可能被更新的渲染打断，那次就没写静态文字。
let appliedLocale;
// 最近一次交给 setLocale 的 pref（同步记录）。判断要不要切换时和它比，不和已生效的 currentPref() 比：
// 否则“切走再切回”时，后一次渲染看到旧语言仍生效就不发 setLocale，前一次晚到的 setLocale 反而成了最后一次调用。
let requestedPref;
// 对应 requestedPref 的那次 setLocale（与它同步赋值）。每次渲染都等它：同语言的无关渲染不发起切换，
// 但不能抢在进行中的切换完成前按旧语言写入。
let localeSwitch = Promise.resolve();
// 下拉框最近一次按哪组 uiLocale|语言 建的；都没变就只同步选中值，不重建（重建会关掉用户正打开的下拉列表）
let pickerKey;

// ---- 渲染 ----

// 语言变了（含第一次渲染）就把 options.html 的静态文字按目录重写，写入后才去掉 loading
function applyStatic() {
  if (currentLocale() === appliedLocale) return;
  appliedLocale = currentLocale();
  applyI18n(document);
  applyRichText();
}

// 只写 uiLocale；成功后由 storage.onChanged 触发 render()，另开的设置页也跟着切换
async function pickLocale(value) {
  try {
    await write(() => ({ ok: true, patch: { uiLocale: value } }));
  } catch (err) {
    notify(t("notice_save_failed", errorText(err)), "error");
    render(); // 下拉框退回已保存的语言
  }
}

function syncLangPicker(pref) {
  const key = `${pref}|${currentLocale()}`;
  const select = $("lang-select");
  if (select && key === pickerKey) {
    select.value = pref; // 保存失败后退回已保存的语言
    return;
  }
  pickerKey = key;
  const focused = document.activeElement === select;
  $("lang-picker").replaceChildren(renderLangPicker(pref, pickLocale));
  if (focused) $("lang-select").focus(); // 键盘用户选完语言后焦点留在下拉框上
}

async function render() {
  const seq = ++renderSeq;
  let raw;
  try {
    [raw] = await Promise.all([loadRaw(), i18nReady]);
  } catch (err) {
    await i18nReady;
    await localeSwitch;
    applyStatic();
    notify(t("notice_load_failed", errorText(err)), "error");
    document.body.classList.remove("loading");
    return;
  }
  const pendingOrder = getPendingOrder();
  const cfg = mergeConfig(pendingOrder ? { ...raw, order: pendingOrder } : raw);
  // 和最近一次请求的 pref 比，不同才调 setLocale（它保证最后一次调用生效）；所有渲染都等进行中的切换。
  // 已被取代的渲染不发起切换（它的 raw 可能比更新的渲染旧），反正会在下面的 seq 检查处退出。
  if (seq === renderSeq && cfg.uiLocale !== (requestedPref ?? currentPref())) {
    requestedPref = cfg.uiLocale;
    localeSwitch = setLocale(cfg.uiLocale).catch(log);
  }
  await localeSwitch;
  const all = [...cfg.engines, ...cfg.hidden];
  const [grants] = await Promise.all([Promise.all(all.map(async e => [e.id, await isGranted(e)])), loadSetupDone()]);
  const granted = new Map(grants);
  if (seq !== renderSeq) return; // 已有更新的渲染
  for (const id of attention) if (granted.get(id)) attention.delete(id);
  current = cfg;
  refreshCatalog(cfg);
  refreshImageCatalog(cfg);
  applyStatic();
  syncLangPicker(cfg.uiLocale);
  const byId = new Map(all.map(e => [e.id, e]));
  // 有意为之：重建下面几个区块会丢掉焦点，记下有 id 的焦点元素（键盘用户刚改的开关、下拉框），重建后还给它
  const focusedId = document.activeElement?.id;
  const setupShown = renderSetup($("setup"), { cfg, byId, granted });
  const ctx = { cfg, granted, attention, actions, refresh: render, setupShown };
  $("pair-body").replaceChildren(...pairSection(cfg, byId, granted, setupShown));
  $("lookup-body").replaceChildren(renderLookupCard(cfg, actions));
  $("triggers").replaceChildren(renderTriggers(ctx));
  $("engines").replaceChildren(renderEngineList(ctx));
  $("hidden-engines").replaceChildren(renderHiddenList(ctx));
  if (focusedId && document.activeElement === document.body) ($(focusedId) ?? $(FOCUS_FALLBACK[focusedId]))?.focus();
  refreshShortcut();
  document.body.classList.remove("loading");
}

// 快捷键一行只依赖 chrome.commands，不随存储变化；用户去 chrome://extensions/shortcuts 绑完回来时（focus）也重画
let shortcutSeq = 0;
async function refreshShortcut() {
  const seq = ++shortcutSeq;
  try {
    await i18nReady;
    await localeSwitch;
    const node = await renderShortcut();
    if (seq !== shortcutSeq) return;
    // 用户点按钮去绑快捷键、回来时（focus）这一行会重画：焦点原来在按钮上就还给新按钮
    const hadFocus = document.activeElement?.id === SHORTCUT_BUTTON_ID;
    $("shortcut").replaceChildren(node);
    if (hadFocus) $(SHORTCUT_BUTTON_ID)?.focus();
  } catch (err) {
    log("failed to render the keyboard shortcut", err);
  }
}

// setupShown：“开始使用”卡显示着时，左侧授权的提示框只留在卡里，这里不重复
function pairSection(cfg, byId, granted, setupShown) {
  const lefts = cfg.engines.filter(canBeLeft);
  const [l, r] = cfg.defaultPair;
  const leftSel = h("select", { id: "pair-left" }, lefts.map(e => option(e.id, e.name, e.id === l)));
  const rightSel = h("select", { id: "pair-right" }, cfg.engines.map(e => option(e.id, e.name, e.id === r)));
  const save = () => act(raw => setDefaultPair(raw, leftSel.value, rightSel.value), ["notice_pair_saved"]);
  leftSel.addEventListener("change", save);
  rightSel.addEventListener("change", save);

  const narrow = h("input", { type: "checkbox", id: "narrow-fallback" });
  narrow.checked = cfg.narrowFallback;
  narrow.addEventListener("change", () => act(raw => setNarrowFallback(raw, narrow.checked), ["notice_narrow_saved"]));

  const nodes = [h("div", { class: "pair-pickers" },
    h("label", null, ht("span", null, "common_left"), leftSel),
    ht("span", { class: "pair-sep", "aria-hidden": "true" }, "common_pair_separator"),
    h("label", null, ht("span", null, "common_right"), rightSel)),
  h("label", { class: "check-row" }, narrow, ht("span", null, "options_narrow_label")),
  ht("p", { class: "hint" }, "options_narrow_hint")];
  const left = byId.get(l);
  if (left && !setupShown && !granted.get(left.id)) {
    nodes.push(h("div", { class: "callout callout-warn" },
      ht("span", null, "options_left_not_granted", left.name),
      authButton([left], ["engine_grant_named", left.name], { cls: "btn btn-small btn-attention", onDone: render })));
  }
  return nodes;
}

// ---- 启动 ----

// 对话框和“复制地址”按钮要用 t()，等目录加载完再建；下面的监听只调 render()，render 自己 await i18nReady
i18nReady.then(() => {
  setupEngineDialog(actions);
  setupCatalogDialog(actions);
  setupLookupDialogs(actions);
  setupGuide();
  initSetup(render);
});
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "sync") render(); });
chrome.permissions.onAdded.addListener(() => render());
chrome.permissions.onRemoved.addListener(() => render());
window.addEventListener("focus", () => refreshShortcut());
render();
