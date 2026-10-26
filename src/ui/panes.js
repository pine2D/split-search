// 左右窗格：镜像工具栏图标的两格（左松绿、右暖雾灰），样式在 styles/panes.css。设置页的组合下拉框和弹窗共用。
// 只建 DOM，文字由调用方准备好（label 是已经带 data-i18n 的元素或文本节点）。

// side："left" | "right"；tag：窗格本身的元素（包着下拉框时用 "label"，只读展示可用 "dl" 等）；
// label：小标题元素，加上 pane-label；children：窗格内容
export function pane(side, tag, label, ...children) {
  const el = document.createElement(tag);
  el.className = `pane pane-${side}`;
  label.classList.add("pane-label");
  el.append(label, ...children);
  return el;
}

// 两个窗格并排（窄宽度时上下堆叠，左在上），cls 是附加的 class
export function panes(left, right, cls = "") {
  const el = document.createElement("div");
  el.className = cls ? `panes ${cls}` : "panes";
  el.append(left, right);
  return el;
}
