import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readRecord, writePair, writeEngine, clearPair, inspectTab } from "../src/chrome/split-state.js";
import { parseRecord } from "../src/lib/split-owner.js";

// 最小 chrome 桩：storage.session 用内存 Map；fail.<name> 为 true 时对应调用抛错。
// tabs 是 id → 标签 的表，tabs.get 找不到时按 Chrome 的报错抛出。
let calls, store;
function installChrome({ fail = {}, tabs = {}, data = {} } = {}) {
  calls = [];
  store = new Map(Object.entries(data));
  const check = (name) => { if (fail[name]) throw new Error(`${name} failed`); };
  globalThis.chrome = {
    tabs: {
      async get(id) {
        calls.push(["tabs.get", id]);
        if (!tabs[id]) throw new Error(`No tab with id: ${id}.`);
        return tabs[id];
      },
      async query(q) {
        calls.push(["tabs.query", q]);
        return Object.values(tabs).filter(t => t.splitViewId === q.splitViewId);
      },
    },
    storage: {
      session: {
        async get(key) {
          check("get");
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.filter(k => store.has(k)).map(k => [k, store.get(k)]));
        },
        async set(obj) {
          calls.push(["session.set", obj]);
          check("set");
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        async remove(keys) {
          calls.push(["session.remove", keys]);
          check("remove");
          for (const k of [].concat(keys)) store.delete(k);
        },
      },
    },
  };
}

const rec = (peer, over = {}) => ({ peer, splitViewId: 7, mode: "split", role: "search", engine: "google", query: "q", ...over });
const engines = [{ id: "google", url: "https://www.google.com/search?q=%s" }];

beforeEach((t) => {
  installChrome();
  t.mock.method(console, "error", () => {});
});

test("readRecord：裸数字（旧版本的记录）当作没有记录", async () => {
  installChrome({ data: { "split:1": 2 } });
  assert.equal(await readRecord(1), null);
});

test("readRecord：读出合法记录；没有记录返回 null", async () => {
  installChrome({ data: { "split:1": rec(2) } });
  assert.deepEqual(await readRecord(1), rec(2));
  assert.equal(await readRecord(5), null);
});

test("readRecord：storage.session.get 抛错时返回 null，不抛", async () => {
  installChrome({ fail: { get: true }, data: { "split:1": rec(2) } });
  assert.equal(await readRecord(1), null);
  assert.equal(console.error.mock.callCount(), 1);
});

test("writePair：一次 set 写两条", async () => {
  await writePair({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "google", engineB: "bing", query: "a&b" });
  assert.deepEqual(calls, [["session.set", {
    "split:1": { peer: 2, splitViewId: 7, mode: "split", role: "search", engine: "google", query: "a&b" },
    "split:2": { peer: 1, splitViewId: 7, mode: "split", role: "search", engine: "bing", query: "a&b" },
  }]]);
});

test("writePair：set 抛错时只记日志，不抛", async () => {
  installChrome({ fail: { set: true } });
  await writePair({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "google", engineB: "bing", query: "q" });
  assert.equal(console.error.mock.callCount(), 1);
});

test("writeEngine：只改这一条的 engine", async () => {
  installChrome({ data: { "split:1": rec(2), "split:2": rec(1) } });
  await writeEngine(2, rec(1), "kagi");
  assert.deepEqual(calls, [["session.set", { "split:2": rec(1, { engine: "kagi" }) }]]);
  assert.deepEqual(store.get("split:1"), rec(2));
});

test("writeEngine：set 抛错时不抛", async () => {
  installChrome({ fail: { set: true } });
  await writeEngine(2, rec(1), "kagi");
  assert.equal(console.error.mock.callCount(), 1);
});

test("clearPair：对侧记录指回自己 → 两条都删", async () => {
  installChrome({ data: { "split:1": rec(2), "split:2": rec(1) } });
  await clearPair(1);
  assert.equal(store.size, 0);
});

test("clearPair：对侧记录已指向别的标签 → 只删自己", async () => {
  installChrome({ data: { "split:1": rec(2), "split:2": rec(3), "split:3": rec(2) } });
  await clearPair(1);
  assert.deepEqual([...store.keys()].sort(), ["split:2", "split:3"]);
});

test("clearPair：没有记录或旧形状时只删自己", async () => {
  installChrome({ data: { "split:1": 2, "split:2": 1 } });
  await clearPair(1);
  assert.deepEqual([...store.keys()], ["split:2"]);
});

test("clearPair：storage 抛错时不抛", async () => {
  installChrome({ fail: { get: true, remove: true }, data: { "split:1": rec(2) } });
  await clearPair(1);
  assert.ok(console.error.mock.callCount() >= 1);
});

test("inspectTab：在分屏中，经 tabs.query 找对侧，互指记录 → own", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: 7 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: 7, url: "https://www.bing.com/search?q=q" };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:1": rec(2), "split:2": rec(1) } });
  const info = await inspectTab(tab, engines);
  assert.equal(info.splitViewId, 7);
  assert.equal(info.splitTabs.length, 2);
  assert.deepEqual(info.peer, { id: 2, index: 5, windowId: 9, splitViewId: 7, url: other.url });
  assert.deepEqual(info.record, rec(2));
  assert.deepEqual(info.peerRecord, rec(1));
  assert.equal(info.ownership, "own");
  assert.deepEqual(calls[0], ["tabs.query", { splitViewId: 7 }]);
});

test("inspectTab：不在分屏中、没有记录 → 不查对侧，none", async () => {
  const tab = { id: 1, index: 4, windowId: 9 };
  installChrome({ tabs: { 1: tab } });
  const info = await inspectTab(tab, engines);
  assert.equal(info.splitViewId, -1);
  assert.deepEqual(info.splitTabs, []);
  assert.equal(info.peer, null);
  assert.equal(info.ownership, "none");
  assert.deepEqual(calls, []);
});

test("inspectTab：相邻对经 tabs.get(record.peer) 取对侧", async () => {
  const adj = (p) => rec(p, { mode: "adjacent", splitViewId: -1 });
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: -1 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: -1 };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:1": adj(2), "split:2": adj(1) } });
  const info = await inspectTab(tab, engines);
  assert.deepEqual(calls[0], ["tabs.get", 2]);
  assert.equal(info.peer.id, 2);
  assert.equal(info.ownership, "own");
  assert.equal(store.size, 2);
});

test("inspectTab：相邻对的对侧已关掉（No tab with id）→ peer 为 null、stale，并删掉自己的记录", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: -1 };
  installChrome({ tabs: { 1: tab }, data: { "split:1": rec(2, { mode: "adjacent", splitViewId: -1 }) } });
  const info = await inspectTab(tab, engines);
  assert.deepEqual(calls[0], ["tabs.get", 2]);
  assert.equal(info.peer, null);
  assert.equal(info.ownership, "stale");
  assert.equal(store.has("split:1"), false);
});

test("inspectTab：拆开又拼回（splitViewId 变了）→ stale，对侧还在，两条记录都保留", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: 8 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: 8, url: "https://www.google.com/search?q=q" };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:1": rec(2), "split:2": rec(1) } });
  const info = await inspectTab(tab, engines);
  assert.equal(info.ownership, "stale");
  assert.deepEqual([...store.keys()].sort(), ["split:1", "split:2"]);
  assert.ok(!calls.some(c => c[0] === "session.remove"));
});

test("inspectTab：拼回后连续检查两次 → 两次都 stale，不会落到兜底", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: 8 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: 8, url: "https://www.google.com/search?q=q" };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:1": rec(2), "split:2": rec(1) } });
  assert.equal((await inspectTab(tab, engines)).ownership, "stale");
  assert.equal((await inspectTab(tab, engines)).ownership, "stale");
  assert.equal((await inspectTab(other, engines)).ownership, "stale");
});

test("inspectTab：拆开后（不在分屏中）检查 → stale，对侧还在，记录保留，之后拼回仍判 stale", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: -1 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: -1, url: "https://www.google.com/search?q=q" };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:1": rec(2), "split:2": rec(1) } });
  assert.equal((await inspectTab(tab, engines)).ownership, "stale");
  assert.equal(store.size, 2);
  tab.splitViewId = 8;
  other.splitViewId = 8;
  assert.equal((await inspectTab(tab, engines)).ownership, "stale");
});

test("inspectTab：在别的分屏里、记录里的对侧已关掉 → stale，清掉自己的记录", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: 8 };
  const other = { id: 3, index: 5, windowId: 9, splitViewId: 8, url: "https://www.google.com/search?q=q" };
  installChrome({ tabs: { 1: tab, 3: other }, data: { "split:1": rec(2) } });
  const info = await inspectTab(tab, engines);
  assert.equal(info.ownership, "stale");
  assert.deepEqual(calls.filter(c => c[0] === "tabs.get"), [["tabs.get", 2]]);
  assert.equal(store.size, 0);
});

test("inspectTab：无记录、对侧是引擎搜索页 → fallback-own", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: 7 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: 7, url: "https://www.google.com/search?q=q" };
  installChrome({ tabs: { 1: tab, 2: other } });
  assert.equal((await inspectTab(tab, engines)).ownership, "fallback-own");
});

test("inspectTab：当前标签无记录、对侧有指回它的记录 → stale，不清理、不抛错", async () => {
  // 场景：A|B 拆开 → A 另组一对后对方关掉，A 的记录被连带删掉，B 仍指回 A → 用户把 A、B 手动拼回
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: 8 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: 8, url: "https://www.google.com/search?q=q" };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:2": rec(1) } });
  const info = await inspectTab(tab, engines);
  assert.equal(info.ownership, "stale");
  assert.equal(store.has("split:2"), true);
  assert.ok(!calls.some(c => c[0] === "session.remove"));
});

test("inspectTab：storage 读失败时当作没有记录", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: 7 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: 7 };
  installChrome({ fail: { get: true }, tabs: { 1: tab, 2: other }, data: { "split:1": rec(2) } });
  const info = await inspectTab(tab, engines);
  assert.equal(info.record, null);
  assert.equal(info.ownership, "none");
});

// ---- 相邻对拖开后永久失效（spec 3.3“拖开后就不再复用”）----
const adjRec = (p, over = {}) => rec(p, { mode: "adjacent", splitViewId: -1, ...over });
const marker = (p, over = {}) => rec(p, { mode: "split", splitViewId: -1, ...over });

test("inspectTab：相邻对被拖开（对侧还在）→ stale，两条记录都改写成永久失效标记", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: -1 };
  const other = { id: 2, index: 7, windowId: 9, splitViewId: -1 };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:1": adjRec(2, { engine: "ea" }), "split:2": adjRec(1, { engine: "eb" }) } });
  assert.equal((await inspectTab(tab, engines)).ownership, "stale");
  assert.deepEqual(store.get("split:1"), marker(2, { engine: "ea" }));
  assert.deepEqual(store.get("split:2"), marker(1, { engine: "eb" }));
});

test("inspectTab：拖开后再拖回相邻、或手动拼成分屏 → 仍 stale，不落到兜底", async () => {
  const url = "https://www.google.com/search?q=q";
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: -1 };
  const other = { id: 2, index: 7, windowId: 9, splitViewId: -1, url };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:1": adjRec(2), "split:2": adjRec(1) } });
  assert.equal((await inspectTab(tab, engines)).ownership, "stale");
  other.index = 5; // 拖回相邻
  assert.equal((await inspectTab(tab, engines)).ownership, "stale");
  assert.equal((await inspectTab(other, engines)).ownership, "stale");
  tab.splitViewId = 8; other.splitViewId = 8; // 用户手动拼成分屏
  assert.equal((await inspectTab(tab, engines)).ownership, "stale");
  assert.equal((await inspectTab(other, engines)).ownership, "stale");
});

test("inspectTab：相邻记录失效、对侧记录已指向别的标签 → 只改写自己的，不碰对侧", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: -1 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: -1 };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:1": adjRec(2), "split:2": adjRec(3) } });
  assert.equal((await inspectTab(tab, engines)).ownership, "stale");
  assert.deepEqual(store.get("split:1"), marker(2));
  assert.deepEqual(store.get("split:2"), adjRec(3));
});

test("inspectTab：本扩展的相邻对仍相邻 → own，记录不动", async () => {
  const tab = { id: 1, index: 4, windowId: 9, splitViewId: -1 };
  const other = { id: 2, index: 5, windowId: 9, splitViewId: -1 };
  installChrome({ tabs: { 1: tab, 2: other }, data: { "split:1": adjRec(2), "split:2": adjRec(1) } });
  assert.equal((await inspectTab(tab, engines)).ownership, "own");
  assert.ok(!calls.some(c => c[0] === "session.set"));
});

// ---- 同一上下文里的记录写入串行执行 ----
test("clearPair 与紧随其后的 writePair 并发：按调用顺序生效，新记录不会被前一个 clearPair 删掉", async () => {
  installChrome({ data: { "split:1": rec(2), "split:2": rec(1) } });
  const a = clearPair(1);
  const b = writePair({ a: 1, b: 3, splitViewId: 9, mode: "split", engineA: "google", engineB: "bing", query: "n" });
  await Promise.all([a, b]);
  assert.deepEqual(store.get("split:1"), rec(3, { splitViewId: 9, query: "n" }));
  assert.equal(store.get("split:3").peer, 1);
  assert.equal(store.has("split:2"), false);
});

test("writeEngine 与 clearPair 并发：按调用顺序生效", async () => {
  installChrome({ data: { "split:1": rec(2), "split:2": rec(1) } });
  await Promise.all([clearPair(1), writeEngine(1, rec(2), "bing")]);
  assert.deepEqual(store.get("split:1"), rec(2, { engine: "bing" }));
});

test("串行队列：前一个写入抛错不影响后面的写入", async () => {
  installChrome({ fail: { remove: true }, data: { "split:1": rec(2) } });
  await Promise.all([clearPair(1), writePair({ a: 5, b: 6, splitViewId: 9, mode: "split", engineA: "google", engineB: "bing", query: "q" })]);
  assert.equal(store.get("split:5").peer, 6);
});

// ---- v0.4 记录角色：读写不丢 role、input ----
test("writePair：roleA/roleB/input 原样写进两条记录（查询对）", async () => {
  await writePair({
    a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "", engineB: "bing", query: "q",
    roleA: "page", roleB: "lookup", input: "text",
  });
  assert.deepEqual(calls, [["session.set", {
    "split:1": { peer: 2, splitViewId: 7, mode: "split", role: "page", input: "text", engine: "", query: "q" },
    "split:2": { peer: 1, splitViewId: 7, mode: "split", role: "lookup", input: "text", engine: "bing", query: "q" },
  }]]);
});

test("writeEngine：在解析后的 lookup 记录上改 engine，role、input 不变", async () => {
  const lookupRec = rec(1, { role: "lookup", input: "image", engine: "lens", query: "https://img.example.com/a.png" });
  installChrome({ data: { "split:1": rec(2, { role: "page", input: "image", engine: "" }), "split:2": lookupRec } });
  await writeEngine(2, parseRecord(lookupRec), "ddg");
  const got = store.get("split:2");
  assert.equal(got.role, "lookup");
  assert.equal(got.input, "image");
  assert.equal(got.engine, "ddg");
  assert.deepEqual(parseRecord(got), { ...lookupRec, engine: "ddg" });
});

test("writePair：不合法的组合（makeRecords 抛错）只记日志、一条都不写，不抛给调用方", async () => {
  await writePair({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "", engineB: "bing", query: "q",
    roleA: "page", roleB: "lookup" });
  await writePair({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "google", engineB: "bing", query: "q",
    roleA: "search", roleB: "lookup", input: "text" });
  assert.deepEqual(calls, []);
  assert.equal(console.error.mock.callCount(), 2);
});

test("writePair：写成返回 true，set 抛错返回 false（不抛）", async () => {
  assert.equal(await writePair({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "google", engineB: "bing", query: "q" }), true);
  installChrome({ fail: { set: true } });
  assert.equal(await writePair({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "google", engineB: "bing", query: "q" }), false);
});
