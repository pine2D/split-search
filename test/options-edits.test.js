import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, ID_PATTERN, isIdTaken } from "../src/lib/engines.js";
import {
  addEngine, editEngine, hideEngine, deleteEngine, restoreEngine, setDefaultPair, LEFT_RULE,
} from "../src/options/edits.js";

const preset = (id) => PRESETS.find(p => p.id === id);
const baidu = { id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" };

test("默认组合引用的预置引擎不能隐藏", () => {
  for (const id of ["google", "bing"]) assert.equal(hideEngine({}, id).ok, false, id);
  const raw = { defaultPair: ["bing", "ddg"] };
  assert.equal(hideEngine(raw, "bing").ok, false);
  assert.equal(hideEngine(raw, "ddg").ok, false);
  assert.equal(hideEngine(raw, "kagi").ok, true);
});
test("默认组合引用的自定义引擎不能删除", () => {
  const raw = { customEngines: [baidu], defaultPair: ["baidu", "google"] };
  const r = deleteEngine(raw, "baidu");
  assert.equal(r.ok, false); assert.match(r.error, /默认组合/);
  assert.equal(deleteEngine({ customEngines: [baidu] }, "baidu").ok, true);
});
test("预置引擎不能删除、自定义引擎不能隐藏", () => {
  assert.equal(deleteEngine({}, "bing").ok, false);
  assert.equal(hideEngine({ customEngines: [baidu] }, "baidu").ok, false);
});
test("默认左侧引擎改成不能作左侧的网址时拒绝保存", () => {
  const r = editEngine({}, "google", { name: "Google", url: "https://www.google.com/search/%s" });
  assert.equal(r.ok, false); assert.match(r.errors.url, /默认组合的左侧/);
  const custom = { customEngines: [baidu], defaultPair: ["baidu", "google"] };
  assert.equal(editEngine(custom, "baidu", { name: "百度", url: "https://www.baidu.com/s/%s" }).ok, false);
  // 默认右侧可以改成仅右侧的网址
  assert.equal(editEngine({}, "bing", { name: "Bing", url: "https://www.bing.com/s/%s" }).ok, true);
});
test("编辑预置引擎改名时保留 hidden", () => {
  const raw = { presetOverrides: { bing: { hidden: true } } };
  const r = editEngine(raw, "bing", { name: "B", url: preset("bing").url });
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch.presetOverrides.bing, { hidden: true, name: "B" });
});
test("隐藏预置引擎时保留已改的 url", () => {
  const url = "https://duckduckgo.com/?q=%s&kl=cn-zh";
  const r = hideEngine({ presetOverrides: { ddg: { url } } }, "ddg");
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch.presetOverrides.ddg, { url, hidden: true });
});
test("改回预置值时删除对应字段，全部改回时删除整项", () => {
  const raw = { presetOverrides: { google: { name: "G", url: "https://www.google.com/search?q=%s&hl=en" }, bing: { hidden: true } } };
  const r1 = editEngine(raw, "google", { name: "Google", url: "https://www.google.com/search?q=%s&hl=en" });
  assert.deepEqual(r1.patch.presetOverrides.google, { url: "https://www.google.com/search?q=%s&hl=en" });
  const r2 = editEngine(raw, "google", { name: "Google", url: preset("google").url });
  assert.equal("google" in r2.patch.presetOverrides, false);
  assert.deepEqual(r2.patch.presetOverrides.bing, { hidden: true });
  assert.equal(r2.templateChanged, true);
});
test("恢复隐藏的预置引擎时只删 hidden", () => {
  const r = restoreEngine({ presetOverrides: { bing: { hidden: true, name: "B" } } }, "bing");
  assert.deepEqual(r.patch.presetOverrides, { bing: { name: "B" } });
  assert.deepEqual(restoreEngine({ presetOverrides: { bing: { hidden: true } } }, "bing").patch.presetOverrides, {});
});
test("新增引擎的 id 校验", () => {
  const input = { name: "百度", url: baidu.url };
  for (const id of ["Baidu", "", "a b", "a".repeat(21), "百度"]) {
    const r = addEngine({}, { ...input, id });
    assert.equal(r.ok, false, id); assert.match(r.errors.id, /小写字母/);
    assert.equal(ID_PATTERN.test(id), false, id);
  }
  const taken = addEngine({ presetOverrides: { bing: { hidden: true } } }, { ...input, id: "bing" });
  assert.equal(taken.ok, false); assert.match(taken.errors.id, /已被占用/);
  assert.equal(isIdTaken("bing", { presetOverrides: { bing: { hidden: true } } }), true);
  assert.equal(addEngine({ customEngines: [baidu] }, { ...input, id: "baidu" }).ok, false);
  const ok = addEngine({ customEngines: [baidu] }, { ...input, id: "baidu-2" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.patch.customEngines.map(e => e.id), ["baidu", "baidu-2"]);
});
test("新增引擎的网址校验沿用 validateTemplate", () => {
  assert.match(addEngine({}, { id: "x", name: "X", url: "https://*.x.com/?q=%s" }).errors.url, /\*/);
  assert.match(addEngine({}, { id: "x", name: "X", url: "https://x.com/?q=%s&_ss=x,y" }).errors.url, /保留参数/);
});
test("设置默认组合：左侧必须能作左侧", () => {
  const wiki = { id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" };
  assert.equal(setDefaultPair({ customEngines: [wiki] }, "wiki", "kagi").ok, false);
  assert.deepEqual(setDefaultPair({ customEngines: [wiki] }, "kagi", "wiki").patch, { defaultPair: ["kagi", "wiki"] });
});
test("LEFT_RULE 说明参数名只能出现一次", () => {
  assert.match(LEFT_RULE, /只出现一次/);
});
