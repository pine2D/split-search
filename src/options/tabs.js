// 设置页的四个 tab（WAI-ARIA APG Tabs，自动激活）：按钮 #tabbtn-<key>、面板 #panel-<key>，面板只切普通 hidden。
// tab 状态只在网址 hash（#tab-<key>）里：点 tab、方向键、页内链接用 replaceState 写，不产生历史；首次载入按 initialTab 选，不改写 hash。
// 整个设置页只有这里监听 hashchange：#tab-* 换 tab，#setup / #guide-steps 交给注入的 onReveal。
// 模块顶层只有常量和状态，不碰 window / location / document（test/options-actions.test.js 经 actions.js 传递导入它）。
import { TAB_KEYS, tabHash, routeFromHash, initialTab, stepTab } from "../lib/options-route.js";
import { ht } from "./ui.js";
import { icon } from "../ui/icons.js";

const BTN = "tabbtn-";
let deps = { onReveal() {}, onLeave() {}, reveals: {} };
let routed = false;      // routeOnce 只在第一次调用时生效
let flagMode;            // setTabFlag 最近一次按哪一档写的

const $ = (id) => document.getElementById(id);
const keyOf = (btn) => (btn?.id?.startsWith(BTN) ? btn.id.slice(BTN.length) : null);
const plainLeft = (ev) => ev.button === 0 && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey;

// onReveal(target)：hash 变成 #setup / #guide-steps 时调用；onLeave(fromKey)：离开某个 tab 后调用；
// reveals[name]：href="#tab-*" 的页内链接左键切过去后，按链接的 data-reveal 调用（焦点给目标控件之类）
export function initTabs({ onReveal, onLeave, reveals }) {
  deps = { onReveal, onLeave, reveals: reveals ?? {} };
  const list = $("tabs");
  list.addEventListener("click", (ev) => {
    const key = keyOf(ev.target.closest?.('[role="tab"]'));
    if (key) showTab(key);
  });
  list.addEventListener("keydown", (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const from = keyOf(ev.target.closest?.('[role="tab"]'));
    const next = from && stepTab(TAB_KEYS, from, ev.key);
    if (!next) return;
    ev.preventDefault();
    showTab(next, { focusTab: true });
  });
  window.addEventListener("hashchange", () => {
    const route = routeFromHash(location.hash);
    if (route.tab) switchTo(route.tab, { hash: false, scroll: true, leave: true });
    else if (route.reveal) deps.onReveal(route.reveal);
  });
  // 页内跨 tab 链接写真实 href（中键、Ctrl+点照常在新标签打开）；只接管不带修饰键的左键
  document.addEventListener("click", (ev) => {
    if (!plainLeft(ev) || ev.defaultPrevented || !(ev.target instanceof Element)) return;
    const a = ev.target.closest('a[href^="#tab-"]');
    const route = a ? routeFromHash(a.getAttribute("href")) : {};
    if (!route.tab) return;
    ev.preventDefault();
    showTab(route.tab);
    deps.reveals[a.dataset.reveal]?.();
  });
}

export function activeTab() {
  return keyOf($("tabs")?.querySelector('[role="tab"][aria-selected="true"]'));
}

// 用户或页内链接换 tab：写 hash（replaceState）、离开时通知、必要时滚回 tab 栏
export function showTab(key, { focusTab = false } = {}) {
  switchTo(key, { hash: true, scroll: true, leave: true, focusTab });
}

// 首次渲染时选中一个 tab：按 initialTab，不写 hash、不滚动、不调 onLeave；之后的调用什么都不做
export function routeOnce(mode) {
  if (routed) return;
  routed = true;
  switchTo(initialTab(location.hash, { mode }), { hash: false, scroll: false, leave: false });
}

function switchTo(key, { hash, scroll, leave, focusTab = false }) {
  if (!TAB_KEYS.includes(key)) return;
  const from = activeTab();
  if (from === key) return;
  for (const k of TAB_KEYS) {
    const btn = $(BTN + k);
    btn.setAttribute("aria-selected", String(k === key));
    btn.tabIndex = k === key ? 0 : -1;
    $(`panel-${k}`).hidden = k !== key;
  }
  if (hash) history.replaceState(null, "", tabHash(key));
  if (leave && from) deps.onLeave(from);
  const btn = $(BTN + key);
  if (focusTab) btn.focus();
  if (!scroll) return;
  btn.scrollIntoView({ inline: "nearest", block: "nearest" });
  const bar = document.querySelector(".tabbar");
  const top = bar?.getBoundingClientRect().top;
  if (top < 0) window.scrollTo({ top: top + window.scrollY, behavior: "instant" });
}

// ① 上的标记（只按“开始使用”卡的档位）：steps 是圆点 + 读屏的“未完成”，regrant 是警示图标 + “需要授权”，其余不显示。
// 读屏文字在 flag 里面：flag 不显示时跟着不在无障碍树里；它带 data-i18n，换语言时 applyI18n 一起重写
export function setTabFlag(mode) {
  const flag = $("tab-flag-add");
  if (!flag || mode === flagMode) return;
  flagMode = mode;
  flag.classList.toggle("todo", mode === "steps");
  flag.classList.toggle("regrant", mode === "regrant");
  if (mode === "steps") flag.replaceChildren(ht("span", { class: "sr-only" }, "options_tab_todo"));
  else if (mode === "regrant") flag.replaceChildren(icon("alert-circle", { size: 14 }), ht("span", { class: "sr-only" }, "options_tab_regrant"));
  else flag.replaceChildren();
}

// 焦点兜底：目标看得见就给它，否则（没有、在别的 tab 里、被藏起来）给当前选中的 tab 按钮
export function focusIn(el) {
  if (el && el.checkVisibility()) el.focus();
  else $(BTN + activeTab())?.focus();
}
