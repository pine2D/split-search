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
const rec = (peer, engine, over = {}) => ({ peer, splitViewId: 7, mode: "split", role: "search", engine, query: QUERY, ...over });
const ownData = () => ({ "split:10": rec(11, "google"), "split:11": rec(10, "bing") });

beforeEach((t) => {
  installChrome();
  t.mock.method(console, "error", () => {});
});

test("ownedPair：从左侧标签出发，左右按 index 分", async () => {
  installChrome({ tabs: { 10: L, 11: R }, data: ownData() });
  const pair = await ownedPair(L, engines);
  assert.deepEqual(pair, {
    kind: "search",
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

// 查询对：page 一侧 engine 为 ""，两侧写同一个 input；用户对调过，lookup 现在在左边（index 0）
const lookupData = (input = "text") => ({
  "split:10": rec(11, "", { role: "page", input }),
  "split:11": rec(10, "bing", { role: "lookup", input }),
});

test("ownedPair：查询对（用户对调过）right 固定是 lookup 一侧、left 是 page 一侧，kind 取 input", async () => {
  const page = { ...L, index: 1 };
  const lookup = { ...R, index: 0 };
  installChrome({ tabs: { 10: page, 11: lookup }, data: lookupData() });
  for (const from of [page, lookup]) {
    const pair = await ownedPair(from, engines);
    assert.equal(pair.kind, "text");
    assert.equal(pair.right.tabId, 11);
    assert.equal(pair.right.engineId, "bing");
    assert.equal(pair.left.tabId, 10);
    assert.equal(pair.left.engineId, "");
    assert.equal(pair.query, QUERY);
  }
});

test("ownedPair：图片查询对的 kind 是 image", async () => {
  installChrome({ tabs: { 10: L, 11: R }, data: lookupData("image") });
  assert.equal((await ownedPair(L, engines)).kind, "image");
});

test("switchRight：查询对换的是 lookup 一侧，记录的 role、input 不变，page 一侧不动", async () => {
  const page = { ...L, index: 1 };
  const lookup = { ...R, index: 0 };
  installChrome({ tabs: { 10: page, 11: lookup }, data: lookupData() });
  const pair = await ownedPair(page, engines);
  calls = [];
  await switchRight(pair, engines[2]);
  assert.deepEqual(calls[0], ["tabs.update", 11, { url: expandTemplate(engines[2].url, QUERY) }]);
  const after = store.get("split:11");
  assert.equal(after.role, "lookup");
  assert.equal(after.input, "text");
  assert.equal(after.engine, "wiki");
  assert.deepEqual(store.get("split:10"), lookupData()["split:10"]);
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

// F11：图片查询对里，弹窗的“换右侧”只在以图搜图引擎里挑。走弹窗同一条路径：
// ownedPair → popupView 的按钮 → switchTarget（popup.js 的 onSwitch 用它找引擎）→ switchRight。
test("弹窗换右侧：图片查询对点 bing-img → lookup 一侧换成 bing-img，记录 engine 跟着改；文字引擎 id 不会被接受", async () => {
  const { mergeConfig } = await import("../src/lib/engines.js");
  const { IMAGE_CATALOG } = await import("../src/lib/image-engines.js");
  const { popupView, switchTarget } = await import("../src/lib/popup-view.js");
  const SRC = "https://img.example.com/a b.png?sig=1&x=2";
  const P = { id: 20, index: 1, windowId: 1, splitViewId: 9 };
  const K = { id: 21, index: 2, windowId: 1, splitViewId: 9 };
  const base = { splitViewId: 9, mode: "split", input: "image", query: SRC };
  installChrome({ tabs: { 20: P, 21: K }, data: {
    "split:20": { peer: 21, role: "page", engine: "", ...base },
    "split:21": { peer: 20, role: "lookup", engine: "lens", ...base },
  } });
  const cfg = mergeConfig({ imageEngines: [IMAGE_CATALOG[0]] });
  const pair = await ownedPair(P, cfg.engines);
  assert.equal(pair.kind, "image");
  assert.deepEqual(popupView(pair, cfg).choices.map(e => e.id), ["bing-img"]);
  assert.equal(switchTarget(pair, cfg, "bing"), null);
  assert.equal(switchTarget(pair, cfg, "google"), null);
  assert.equal(switchTarget(null, cfg, "bing-img"), null);
  const engine = switchTarget(pair, cfg, "bing-img");
  assert.equal(engine.id, "bing-img");
  await switchRight(pair, engine);
  assert.deepEqual(calls, [
    ["tabs.update", 21, { url: expandTemplate(IMAGE_CATALOG[0].url, SRC) }],
    ["session.set", { "split:21": { peer: 20, role: "lookup", engine: "bing-img", ...base } }],
  ]);
  assert.equal(store.get("split:20").engine, "");
  // 文字查询对反过来：只接受文字引擎
  const textPair = { ...pair, kind: "text" };
  assert.equal(switchTarget(textPair, cfg, "bing-img"), null);
  assert.equal(switchTarget(textPair, cfg, "bing").id, "bing");
});

test("popup.js 换右侧时经 switchTarget 找引擎（接线守门）", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/popup/popup.js", import.meta.url), "utf8");
  assert.match(src, /switchTarget\(state\?\.pair, state\?\.cfg, engineId\)/);
  assert.match(src, /await switchRight\(state\.pair, engine\)/);
});

test("switchRight：规则选的右侧（记录带 rule、base）换过之后，写出的记录没有这两个键", async () => {
  installChrome({ tabs: { 10: L, 11: R },
    data: { "split:10": rec(11, "google"), "split:11": rec(10, "wiki", { rule: "r2", base: "bing" }) } });
  const pair = await ownedPair(L, engines);
  assert.equal(pair.right.record.rule, "r2");                  // 夹具确实带着标记（progress.md F6）
  calls = [];
  await switchRight(pair, engines[1]);
  assert.deepEqual(store.get("split:11"), rec(10, "bing"));
  assert.equal("rule" in store.get("split:11"), false);
  assert.equal("base" in store.get("split:11"), false);
});
