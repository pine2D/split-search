// 设置页的写入与动作：串行写入（loadRaw → 改整键 → saveKeys / removeKeys）、提示、各区块用的 actions。
// render / 当前配置由 options.js 经 bindActions 注入。
import { loadRaw, saveKeys, removeKeys } from "../chrome/config-store.js";
import { notify, errorText, isGranted, joinSentences } from "./ui.js";
import {
  addEngine, editEngine, hideEngine, restoreEngine, deleteEngine, moveId, addFromCatalog, needsGrantWarning, setCycle,
  setLookupEngine,
} from "./edits.js";
import { addImageEngine, addImageFromCatalog, deleteImageEngine, setImageEngine } from "./image-edits.js";
import { confirmRemoval } from "./engine-list.js";
import { currentLocale, t } from "../chrome/i18n.js";

const ORDER_DEBOUNCE_MS = 500;

export const attention = new Set(); // 保存后尚未授权的引擎：突出显示“授权”按钮
let pendingOrder = null;           // 防抖期间的本地排序
let orderTimer = null;
let deps = { render() {}, current: () => null };

export const getPendingOrder = () => pendingOrder;
export function bindActions(d) { deps = d; }
const render = () => deps.render();

let writeChain = Promise.resolve();

// compute(raw) 返回 { ok, patch?, remove?, ... }；ok 时先写 patch（有的话），再删 remove 里的键。返回 compute 的结果。
export function write(compute) {
  const run = async () => {
    const raw = await loadRaw();
    const result = compute(raw);
    if (result.ok && result.patch) await saveKeys(result.patch);
    if (result.ok && result.remove?.length) await removeKeys(result.remove);
    return result;
  };
  const p = writeChain.then(run);
  writeChain = p.catch(() => {});
  return p;
}

// ok 是成功提示的 LabelSpec（[key, ...subs]），null 表示不提示
export async function act(compute, ok) {
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
    return { ok: false, errors: { form: t("notice_save_failed", errorText(err)) } };
  }
  if (!result.ok) return result;
  notify(t(okKey, result.engine.name));
  render();
  return result;
}

export const actions = {
  add: (input) => saveEngine(raw => addEngine(raw, input), "notice_added"),
  edit: (id, input) => saveEngine(raw => editEngine(raw, id, input), "notice_saved"),
  // 引擎库条目按右侧用途处理：不进 attention，不显示“需授权”
  addFromCatalog: (entry) => act(raw => addFromCatalog(raw, entry, currentLocale()), ["notice_catalog_added", entry.name]),
  hide(e) {
    if (confirmRemoval("engine_confirm_hide", e)) act(raw => hideEngine(raw, e.id), ["notice_hidden", e.name]);
  },
  remove(e) {
    if (confirmRemoval("engine_confirm_delete", e)) act(raw => deleteEngine(raw, e.id), ["notice_deleted", e.name]);
  },
  restore: (e) => act(raw => restoreEngine(raw, e.id), ["notice_restored", e.name]),
  // 勾选框本身就是反馈，成功不弹提示；失败照常提示，重渲染后开关退回已保存的状态
  setCycle: (id, included) => act(raw => setCycle(raw, id, included), null),
  // 查词 / 以图搜图引擎：下拉框本身就是反馈，成功给一句提示
  setLookupEngine: (id) => act(raw => setLookupEngine(raw, id), ["notice_lookup_saved"]),
  setImageEngine: (id) => act(raw => setImageEngine(raw, id), ["notice_image_engine_saved"]),
  addImageEngine: (input) => saveImage(raw => addImageEngine(raw, input), "notice_added"),
  addImageFromCatalog: (entry) => act(raw => addImageFromCatalog(raw, entry), ["notice_catalog_added", entry.name]),
  deleteImageEngine(e) {
    if (confirm(t("engine_confirm_delete_image", e.name))) act(raw => deleteImageEngine(raw, e.id), ["notice_deleted", e.name]);
  },
  move(id, delta) {
    const current = deps.current();
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
