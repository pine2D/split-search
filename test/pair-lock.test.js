import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { withPairLock } from "../src/chrome/pair-lock.js";
import { saveKeys } from "../src/chrome/config-store.js";

const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const nav = locks => Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
afterEach(() => { if (original) Object.defineProperty(globalThis, "navigator", original); else delete globalThis.navigator; });

test("没有跨上下文锁时原有动作可执行，要求锁的关闭判定拒绝执行", async () => {
  nav(undefined);
  assert.equal(await withPairLock(() => 42), 42);
  let fired = false;
  await assert.rejects(withPairLock(() => { fired = true; }, { required: true }), /lock/i);
  assert.equal(fired, false);
});

test("所有上下文使用同名独占锁；第二个动作等第一个完成才重新读取状态", async () => {
  let queue = Promise.resolve(); const calls = [], states = []; let release, value = 0;
  nav({ request(name, opts, fn) {
    calls.push({ name, mode: opts.mode, signal: opts.signal });
    const next = queue.then(fn); queue = next.catch(() => {}); return next;
  } });
  const first = withPairLock(async () => { states.push(value); await new Promise(r => { release = r; }); value = 1; });
  await new Promise(r => setImmediate(r));
  const second = withPairLock(() => states.push(value));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(states, [0]);
  release(); await Promise.all([first, second]);
  assert.deepEqual(states, [0, 1]);
  assert.equal(calls[0].name, calls[1].name);
  assert.equal(calls[0].mode, "exclusive");
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test("锁请求拒绝时不在锁外重做动作；回调错误原样传出", async () => {
  nav({ request() { return Promise.reject(new Error("lock wait aborted")); } });
  let fired = false;
  await assert.rejects(withPairLock(() => { fired = true; }), /aborted/);
  assert.equal(fired, false);
  nav({ request(_name, _opts, fn) { return fn(); } });
  await assert.rejects(withPairLock(() => { throw new Error("action failed"); }), /action failed/);
});

test("关闭开关的保存与自动关闭判定共用锁，不在另一动作持锁时提前保存成功", async () => {
  let queue = Promise.resolve(), release; const writes = [];
  nav({ request(_name, _opts, fn) { const p = queue.then(fn); queue = p.catch(() => {}); return p; } });
  const active = withPairLock(() => new Promise(r => { release = r; }));
  await new Promise(r => setImmediate(r));
  const saved = saveKeys({ closePairTogether: false }, { set: async patch => { writes.push(patch); } });
  try {
    await new Promise(r => setImmediate(r));
    assert.deepEqual(writes, []);
  } finally { release(); await Promise.all([active, saved]); }
  assert.deepEqual(writes, [{ closePairTogether: false }]);
});
