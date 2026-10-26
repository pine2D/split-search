import { test } from "node:test";
import assert from "node:assert/strict";
import { ht, joinSentences } from "../src/options/ui.js";
import { setLocale } from "../src/chrome/i18n.js";

// ---- ht / joinSentences：用最小的假 DOM 和假目录 ----

const CATALOGS = {
  en: {
    greet: { message: "Hi $NAME$", placeholders: { name: { content: "$1", example: "Ann" } } },
    plain: { message: "Plain" },
  },
  zh_CN: { greet: { message: "你好 $NAME$", placeholders: { name: { content: "$1", example: "Ann" } } } },
};

function installFakes() {
  class FakeNode {}
  class FakeEl extends FakeNode {
    constructor(tag) { super(); this.tag = tag; this.attrs = new Map(); this.children = []; }
    setAttribute(k, v) { this.attrs.set(k, v); }
    append(c) { this.children.push(c); }
    get textContent() { return this.children.map((c) => c.text ?? c.textContent).join(""); }
  }
  globalThis.Node = FakeNode;
  globalThis.document = {
    documentElement: { lang: "", classList: { remove() {} } },
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (text) => ({ text }),
  };
  globalThis.chrome = {
    runtime: { getURL: (p) => `chrome-extension://test-id/${p}` },
    i18n: { getUILanguage: () => "en-US", getMessage: () => "" },
  };
  globalThis.fetch = async (url) => {
    const l = /_locales\/([^/]+)\//.exec(url)[1];
    return { ok: true, json: async () => structuredClone(CATALOGS[l] ?? {}) };
  };
}

test("ht：写入译文和 data-i18n / data-i18n-args；没有参数时不写 data-i18n-args", async () => {
  installFakes();
  await setLocale("en");
  const el = ht("button", { class: "btn" }, "greet", "Ann");
  assert.equal(el.textContent, "Hi Ann");
  assert.equal(el.attrs.get("data-i18n"), "greet");
  assert.equal(el.attrs.get("data-i18n-args"), JSON.stringify(["Ann"]));
  const plain = ht("span", null, "plain");
  assert.equal(plain.textContent, "Plain");
  assert.equal(plain.attrs.has("data-i18n-args"), false);
});

test("joinSentences：中文句间不加空格，其他语言加一个空格", async () => {
  installFakes();
  await setLocale("zh_CN");
  assert.equal(joinSentences("已新增“X”。", "它的网站还没授权。"), "已新增“X”。它的网站还没授权。");
  await setLocale("en");
  assert.equal(joinSentences("Added X.", "Grant access."), "Added X. Grant access.");
});

// ---- 表单错误与列表焦点：设置页各对话框共用（engine-list、lookup、catalog） ----

import { showFieldErrors, clearFieldErrors, focusedRow, restoreRowFocus } from "../src/options/ui.js";

class Box {
  constructor(attrs = {}) { this.attrs = new Map(Object.entries(attrs)); this.focused = false; this.children = []; this.hidden = true; this.textContent = ""; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  focus() { globalThis.document.activeElement = this; }
  addEventListener() {}
  append(...c) { this.children.push(...c); }
  remove() {}
}

function fakeForm(names, slots) {
  const inputs = Object.fromEntries(names.map(n => [n, new Box({ name: n })]));
  const errs = Object.fromEntries(slots.map(n => [n, new Box({ "data-for": n })]));
  return {
    inputs, errs,
    elements: inputs,
    querySelectorAll(sel) {
      if (sel === ".field-error") return Object.values(errs);
      if (sel === "[aria-invalid]") return Object.values(inputs).filter(i => i.hasAttribute("aria-invalid"));
      return [];
    },
    querySelector(sel) {
      const m = /^\.field-error\[data-for="([^"]+)"\]$/.exec(sel);
      return m ? errs[m[1]] ?? null : null;
    },
  };
}

function formFakes() {
  installFakes();
  const notices = new Box();
  globalThis.document.getElementById = (id) => (id === "notices" ? notices : null);
  globalThis.document.createElement = () => new Box();
  globalThis.document.createElementNS = () => new Box();
  return notices;
}

test("showFieldErrors：写进槽位、设 aria-invalid、聚焦第一个出错的输入框", async () => {
  formFakes();
  await setLocale("en");
  const form = fakeForm(["name", "url"], ["name", "url", "form"]);
  showFieldErrors(form, { name: "Bad name", url: "Bad url" });
  assert.equal(form.errs.name.textContent, "Bad name");
  assert.equal(form.errs.name.hidden, false);
  assert.equal(form.inputs.name.attrs.get("aria-invalid"), "true");
  assert.equal(form.inputs.url.attrs.get("aria-invalid"), "true");
  assert.equal(globalThis.document.activeElement, form.inputs.name);
});

test("showFieldErrors：找不到槽位的错误改用提示显示，不被吞掉", async () => {
  const notices = formFakes();
  await setLocale("en");
  const form = fakeForm(["name"], ["name"]);
  showFieldErrors(form, { other: "Lost error" });
  assert.equal(notices.children.length, 1);
});

test("showFieldErrors：fieldOf 可以换成按 id 找输入框", async () => {
  formFakes();
  await setLocale("en");
  const form = fakeForm([], ["name"]);
  const input = new Box();
  showFieldErrors(form, { name: "x" }, (n) => (n === "name" ? input : null));
  assert.equal(input.attrs.get("aria-invalid"), "true");
  assert.equal(globalThis.document.activeElement, input);
});

test("clearFieldErrors：清空并隐藏槽位、去掉 aria-invalid", async () => {
  formFakes();
  await setLocale("en");
  const form = fakeForm(["name"], ["name"]);
  showFieldErrors(form, { name: "x" });
  clearFieldErrors(form);
  assert.equal(form.errs.name.textContent, "");
  assert.equal(form.errs.name.hidden, true);
  assert.equal(form.inputs.name.hasAttribute("aria-invalid"), false);
});

function fakeList(ids, disabled = {}) {
  const rows = ids.map(id => {
    const row = new Box();
    row.dataset = { entry: id };
    row.button = new Box();
    row.button.disabled = Boolean(disabled[id]);
    row.button.row = row;
    row.querySelector = (sel) => (sel === "button" ? row.button : null);
    row.closest = () => row;
    row.button.closest = () => row;
    return row;
  });
  return {
    rows,
    contains: (n) => rows.includes(n),
    querySelectorAll: (sel) => (sel === "[data-entry]" ? rows : []),
  };
}

test("focusedRow：焦点在列表某一行（或行内按钮）上时返回条目 id，不在列表里返回 null", () => {
  formFakes();
  const list = fakeList(["a", "b"]);
  globalThis.document.activeElement = list.rows[1].button;
  assert.equal(focusedRow(list), "b");
  const other = fakeList(["c"]);
  globalThis.document.activeElement = other.rows[0];
  assert.equal(focusedRow(list), null);
  globalThis.document.activeElement = null;
  assert.equal(focusedRow(list), null);
});

test("restoreRowFocus：按钮可点就聚焦按钮，按钮已禁用就聚焦行本身，找不到不动", () => {
  formFakes();
  const list = fakeList(["a", "b"], { b: true });
  restoreRowFocus(list, "a");
  assert.equal(globalThis.document.activeElement, list.rows[0].button);
  restoreRowFocus(list, "b");
  assert.equal(globalThis.document.activeElement, list.rows[1]);
  restoreRowFocus(list, "zzz");
  assert.equal(globalThis.document.activeElement, list.rows[1]);
  restoreRowFocus(list, null);
  assert.equal(globalThis.document.activeElement, list.rows[1]);
});

// ---- confirmStep：删除的两步确认；第一次点击可经 #notices 播报一句提醒 ----

import { confirmStep } from "../src/options/ui.js";

function fakeButton() {
  const btn = new Box();
  btn.listeners = {};
  btn.classList = { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } };
  btn.addEventListener = (type, fn) => { (btn.listeners[type] ??= []).push(fn); };
  btn.fire = (type, ev = {}) => { for (const fn of btn.listeners[type] ?? []) fn({ preventDefault() {}, ...ev }); };
  return btn;
}

test("confirmStep：第一次点击进入确认并播报 armNotice 的文字（警告级），第二次才执行；没传 armNotice 不播报", async () => {
  const notices = formFakes();
  await setLocale("en");
  const btn = fakeButton();
  let confirmed = 0, armed = 0;
  confirmStep(btn, "plain", "plain", () => { confirmed++; }, { armNotice: () => { armed++; return "Think twice"; } });
  btn.fire("click");
  assert.equal(confirmed, 0);
  assert.equal(armed, 1);
  assert.equal(notices.children.length, 1, "应在 #notices 里加一条提示");
  assert.match(notices.children[0].attrs.get("class") ?? notices.children[0].className ?? "", /notice-warn/);
  btn.fire("click");
  assert.equal(confirmed, 1);
  assert.equal(armed, 1, "确认那一下不再播报");

  const plain = fakeButton();
  const before = notices.children.length;
  confirmStep(plain, "plain", "plain", () => {}, {});
  plain.fire("click");
  assert.equal(notices.children.length, before, "没传 armNotice 不播报");
  plain.fire("blur");
});

test("confirmStep：失焦和 Esc 复原，复原后再点重新进入确认；进入确认很久之后再点仍会删除", async () => {
  formFakes();
  await setLocale("en");
  const btn = fakeButton();
  let confirmed = 0;
  confirmStep(btn, "plain", "plain", () => { confirmed++; });
  btn.fire("click");
  assert.ok(btn.classList.set.has("btn-confirm"));
  btn.fire("blur");
  assert.ok(!btn.classList.set.has("btn-confirm"), "失焦复原");
  btn.fire("click");
  assert.ok(btn.classList.set.has("btn-confirm"));
  let prevented = 0;
  btn.fire("keydown", { key: "Escape", preventDefault() { prevented++; } });
  assert.ok(!btn.classList.set.has("btn-confirm"), "Esc 复原");
  assert.equal(prevented, 1);
  btn.fire("click");
  btn.fire("click");
  assert.equal(confirmed, 1, "复原后重新点两次才删");

  const realSetTimeout = globalThis.setTimeout;
  let timers = 0;
  globalThis.setTimeout = (...a) => { timers++; return realSetTimeout(...a); };
  try {
    const slow = fakeButton();
    confirmStep(slow, "plain", "plain", () => { confirmed++; });
    slow.fire("click");
    assert.equal(timers, 0, "进入确认不起任何计时器");
    await new Promise((r) => realSetTimeout(r, 3300));
    assert.ok(slow.classList.set.has("btn-confirm"), "超过 3 秒仍在确认状态");
    slow.fire("click");
    assert.equal(confirmed, 2);
  } finally { globalThis.setTimeout = realSetTimeout; }
});
