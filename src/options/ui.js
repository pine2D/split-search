// 设置页的 DOM 小工具。所有文字都用 textContent / 文本节点写入，不用 innerHTML。
import { engineOrigin } from "../lib/engines.js";

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

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// 页面右下角的提示。sticky 的提示要手动关闭，用于“需要重新复制”这类必须看到的信息。
export function notify(text, kind = "ok", { sticky = false } = {}) {
  const box = document.getElementById("notices");
  if (!box) return;
  const close = () => item.remove();
  const item = h("div", { class: `notice notice-${kind}`, role: kind === "error" ? "alert" : "status" },
    h("span", { class: "notice-text" }, text),
    h("button", { type: "button", class: "notice-close", "aria-label": "关闭", onclick: close }, "×"));
  box.append(item);
  if (!sticky) setTimeout(close, kind === "error" ? 8000 : 3500);
}

// chrome.storage.sync 的配额错误是英文常量名，翻译成用户看得懂的说明
const QUOTA_ERRORS = [
  [/MAX_WRITE_OPERATIONS_PER_(MINUTE|HOUR)/, "保存过于频繁，请稍后再试"],
  [/QUOTA_BYTES/, "同步存储空间已满，请删除一些自定义引擎或缩短名称和网址后再试"],
];

export function errorText(err) {
  const text = err?.message || String(err);
  for (const [re, zh] of QUOTA_ERRORS) if (re.test(text)) return zh;
  return text;
}

export function copyButton(getText, label = "复制") {
  const btn = h("button", { type: "button", class: "btn btn-small" }, label);
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      btn.textContent = "已复制";
      setTimeout(() => { btn.textContent = label; }, 1500);
    } catch (err) {
      notify(`复制失败，请手动选中文字复制（${errorText(err)}）`, "error");
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
export function authButton(engines, label, { cls = "btn btn-small", onDone } = {}) {
  const origins = [...new Set(engines.map(originPattern).filter(Boolean))];
  const btn = h("button", { type: "button", class: cls, disabled: origins.length === 0 }, label);
  btn.addEventListener("click", () => {
    let pending;
    try {
      pending = chrome.permissions.request({ origins });
    } catch (err) {
      notify(`授权失败：${errorText(err)}`, "error");
      return;
    }
    Promise.resolve(pending).then(
      (granted) => {
        notify(granted ? "授权成功" : "没有授权：弹窗被拒绝或关闭", granted ? "ok" : "warn");
        onDone?.(granted);
      },
      (err) => notify(`授权失败：${errorText(err)}`, "error"),
    );
  });
  return btn;
}

export function option(value, text, selected) {
  return h("option", { value, selected: !!selected }, text);
}
