// 工具栏弹窗编排：读目标标签 → 归属判定（与 go.html、快捷键共用）→ 显示关键词、左右引擎和换右侧的按钮。
// 只做 Chrome 原生拆分视图菜单没有的事：换右侧引擎。互换左右、取消拆分视图用原生菜单。
import { loadConfig } from "../chrome/config-store.js";
import { ownedPair, switchRight } from "../chrome/right-switch.js";
import { popupView, targetTabId } from "../lib/popup-view.js";
import { normalizeLocalePref } from "../lib/i18n.js";
import { initI18n, applyI18n, setLocale, setI18nText } from "../chrome/i18n.js";

const $ = (id) => document.getElementById(id);
const log = (...args) => console.error("[split-search]", ...args);

// 目录加载前不得调用 t / setI18nText：渲染都先 await i18nReady
const i18nReady = initI18n().catch(log);
const forcedTabId = targetTabId(location.search);

let renderSeq = 0;
let busy = false; // 换右侧进行中：按钮保持禁用，避免连点发出两次导航

async function targetTab() {
  if (forcedTabId !== null) return chrome.tabs.get(forcedTabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

// 返回 { pair, cfg }；不是本扩展的一对返回 null。读取失败照常抛出，由调用方记日志。
async function load() {
  const tab = await targetTab();
  if (!tab) return null;
  const cfg = await loadConfig();
  const pair = await ownedPair(tab, cfg.engines);
  return pair ? { pair, cfg } : null;
}

// 引擎名是用户数据，直接写 textContent，并去掉 data-i18n，切换语言时不会被改写；
// 引擎已删除时写“已删除的引擎”文案。
function showEngine(el, engine) {
  el.classList.toggle("placeholder", !engine);
  if (engine) {
    el.textContent = engine.name;
    el.removeAttribute("data-i18n");
    el.removeAttribute("data-i18n-args");
  } else {
    setI18nText(el, "popup_engine_deleted");
  }
}

function showError(key) {
  const el = $("error");
  if (key) setI18nText(el, key);
  el.hidden = !key;
}

function setButtonsDisabled(disabled) {
  for (const b of $("choices").querySelectorAll("button")) b.disabled = disabled;
}

function show(state) {
  $("not-ours").hidden = !!state;
  $("pair").hidden = !state;
  if (!state) return;
  const view = popupView(state.pair, state.cfg);

  const q = $("query");
  q.classList.toggle("placeholder", view.query === "");
  if (view.query === "") {
    setI18nText(q, "popup_empty_query");
    q.removeAttribute("title");
  } else {
    q.textContent = view.query;
    q.title = view.query; // 很长时只显示前几行（popup.css），悬停看完整的关键词
    q.removeAttribute("data-i18n");
    q.removeAttribute("data-i18n-args");
  }
  showEngine($("left-engine"), view.left);
  showEngine($("right-engine"), view.right);

  const list = $("choices");
  list.replaceChildren(...view.choices.map((engine) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = engine.name;
    button.dataset.engine = engine.id;
    button.disabled = busy;
    button.addEventListener("click", () => onSwitch(engine.id));
    const li = document.createElement("li");
    li.append(button);
    return li;
  }));
  $("no-choices").hidden = view.choices.length > 0;
}

// 任何读取或显示错误都落到“不是本扩展的拆分视图”，弹窗不会空白。
async function render() {
  const seq = ++renderSeq;
  let state = null;
  try {
    state = await load();
  } catch (err) {
    log("popup: reading the split failed", err);
  }
  if (seq !== renderSeq) return;
  try {
    show(state);
  } catch (err) {
    log("popup: rendering failed", err);
    show(null);
  }
}

// 列表重建会丢掉焦点：还给刚点的引擎；它成了当前右侧、不在列表里了，就给第一个按钮；
// 列表为空或这一对已经不是本扩展的，给“打开设置页”
function restoreFocus(engineId) {
  const buttons = $("pair").hidden ? [] : [...$("choices").querySelectorAll("button")];
  (buttons.find((b) => b.dataset.engine === engineId) ?? buttons[0] ?? $("open-options")).focus();
}

// 点击时重新判定一次：弹窗打开期间这一对可能已被拆开或关掉。换完弹窗保持打开并刷新，方便连续切换。
async function onSwitch(engineId) {
  if (busy) return;
  busy = true;
  setButtonsDisabled(true);
  showError(null);
  try {
    const state = await load();
    const engine = state?.cfg.engines.find((e) => e.id === engineId);
    if (!state || !engine) {
      log("popup: the split or the engine is gone, nothing switched", engineId);
      showError("popup_switch_failed");
    } else {
      await switchRight(state.pair, engine);
    }
  } catch (err) {
    log("popup: switching the right side failed", err);
    showError("popup_switch_failed");
  } finally {
    busy = false;
    await render();
    restoreFocus(engineId);
  }
}

$("open-options").addEventListener("click", () => {
  Promise.resolve().then(() => chrome.runtime.openOptionsPage()).catch((err) => log("popup: openOptionsPage failed", err));
});

// 设置页改了语言或引擎：跟着切换语言并重绘
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  i18nReady
    .then(() => ("uiLocale" in changes ? setLocale(normalizeLocalePref(changes.uiLocale.newValue)).then(() => applyI18n()) : null))
    .catch(log)
    .then(render);
});

try {
  await i18nReady;
  applyI18n();
  await render();
} finally {
  document.querySelector("main").classList.remove("loading");
}
