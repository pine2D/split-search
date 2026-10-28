// 设置页对话框点外部（遮罩）关闭，以及表单改过时的保存确认（#discard-dialog）。
// 不用 closedby="any"：它把 Esc 和点外部合成同一个 cancel 事件，分不开“Esc 照旧”和“点外部要问”。
// 模块顶层不碰 document / window（test/options-dialogs.test.js 在 node 里导入它）。

const SKIP = new Set(["button", "submit", "reset", "fieldset"]);

// 按顺序序列化表单字段：复选框、单选框取 checked，其余取 value；按钮和 fieldset 不算
export function formSnapshot(elements) {
  const values = [];
  for (const el of elements) {
    if (SKIP.has(el.type)) continue;
    values.push(el.type === "checkbox" || el.type === "radio" ? !!el.checked : String(el.value ?? ""));
  }
  return JSON.stringify(values);
}

const outside = (r, p) => p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom;

// 按下和松开都在对话框矩形以外才算点遮罩；在输入框里按下、拖到外面松开（选文字）不算
export function isBackdropClick(rect, down, up) {
  return !!down && outside(rect, down) && outside(rect, up);
}

// 只认主键、真实指针的点击：键盘按 Enter / 空格产生的 click 的 detail 是 0，不算
function watchBackdrop(dialog, onBackdrop) {
  let down = null; // { x, y, active }：主键按下时的坐标和当时有焦点的元素
  dialog.addEventListener("pointerdown", (ev) => {
    down = ev.button === 0 ? { x: ev.clientX, y: ev.clientY, active: document.activeElement } : null;
  });
  dialog.addEventListener("click", (ev) => {
    const press = down;
    down = null;
    if (ev.target !== dialog || ev.button !== 0 || ev.detail === 0) return;
    if (isBackdropClick(dialog.getBoundingClientRect(), press, { x: ev.clientX, y: ev.clientY })) onBackdrop(press.active);
  });
}

// ---- 保存确认 ----

let confirmCtx = null; // 正在问的那次：{ form, onClose, active }
let confirmReady = false;

const confirmDialog = () => document.getElementById("discard-dialog");

function firstField(form) {
  return [...form.elements].find(el => !SKIP.has(el.type) && !el.disabled && el.checkVisibility?.() !== false) ?? null;
}

// “继续编辑”：焦点回到点外部之前表单里有焦点的字段，不在表单里就给第一个字段
function keepEditing(ctx) {
  const back = ctx.active && ctx.form.contains(ctx.active) ? ctx.active : firstField(ctx.form);
  back?.focus();
}

function choose(kind) {
  const ctx = confirmCtx;
  confirmCtx = null;
  confirmDialog().close();
  if (!ctx) return;
  if (kind === "save") ctx.form.requestSubmit(); // 走原来的提交流程；校验不过时表单对话框留着、显示字段错误
  else if (kind === "drop") ctx.onClose();
  else keepEditing(ctx);
}

function setupConfirm() {
  if (confirmReady) return;
  confirmReady = true;
  const dlg = confirmDialog();
  document.getElementById("discard-save").addEventListener("click", () => choose("save"));
  document.getElementById("discard-drop").addEventListener("click", () => choose("drop"));
  document.getElementById("discard-keep").addEventListener("click", () => choose("keep"));
  watchBackdrop(dlg, () => choose("keep"));
  // Esc 关掉确认框：等同“继续编辑”（按钮路径已先清掉 confirmCtx）
  dlg.addEventListener("close", () => {
    const ctx = confirmCtx;
    confirmCtx = null;
    if (ctx) keepEditing(ctx);
  });
}

function askToSave(form, onClose, active) {
  confirmCtx = { form, onClose, active };
  const dlg = confirmDialog();
  if (!dlg.open) dlg.showModal();
  document.getElementById("discard-save").focus();
}

// 点外部：没有 form 直接 onClose；有 form 时与最近一次 mark() 的快照比，没改过就 onClose，改过就问
// onClose 由调用方给：走与“关闭”/“取消”相同的关闭与焦点归还。mark() 在填好初值、showModal() 之后调用
export function lightDismiss(dialog, { form, onClose }) {
  let snapshot = null;
  if (form) setupConfirm();
  watchBackdrop(dialog, (active) => {
    if (!form || formSnapshot(form.elements) === snapshot) onClose();
    else askToSave(form, onClose, active);
  });
  return { mark() { if (form) snapshot = formSnapshot(form.elements); } };
}
