// 设置页编排：读配置 → 实时查授权 → 渲染各区块；所有写入串行执行“loadRaw → 改整键 → saveKeys”。
import { loadRaw, saveKeys } from "../chrome/config-store.js";
import { mergeConfig } from "../lib/engines.js";
import { h, notify, errorText, authButton, option, isGranted } from "./ui.js";
import {
  addEngine, editEngine, hideEngine, restoreEngine, deleteEngine, setDefaultPair, moveId, canBeLeft,
} from "./edits.js";
import { renderEngineList, renderHiddenList, setupEngineDialog, confirmRemoval } from "./engine-list.js";
import { renderTriggers, setupGuide } from "./guide.js";

const ORDER_DEBOUNCE_MS = 500;
const $ = (id) => document.getElementById(id);

const attention = new Set(); // 保存后尚未授权的引擎：突出显示“授权”按钮
let pendingOrder = null;     // 防抖期间的本地排序
let orderTimer = null;
let renderSeq = 0;
let current = null;          // 最近一次渲染用的 cfg

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

async function act(compute, okText) {
  try {
    const result = await write(compute);
    if (!result.ok) notify(result.error || "操作失败", "error");
    else if (okText) notify(okText);
    return result;
  } catch (err) {
    notify(`保存失败：${errorText(err)}`, "error");
    return { ok: false };
  } finally {
    render();
  }
}

// 新增 / 编辑：校验错误交给对话框显示在表单旁；存储错误也作为表单错误显示
async function saveEngine(compute, verb) {
  let result;
  try {
    result = await write(compute);
  } catch (err) {
    return { ok: false, errors: { form: `保存失败：${errorText(err)}` } };
  }
  if (!result.ok) return result;
  const granted = await isGranted(result.engine);
  if (!granted) attention.add(result.engine.id);
  const parts = [`已${verb}“${result.engine.name}”。`];
  if (!granted) parts.push("它的网站还没授权，请点该行高亮的“授权”按钮。");
  notify(parts.join(""), granted ? "ok" : "warn", { sticky: !granted });
  if (result.templateChanged) {
    notify(`“${result.engine.name}”的网址已修改：以该引擎为左侧的网站搜索网址需要重新复制（用下方“触发网址”重新生成），`
      + "并替换 Chrome 设置里对应网站搜索的网址。", "warn", { sticky: true });
  }
  render();
  return result;
}

const actions = {
  add: (input) => saveEngine(raw => addEngine(raw, input), "新增"),
  edit: (id, input) => saveEngine(raw => editEngine(raw, id, input), "保存"),
  hide(e) {
    if (confirmRemoval(e, "隐藏")) act(raw => hideEngine(raw, e.id), `已隐藏“${e.name}”`);
  },
  remove(e) {
    if (confirmRemoval(e, "删除")) act(raw => deleteEngine(raw, e.id), `已删除“${e.name}”`);
  },
  restore: (e) => act(raw => restoreEngine(raw, e.id), `已恢复“${e.name}”`),
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
    notify(`排序保存失败：${errorText(err)}`, "error");
  }
  if (pendingOrder === order) pendingOrder = null;
  render();
}

// ---- 渲染 ----

async function render() {
  const seq = ++renderSeq;
  let raw;
  try {
    raw = await loadRaw();
  } catch (err) {
    notify(`读取配置失败：${errorText(err)}`, "error");
    document.body.classList.remove("loading");
    return;
  }
  const cfg = mergeConfig(pendingOrder ? { ...raw, order: pendingOrder } : raw);
  const all = [...cfg.engines, ...cfg.hidden];
  const granted = new Map(await Promise.all(all.map(async e => [e.id, await isGranted(e)])));
  if (seq !== renderSeq) return; // 已有更新的渲染
  for (const id of attention) if (granted.get(id)) attention.delete(id);
  current = cfg;

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
    ? `点此授权 ${left.name}（必需）和 ${right.name}（建议）`
    : `点此授权 ${left.name}（必需）`;
  return [h("div", { class: "banner" },
    h("div", { class: "banner-text" },
      h("strong", null, "还差一步：授权访问搜索引擎网站"),
      h("p", null, `分屏靠拦截发往左侧引擎 ${left.name} 的搜索请求实现，必须授权它的网站；`
        + "右侧引擎授权后，再次搜索时能识别并就地更新本扩展打开的分屏。授权只针对这两个网站。")),
    authButton(engines, label, { cls: "btn btn-primary", onDone: render }))];
}

function pairSection(cfg, byId, granted) {
  const lefts = cfg.engines.filter(canBeLeft);
  const [l, r] = cfg.defaultPair;
  const leftSel = h("select", { id: "pair-left" }, lefts.map(e => option(e.id, e.name, e.id === l)));
  const rightSel = h("select", { id: "pair-right" }, cfg.engines.map(e => option(e.id, e.name, e.id === r)));
  const save = () => act(raw => setDefaultPair(raw, leftSel.value, rightSel.value),
    "默认组合已保存。记得把新的触发网址复制到 Chrome 并设为默认。");
  leftSel.addEventListener("change", save);
  rightSel.addEventListener("change", save);

  const nodes = [h("div", { class: "pair-pickers" },
    h("label", null, h("span", null, "左侧"), leftSel),
    h("span", { class: "pair-sep", "aria-hidden": "true" }, "｜"),
    h("label", null, h("span", null, "右侧"), rightSel))];
  const left = byId.get(l);
  if (left && !granted.get(left.id)) {
    nodes.push(h("div", { class: "callout callout-warn" },
      h("span", null, `左侧 ${left.name} 还没授权，目前搜索不会分屏，只会打开普通的 ${left.name} 搜索。`),
      authButton([left], `授权 ${left.name}`, { cls: "btn btn-small btn-attention", onDone: render })));
  }
  return nodes;
}

// ---- 启动 ----

setupEngineDialog(actions);
setupGuide();
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "sync") render(); });
chrome.permissions.onAdded.addListener(() => render());
chrome.permissions.onRemoved.addListener(() => render());
render();
