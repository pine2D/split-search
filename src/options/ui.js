// 设置页的 DOM 小工具。所有文字都用 textContent / 文本节点写入，不用 innerHTML。
import { engineOrigin } from "../lib/engines.js";
import { errorKey } from "../lib/errors.js";
import { t, setI18nText, currentLocale } from "../chrome/i18n.js";

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (typeof v === "boolean") el[k] = v;
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

// 带 key 的元素：切换语言时 applyI18n 按 data-i18n / data-i18n-args 重写文字
export function ht(tag, props, key, ...subs) {
  return h(tag, {
    ...props,
    "data-i18n": key,
    "data-i18n-args": subs.length ? JSON.stringify(subs.map(String)) : null,
  }, t(key, ...subs));
}

// 两句各自完整的话放进同一条提示：中文句间不加空格，其他语言加一个空格
export function joinSentences(...parts) {
  return parts.join(currentLocale()?.startsWith("zh") ? "" : " ");
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// 页面右下角的提示。sticky 的提示要手动关闭，用于“需要重新复制”这类必须看到的信息。
// text 由调用方用 t() 算好；提示不带 data-i18n，切换语言时保持原语言。
export function notify(text, kind = "ok", { sticky = false } = {}) {
  const box = document.getElementById("notices");
  if (!box) return;
  const close = () => item.remove();
  const item = h("div", { class: `notice notice-${kind}`, role: kind === "error" ? "alert" : "status" },
    h("span", { class: "notice-text" }, text),
    h("button", { type: "button", class: "notice-close", "aria-label": t("common_close"), onclick: close }, "×"));
  box.append(item);
  if (!sticky) setTimeout(close, kind === "error" ? 8000 : 3500);
}

// 认得出的错误（错误码、storage.sync 配额常量）按当前语言显示，其余原样显示 message
export function errorText(err) {
  const key = errorKey(err);
  return key ? t(...key) : (err?.message ?? String(err));
}

// label 是 LabelSpec：[key, ...subs]
export function copyButton(getText, label = ["common_copy"]) {
  const btn = ht("button", { type: "button", class: "btn btn-small" }, ...label);
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setI18nText(btn, "common_copied");
      setTimeout(() => setI18nText(btn, ...label), 1500);
    } catch (err) {
      notify(t("notice_copy_failed", errorText(err)), "error");
    }
  });
  return btn;
}

// ---- host 权限 ----

// 只为精确 origin 申请；含 * 的模式等于宽泛权限，一律不生成
export function originPattern(engine) {
  try {
    const origin = engineOrigin(engine);
    return origin.includes("*") ? null : origin + "/*";
  } catch {
    return null;
  }
}

// 每次渲染实时查询，不缓存
export async function isGranted(engine) {
  const pattern = originPattern(engine);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch (err) {
    console.warn("[split-search]", err);
    return false;
  }
}

// 授权按钮：permissions.request 必须在点击处理函数里同步调用（在任何 await 之前），
// 否则 Chrome 认为不是用户手势而拒绝。多个引擎在同一次 request 里申请。
// label 是 LabelSpec：[key, ...subs]
export function authButton(engines, label, { cls = "btn btn-small", onDone } = {}) {
  const origins = [...new Set(engines.map(originPattern).filter(Boolean))];
  const btn = ht("button", { type: "button", class: cls, disabled: origins.length === 0 }, ...label);
  btn.addEventListener("click", () => {
    let pending;
    try {
      pending = chrome.permissions.request({ origins });
    } catch (err) {
      notify(t("notice_grant_failed", errorText(err)), "error");
      return;
    }
    Promise.resolve(pending).then(
      (granted) => {
        notify(t(granted ? "notice_granted" : "notice_grant_denied"), granted ? "ok" : "warn");
        onDone?.(granted);
      },
      (err) => notify(t("notice_grant_failed", errorText(err)), "error"),
    );
  });
  return btn;
}

export function option(value, text, selected) {
  return h("option", { value, selected: !!selected }, text);
}
