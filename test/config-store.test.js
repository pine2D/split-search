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
  await assert.rejects(saveKeys({ order: ["ddg"], customEngines: big }, area), { code: "config_too_large", args: ["customEngines"] });
  assert.equal(area.setCalls.length, 0);
});
test("loadRaw 原样返回 presetOverrides", async () => {
  const presetOverrides = { kagi: { name: "K" } };
  assert.deepEqual((await loadRaw(fakeArea({ presetOverrides }))).presetOverrides, presetOverrides);
});
test("单项上限按 键名 + JSON 值 计：恰好 8192 字节通过，8193 字节拒绝", async () => {
  // "k" + JSON.stringify("a".repeat(n)) = 1 + n + 2 字节
  const area = fakeArea();
  await saveKeys({ k: "a".repeat(8189) }, area);
  assert.equal(area.setCalls.length, 1);
  await assert.rejects(saveKeys({ k: "a".repeat(8190) }, area), { code: "config_too_large" });
  assert.equal(area.setCalls.length, 1);
});
test("多字节字符按 UTF-8 字节计", async () => {
  const area = fakeArea();
  const name = "中".repeat(2731); // 2731 个字符，8193 字节
  const big = [{ id: "x", name, url: "https://e.com/?q=%s" }];
  assert.ok(JSON.stringify(big).length < 8192);
  await assert.rejects(saveKeys({ customEngines: big }, area), { code: "config_too_large" });
  assert.equal(area.setCalls.length, 0);
});
test("loadConfig 按预置顺序返回引擎和默认组合", async () => {
  const cfg = await loadConfig(fakeArea());
  assert.deepEqual(cfg.engines.map(e => e.id), ["google", "bing", "ddg", "perplexity", "kagi"]);
  assert.deepEqual(cfg.defaultPair, ["google", "bing"]);
});
