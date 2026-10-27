import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// write() 的写入结果要如实：先写 patch、再删键是两次写入，删键失败时 patch 可能已经落地。
// chrome.storage.sync 用内存桩；fail.<name> 为 true 时对应调用抛错，ghost 为 true 时 remove 抛错但其实删掉了。
let store, fail, calls;
globalThis.chrome = {
  storage: {
    sync: {
      async get() { calls.push("get"); if (fail.get) throw new Error("get failed"); return Object.fromEntries(store); },
      async set(obj) {
        calls.push("set");
        if (fail.set) throw new Error("set failed");
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
      async remove(keys) {
        calls.push("remove");
        if (fail.ghost) { for (const k of [].concat(keys)) store.delete(k); throw new Error("remove flaked"); }
        if (fail.remove) throw new Error("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded");
        for (const k of [].concat(keys)) store.delete(k);
      },
    },
  },
};
// act 的成功提示经 notify 写进 #notices：给 t() 装上真实的 en 目录，给 notify 一个只记文字的极简 DOM
class FakeNode {
  constructor() { this.children = []; this.attrs = {}; }
  append(...c) { this.children.push(...c); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener() {}
  remove() { this.removed = true; }
  matches() { return false; }
  contains() { return false; }
  get textContent() { return this.children.map(c => c.textContent ?? "").join(""); }
}
class FakeText extends FakeNode {
  constructor(s) { super(); this.text = s; }
  get textContent() { return this.text; }
}
const notices = new FakeNode();
globalThis.Node = FakeNode;
globalThis.document = {
  documentElement: { lang: "" },
  activeElement: null,
  getElementById: (id) => (id === "notices" ? notices : null),
  createElement: () => new FakeNode(),
  createElementNS: () => new FakeNode(),
  createTextNode: (s) => new FakeText(s),
};
chrome.runtime = { getURL: (p) => `chrome-extension://test-id/${p}` };
chrome.i18n = { getUILanguage: () => "en-US" };
globalThis.fetch = async (url) => {
  const m = /_locales\/([^/]+)\/messages\.json$/.exec(url);
  const text = readFileSync(new URL(`../src/_locales/${m[1]}/messages.json`, import.meta.url), "utf8");
  return { ok: true, json: async () => JSON.parse(text) };
};
// 提示自动消失的计时器不拖住测试进程
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => { const h = realSetTimeout(fn, ms, ...args); h.unref?.(); return h; };

const { write, saveFailure, act } = await import("../src/options/actions.js");
const { setLocale, t } = await import("../src/chrome/i18n.js");

beforeEach(() => {
  store = new Map([["imageEngine", "bing-img"], ["imageEngines", [{ id: "bing-img" }]]]);
  fail = {};
  calls = [];
});

const deleteImage = () => ({ ok: true, patch: { imageEngines: [] }, remove: ["imageEngine"] });

test("write：patch 与删键都成功时返回 compute 的结果", async () => {
  assert.deepEqual(await write(deleteImage), deleteImage());
  assert.deepEqual(Object.fromEntries(store), { imageEngines: [] });
});

test("write：patch 已写入、删键失败且键还在 → 抛 partial 错误（保留原因），不报成“保存失败”", async () => {
  fail.remove = true;
  const err = await write(deleteImage).then(() => null, e => e);
  assert.ok(err);
  assert.equal(err.partial, true);
  assert.match(err.message, /MAX_WRITE_OPERATIONS_PER_MINUTE/);
  assert.deepEqual(store.get("imageEngines"), []);
  assert.equal(store.get("imageEngine"), "bing-img");
  assert.deepEqual(saveFailure(err), { key: "notice_save_partial", level: "warn" });
});

test("write：删键报错但重新读出来键已经不在 → 按成功返回", async () => {
  fail.ghost = true;
  assert.deepEqual(await write(deleteImage), deleteImage());
  assert.deepEqual(calls, ["get", "set", "remove", "get"]);
});

test("write：删键失败后重新读也失败 → 按 partial 报（patch 已写入是确定的）", async () => {
  fail.remove = true;
  const orig = chrome.storage.sync.get;
  let n = 0;
  chrome.storage.sync.get = async () => { if (n++ > 0) throw new Error("get failed"); return Object.fromEntries(store); };
  try {
    const err = await write(deleteImage).then(() => null, e => e);
    assert.equal(err?.partial, true);
  } finally {
    chrome.storage.sync.get = orig;
  }
});

test("write：patch 本身写失败 → 原错误，不是 partial，也不再删键", async () => {
  fail.set = true;
  const err = await write(deleteImage).then(() => null, e => e);
  assert.equal(err.message, "set failed");
  assert.equal(err.partial, undefined);
  assert.ok(!calls.includes("remove"));
  assert.deepEqual(saveFailure(err), { key: "notice_save_failed", level: "error" });
});

test("write：没有 patch、只删键时删键失败 → 原错误（什么都没写进去）", async () => {
  fail.remove = true;
  const err = await write(() => ({ ok: true, patch: null, remove: ["imageEngine"] })).then(() => null, e => e);
  assert.equal(err.partial, undefined);
  assert.deepEqual(saveFailure(err), { key: "notice_save_failed", level: "error" });
});

test("write：一次失败不会让后面的写入卡住", async () => {
  fail.set = true;
  await write(deleteImage).catch(() => {});
  fail.set = false;
  assert.deepEqual(await write(deleteImage), deleteImage());
});

test("act：ok 是函数时用 compute 的结果算提示；返回 null 就不提示", async () => {
  await setLocale("en");
  notices.children = [];
  const seen = [];
  const result = await act(() => ({ ok: true, patch: { order: ["bing"] }, position: 3 }),
    (r) => { seen.push(r); return ["notice_rule_moved", r.position]; });
  assert.equal(seen.length, 1);
  assert.equal(seen[0], result);
  assert.deepEqual(notices.children.map(n => n.textContent), [t("notice_rule_moved", 3)]);
  await act(() => ({ ok: true, patch: null }), () => null);
  assert.equal(notices.children.length, 1);
  // 固定的 LabelSpec 照旧
  await act(() => ({ ok: true, patch: null }), ["notice_rule_deleted"]);
  assert.deepEqual(notices.children.map(n => n.textContent).slice(1), [t("notice_rule_deleted")]);
  // compute 失败时不调 ok
  let called = false;
  await act(() => ({ ok: false, error: { code: "rule_gone", args: [] } }), () => { called = true; return null; });
  assert.equal(called, false);
});
