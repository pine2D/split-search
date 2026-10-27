// 设置页的写入与动作：串行写入（loadRaw → 改整键 → saveKeys / removeKeys）、提示、各区块用的 actions。
// render / 当前配置由 options.js 经 bindActions 注入。
import { loadRaw, saveKeys, removeKeys } from "../chrome/config-store.js";
import { notify, errorText, isGranted, joinSentences } from "./ui.js";
import {
  addEngine, editEngine, hideEngine, restoreEngine, deleteEngine, moveId, reconcileOrder, addFromCatalog, needsGrantWarning, setCycle,
  setLookupEngine,
} from "./edits.js";
import { addImageEngine, addImageFromCatalog, deleteImageEngine, setImageEngine } from "./image-edits.js";
import { addRule, editRule, moveRule, removeRule, moveNotice, removeNotice } from "./rule-edits.js";
import { isReordering } from "./reorder.js";
import { focusIn } from "./tabs.js";
import { currentLocale, t } from "../chrome/i18n.js";

const ORDER_DEBOUNCE_MS = 500;

export const attention = new Set(); // 保存后尚未授权的引擎：突出显示“授权”按钮
let pendingOrder = null;           // 防抖期间的本地排序
let orderTimer = null;
let deps = { render() {}, current: () => null };
let lastRender = Promise.resolve(); // 最近一次 act 触发的渲染：要在重渲染之后挪焦点的调用方等它

export const getPendingOrder = () => pendingOrder;
export function bindActions(d) { deps = d; }
const render = () => deps.render();

let writeChain = Promise.resolve();

// patch 已经写进去之后再删键：storage.sync 没有“写入并删除”的原子操作，删键失败时重新读一次，
// 键确实都不在了就算成功；否则抛 partial 错误（保留原因），提示改动已保存、只是有一项没清掉，不报成“保存失败”
async function removeAfterSave(keys) {
  try {
    await removeKeys(keys);
  } catch (err) {
    let raw = null;
    try { raw = await loadRaw(); } catch { /* 读不出来就按没删掉处理 */ }
    if (raw && keys.every(k => !Object.hasOwn(raw, k))) return;
    throw Object.assign(new Error(err?.message ?? String(err)), { partial: true });
  }
}

// compute(raw) 返回 { ok, patch?, remove?, ... }；ok 时先写 patch（有的话），再删 remove 里的键。返回 compute 的结果。
export function write(compute) {
  const run = async () => {
    const raw = await loadRaw();
    const result = compute(raw);
    if (result.ok && result.patch) await saveKeys(result.patch);
    if (result.ok && result.remove?.length) {
      if (result.patch) await removeAfterSave(result.remove);
      else await removeKeys(result.remove);
    }
    return result;
  };
  const p = writeChain.then(run);
  writeChain = p.catch(() => {});
  return p;
}

// write 抛错时的提示：partial（改动已保存，有一项没清掉）用警告级的单独文案，其余是“保存失败”
export function saveFailure(err) {
  return err?.partial ? { key: "notice_save_partial", level: "warn" } : { key: "notice_save_failed", level: "error" };
}
const failText = (err) => t(saveFailure(err).key, errorText(err));

// ok 是成功提示的 LabelSpec（[key, ...subs]），或按 compute 的结果算 LabelSpec 的函数；null 表示不提示
export async function act(compute, ok) {
  try {
    const result = await write(compute);
    if (!result.ok) notify(result.error ? errorText(result.error) : t("notice_action_failed"), "error");
    else {
      const label = typeof ok === "function" ? ok(result) : ok;
      if (label) notify(t(...label));
    }
    return result;
  } catch (err) {
    notify(failText(err), saveFailure(err).level);
    return { ok: false };
  } finally {
    lastRender = Promise.resolve(render()).catch(() => {});
  }
}

// 新增 / 编辑：校验错误交给对话框显示在表单旁；存储错误也作为表单错误显示
// okKey: "notice_added" | "notice_saved"
async function saveEngine(compute, okKey) {
  let result;
  try {
    result = await write(compute);
  } catch (err) {
    return { ok: false, errors: { form: failText(err) } };
  }
  if (!result.ok) return result;
  const warn = needsGrantWarning(result.engine, await isGranted(result.engine));
  if (warn) attention.add(result.engine.id);
  const done = t(okKey, result.engine.name);
  notify(warn ? joinSentences(done, t("notice_needs_grant")) : done, warn ? "warn" : "ok", { sticky: warn });
  if (result.templateChanged) {
    notify(t("notice_template_changed", result.engine.name), "warn", { sticky: true });
  }
  render();
  return result;
}

// 以图搜图引擎的新增：不涉及授权，校验错误交给对话框
async function saveImage(compute, okKey) {
  let result;
  try {
    result = await write(compute);
  } catch (err) {
    return { ok: false, errors: { form: failText(err) } };
  }
  if (!result.ok) return result;
  notify(t(okKey, result.engine.name));
  render();
  return result;
}

// 关键词规则的新增 / 编辑：校验错误交给对话框；成功后等重渲染完再返回，对话框据此把焦点交给这一行的“编辑”
async function saveRule(compute) {
  let result;
  try { result = await write(compute); } catch (err) { return { ok: false, errors: { form: failText(err) } }; }
  if (!result.ok) return result;
  notify(t("notice_rule_saved"));
  await (lastRender = Promise.resolve(render()).catch(() => {}));
  return result;
}

export const actions = {
  add: (input) => saveEngine(raw => addEngine(raw, input), "notice_added"),
  edit: (id, input) => saveEngine(raw => editEngine(raw, id, input), "notice_saved"),
  // 引擎库条目按右侧用途处理：不进 attention，不显示“需授权”
  addFromCatalog: (entry) => act(raw => addFromCatalog(raw, entry, currentLocale()), ["notice_catalog_added", entry.name]),
  // 隐藏随时能恢复，不确认：提示里带“撤销”。隐藏只能从编辑对话框发起，这一行马上就没了，
  // 所以一律把焦点交给“撤销”，键盘用户一按就能撤回
  async hide(e) {
    const result = await act(raw => hideEngine(raw, e.id), null);
    if (!result.ok) return;
    const toast = notify(t("notice_hidden", e.name), "ok", { action: { key: "common_undo", run: () => undoHide(e) } });
    toast?.querySelector(".notice-action")?.focus();
  },
  // 删除按钮自己要点两次（编辑对话框里，engine-list.js），这里不再确认；删掉后焦点交给相邻的一行
  remove: (e) => deleteWithFocus(ENGINE_LIST, e.id, "add-engine",
    () => act(raw => deleteEngine(raw, e.id),
      r => (r.rulesDropped ? ["notice_deleted_with_rules", e.name, r.rulesDropped] : ["notice_deleted", e.name]))),
  restore: (e) => act(raw => restoreEngine(raw, e.id), ["notice_restored", e.name]),
  // 勾选框本身就是反馈，成功不弹提示；失败照常提示，重渲染后开关退回已保存的状态
  setCycle: (id, included) => act(raw => setCycle(raw, id, included), null),
  // 查词 / 以图搜图引擎：下拉框本身就是反馈，成功给一句提示
  setLookupEngine: (id) => act(raw => setLookupEngine(raw, id), ["notice_lookup_saved"]),
  setImageEngine: (id) => act(raw => setImageEngine(raw, id), ["notice_image_engine_saved"]),
  addImageEngine: (input) => saveImage(raw => addImageEngine(raw, input), "notice_added"),
  addImageFromCatalog: (entry) => act(raw => addImageFromCatalog(raw, entry), ["notice_catalog_added", entry.name]),
  // 关键词规则（rules.js）：上移 / 下移立即写；删除在规则对话框里点两次，删后焦点交给相邻行的“编辑”
  addRule: (form) => saveRule(raw => addRule(raw, form)),
  editRule: (id, form) => saveRule(raw => editRule(raw, id, form)),
  moveRule: (id, delta) => act(raw => moveRule(raw, id, delta), moveNotice),
  removeRule: (id) => deleteWithFocus(RULE_LIST, id, "rule-add", () => act(raw => removeRule(raw, id), removeNotice)),
  deleteImageEngine: (e) => deleteWithFocus(IMAGE_LIST, e.id, "image-add-open",
    () => act(raw => deleteImageEngine(raw, e.id), ["notice_deleted", e.name])),
  // 返回移动后的顺序（“调整顺序”模式据此播报位置），没动时返回 null。base 经 reconcileOrder 对齐当前可见引擎：
  // 防抖期内刚恢复的引擎不在 pendingOrder 里，不对齐的话 moveId 找不到它，点了没有反应
  move(id, delta) {
    const current = deps.current();
    if (!current) return null;
    const base = reconcileOrder(pendingOrder, current.engines.map(e => e.id));
    const next = moveId(base, id, delta);
    if (next === base) return null;
    pendingOrder = next;
    render();
    clearTimeout(orderTimer);
    orderTimer = setTimeout(flushOrder, ORDER_DEBOUNCE_MS);
    return next;
  },
};

// list：列表选择器；actions：行里放操作按钮的那一块（文字引擎是 .row-actions，只有编辑按钮）
const ENGINE_LIST = { list: "#engines .engine-list", actions: ".row-actions" };
const IMAGE_LIST = { list: "#lookup-body .engine-list", actions: ".engine-side" };
const RULE_LIST = { list: "#rule-list", actions: ".row-actions" };

// 删除成功后这一行没了，焦点不能落回 body：等列表重建后交给相邻一行（优先下一行）里第一个可用的按钮，
// 没有相邻行（或那一行没有可用按钮，如内置的 Google Lens）就交给 fallbackId（该列表的添加按钮）
async function deleteWithFocus({ list, actions: scope }, id, fallbackId, run) {
  const rows = [...document.querySelectorAll(`${list} > li[data-id]`)];
  const i = rows.findIndex(r => r.dataset.id === id);
  const neighbor = i < 0 ? null : (rows[i + 1] ?? rows[i - 1])?.dataset.id ?? null;
  const result = await run();
  await lastRender;
  if (!result.ok) return result;
  const row = neighbor && document.querySelector(`${list} > li[data-id="${CSS.escape(neighbor)}"]`);
  const btn = row?.querySelector(`${scope} button:not([disabled])`);
  (btn ?? document.getElementById(fallbackId))?.focus();
  return result;
}

// 提示里的“撤销”：恢复显示，等列表重建后把焦点放回这一行的“编辑”按钮（提示已经关掉，焦点不能留在那里）；
// 提示还在时进了“调整顺序”，模式中的行没有“编辑”，交给卡头的“完成”；已切到别的 tab 时 focusIn 交给当前 tab 按钮，不替用户切回
async function undoHide(e) {
  const result = await actions.restore(e);
  await lastRender;
  if (result.ok) focusIn(document.getElementById(`edit-${e.id}`) ?? (isReordering() ? document.getElementById("engines-reorder") : null));
}

// 退出“调整顺序”时立刻写出，不等防抖（reorder.js）
export function flushOrderNow() {
  clearTimeout(orderTimer);
  orderTimer = null;
  return flushOrder();
}

export async function flushOrder() {
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
