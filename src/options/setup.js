// 设置页顶部的“开始使用”卡（#setup）：先试用工具栏或示例，再按需配置地址栏。
// 显示哪几步见 lib/setup-state.js。完成由 go.html 判定并写 storage.local 的 setupDone（chrome/setup-store.js），
// 设置页开着、关着都一样；这里只读它、监听它的变化。“试搜示例”打开的标签 id 记进 storage.session 的 setupTryTabs，
// go.html 据此不把它算成完成（它绕过了用户的网站搜索设置）。
import { buildTriggerTemplate, expandTemplate } from "../lib/trigger.js";
import { setupView } from "../lib/setup-state.js";
import { safeArgs } from "../lib/safe-error.js";
import { acceptRevealSetup, isRevealSetup } from "../lib/messages.js";
import { routeFromHash } from "../lib/options-route.js";
import { DONE_KEY, readSetupDone, rememberTryTab } from "../chrome/setup-store.js";
import { h, ht, notify, errorText, authButton } from "./ui.js";
import { urlBox, leftWarn, revealGuideSteps, searchSettingsControl } from "./guide.js";
import { showTab, plainLeft } from "./tabs.js";
import { t } from "../chrome/i18n.js";
import { icon } from "../ui/icons.js";

const log = (...args) => console.error("[split-search]", ...safeArgs(args));
const info = (...args) => console.info("[split-search]", ...safeArgs(args));

let setupDone = false;
let doneVersion = 0;        // onChanged 改过 setupDone 就加一：读存储的结果比它旧时不覆盖
let justCompleted = false;  // 本页看到 setupDone 变成 true：卡片换成一句完成确认，重新打开设置页才消失
let lastLeft = null;        // 上次渲染时的 { id, granted }，用来播报“左侧授权被取消”
let rerender = () => {};
let selfTabId = null;       // 本页所在标签：弹窗的 reveal-setup 只给它选中的那个设置页
let selfTab = Promise.resolve(null); // 读 selfTabId 的那次 tabs.getCurrent：消息比它先到时等它
let selfTabRead = false;    // 那次读取已结束（读失败时 selfTabId 仍是 null）

// ---- 状态 ----

export async function loadSetupDone() {
  const v = doneVersion;
  const value = await readSetupDone(); // 读不出来是 null：保留现状
  if (value !== null && v === doneVersion) setupDone = value;
}

// tabs.create 返回后立刻记下标签 id。go.html 要等这个标签完成重定向、加载、读配置、建好右侧并复核之后才读 setupTryTabs，
// 比这里的一读一写晚得多。不先开空白页再跳转：那样空白页会留在这个标签的“后退”历史里（实测）
async function tryIt(url) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url });
  } catch (err) {
    notify(errorText(err), "error");
    return;
  }
  await rememberTryTab(tab.id);
}

function onLocal(changes) {
  if (!(DONE_KEY in changes)) return;
  const now = changes[DONE_KEY].newValue === true;
  doneVersion++;
  if (now === setupDone) return;
  setupDone = now;
  justCompleted = now;
  if (now) notify(t("setup_done_notice"));
  rerender();
}

// 目录加载后由 options.js 调用一次；render 是设置页的整页渲染
export function initSetup(render) {
  rerender = render;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") onLocal(changes);
  });
}

// 页面脚本一加载就由 options.js 调用（不等文案）：弹窗经 getContexts 找到这一页时就已经有接收者；定位本身由 revealSetup 的 loading 守卫延后
export function listenReveal() {
  selfTab = chrome.tabs.getCurrent().then(tab => (selfTabId = tab?.id ?? null))
    .catch(err => { info("options: reading the current tab failed", err); return null; })
    .finally(() => { selfTabRead = true; });
  chrome.runtime.onMessage.addListener(onRevealMessage);
}

// 弹窗里的设置入口找到已开的设置页时发 reveal-setup（同一 hash 再导航一次不会触发 hashchange）：
// 与 #setup 一样滚到卡片、焦点给标题，卡片不显示时什么都不做。别的消息（complete-split 等）不回复，留给 SW。
// 本页刚打开、还没读到自己的标签 id 时先等它（只有这时才返回 true 留着回复通道）；首次渲染前到达的由 revealSetup 留到渲染后再做
function onRevealMessage(msg, sender, sendResponse) {
  const handle = tabId => {
    const ctx = { extId: chrome.runtime.id, popupUrl: chrome.runtime.getURL("popup/popup.html"), tabId };
    if (!acceptRevealSetup(msg, sender, ctx)) return false;
    requestReveal("setup");
    sendResponse({ ok: true });
    return true;
  };
  if (selfTabRead || !isRevealSetup(msg)) {
    handle(selfTabId);
    return undefined;
  }
  selfTab.then(handle);
  return true;
}

// ---- 渲染 ----

const checkIcon = () => icon("check");

function triggerOf(left, right) {
  try {
    return left && right ? buildTriggerTemplate(left, right.id) : null;
  } catch {
    return null;
  }
}

function grantButton(left) {
  const btn = authButton([left], ["setup_grant_left", left.name], { cls: "btn btn-primary", onDone: rerender });
  btn.id = "setup-grant";
  return btn;
}

// “详细步骤”：“添加到 Chrome”卡的 5 步说明和默认组合一段这时收着，先展开再滚过去（不改 hash，免得和 #setup 定位搅在一起）
function openDetails(ev) {
  if (!plainLeft(ev)) return;
  ev.preventDefault();
  revealGuideSteps();
}

// 先复制组合网址，再直达 Chrome 设置。设为默认与快捷字词两种用法共用同一条网站搜索。
function addBody({ left, url }) {
  const sub = (key, ...rest) => h("li", null, ht("p", { class: "hint" }, key), ...rest);
  const box = url ? urlBox(url, undefined, "guide_copy_default_aria") : ht("p", { class: "hint hint-error" }, "guide_no_trigger");
  if (url) box.querySelector("button").id = "setup-copy-trigger";
  return [
    h("ol", { class: "setup-substeps" },
      sub("setup_copy_trigger", box, url && left.leftDiscouraged && leftWarn(left)),
      sub("setup_add_paste", searchSettingsControl("setup-open-settings")),
      sub("guide_step_default", ht("p", { class: "hint" }, "guide_caveat_no_suggest"))),
    h("div", { class: "step-links" },
      ht("a", { href: "#guide-steps", class: "step-link", onclick: openDetails }, "setup_details_link"),
      ht("a", { href: "#tab-pair", id: "setup-change-pair", class: "step-link", "data-reveal": "pair-left" }, "setup_change_pair")),
  ];
}

function tryBody({ left, url, canCompare }, ready) {
  const intro = canCompare ? ht("p", { class: "hint" }, "setup_toolbar_hint", left.name)
    : ht("p", { class: "hint" }, "popup_setup_add_engine");
  if (!url) return [intro, ht("p", { class: "hint hint-error" }, "guide_no_trigger")];
  const query = t("setup_sample_query");
  const hint = ready ? ht("p", { class: "hint" }, "setup_try_hint", query)
    : ht("p", { class: "hint" }, "setup_try_grant_hint", query, left.name);
  const button = ready ? ht("button", { type: "button", id: "setup-try", class: "btn btn-primary",
    onclick: () => tryIt(expandTemplate(url, query)).catch(err => log("failed to open the try tab", err)) }, "setup_try_button")
    : grantButton(left);
  return [intro, hint, left.leftDiscouraged && leftWarn(left), h("div", { class: "step-actions" }, button)];
}

function stepList(v, info) {
  return h("ol", { class: "setup-steps" }, v.steps.map((s, i) =>
    h("li", { class: "setup-step", "data-step": s.id, "data-state": s.state },
      h("span", { class: "step-mark", "aria-hidden": "true" }, String(i + 1)),
      h("div", { class: "step-body" }, ht("h3", null, s.id === "try" ? "setup_try_title" : "setup_add_title"),
        s.id === "try" ? tryBody(info, s.state === "ready") : addBody(info)))));
}

// 左侧授权从有变没有（例如在 chrome://extensions 里撤销）时经 #notices 播报；授权成功由授权按钮自己播报
function announce(left, leftGranted) {
  if (lastLeft && left && lastLeft.id === left.id && lastLeft.granted && !leftGranted) {
    notify(t("setup_revoked_notice", left.name), "warn");
  }
  lastLeft = left ? { id: left.id, granted: leftGranted } : null;
}

// 卡片标题：tabindex=-1 让 #setup 定位时能把焦点给它（重建后 options.js 按 id 把焦点还回来）
const title = (key, props = {}, ...children) => children.length
  ? h("h2", { id: "setup-title", tabindex: "-1", ...props }, ...children)
  : ht("h2", { id: "setup-title", tabindex: "-1", ...props }, key);

// 网址带 #setup（从弹窗新开的设置页）：页面第一次显示出来后滚到卡片、焦点给标题；卡片不显示时什么都不做。
// 网址带 #guide-steps（中键或 Ctrl+点“详细步骤”在新标签打开的）：同样等页面显示出来，再做与左键点击相同的 revealGuideSteps。
// 只做一次，之后 hash 再变成这两者之一（tabs.js 的 hashchange 经 onReveal 调 requestReveal）或收到弹窗的 reveal-setup 才再做。
// 卡片显示时先切到“添加到 Chrome”（从别的 tab 过来就写 #tab-add）；卡片隐藏时什么都不做，也不切 tab
let revealPending = routeFromHash(location.hash).reveal ?? null;
export function requestReveal(target) {
  revealPending = target;
  revealSetup();
}
export function revealSetup() {
  const target = revealPending;
  if (!target || document.body.classList.contains("loading")) return; // 首次渲染前：留着，options.js 去掉 loading 后再调
  revealPending = null;
  if (target === "guide-steps") return revealGuideSteps();
  const card = document.getElementById("setup");
  if (!card || card.hidden) return;
  showTab("add");
  card.scrollIntoView({ block: "start" });
  document.getElementById("setup-title")?.focus({ preventScroll: true });
}

// el 是 #setup；返回 setupView 的 mode（steps / regrant 时卡片显示，默认组合卡与组合生成器不再重复左侧授权的提示框）
export function renderSetup(el, { cfg, byId, granted }) {
  const [left, right] = cfg.defaultPair.map(id => byId.get(id));
  const leftGranted = !!left && granted.get(left.id) === true;
  announce(left, leftGranted);
  const v = setupView({ leftGranted, setupDone, justCompleted });
  const info = { left, url: triggerOf(left, right), canCompare: cfg.engines.length > 1 };
  let nodes = [];
  if (!left && v.mode !== "hidden" && v.mode !== "done") {
    nodes = [title("setup_title"), ht("p", { class: "hint hint-error" }, "guide_no_trigger")];
  } else if (v.mode === "steps") {
    nodes = [title("setup_title"), stepList(v, info)];
  } else if (v.mode === "regrant") {
    nodes = [title("setup_regrant_title"),
      h("div", { class: "setup-step", "data-step": "grant", "data-state": "todo" },
        ht("p", { class: "hint" }, "setup_regrant_text", left.name), h("div", { class: "step-actions" }, grantButton(left)))];
  } else if (v.mode === "done") {
    nodes = [title(null, { class: "setup-done-title" }, checkIcon(), ht("span", null, "setup_done_title")),
      ht("p", { class: "hint" }, "setup_done_text"),
      ht("a", { class: "step-link", href: "#guide-steps", onclick: openDetails }, "options_pair_changed_steps")];
  }
  el.replaceChildren(...nodes);
  el.dataset.mode = v.mode;
  el.hidden = v.mode === "hidden";
  return v.mode;
}
