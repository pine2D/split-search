import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { serialQueue } from "../src/lib/serial.js";
import { installClosePair } from "../src/chrome/close-pair.js";
import { withPairLock } from "../src/chrome/pair-lock.js";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => Object.defineProperty(globalThis, "navigator", originalNavigator));
const rec = (peer, engine, over = {}) => ({ peer, engine, query: "test", role: "search", mode: "split", splitViewId: 7, ...over });
const records = () => ({ "split:10": rec(11, "google"), "split:11": rec(10, "bing") });
const tick = () => new Promise(r => setImmediate(r));

async function setup(t, over = {}) {
  t.mock.method(console, "error", () => {});
  let lockChain = Promise.resolve();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    request(_name, _opts, run) { const p = lockChain.then(run); lockChain = p.catch(() => {}); return p; },
  } } });
  const handlers = {};
  const event = name => {
    const fns = handlers[name] = new Set();
    return { addListener: fn => fns.add(fn), removeListener: fn => fns.delete(fn), hasListener: fn => fns.has(fn) };
  };
  const state = {
    sync: { closePairTogether: true }, session: records(), calls: [], removed: [],
    tabs: { 10: { id: 10, index: 0, windowId: 1, splitViewId: 7 }, 11: { id: 11, index: 1, windowId: 1, splitViewId: 7 } },
    fail: {}, ...over,
  };
  const read = (obj, keys) => structuredClone(keys == null ? obj : Object.fromEntries([].concat(keys).filter(k => k in obj).map(k => [k, obj[k]])));
  globalThis.chrome = {
    storage: {
      onChanged: event("storage"),
      sync: { async get(keys) { if (state.configGate) await state.configGate; if (state.fail.config) throw new Error("config failed"); return read(state.sync, keys); } },
      session: {
        async get(keys) { if (state.fail.read) throw new Error("read failed"); return read(state.session, keys); },
        async set(patch) { if (state.fail.write) throw new Error("write failed"); Object.assign(state.session, structuredClone(patch)); },
        async remove(keys) {
          state.calls.push(["consume", [...keys]]);
          if (state.fail.consume) throw new Error("consume failed");
          for (const key of [].concat(keys)) delete state.session[key];
        },
      },
    },
    tabs: {
      onUpdated: event("update"), onRemoved: event("remove"), onDetached: event("detach"), onAttached: event("attach"),
      async query(query) {
        state.calls.push(["query", query]);
        if (state.fail.query) throw new Error("query failed");
        return structuredClone(Object.values(state.tabs).filter(x => query.splitViewId === undefined || x.splitViewId === query.splitViewId));
      },
      async get(id) {
        state.calls.push(["get", id]);
        if (state.beforeGet) await state.beforeGet(id);
        if (state.fail.get || !state.tabs[id]) throw new Error("No tab with id");
        return structuredClone(state.tabs[id]);
      },
      remove(id) {
        state.calls.push(["close", id]); state.removed.push(id);
        if (state.fail.remove) return Promise.reject(new Error("close failed"));
        if (state.holdRemove) return new Promise(() => {});
        delete state.tabs[id]; return Promise.resolve();
      },
    },
  };
  const queue = serialQueue();
  const ready = installClosePair(queue);
  if (!state.deferReady) await ready;
  const emit = (name, ...args) => Promise.all([...handlers[name]].map(fn => fn(...args)));
  const update = (id, splitViewId = -1) => emit("update", id, { splitViewId }, { ...state.tabs[id], id });
  const removed = (id, info = {}) => emit("remove", id, { windowId: 1, isWindowClosing: false, ...info });
  const shut = async (id = 10, info) => {
    delete state.tabs[id]; const peer = id === 10 ? 11 : 10;
    if (state.tabs[peer]) state.tabs[peer].splitViewId = -1;
    await Promise.all([update(10), update(11), removed(id, info)]);
  };
  const preference = async value => {
    const oldValue = state.sync.closePairTogether; state.sync.closePairTogether = value;
    await emit("storage", { closePairTogether: { oldValue, newValue: value } }, "sync");
  };
  return { state, queue, emit, update, removed, shut, preference, handlers, ready };
}

test("启用时只核实原生搜索对；直接关左/右各只关闭对侧一次并消费旧记录", async t => {
  for (const closed of [10, 11]) {
    const s = await setup(t);
    assert.deepEqual(s.state.session["linked:7"], [10, 11]);
    await s.shut(closed);
    assert.deepEqual(s.state.removed, [closed === 10 ? 11 : 10]);
    assert.deepEqual(s.state.session, {});
    await s.removed(closed === 10 ? 11 : 10);
    assert.equal(s.state.removed.length, 1);
    const consume = s.state.calls.findLastIndex(c => c[0] === "consume");
    assert.ok(s.state.calls.findIndex(c => c[0] === "close") < consume); // 第二次 onRemoved 只清理
  }
});

test("开关缺省关闭，普通导航不查询；打开时纳入现有完整分屏", async t => {
  const s = await setup(t, { sync: {} });
  assert.equal(s.handlers.update.size, 0);
  assert.equal(s.state.session["linked:7"], undefined);
  await s.preference(true);
  assert.deepEqual(s.state.session["linked:7"], [10, 11]);
  const n = s.state.calls.length;
  await s.emit("update", 10, { status: "complete" }, s.state.tabs[10]);
  assert.equal(s.state.calls.length, n);
  await s.preference(false);
  assert.equal(s.state.session["linked:7"], undefined);
  await s.shut(); assert.deepEqual(s.state.removed, []);
});

test("确认拆开后再关不联动；手动重新拼回新 split id 也不恢复资格", async t => {
  const s = await setup(t);
  s.state.tabs[10].splitViewId = -1; s.state.tabs[11].splitViewId = -1;
  await Promise.all([s.update(10), s.update(11)]);
  assert.equal(s.state.session["linked:7"], undefined);
  s.state.tabs[10].splitViewId = 8; s.state.tabs[11].splitViewId = 8;
  await Promise.all([s.update(10, 8), s.update(11, 8)]);
  await s.shut(); assert.deepEqual(s.state.removed, []);
});

test("未知快照、仅一侧事件、窗口关闭、对侧已在别处：均不自动关", async t => {
  for (const mode of ["query", "one", "window", "moved", "new-split"]) {
    const s = await setup(t); delete s.state.tabs[10]; s.state.tabs[11].splitViewId = -1;
    if (mode === "query") s.state.fail.query = true;
    await s.update(10);
    if (mode !== "one") await s.update(11);
    if (mode === "moved") s.state.tabs[11].windowId = 2;
    if (mode === "new-split") s.state.tabs[11].splitViewId = 8;
    await s.removed(10, { isWindowClosing: mode === "window" });
    assert.deepEqual(s.state.removed, [], mode);
  }
});

test("没有原生分屏/搜索角色/互指记录不签发资格；记录更新新建对会签发", async t => {
  for (const mode of ["adjacent", "lookup", "foreign", "missing"]) {
    const data = records();
    if (mode === "adjacent") for (const r of Object.values(data)) { r.mode = "adjacent"; r.splitViewId = -1; }
    if (mode === "lookup") { Object.assign(data["split:10"], { role: "page", engine: "", input: "text" }); Object.assign(data["split:11"], { role: "lookup", input: "text" }); }
    if (mode === "foreign") delete data["split:10"];
    if (mode === "missing") delete data["split:11"];
    const s = await setup(t, { session: data });
    assert.equal(s.state.session["linked:7"], undefined);
    await s.shut(); assert.deepEqual(s.state.removed, [], mode);
  }
  const s = await setup(t, { session: {} });
  Object.assign(s.state.session, records());
  await s.emit("storage", { "split:10": { newValue: s.state.session["split:10"] } }, "session");
  assert.deepEqual(s.state.session["linked:7"], [10, 11]);
});

test("关闭前先消费许可；remove 永远 pending 也不挡住后续队列和锁", async t => {
  const s = await setup(t); s.state.holdRemove = true;
  await s.shut();
  assert.deepEqual(s.state.removed, [11]); assert.deepEqual(s.state.session, {});
  assert.equal(await s.queue(() => withPairLock(() => "next action")), "next action");
  const actions = s.state.calls.filter(c => c[0] !== "query");
  assert.deepEqual(actions.slice(-3).map(c => c[0]), ["consume", "get", "close"]);
});

test("读取/消费/签发/偏好/目标查询失败不发关闭；remove 拒绝不恢复许可或重试", async t => {
  for (const failure of ["read", "consume", "write", "config", "get", "remove"]) {
    const s = await setup(t, failure === "write" ? { fail: { write: true } } : {});
    s.state.fail[failure] = true;
    await s.shut(); await tick();
    assert.deepEqual(s.state.removed, failure === "remove" ? [11] : [], failure);
    if (failure === "remove") assert.equal(s.state.session["linked:7"], undefined);
  }
});

test("关闭与重新开启开关不能让队列中的旧证据复活", async t => {
  const s = await setup(t);
  let release; const held = withPairLock(() => new Promise(r => { release = r; })); await tick();
  delete s.state.tabs[10]; s.state.tabs[11].splitViewId = -1;
  const events = [s.update(10), s.update(11), s.removed(10)];
  const off = s.preference(false), on = s.preference(true);
  release(); await Promise.all([held, ...events, off, on]);
  assert.deepEqual(s.state.removed, []);
});

test("关闭等锁期间 go 建立新的 adjacent B/C，旧关闭不删新记录也不关 B", async t => {
  const s = await setup(t); let release;
  const go = withPairLock(async () => {
    await new Promise(r => { release = r; });
    delete s.state.session["split:10"];
    s.state.session["split:11"] = rec(12, "bing", { mode: "adjacent", splitViewId: -1 });
    s.state.session["split:12"] = rec(11, "ddg", { mode: "adjacent", splitViewId: -1 });
    s.state.tabs[12] = { id: 12, windowId: 1, index: 1, splitViewId: -1 };
  });
  await tick(); delete s.state.tabs[10]; s.state.tabs[11].splitViewId = -1;
  const events = [s.update(10), s.update(11), s.removed(10)];
  release(); await Promise.all([go, ...events]);
  assert.deepEqual(s.state.removed, []);
  assert.equal(s.state.session["split:11"].peer, 12);
  assert.equal(s.state.session["split:12"].peer, 11);
});

test("跨窗口移出解除许可；移出通知在最后查询中到达也撤销本次关闭", async t => {
  const s = await setup(t);
  await s.emit("detach", 11, { oldWindowId: 1 });
  assert.equal(s.state.session["linked:7"], undefined);
  await s.shut(); assert.deepEqual(s.state.removed, []);
  const other = await setup(t);
  let moved;
  other.state.beforeGet = async () => { moved = other.emit("detach", 11, { oldWindowId: 1 }); };
  await other.shut(); await moved;
  assert.deepEqual(other.state.removed, []);
});

test("新 SW 不继承单侧内存证据，但能使用已核实的 session 许可处理完整冷启动事件", async t => {
  for (const complete of [false, true]) {
    const s = await setup(t, {
      session: { ...records(), "linked:7": [10, 11] },
      tabs: { 11: { id: 11, windowId: 1, index: 0, splitViewId: -1 } },
    });
    if (complete) await s.update(10);
    await s.update(11); await s.removed(10);
    assert.deepEqual(s.state.removed, complete ? [11] : []);
  }
});

test("冷启动偏好读取尚未完成时到来的原生关闭事件不能丢掉", async t => {
  let release;
  const configGate = new Promise(r => { release = r; });
  const s = await setup(t, { deferReady: true, configGate, session: { ...records(), "linked:7": [10, 11] } });
  const close = s.shut();
  await tick(); release();
  await Promise.all([s.ready, close]);
  assert.deepEqual(s.state.removed, [11]);
});
