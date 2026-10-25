// 纯逻辑：右键菜单两项的属性（spec 3.6）。不引用 chrome。
export const MENU_TEXT = "ss-lookup-text";
export const MENU_IMAGE = "ss-lookup-image";
export const PAGE_PATTERNS = Object.freeze(["https://*/*", "http://*/*"]);

// 引擎名是用户数据：& 写成 &&（不被当成助记键），%s 拆成 % s（Chrome 不会把它换成选中的文字）
export function menuSafeName(name) {
  return String(name).replace(/&/g, "&&").replace(/%s/g, "% s");
}

// t 是文案函数（SW 里传 chrome/i18n.js 的 t）；标题里给 Chrome 的 %s 写在文案里
export function menuItems({ textEngine, imageEngine }, t) {
  return [
    { id: MENU_TEXT, title: t("menu_lookup_text", menuSafeName(textEngine.name)), contexts: ["selection"],
      documentUrlPatterns: [...PAGE_PATTERNS] },
    { id: MENU_IMAGE, title: t("menu_lookup_image", menuSafeName(imageEngine.name)), contexts: ["image"],
      documentUrlPatterns: [...PAGE_PATTERNS], targetUrlPatterns: [...PAGE_PATTERNS] },
  ];
}
