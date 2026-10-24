// 设置页编排：读配置 → 实时查授权 → 渲染各区块；所有写入串行执行“loadRaw → 改整键 → saveKeys”。
import { loadRaw, saveKeys } from "../chrome/config-store.js";
import { mergeConfig } from "../lib/engines.js";
import { h, ht, notify, errorText, authButton, option, isGranted, joinSentences } from "./ui.js";
import {
  addEngine, editEngine, hideEngine, restoreEngine, deleteEngine, setDefaultPair, moveId, canBeLeft,
} from "./edits.js";
import { renderEngineList, renderHiddenList, setupEngineDialog, confirmRemoval } from "./engine-list.js";
import { renderTriggers, setupGuide } from "./guide.js";
import { applyRichText, renderLangPicker } from "./locale-ui.js";
import { initI18n, applyI18n, setLocale, currentPref, currentLocale, t } from "../chrome/i18n.js";

const ORDER_DEBOUNCE_MS = 500;
const $ = (id) => document.getElementById(id);
const log = (...args) => console.error("[split-search]", ...args);

// 目录加载前不得调用 t / ht / tNodes：凡是要用它们的路径都先 await i18nReady
const i18nReady = initI18n().catch(log);

const attention = new Set(); // 保存后尚未授权的引擎：突出显示“授权”按钮
let pendingOrder = null;     // 防抖期间的本地排序
let orderTimer = null;
let renderSeq = 0;
let current = null;          // 最近一次渲染用的 cfg
// 静态文字最近一次按哪种语言写入；初值 undefined 保证第一次渲染一定写入（即使目录没加载成功）。
// 不能用“setLocale 已调用过”代替：调过 setLocale 的渲染可能被更新的渲染打断，那次就没写静态文字。
let appliedLocale;

// ---- 写入：串行化，避免并发的读取→修改→写回 ----

let writeChain = Promise.resolve();

// compute(raw) 返回 { ok, patch?, ... }；ok 且有 patch 时才写入。返回 compute 的结果。
function write(compute) {
  const run = async () => {
    const raw = await loadRaw();
    const result = compute(raw);
    if (result.ok && result.patch) await saveKeys(result.patch);
    return result;
  };
  const p = writeChain.then(run);
  writeChain = p.catch(() => {});
  return p;
}

// ok 是成功提示的 LabelSpec（[key, ...subs]），null 表示不提示
async function act(compute, ok) {
  try {
    const result = await write(compute);
    if (!result.ok) notify(result.error ? errorText(result.error) : t("notice_action_failed"), "error");
    else if (ok) notify(t(...ok));
    return result;
  } catch (err) {
    notify(t("notice_save_failed", errorText(err)), "error");
    return { ok: false };
  } finally {
    render();
  }
}

// 新增 / 编辑：校验错误交给对话框显示在表单旁；存储错误也作为表单错误显示
// okKey: "notice_added" | "notice_saved"
async function saveEngine(compute, okKey) {
  let result;
  try {
    result = await write(compute);
  } catch (err) {
    return { ok: false, errors: { form: t("notice_save_failed", errorText(err)) } };
  }
  if (!result.ok) return result;
  const granted = await isGranted(result.engine);
  if (!granted) attention.add(result.engine.id);
  const done = t(okKey, result.engine.name);
  notify(granted ? done : joinSentences(done, t("notice_needs_grant")), granted ? "ok" : "warn", { sticky: !granted });
  if (result.templateChanged) {
    notify(t("notice_template_changed", result.engine.name), "warn", { sticky: true });
  }
  render();
  return result;
}

const actions = {
  add: (input) => saveEngine(raw => addEngine(raw, input), "notice_added"),
  edit: (id, input) => saveEngine(raw => editEngine(raw, id, input), "notice_saved"),
  hide(e) {
    if (confirmRemoval("engine_confirm_hide", e)) act(raw => hideEngine(raw, e.id), ["notice_hidden", e.name]);
  },
  remove(e) {
    if (confirmRemoval("engine_confirm_delete", e)) act(raw => deleteEngine(raw, e.id), ["notice_deleted", e.name]);
  },
  restore: (e) => act(raw => restoreEngine(raw, e.id), ["notice_restored", e.name]),
  move(id, delta) {
    if (!current) return;
    const base = pendingOrder || current.engines.map(e => e.id);
    const next = moveId(base, id, delta);
    if (next === base) return;
    pendingOrder = next;
    render();
    clearTimeout(orderTimer);
    orderTimer = setTimeout(flushOrder, ORDER_DEBOUNCE_MS);
  },
};

async function flushOrder() {
  const order = pendingOrder;
  if (!order) return;
  try {
    await write(() => ({ ok: true, patch: { order } }));
  } catch (err) {
    notify(t("notice_order_save_failed", errorText(err)), "error");
  }
  if (pendingOrder === order) pendingOrder = null;
  render();
}

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

async function render() {
  const seq = ++renderSeq;
  let raw;
  try {
    [raw] = await Promise.all([loadRaw(), i18nReady]);
  } catch (err) {
    await i18nReady;
    applyStatic();
    notify(t("notice_load_failed", errorText(err)), "error");
    document.body.classList.remove("loading");
    return;
  }
  const cfg = mergeConfig(pendingOrder ? { ...raw, order: pendingOrder } : raw);
  // 连续切换时每次渲染各调一次 setLocale，它保证最后一次调用生效；被取代的渲染在下面的 seq 检查处退出
  const switching = cfg.uiLocale !== currentPref();
  if (switching) await setLocale(cfg.uiLocale).catch(log);
  const all = [...cfg.engines, ...cfg.hidden];
  const granted = new Map(await Promise.all(all.map(async e => [e.id, await isGranted(e)])));
  if (seq !== renderSeq) return; // 已有更新的渲染
  // 本次没切换，但上一次渲染的 setLocale 晚到生效（如快速切走又切回）：重来一次，按本次的 uiLocale 切换
  if (!switching && cfg.uiLocale !== currentPref()) return render();
  for (const id of attention) if (granted.get(id)) attention.delete(id);
  current = cfg;
  applyStatic();

  const langFocused = document.activeElement?.id === "lang-select";
  $("lang-picker").replaceChildren(renderLangPicker(cfg.uiLocale, pickLocale));
  if (langFocused) $("lang-select").focus();
  const ctx = { cfg, granted, attention, actions, refresh: render };
  const byId = new Map(all.map(e => [e.id, e]));
  $("banner").replaceChildren(...banner(cfg, byId, granted));
  $("pair-body").replaceChildren(...pairSection(cfg, byId, granted));
  $("triggers").replaceChildren(renderTriggers(ctx));
  $("engines").replaceChildren(renderEngineList(ctx));
  $("hidden-engines").replaceChildren(renderHiddenList(ctx));
  document.body.classList.remove("loading");
}

// 首次安装授权横幅：默认组合左侧未授权就一直显示
function banner(cfg, byId, granted) {
  const [left, right] = cfg.defaultPair.map(id => byId.get(id));
  if (!left || granted.get(left.id)) return [];
  const engines = right && right.id !== left.id && !granted.get(right.id) ? [left, right] : [left];
  const label = engines.length === 2
    ? ["options_banner_grant_both", left.name, right.name]
    : ["options_banner_grant_left", left.name];
  return [h("div", { class: "banner" },
    h("div", { class: "banner-text" },
      ht("strong", null, "options_banner_title"),
      ht("p", null, "options_banner_text", left.name)),
    authButton(engines, label, { cls: "btn btn-primary", onDone: render }))];
}

function pairSection(cfg, byId, granted) {
  const lefts = cfg.engines.filter(canBeLeft);
  const [l, r] = cfg.defaultPair;
  const leftSel = h("select", { id: "pair-left" }, lefts.map(e => option(e.id, e.name, e.id === l)));
  const rightSel = h("select", { id: "pair-right" }, cfg.engines.map(e => option(e.id, e.name, e.id === r)));
  const save = () => act(raw => setDefaultPair(raw, leftSel.value, rightSel.value), ["notice_pair_saved"]);
  leftSel.addEventListener("change", save);
  rightSel.addEventListener("change", save);

  const nodes = [h("div", { class: "pair-pickers" },
    h("label", null, ht("span", null, "common_left"), leftSel),
    h("span", { class: "pair-sep", "aria-hidden": "true" }, "｜"),
    h("label", null, ht("span", null, "common_right"), rightSel))];
  const left = byId.get(l);
  if (left && !granted.get(left.id)) {
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
  setupGuide();
});
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "sync") render(); });
chrome.permissions.onAdded.addListener(() => render());
chrome.permissions.onRemoved.addListener(() => render());
render();
