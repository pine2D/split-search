import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRaw, loadConfig, saveKeys } from "../src/chrome/config-store.js";

function fakeArea(initial = {}) {
  const data = { ...initial };
  const setCalls = [];
  return {
    setCalls,
    async get(keys) { assert.equal(keys, null); return structuredClone(data); },
    async set(obj) { setCalls.push(obj); Object.assign(data, structuredClone(obj)); },
  };
}

test("存储为空时返回 5 个预置引擎", async () => {
  const cfg = await loadConfig(fakeArea());
  assert.equal(cfg.engines.length, 5);
});
test("saveKeys 只写传入的键，loadConfig 反映排序", async () => {
  const area = fakeArea();
  await saveKeys({ order: ["ddg"] }, area);
  assert.deepEqual(area.setCalls, [{ order: ["ddg"] }]);
  assert.equal((await loadConfig(area)).engines[0].id, "ddg");
});
test("超过 8192 字节时拒绝且不调用 set", async () => {
  const area = fakeArea();
  const big = [{ id: "x", name: "x", url: "https://e.com/?q=%s", pad: "a".repeat(9000) }];
  await assert.rejects(saveKeys({ order: ["ddg"], customEngines: big }, area), /配置过大/);
  assert.equal(area.setCalls.length, 0);
});
test("loadRaw 原样返回 presetOverrides", async () => {
  const presetOverrides = { kagi: { name: "K" } };
  assert.deepEqual((await loadRaw(fakeArea({ presetOverrides }))).presetOverrides, presetOverrides);
});
