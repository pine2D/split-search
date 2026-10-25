import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  snapshotStorage, restoreStorage, restorePendingSnapshot, configureMocks, mockBaseline, bindExt,
  ensureExtension, ensureExtensionUp, registeredEntry, storageDigest, installedIds,
} from "../scripts/e2e/ext.mjs";
import { EXT_ID, mockEngines } from "../scripts/e2e/config.mjs";

// 假浏览器：evalExt 在带假 chrome 的沙箱里执行表达式，按 returnByValue 的方式返回
function fakeBrowser(initial = {}, { failSet = false, runtimeId = EXT_ID } = {}) {
  let store = structuredClone(initial);
  const calls = [];
  const chrome = {
    runtime: { id: runtimeId },
    storage: { sync: {
      get: async () => structuredClone(store),
      clear: async () => { calls.push("clear"); store = {}; },
      set: async o => { calls.push("set"); if (failSet) throw new Error("写入失败"); store = { ...store, ...structuredClone(o) }; },
    } },
  };
  return {
    calls,
    get store() { return store; },
    evalExt: async expr => {
      const v = await vm.runInNewContext(expr, { chrome });
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    },
  };
}
function withDir(fn) {
  const d = mkdtempSync(join(tmpdir(), "e2e-ext-"));
  return Promise.resolve(fn(d)).finally(() => rmSync(d, { recursive: true, force: true }));
}
const sample = { order: ["bing", "google"], presetOverrides: { ddg: { hidden: true } }, "键": "值" };

test("snapshotStorage: 写出全量快照；已有快照时拒绝覆盖", () => withDir(async d => {
  const b = fakeBrowser(sample);
  const file = join(d, "sub", "snap.json");
  const r = await snapshotStorage(b, file);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), sample);
  assert.equal(r.digest, storageDigest(sample));
  await assert.rejects(snapshotStorage(b, file), /已存在/);
}));

test("restoreStorage: 先 clear 再 set，校验一致后删除快照", () => withDir(async d => {
  const b = fakeBrowser(sample);
  const file = join(d, "snap.json");
  await snapshotStorage(b, file);
  await configureMocks(b, 8765);
  assert.deepEqual(b.store.customEngines, mockEngines(8765));
  assert.deepEqual(b.store.defaultPair, ["ea", "eb"]);
  b.calls.length = 0;
  const r = await restoreStorage(b, file);
  assert.deepEqual(b.calls, ["clear", "set"]);
  assert.deepEqual(b.store, sample);
  assert.equal(r.equal, true);
  assert.equal(r.digest, storageDigest(sample));
  assert.equal(existsSync(file), false);
}));

test("restoreStorage: 写入失败时保留快照文件", () => withDir(async d => {
  const file = join(d, "snap.json");
  writeFileSync(file, JSON.stringify(sample));
  await assert.rejects(restoreStorage(fakeBrowser({}, { failSet: true }), file), /写入失败/);
  assert.equal(existsSync(file), true);
}));

test("restorePendingSnapshot: 无快照返回 false；有遗留快照则恢复并返回 true", () => withDir(async d => {
  const file = join(d, "snap.json");
  const b = fakeBrowser({ defaultPair: ["ea", "eb"] });
  assert.equal(await restorePendingSnapshot(b, file), false);
  assert.deepEqual(b.store, { defaultPair: ["ea", "eb"] });
  writeFileSync(file, JSON.stringify(sample));
  assert.equal(await restorePendingSnapshot(b, file), true);
  assert.deepEqual(b.store, sample);
  assert.equal(existsSync(file), false);
}));

test("configureMocks: 从干净基线写入模拟引擎、默认组合与界面语言", async () => {
  const b = fakeBrowser(sample);
  await configureMocks(b, 9000);
  assert.deepEqual(b.store, { customEngines: mockEngines(9000), defaultPair: ["ea", "eb"], uiLocale: "zh_CN", narrowFallback: false });
});

test("mockBaseline: 基线对象含 uiLocale: zh_CN，并关掉窄窗口降级", () => {
  assert.deepEqual(mockBaseline(9000), { customEngines: mockEngines(9000), defaultPair: ["ea", "eb"], uiLocale: "zh_CN", narrowFallback: false });
});

test("ctx.ext.configureMocks: 步骤内重置基线后，存储里仍是 uiLocale: zh_CN", async () => {
  const b = fakeBrowser({ uiLocale: "en", customEngines: [], defaultPair: ["google", "bing"] });
  const ext = bindExt(b, { port: 8765 });
  await ext.configureMocks();
  assert.equal(b.store.uiLocale, "zh_CN");
  b.store.uiLocale = "es";
  await ext.configureMocks();
  assert.deepEqual(b.calls.slice(-2), ["clear", "set"]);
  assert.deepEqual(b.store, mockBaseline(8765));
});

test("storageDigest: 与键顺序无关", () => {
  assert.equal(storageDigest({ a: 1, b: { c: 2, d: [1, 2] } }), storageDigest({ b: { d: [1, 2], c: 2 }, a: 1 }));
  assert.notEqual(storageDigest({ a: 1 }), storageDigest({ a: 2 }));
});

function profileWith(d, settings) {
  mkdirSync(join(d, "Default"), { recursive: true });
  writeFileSync(join(d, "Default", "Preferences"), JSON.stringify({ extensions: { settings } }));
}

test("installedIds: 从测试配置的 Preferences 找出指向源码目录的扩展", () => withDir(d => {
  profileWith(d, { abc: { path: "/src/x", location: 4 }, other: { path: "/elsewhere" } });
  assert.deepEqual(installedIds(d, "/src/x"), ["abc"]);
  assert.deepEqual(installedIds(join(d, "nope"), "/src/x"), []);
}));

test("ensureExtension: 能在扩展页执行且 id 一致 -> ok", async () => {
  assert.deepEqual(await ensureExtension(fakeBrowser(), { timeoutMs: 500 }), { ok: true });
});

test("ensureExtension: 扩展页打不开 -> not-installed；源码装在别的 id 下 -> wrong-id", () => withDir(async d => {
  const dead = { evalExt: () => new Promise(() => {}) };
  profileWith(d, {});
  assert.deepEqual(await ensureExtension(dead, { timeoutMs: 50, profileDir: d, srcDir: "/src/x" }), { ok: false, reason: "not-installed" });
  profileWith(d, { zzz: { path: "/src/x" } });
  const r = await ensureExtension(dead, { timeoutMs: 50, profileDir: d, srcDir: "/src/x" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "wrong-id");
  assert.deepEqual(r.ids, ["zzz"]);
}));

test("ensureExtension: 页面里 id 不符 -> wrong-id", async () => {
  const r = await ensureExtension(fakeBrowser({}, { runtimeId: "other" }), { timeoutMs: 500 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "wrong-id");
});

test("ensureExtensionUp: 已登记但打不开 → 稍等重试，仍不行经详情页启用再查（reenabled）；未登记、wrong-id 不启用", async () => {
  const seq = list => { let i = 0; return async () => list[Math.min(i++, list.length - 1)]; };
  const DIS = { ok: false, reason: "not-installed", hint: "扩展已登记但设置页打不开，可能被停用" };
  const wait = async () => {};
  let enables = 0;
  const enable = async () => { enables++; return true; };
  assert.deepEqual(await ensureExtensionUp(seq([{ ok: true }]), { enable, wait }), { ok: true });
  assert.deepEqual(await ensureExtensionUp(seq([DIS, { ok: true }]), { enable, wait }), { ok: true }, "冷启动慢：重试即可");
  assert.equal(enables, 0);
  assert.deepEqual(await ensureExtensionUp(seq([DIS, DIS, { ok: true }]), { enable, wait }), { ok: true, reenabled: true });
  assert.equal(enables, 1);
  assert.deepEqual(await ensureExtensionUp(seq([DIS, DIS, DIS]), { enable: async () => false, wait }), DIS, "启用失败：原样返回");
  assert.deepEqual(await ensureExtensionUp(seq([DIS, DIS, DIS]), { enable: async () => { throw new Error("x"); }, wait }), DIS);
  enables = 0;
  await ensureExtensionUp(seq([{ ok: false, reason: "not-installed" }]), { enable, wait });
  await ensureExtensionUp(seq([{ ok: false, reason: "wrong-id", ids: ["x"] }]), { enable, wait });
  assert.equal(enables, 0);
});

test("ensureExtension: 本扩展已登记（不论装自哪个目录）但打不开 → not-installed 带 hint；停用的写明停用", () => withDir(async d => {
  const dead = { evalExt: () => new Promise(() => {}) };
  profileWith(d, { [EXT_ID]: { path: "/main/src", disable_reasons: [1] } });
  assert.deepEqual(registeredEntry(d), { path: "/main/src", disabled: true });
  assert.deepEqual(await ensureExtension(dead, { timeoutMs: 50, profileDir: d, srcDir: "/worktree/src" }),
    { ok: false, reason: "not-installed", hint: "扩展已登记但处于停用状态" });
  profileWith(d, { [EXT_ID]: { path: "/main/src", disable_reasons: [] } });
  assert.equal(registeredEntry(d).disabled, false);
  assert.match((await ensureExtension(dead, { timeoutMs: 50, profileDir: d, srcDir: "/worktree/src" })).hint, /可能被停用/);
  profileWith(d, { [EXT_ID]: { path: "/main/src", disable_reasons: 1 } });
  assert.equal(registeredEntry(d).disabled, true, "旧版位掩码");
  assert.equal(registeredEntry(join(d, "nope")), null);
}));
