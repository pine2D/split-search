// 设置页的 DOM 小工具。所有文字都用 textContent / 文本节点写入，不用 innerHTML。
import { originPattern } from "../lib/engines.js";
import { errorKey } from "../lib/errors.js";
import { t, setI18nText, currentLocale } from "../chrome/i18n.js";
import { safeError } from "../lib/safe-error.js";
import { icon } from "../ui/icons.js";

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

// 可收起的说明：<details> + 带 SVG 箭头的 <summary>。展开状态按 id 记在模块里，卡片重建后保持。
// titleKey 是 key 或 LabelSpec（[key, ...subs]，如带计数的标题）
const openIds = new Set();
export function disclosure(id, titleKey, ...children) {
  const d = h("details", { class: "disclosure" },
    h("summary", null, icon("chevron-right", { size: 14, cls: "chev" }), ht("span", null, ...[].concat(titleKey))), ...children);
  d.open = openIds.has(id);
  d.addEventListener("toggle", () => { if (d.open) openIds.add(id); else openIds.delete(id); });
  return d;
}

// options.html 里静态写的 <details class="disclosure">：给 summary 补上箭头
export function addChevrons(root = document) {
  for (const s of root.querySelectorAll("details.disclosure > summary")) {
    if (!s.querySelector(".chev")) s.prepend(icon("chevron-right", { size: 14, cls: "chev" }));
  }
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
// kind 的状态图标在文字之外（不只靠边框颜色区分成功、注意和出错）。
// action：{ key, run } 在文字后面加一个按钮（如“撤销”），点了先关掉提示再 run()；带按钮的提示停留更久，
// 鼠标停在上面或焦点在里面时不自动消失（键盘用户 Tab 过去时它不会先没了）。返回提示元素。
const NOTICE_ICONS = { ok: "check-circle", warn: "alert-triangle", error: "x-circle" };
export function notify(text, kind = "ok", { sticky = false, action = null } = {}) {
  const box = document.getElementById("notices");
  if (!box) return null;
  let timer = null;
  const close = () => { clearTimeout(timer); item.remove(); };
  const actionBtn = action && ht("button", { type: "button", class: "notice-action",
    onclick: () => { close(); action.run(); } }, action.key);
  const item = h("div", { class: `notice notice-${kind}`, role: kind === "error" ? "alert" : "status" },
    icon(NOTICE_ICONS[kind] ?? NOTICE_ICONS.ok, { cls: "notice-icon" }),
    h("span", { class: "notice-text" }, text),
    actionBtn,
    h("button", { type: "button", class: "notice-close", "aria-label": t("common_close"), onclick: close }, icon("x")));
  box.append(item);
  if (sticky) return item;
  const ms = action ? 8000 : kind === "error" ? 8000 : 3500;
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, ms); };
  const held = () => item.matches(":hover") || item.contains(document.activeElement);
  if (action) {
    item.addEventListener("mouseenter", () => clearTimeout(timer));
    item.addEventListener("focusin", () => clearTimeout(timer));
    item.addEventListener("mouseleave", () => { if (!held()) arm(); });
    item.addEventListener("focusout", (ev) => { if (!item.contains(ev.relatedTarget) && !item.matches(":hover")) arm(); });
  }
  arm();
  return item;
}

// 两步确认的按钮（删除）：第一次点把文字换成 confirmKey，再点一次才执行 onConfirm。
// 不限时（读屏用户需要时间）：保持到再点、失焦或按 Esc 复原。按钮文字经 setI18nText 切换，切换语言时照当前状态重写。
// armNotice：第一次点击进入确认时经 #notices（aria-live）播报的一句提醒，读屏用户也能听到要再点一次、删前要注意什么。
// 按钮在模态对话框里时 #notices 是 inert（不播报，还压在 ::backdrop 下面），改用 onArm / onReset 把提醒写进对话框里自己的 role="status"。
// 按钮带 aria-disabled="true"（能聚焦、读屏读“不可用”，原因写在旁边）时点击什么都不做
export function confirmStep(btn, labelKey, confirmKey, onConfirm, { armNotice = null, onArm = null, onReset = null } = {}) {
  let armed = false;
  const reset = () => {
    armed = false;
    btn.classList.remove("btn-confirm");
    setI18nText(btn, labelKey);
    onReset?.();
  };
  btn.addEventListener("click", () => {
    if (btn.getAttribute("aria-disabled") === "true") return;
    if (!armed) {
      armed = true;
      setI18nText(btn, confirmKey);
      btn.classList.add("btn-confirm");
      if (armNotice) notify(armNotice(), "warn");
      onArm?.();
      return;
    }
    reset();
    onConfirm();
  });
  btn.addEventListener("blur", () => { if (armed) reset(); });
  btn.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && armed) { ev.preventDefault(); reset(); } });
  return btn;
}

// 认得出的错误（错误码、storage.sync 配额常量）按当前语言显示，其余原样显示 message
export function errorText(err) {
  const key = errorKey(err);
  return key ? t(...key) : (err?.message ?? String(err));
}

// label 是 LabelSpec：[key, ...subs]。ariaKey：无障碍名称带上复制的对象（页面上有好几个“复制”），
// 文案开头逐字包含看得见的文字（WCAG 2.5.3）；显示“已复制”的 1.5 秒里去掉它，读出来的就是“已复制”
export function copyButton(getText, label = ["common_copy"], ariaKey = null) {
  const btn = ht("button", { type: "button", class: "btn btn-small" }, ...label);
  const setAria = () => {
    if (!ariaKey) return;
    btn.setAttribute("aria-label", t(ariaKey));
    btn.setAttribute("data-i18n-attr", `aria-label:${ariaKey}`);
  };
  setAria();
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      btn.removeAttribute("aria-label");
      btn.removeAttribute("data-i18n-attr");
      setI18nText(btn, "common_copied");
      setTimeout(() => { setI18nText(btn, ...label); setAria(); }, 1500);
    } catch (err) {
      notify(t("notice_copy_failed", errorText(err)), "error");
    }
  });
  return btn;
}

// ---- host 权限 ----

// 只为精确 origin 申请（originPattern 见 lib/engines.js，含 * 的模式一律不生成）
// 每次渲染实时查询，不缓存
export async function isGranted(engine) {
  const pattern = originPattern(engine);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch (err) {
    console.warn("[split-search]", safeError(err));
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

// ---- 对话框的表单错误：槽位是 .field-error[data-for=<字段名>] ----

export function clearFieldErrors(form) {
  for (const el of form.querySelectorAll(".field-error")) {
    el.textContent = "";
    el.hidden = true;
  }
  for (const el of form.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
}

// errors 的值是 ErrorSpec（edits.js）、异常，或调用方已用 t() 算好的句子。
// 没有对应槽位的错误改用 notify 显示，不吞掉；fieldOf 按字段名找输入框（缺省 form.elements）。
export function showFieldErrors(form, errors, fieldOf = (name) => form.elements?.[name]) {
  let first = null;
  for (const [name, spec] of Object.entries(errors || {})) {
    const msg = typeof spec === "string" ? spec : errorText(spec);
    const el = form.querySelector(`.field-error[data-for="${name}"]`);
    if (!el) {
      notify(msg, "error");
      continue;
    }
    el.textContent = msg;
    el.hidden = false;
    const input = fieldOf(name);
    if (input) {
      input.setAttribute("aria-invalid", "true");
      first ??= input;
    }
  }
  first?.focus();
}

// ---- 引擎库对话框 ----

// 条目的名称 + 网址的 host（让人看出会打开哪个网站）；网址解析不了就只显示名称
export function catalogLabel(name, url) {
  let host = "";
  try { host = new URL(url.replace("%s", "x")).host; } catch { /* 只显示名称 */ }
  return h("span", { class: "catalog-label" },
    h("strong", { class: "catalog-name" }, name),
    host && h("span", { class: "catalog-host mono" }, host));
}

// 打开模态对话框（对话框带 tabindex="-1"）。用鼠标打开时焦点放在对话框本身（不画焦点框，Tab 从第一项开始）；
// 用键盘打开时交给第一个能点的按钮，焦点框照常显示（浏览器默认会落到 tabindex=-1 的列表行上）
export function showDialog(dialog, viaKeyboard) {
  dialog.showModal();
  const first = viaKeyboard ? dialog.querySelector("button:not(:disabled)") : null;
  (first ?? dialog).focus();
}

// ---- 对话框列表重建会丢掉焦点：每行带 data-entry（行本身 tabindex=-1） ----

// 焦点在列表的某一行（或行内按钮）上时，返回那一行的条目 id
export function focusedRow(body) {
  const row = document.activeElement?.closest?.("[data-entry]");
  return row && body.contains(row) ? row.dataset.entry : null;
}

// 重建后把焦点还给这一行：按钮还能点就回到按钮上（例如添加失败），已禁用就停在行上，Tab 从这里继续
export function restoreRowFocus(body, want) {
  if (!want) return;
  const row = [...body.querySelectorAll("[data-entry]")].find(r => r.dataset.entry === want);
  if (!row) return;
  const button = row.querySelector("button");
  (button && !button.disabled ? button : row).focus();
}
