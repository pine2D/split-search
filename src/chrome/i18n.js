// 页内文案加载器：读扩展包内的 _locales/*/messages.json，支持运行时切换语言。
// 顶层不访问 chrome、document、fetch：设置页的 node 测试会 import 本模块。
import {
  DEFAULT_LOCALE, MARK_OPEN, MARK_CLOSE,
  resolveLocale, normalizeLocalePref, formatMessage, splitMarked,
} from "../lib/i18n.js";
import { safeError } from "../lib/safe-error.js";

let chosen = null;
let fallback = null;
let pref = null;
let locale = null;
let loaded = false;
let localeToken = 0;

// 读一份语言文件；失败记错并返回 null，不让 setLocale 整体 reject。
function load(l) {
  return fetch(chrome.runtime.getURL(`_locales/${l}/messages.json`))
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch((err) => {
      console.error("[split-search] failed to load locale", l, safeError(err));
      return null;
    });
}

// 最后一次调用生效：读完时已有更新的调用，就不写任何模块状态。
export async function setLocale(nextPref) {
  const token = ++localeToken;
  const next = resolveLocale(nextPref, chrome.i18n.getUILanguage());
  const [c, f] = await Promise.all([
    load(next),
    next === DEFAULT_LOCALE ? null : load(DEFAULT_LOCALE),
  ]);
  if (token !== localeToken) return next;
  chosen = c;
  fallback = f;
  pref = nextPref;
  locale = next;
  loaded = true;
  // SW 里没有 document（菜单标题也经 t()，spec 3.6）
  if (typeof document !== "undefined") document.documentElement.lang = next.replace("_", "-");
  return next;
}

// go.html 和设置页的入口。
export async function initI18n() {
  const got = await Promise.resolve()
    .then(() => chrome.storage.sync.get("uiLocale"))
    .catch(() => ({}));
  return setLocale(normalizeLocalePref(got?.uiLocale));
}

export function currentPref() {
  return pref;
}

export function currentLocale() {
  return locale;
}

const entryOf = (catalog, key) => (catalog && Object.hasOwn(catalog, key) ? catalog[key] : null);

export function t(key, ...subs) {
  if (!loaded) throw new Error("[split-search] t() called before i18n loaded: " + key);
  const args = subs.map(String);
  const entry = entryOf(chosen, key) ?? entryOf(fallback, key);
  if (entry) return formatMessage(entry, args);
  if (chosen === null && fallback === null) {
    console.error("[split-search] no locale catalog loaded, using chrome.i18n", key);
    const msg = chrome.i18n.getMessage(key, args);
    if (msg) return msg;
  }
  console.error("[split-search] missing message", key);
  return key;
}

// 带内联元素的句子：节点位置先用私有区字符标记，格式化后再换回节点。
export function tNodes(key, nodes) {
  const text = t(key, ...nodes.map((_, i) => MARK_OPEN + i + MARK_CLOSE));
  return splitMarked(text).map((part) => (typeof part === "number" ? nodes[part] : part));
}

// 同一元素按情况写不同 key 时用它，applyI18n 切换语言时才能按当前 key 和参数重写。
export function setI18nText(el, key, ...subs) {
  const args = subs.map(String);
  el.textContent = t(key, ...args);
  el.setAttribute("data-i18n", key);
  if (args.length) el.setAttribute("data-i18n-args", JSON.stringify(args));
  else el.removeAttribute("data-i18n-args");
}

// data-i18n 写 textContent（<title> 即 document.title），data-i18n-attr="attr:key;attr:key" 写属性。
// 单个元素出错只记日志并跳过；无论如何都去掉 i18n-pending，页面不会一直不可见。
export function applyI18n(root = document) {
  try {
    for (const el of root.querySelectorAll("[data-i18n]")) {
      const key = el.getAttribute("data-i18n");
      try {
        el.textContent = t(key, ...JSON.parse(el.getAttribute("data-i18n-args") ?? "[]"));
      } catch (err) {
        console.error("[split-search] applyI18n", key, safeError(err));
      }
    }
    for (const el of root.querySelectorAll("[data-i18n-attr]")) {
      const spec = el.getAttribute("data-i18n-attr");
      try {
        for (const pair of spec.split(";")) {
          const [attr, key] = pair.split(":").map((s) => s.trim());
          if (attr && key) el.setAttribute(attr, t(key));
        }
      } catch (err) {
        console.error("[split-search] applyI18n", spec, safeError(err));
      }
    }
  } finally {
    document.documentElement.classList.remove("i18n-pending");
  }
}
