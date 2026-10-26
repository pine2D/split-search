// 设置页顶部的“开始使用”卡（#setup）：授权 → 在 Chrome 里添加网站搜索并设为默认 → 试一下。
// 显示哪几步见 lib/setup-state.js。完成由 go.html 判定并写 storage.local 的 setupDone（chrome/setup-store.js），
// 设置页开着、关着都一样；这里只读它、监听它的变化。“试一下”打开的标签 id 记进 storage.session 的 setupTryTabs，
// go.html 据此不把它算成完成（它绕过了用户的网站搜索设置）。
import { buildTriggerTemplate, expandTemplate } from "../lib/trigger.js";
import { setupView } from "../lib/setup-state.js";
import { safeArgs } from "../lib/safe-error.js";
import { DONE_KEY, readSetupDone, rememberTryTab } from "../chrome/setup-store.js";
import { h, ht, notify, errorText, authButton } from "./ui.js";
import { urlBox, leftWarn, SETTINGS_URL } from "./guide.js";
import { t } from "../chrome/i18n.js";
import { icon } from "../ui/icons.js";

const log = (...args) => console.error("[split-search]", ...safeArgs(args));

let setupDone = false;
let doneVersion = 0;        // onChanged 改过 setupDone 就加一：读存储的结果比它旧时不覆盖
let justCompleted = false;  // 本页看到 setupDone 变成 true：卡片换成一句完成确认，重新打开设置页才消失
let lastLeft = null;        // 上次渲染时的 { id, granted }，用来播报“左侧授权被取消”
let rerender = () => {};

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
  window.addEventListener("hashchange", () => {
    if (location.hash !== "#setup") return;
    revealPending = true;
    revealSetup();
  });
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

function grantButton(engines, label, id, cls) {
  const btn = authButton(engines, label, { cls, onDone: () => rerender() });
  btn.id = id;
  return btn;
}

// 第 1 步还没完成（regrant 时 textKey 换成“需要授权”的说明）
function grantTodo({ left, right, rightPending }, textKey) {
  const both = rightPending;
  const key = textKey ?? (both ? "setup_grant_text" : "setup_grant_text_left");
  const textArgs = key === "setup_grant_text" ? [left.name, right.name] : [left.name];
  return [
    ht("p", { class: "hint" }, key, ...textArgs),
    h("div", { class: "step-actions" }, grantButton(both ? [left, right] : [left],
      both ? ["setup_grant_both", left.name, right.name] : ["setup_grant_left", left.name], "setup-grant", "btn btn-primary")),
  ];
}

function grantDone({ left, right, rightPending }) {
  return [
    h("p", { class: "step-status", id: "setup-grant-status", tabindex: "-1" }, checkIcon(), ht("span", null, "setup_granted", left.name)),
    rightPending && h("div", { class: "step-actions" },
      ht("span", { class: "hint" }, "setup_right_hint", right.name),
      grantButton([right], ["setup_grant_right", right.name], "setup-grant-right", "btn btn-small")),
  ];
}

// 第 2 步按操作顺序拆成三个编号小步（<ol> 的序号），每步只带它自己要复制的东西：剪贴板一次只装一样，
// 先复制设置地址打开设置页，再复制触发网址粘进“网站搜索”，最后设为默认
function addBody({ left, url }) {
  const sub = (key, ...rest) => h("li", null, ht("p", { class: "hint" }, key), ...rest);
  return [
    h("ol", { class: "setup-substeps" },
      sub("setup_add_open", urlBox(SETTINGS_URL, ["guide_copy_settings_url"], "guide_copy_settings_aria")),
      sub("setup_add_paste",
        url ? urlBox(url, undefined, "guide_copy_default_aria") : ht("p", { class: "hint hint-error" }, "guide_no_trigger"),
        url && left.leftDiscouraged && leftWarn(left)),
      sub("setup_add_default")),
    ht("a", { href: "#guide", class: "step-link" }, "setup_details_link"),
  ];
}

function tryBody({ url, grantOk }) {
  const query = t("setup_sample_query");
  const reason = !url ? "guide_no_trigger" : grantOk ? null : "setup_try_blocked";
  const btn = ht("button", { type: "button", id: "setup-try", class: grantOk ? "btn btn-primary" : "btn",
    disabled: !!reason, "aria-describedby": reason ? "setup-try-reason" : null }, "setup_try_button");
  btn.addEventListener("click", () => { tryIt(expandTemplate(url, query)).catch(err => log("failed to open the try tab", err)); });
  return [
    h("div", { class: "step-actions" }, btn, reason && ht("span", { id: "setup-try-reason", class: "hint" }, reason)),
    ht("p", { class: "hint" }, "setup_try_hint", query),
  ];
}

const STEP_TITLES = { grant: "setup_grant_title", add: "setup_add_title", try: "setup_try_title" };

function stepList(v, info) {
  const current = v.steps.findIndex(s => s.state !== "done");
  const body = s => s.id === "grant" ? (s.state === "done" ? grantDone(info) : grantTodo(info))
    : s.id === "add" ? addBody(info) : tryBody({ ...info, grantOk: s.state === "ready" });
  return h("ol", { class: "setup-steps" }, v.steps.map((s, i) =>
    h("li", { class: i === current ? "setup-step current" : "setup-step", "data-step": s.id, "data-state": s.state },
      h("span", { class: "step-mark", "aria-hidden": "true" }, s.state === "done" ? checkIcon() : String(i + 1)),
      h("div", { class: "step-body" }, ht("h3", null, STEP_TITLES[s.id]), body(s)))));
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

// 网址带 #setup（弹窗的“完成设置”“去第 2 步”）：页面第一次显示出来后滚到卡片、焦点给标题；卡片不显示时什么都不做。
// 只做一次，之后 hash 再变成 #setup 才再做
let revealPending = location.hash === "#setup";
export function revealSetup() {
  if (!revealPending) return;
  revealPending = false;
  const card = document.getElementById("setup");
  if (!card || card.hidden) return;
  card.scrollIntoView({ block: "start" });
  document.getElementById("setup-title")?.focus({ preventScroll: true });
}

// el 是 #setup；返回卡片是否显示（显示时默认组合卡与组合生成器不再重复左侧授权的提示框）
export function renderSetup(el, { cfg, byId, granted }) {
  const [left, right] = cfg.defaultPair.map(id => byId.get(id));
  const leftGranted = !!left && granted.get(left.id) === true;
  const rightDistinct = !!right && right.id !== left?.id;
  const rightGranted = rightDistinct && granted.get(right.id) === true;
  announce(left, leftGranted);
  const v = setupView({ leftGranted, rightGranted, rightDistinct, setupDone, justCompleted });
  const info = { left, right, rightPending: v.rightPending, url: triggerOf(left, right) };
  let nodes = [];
  if (!left && v.mode !== "hidden" && v.mode !== "done") {
    nodes = [title("setup_title"), ht("p", { class: "hint hint-error" }, "guide_no_trigger")];
  } else if (v.mode === "steps") {
    nodes = [title("setup_title"), stepList(v, info)];
  } else if (v.mode === "regrant") {
    nodes = [title("setup_regrant_title"),
      h("div", { class: "setup-step", "data-step": "grant", "data-state": "todo" }, grantTodo(info, "setup_regrant_text"))];
  } else if (v.mode === "done") {
    nodes = [title(null, { class: "setup-done-title" }, checkIcon(), ht("span", null, "setup_done_title")),
      ht("p", { class: "hint" }, "setup_done_text")];
  }
  el.replaceChildren(...nodes);
  el.dataset.mode = v.mode;
  el.hidden = v.mode === "hidden";
  return v.mode === "steps" || v.mode === "regrant";
}
