// 设置页与语言相关的界面：带内联 <code> 的句子。
import { h } from "./ui.js";
import { t, tNodes } from "../chrome/i18n.js";

// [元素 id, key, 内联节点]：节点按占位符顺序传给 tNodes，每次调用都新建
const RICH_TEXT = [
  ["engines-hint", "options_engines_hint", () => [h("code", null, "%s")]],
  ["guide-step-fields", "guide_step_fields", () => [h("code", null, t("guide_example_keyword"))]],
];

export function applyRichText() {
  for (const [id, key, nodes] of RICH_TEXT) {
    document.getElementById(id)?.replaceChildren(...tNodes(key, nodes()));
  }
}
