import { test } from "node:test";
import assert from "node:assert/strict";
import { originPattern, ht, joinSentences } from "../src/options/ui.js";
import { setLocale } from "../src/chrome/i18n.js";

test("originPattern：精确 origin + /*", () => {
  assert.equal(originPattern({ url: "https://kagi.com/search?q=%s" }), "https://kagi.com/*");
  assert.equal(originPattern({ url: "http://127.0.0.1:8080/?q=%s" }), "http://127.0.0.1:8080/*");
});
test("originPattern：含 * 或无法解析时不生成（不会申请宽泛权限）", () => {
  assert.equal(originPattern({ url: "https://*/?q=%s" }), null);
  assert.equal(originPattern({ url: "https://*.example.com/?q=%s" }), null);
  assert.equal(originPattern({ url: "not a url" }), null);
});

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
