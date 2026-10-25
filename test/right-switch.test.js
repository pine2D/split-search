import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ownedPair, switchRight } from "../src/chrome/right-switch.js";
import { expandTemplate } from "../src/lib/trigger.js";

// chrome 桩：storage.session 用内存 Map；tabs 是 id → 标签 的表
let calls, store;
function installChrome({ tabs = {}, data = {}, fail = {} } = {}) {
  calls = [];
  store = new Map(Object.entries(data));
  globalThis.chrome = {
    tabs: {
      async get(id) {
        if (!tabs[id]) throw new Error(`No tab with id: ${id}.`);
        return tabs[id];
      },
      async query(q) {
        return Object.values(tabs).filter(t => t.splitViewId === q.splitViewId);
      },
      async update(id, props) {
        calls.push(["tabs.update", id, props]);
        if (fail.update) throw new Error(`No tab with id: ${id}.`);
        return { ...tabs[id], ...props };
      },
    },
    storage: {
      session: {
        async get(key) {
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.filter(k => store.has(k)).map(k => [k, store.get(k)]));
        },
        async set(obj) {
          calls.push(["session.set", obj]);
          if (fail.set) throw new Error("quota");
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        async remove(keys) {
          calls.push(["session.remove", keys]);
          for (const k of [].concat(keys)) store.delete(k);
        },
      },
    },
  };
}

const QUERY = "a&b #c+d 中文 😀";
const engines = [
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=%s" },
  { id: "wiki", name: "Wikipedia", url: "https://en.wikipedia.org/wiki/%s" },
];
const L = { id: 10, index: 3, windowId: 1, splitViewId: 7, url: "https://www.google.com/search?q=x" };
const R = { id: 11, index: 4, windowId: 1, splitViewId: 7, url: "https://www.bing.com/search?q=x" };
const rec = (peer, engine, over = {}) => ({ peer, splitViewId: 7, mode: "split", engine, query: QUERY, ...over });
const ownData = () => ({ "split:10": rec(11, "google"), "split:11": rec(10, "bing") });

beforeEach((t) => {
  installChrome();
  t.mock.method(console, "error", () => {});
});

test("ownedPair：从左侧标签出发，左右按 index 分", async () => {
  installChrome({ tabs: { 10: L, 11: R }, data: ownData() });
  const pair = await ownedPair(L, engines);
  assert.deepEqual(pair, {
    left: { tabId: 10, engineId: "google", record: rec(11, "google") },
    right: { tabId: 11, engineId: "bing", record: rec(10, "bing") },
    query: QUERY,
  });
});

test("ownedPair：当前活动标签在右侧时，right 仍是 index 大的那个", async () => {
  installChrome({ tabs: { 10: L, 11: R }, data: ownData() });
  const pair = await ownedPair(R, engines);
  assert.equal(pair.right.tabId, 11);
  assert.equal(pair.right.engineId, "bing");
  assert.equal(pair.left.tabId, 10);
});

test("ownedPair：原生“互换位置”之后，右侧是现在 index 大的标签和它自己记录的引擎", async () => {
  const l = { ...R, index: 3 };
  const r = { ...L, index: 4 };
  installChrome({ tabs: { 10: r, 11: l }, data: ownData() });
  const pair = await ownedPair(r, engines);
  assert.equal(pair.right.tabId, 10);
  assert.equal(pair.right.engineId, "google");
  assert.equal(pair.left.engineId, "bing");
});

test("ownedPair：相邻标签模式也支持", async () => {
  const a = { id: 20, index: 0, windowId: 1, splitViewId: -1 };
  const b = { id: 21, index: 1, windowId: 1, splitViewId: -1 };
  installChrome({
    tabs: { 20: a, 21: b },
    data: { "split:20": rec(21, "google", { mode: "adjacent", splitViewId: -1 }),
      "split:21": rec(20, "bing", { mode: "adjacent", splitViewId: -1 }) },
  });
  const pair = await ownedPair(b, engines);
  assert.equal(pair.left.tabId, 20);
  assert.equal(pair.right.tabId, 21);
});

test("ownedPair：fallback-own（没有记录、对侧像搜索页）返回 null，因为没有关键词", async () => {
  installChrome({ tabs: { 10: L, 11: R } });
  assert.equal(await ownedPair(L, engines), null);
});

test("ownedPair：none（不在分屏、没有记录）返回 null", async () => {
  installChrome({ tabs: { 10: { ...L, splitViewId: -1 } } });
  assert.equal(await ownedPair({ ...L, splitViewId: -1 }, engines), null);
});

test("ownedPair：stale（拆开又拼回去，splitViewId 变了）返回 null", async () => {
  const l = { ...L, splitViewId: 9 };
  const r = { ...R, splitViewId: 9 };
  installChrome({ tabs: { 10: l, 11: r }, data: ownData() });
  assert.equal(await ownedPair(l, engines), null);
});

test("ownedPair：相邻模式下对侧已关掉（No tab with id）返回 null，不抛", async () => {
  const a = { id: 20, index: 0, windowId: 1, splitViewId: -1 };
  installChrome({
    tabs: { 20: a },
    data: { "split:20": rec(21, "google", { mode: "adjacent", splitViewId: -1 }) },
  });
  assert.equal(await ownedPair(a, engines), null);
});

test("switchRight：特殊字符关键词的网址与 expandTemplate 逐字相同，记录只改 engine", async () => {
  installChrome({ tabs: { 10: L, 11: R }, data: ownData() });
  const pair = await ownedPair(L, engines);
  calls = [];
  await switchRight(pair, engines[2]);
  const expected = expandTemplate(engines[2].url, QUERY);
  assert.equal(expected, "https://en.wikipedia.org/wiki/a%26b%20%23c%2Bd%20%E4%B8%AD%E6%96%87%20%F0%9F%98%80");
  assert.deepEqual(calls[0], ["tabs.update", 11, { url: expected }]);
  assert.deepEqual(store.get("split:11"), { ...rec(10, "bing"), engine: "wiki" });
  assert.deepEqual(store.get("split:10"), rec(11, "google"));
});

test("switchRight：空关键词打开模板的 origin（同 go.js）", async () => {
  installChrome({ tabs: { 10: L, 11: R },
    data: { "split:10": rec(11, "google", { query: "" }), "split:11": rec(10, "bing", { query: "" }) } });
  const pair = await ownedPair(L, engines);
  calls = [];
  await switchRight(pair, engines[2]);
  assert.deepEqual(calls[0], ["tabs.update", 11, { url: "https://en.wikipedia.org/" }]);
});

test("switchRight：写记录失败只记日志，不抛", async () => {
  installChrome({ tabs: { 10: L, 11: R }, data: ownData(), fail: { set: true } });
  const pair = await ownedPair(L, engines);
  await switchRight(pair, engines[0]);
  assert.equal(console.error.mock.callCount(), 1);
});

test("switchRight：tabs.update 失败时抛出，不改记录", async () => {
  installChrome({ tabs: { 10: L, 11: R }, data: ownData(), fail: { update: true } });
  const pair = await ownedPair(L, engines);
  await assert.rejects(switchRight(pair, engines[0]), /No tab with id/);
  assert.deepEqual(store.get("split:11"), rec(10, "bing"));
});
