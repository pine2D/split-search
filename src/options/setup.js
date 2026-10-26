// 设置页顶部的“开始使用”卡（#setup）：授权 → 在 Chrome 里添加网站搜索并设为默认 → 试一下，以及完成判定。
// 显示哪几步、一次 storage.session 变化算不算完成，见 lib/setup-state.js。
// 唯一写入的是 storage.local 的布尔值 setupDone。“试一下”打开的标签 id 只在页面内存里，
// 经 BroadcastChannel 告诉同时开着的其他设置页（只传标签 id 和示例关键词），免得别的设置页把它当成完成。
import { buildTriggerTemplate, expandTemplate } from "../lib/trigger.js";
import { setupView, isCompletion } from "../lib/setup-state.js";
import { safeArgs } from "../lib/safe-error.js";
import { h, ht, notify, errorText, authButton } from "./ui.js";
import { urlBox, leftWarn, SETTINGS_URL } from "./guide.js";
import { t } from "../chrome/i18n.js";
import { icon } from "../ui/icons.js";

const log = (...args) => console.error("[split-search]", ...safeArgs(args));
const DONE_KEY = "setupDone";
const CHANNEL = "split-search-setup";
const TRY_WAIT_MS = 5000; // “试一下”的标签迟迟建不出来（或发起的设置页关掉了）时，最多等这么久再判定

let setupDone = false;
let doneVersion = 0;        // onChanged 改过 setupDone 就加一：读存储的结果比它旧时不覆盖
let justCompleted = false;  // 本页看到 setupDone 变成 true：卡片换成一句完成确认，重新打开设置页才消失
let lastLeft = null;        // 上次渲染时的 { id, granted }，用来播报“左侧授权被取消”
let rerender = () => {};
let channel = null;
const tryTabs = new Map();  // 标签 id → 当时用的示例关键词
const pending = new Map();  // nonce → 计时器：“试一下”正在建标签（本页或别的设置页）
let waiters = [];

// ---- 状态 ----

export async function loadSetupDone() {
  const v = doneVersion;
  try {
    const value = (await chrome.storage.local.get(DONE_KEY))[DONE_KEY] === true;
    if (v === doneVersion) setupDone = value;
  } catch (err) {
    log("failed to read the setup state", err);
  }
}

function startTry(nonce) {
  pending.set(nonce, setTimeout(() => endTry(nonce), TRY_WAIT_MS));
}

function endTry(nonce, tabId, query) {
  if (Number.isInteger(tabId) && typeof query === "string") tryTabs.set(tabId, query);
  clearTimeout(pending.get(nonce));
  pending.delete(nonce);
  if (pending.size) return;
  const ready = waiters;
  waiters = [];
  for (const resolve of ready) resolve();
}

const tryIdle = () => (pending.size ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve());

async function tryIt(url, query) {
  const nonce = crypto.randomUUID();
  startTry(nonce);
  channel?.postMessage({ type: "try-start", nonce });
  let tabId;
  try {
    tabId = (await chrome.tabs.create({ url })).id;
  } catch (err) {
    notify(errorText(err), "error");
  } finally {
    endTry(nonce, tabId, query);
    channel?.postMessage({ type: "try-end", nonce, tabId, query });
  }
}

async function onSession(changes) {
  if (setupDone) return;
  await tryIdle(); // 先等“试一下”的标签 id 到手，否则会把它打开的那一对误判成完成
  if (setupDone || !isCompletion(changes, tryTabs)) return;
  try {
    await chrome.storage.local.set({ [DONE_KEY]: true }); // 卡片由 onLocal 换成完成确认（每个设置页各自收到）
  } catch (err) {
    log("failed to save the setup state", err);
  }
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

function onMessage({ data }) {
  if (typeof data?.nonce !== "string") return;
  if (data.type === "try-start") startTry(data.nonce);
  else if (data.type === "try-end") endTry(data.nonce, data.tabId, data.query);
}

// 目录加载后由 options.js 调用一次；render 是设置页的整页渲染
export function initSetup(render) {
  rerender = render;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session") onSession(changes).catch(err => log("failed to check the setup state", err));
    else if (area === "local") onLocal(changes);
  });
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = onMessage;
  } catch (err) {
    log("failed to open the settings page channel", err);
  }
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

const field = (labelKey, box) => h("div", { class: "setup-field" }, ht("span", { class: "setup-field-label" }, labelKey), box);

function addBody({ left, url }) {
  return [
    ht("p", { class: "hint" }, "setup_add_text"),
    url ? field("setup_trigger_label", urlBox(url, undefined, "guide_copy_default_aria")) : ht("p", { class: "hint hint-error" }, "guide_no_trigger"),
    url && left.leftDiscouraged && leftWarn(left),
    field("setup_settings_label", urlBox(SETTINGS_URL, ["guide_copy_settings_url"], "guide_copy_settings_aria")),
    ht("a", { href: "#guide", class: "step-link" }, "setup_details_link"),
  ];
}

function tryBody({ url, grantOk }) {
  const query = t("setup_sample_query");
  const reason = !url ? "guide_no_trigger" : grantOk ? null : "setup_try_blocked";
  const btn = ht("button", { type: "button", id: "setup-try", class: grantOk ? "btn btn-primary" : "btn",
    disabled: !!reason, "aria-describedby": reason ? "setup-try-reason" : null }, "setup_try_button");
  btn.addEventListener("click", () => tryIt(expandTemplate(url, query), query));
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
    nodes = [ht("h2", { id: "setup-title" }, "setup_title"), ht("p", { class: "hint hint-error" }, "guide_no_trigger")];
  } else if (v.mode === "steps") {
    nodes = [ht("h2", { id: "setup-title" }, "setup_title"), stepList(v, info)];
  } else if (v.mode === "regrant") {
    nodes = [ht("h2", { id: "setup-title" }, "setup_regrant_title"),
      h("div", { class: "setup-step", "data-step": "grant", "data-state": "todo" }, grantTodo(info, "setup_regrant_text"))];
  } else if (v.mode === "done") {
    nodes = [h("h2", { id: "setup-title", class: "setup-done-title" }, checkIcon(), ht("span", null, "setup_done_title")),
      ht("p", { class: "hint" }, "setup_done_text")];
  }
  el.replaceChildren(...nodes);
  el.dataset.mode = v.mode;
  el.hidden = v.mode === "hidden";
  return v.mode === "steps" || v.mode === "regrant";
}
