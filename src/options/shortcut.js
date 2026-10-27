// 设置页的快捷键卡：“快捷键”一行显示 cycle-right 当前绑定的组合键，按钮打开 Chrome 的快捷键页（chrome/shortcuts.js，弹窗底部共用）；
// 下面是参与轮换的引擎清单（写 cycleExclude）。
import { h, ht, disclosure } from "./ui.js";
import { currentShortcut, openShortcutsPage } from "../chrome/shortcuts.js";

// 固定 id：重画这一行后设置页据此把焦点还给按钮
export const SHORTCUT_BUTTON_ID = "shortcut-open";

export async function renderShortcut() {
  const shortcut = await currentShortcut();
  const value = shortcut
    ? h("kbd", { class: "shortcut-key" }, shortcut)
    : ht("span", { class: "muted" }, "options_shortcut_unset");
  return h("div", { class: "shortcut-row" },
    h("span", { class: "shortcut-current" }, ht("span", null, "options_shortcut_label"), value),
    ht("button", { type: "button", id: SHORTCUT_BUTTON_ID, class: "btn btn-small", onclick: openShortcutsPage }, "options_shortcut_open"));
}

// 参与轮换的引擎：只列可见的文字引擎（与 lib/cycle.js 的 cycleCandidates 一致），按引擎顺序，也就是轮换顺序。
// 默认收起，summary 带“已选几个、共几个”，收起时也看得到；引擎行上的“不参与轮换”标签是另一个入口。
// 复选框的 id 让重渲染后焦点能回到它（options.js 的 render）；可见的引擎名就是它的无障碍名称，分组名由 legend 给出。
// ctx: { cfg, actions }
export function renderCycleList({ cfg, actions }) {
  const included = e => !cfg.cycleExclude.includes(e.id);
  const boxes = cfg.engines.map(e => {
    const box = h("input", { type: "checkbox", id: `cycle-${e.id}` });
    box.checked = included(e);
    // 勾选框本身就是反馈，成功不提示；失败时提示，重渲染后退回已保存的状态
    box.addEventListener("change", () => actions.setCycle(e.id, box.checked));
    return h("label", { class: "check-row" }, box, h("span", null, e.name));
  });
  return disclosure("shortcut-cycle", ["options_cycle_title", cfg.engines.filter(included).length, cfg.engines.length],
    h("fieldset", { class: "cycle-list" }, ht("legend", { class: "hint" }, "options_cycle_hint"), boxes));
}
