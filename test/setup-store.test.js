// chrome/setup-store.js：go.html 写入一对后写 setupDone、“试一下”记标签 id。chrome 用最小桩替身。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { noteSetupPair, rememberTryTab, readSetupDone } from "../src/chrome/setup-store.js";

let local, session, calls;
function installChrome({ fail = {}, hang = false } = {}) {
  calls = [];
  const area = (name, map) => ({
    async get(key) {
      calls.push([`${name}.get`, key]);
      if (hang) await new Promise(() => {});
      if (fail[`${name}.get`]) throw new Error(`${name}.get failed`);
      return map.has(key) ? { [key]: map.get(key) } : {};
    },
    async set(obj) {
      calls.push([`${name}.set`, obj]);
      if (fail[`${name}.set`]) throw new Error(`${name}.set failed`);
      for (const [k, v] of Object.entries(obj)) map.set(k, v);
    },
  });
  globalThis.chrome = { storage: { local: area("local", local), session: area("session", session) } };
}

beforeEach((t) => {
  local = new Map();
  session = new Map();
  installChrome();
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "error", () => {});
});

test("noteSetupPair：没完成、两侧都不是“试一下”的标签 → 写 setupDone: true", async () => {
  session.set("setupTryTabs", [9]);
  await noteSetupPair([1, 2, 3]);
  assert.equal(local.get("setupDone"), true);
});

test("noteSetupPair：任一标签在 setupTryTabs 里 → 不写", async () => {
  session.set("setupTryTabs", [2]);
  await noteSetupPair([1, 2]);
  assert.equal(local.has("setupDone"), false);
});

test("noteSetupPair：已经是 true → 不再读 session、不写", async () => {
  local.set("setupDone", true);
  await noteSetupPair([1, 2]);
  assert.deepEqual(calls.map(c => c[0]), ["local.get"]);
});

test("noteSetupPair：读写失败一律吞掉，只记 info 级日志；读不出 setupTryTabs 时不写", async () => {
  installChrome({ fail: { "local.get": true } });
  await noteSetupPair([1, 2]);
  assert.equal(local.has("setupDone"), false);
  installChrome({ fail: { "session.get": true } });
  await noteSetupPair([1, 2]);
  assert.equal(local.has("setupDone"), false);
  installChrome({ fail: { "local.set": true } });
  await noteSetupPair([1, 2]);
  assert.ok(console.info.mock.callCount() >= 3);
  assert.equal(console.error.mock.callCount(), 0);
});

test("noteSetupPair：存储一直不回复也最多等 timeoutMs", async () => {
  installChrome({ hang: true });
  const t0 = Date.now();
  await noteSetupPair([1, 2], 30);
  assert.ok(Date.now() - t0 < 1000);
});

test("rememberTryTab：追加到 setupTryTabs；失败只记日志", async () => {
  await rememberTryTab(5);
  await rememberTryTab(6);
  assert.deepEqual(session.get("setupTryTabs"), [5, 6]);
  installChrome({ fail: { "session.set": true } });
  await rememberTryTab(7);
  assert.deepEqual(session.get("setupTryTabs"), [5, 6]);
});

test("readSetupDone：true / false；读不出来是 null", async () => {
  assert.equal(await readSetupDone(), false);
  local.set("setupDone", true);
  assert.equal(await readSetupDone(), true);
  installChrome({ fail: { "local.get": true } });
  assert.equal(await readSetupDone(), null);
});
