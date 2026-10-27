// 引擎卡的“调整顺序”模式：卡头按钮进入 / 退出，模式中每行只有上移 / 下移（engine-list.js 的 engineRow 按 isReordering() 分支）。
// 模式状态记在模块变量里，跨重渲染保留（另一页改了顺序、storage.onChanged 重渲染时不退出）；刷新页面回到平时。
// 退出（“完成”、焦点在卡里时按 Esc，或可见引擎不足 2 个时自动退出）时立刻写出防抖中的排序。
// 卡头说明、播报（#engines-status，role="status"）都是 options.html 里 #engines 之外的静态 DOM：#engines 每次渲染都整个换掉。
import { h } from "./ui.js";
import { movePosition } from "./edits.js";
import { t, setI18nText } from "../chrome/i18n.js";
import { icon } from "../ui/icons.js";

const $ = (id) => document.getElementById(id);
let reordering = false;
let count = 0; // 最近一次渲染的可见引擎数
let deps = { render() {}, flush() {} };

export const isReordering = () => reordering;

// render：重渲染设置页；flush：立刻写出防抖中的排序（actions.js 的 flushOrderNow）
export function setupReorder({ render, flush }) {
  deps = { render, flush };
  const btn = $("engines-reorder");
  btn.addEventListener("click", () => (reordering ? leaveReorder() : enter()));
  // 监听挂在整张引擎卡上：焦点在“完成”、上移 / 下移、“已隐藏”的“恢复”上按 Esc 都退出；模式外不处理
  btn.closest("section").addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !reordering || ev.defaultPrevented) return;
    ev.preventDefault();
    leaveReorder();
  });
}

function enter() {
  if (count < 2) return;
  reordering = true;
  syncHeader();
  $("engines-status").textContent = t("engine_reorder_hint");
  deps.render();
}

// 主动退出：焦点留在（或回到）卡头按钮上，它是静态 DOM，不随列表重建；不依赖 flushOrder 末尾的 render（没有待写排序时它不渲染）。
// 不在模式中时什么都不做。切走“搜索引擎”tab 时 options.js 以 focus: false 调用：退出并写出排序，不抢焦点
export function leaveReorder({ focus = true } = {}) {
  if (!reordering) return;
  reordering = false;
  syncHeader();
  if (focus) $("engines-reorder").focus();
  deps.flush();
  deps.render();
}

// renderEngineList 每次渲染开头、建行之前调用：先判断要不要自动退出，再按当前状态更新卡头。
// 自动退出发生在渲染里，这次渲染已经是平时的行，不再调 render()
export function syncReorder(visible) {
  count = visible;
  if (reordering && count < 2) {
    reordering = false;
    deps.flush();
  }
  syncHeader();
}

// 文字会变的按钮不加 aria-pressed（APG）：状态靠按钮文字和说明文字，不只靠颜色。
// 按钮自己有焦点时被藏起来（可见引擎不足 2 个，模式中还会自动退出）：它是静态 DOM，不随列表重建，
// 渲染后 activeElement 仍是这个隐藏的按钮、不是 body，focusAfterRender 管不到，所以在这里把焦点交给“新增引擎”（这时已退出模式，它看得见）
function syncHeader() {
  const btn = $("engines-reorder");
  const hadFocus = document.activeElement === btn;
  setI18nText(btn, reordering ? "engine_reorder_done" : "engine_reorder");
  btn.className = reordering ? "btn btn-small btn-primary" : "btn btn-small";
  btn.hidden = !reordering && count < 2;
  // 模式只管排序：藏起新增，也避免排序途中多出一行
  $("catalog-open").hidden = reordering;
  $("add-engine").hidden = reordering;
  $("engines-hint").hidden = reordering;
  $("engines-reorder-hint").hidden = !reordering;
  if (!reordering) $("engines-status").textContent = "";
  if (hadFocus && btn.hidden) $("add-engine").focus();
}

// 模式中一行的上移 / 下移。id 让重渲染后焦点回到同一个按钮（options.js 的 focusAfterRender，移到边缘被禁用时交给另一个方向的）
export function moveButtons(e, index, total, actions) {
  const move = (delta) => () => {
    const order = actions.move(e.id, delta);
    if (order) announceMove(order, e.id, e.name);
  };
  return h("div", { class: "row-move" },
    h("button", { type: "button", id: `move-up-${e.id}`, class: "btn btn-small btn-icon", disabled: index === 0,
      title: t("engine_move_up"), "aria-label": t("engine_move_up_label", e.name), "data-move": "up",
      onclick: move(-1) }, icon("arrow-up")),
    h("button", { type: "button", id: `move-down-${e.id}`, class: "btn btn-small btn-icon", disabled: index === total - 1,
      title: t("engine_move_down"), "aria-label": t("engine_move_down_label", e.name), "data-move": "down",
      onclick: move(1) }, icon("arrow-down")));
}

// 每次移动播报一句“Google：第 2 位，共 5 个”。一次性的播报，不带 data-i18n
export function announceMove(order, id, name) {
  const p = movePosition(order, id);
  if (p) $("engines-status").textContent = t("engine_moved", name, p.pos, p.total);
}
