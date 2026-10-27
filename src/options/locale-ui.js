// 设置页与语言相关的界面：带内联 <code> 的句子、语言下拉框。
import { h, ht, option } from "./ui.js";
import { t, tNodes } from "../chrome/i18n.js";
import { LOCALES, resolveLocale } from "../lib/i18n.js";

// [元素 id, key, 内联节点]：节点按占位符顺序传给 tNodes，每次调用都新建
const RICH_TEXT = [
  ["guide-step-fields", "guide_step_fields", () => [h("code", null, t("guide_example_keyword"))]],
];

export function applyRichText() {
  for (const [id, key, nodes] of RICH_TEXT) {
    document.getElementById(id)?.replaceChildren(...tNodes(key, nodes()));
  }
}

// 各语言的本名：4 份目录里文字相同，选错语言的用户也认得出自己的语言
const NATIVE_NAME_KEYS = { en: "lang_name_en", zh_CN: "lang_name_zh_cn", zh_TW: "lang_name_zh_tw", es: "lang_name_es" };

// pref 是 mergeConfig 规范化过的 uiLocale；选中新值时调用 onPick(value)
export function renderLangPicker(pref, onPick) {
  const browserLocale = resolveLocale("auto", chrome.i18n.getUILanguage());
  const select = h("select", { id: "lang-select" },
    option("auto", t("lang_auto", t(NATIVE_NAME_KEYS[browserLocale])), pref === "auto"),
    LOCALES.map(l => option(l, t(NATIVE_NAME_KEYS[l]), pref === l)));
  select.addEventListener("change", () => onPick(select.value));
  return h("label", { class: "lang-picker" }, ht("span", null, "lang_label"), select);
}
