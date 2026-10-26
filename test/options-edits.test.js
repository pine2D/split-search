import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, ID_PATTERN, isIdTaken, mergeConfig } from "../src/lib/engines.js";
import { CATALOG } from "../src/lib/engine-catalog.js";
import {
  addEngine, editEngine, hideEngine, deleteEngine, restoreEngine, setDefaultPair, setNarrowFallback, describeTemplate, addFromCatalog,
  setCycle, setLookupEngine,
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
  assert.equal(r.ok, false); assert.equal(r.error.code, "pair_uses_delete");
  assert.equal(deleteEngine({ customEngines: [baidu] }, "baidu").ok, true);
});
test("预置引擎不能删除、自定义引擎不能隐藏", () => {
  assert.equal(deleteEngine({}, "bing").ok, false);
  assert.equal(hideEngine({ customEngines: [baidu] }, "baidu").ok, false);
});
test("默认左侧引擎改成不能作左侧的网址时拒绝保存", () => {
  const r = editEngine({}, "google", { name: "Google", url: "https://www.google.com/search/%s" });
  assert.equal(r.ok, false); assert.equal(r.errors.url.code, "default_left_url");
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
    assert.equal(r.ok, false, id); assert.equal(r.errors.id.code, "id_format");
    assert.equal(ID_PATTERN.test(id), false, id);
  }
  const taken = addEngine({ presetOverrides: { bing: { hidden: true } } }, { ...input, id: "bing" });
  assert.equal(taken.ok, false); assert.deepEqual(taken.errors.id, { code: "id_taken", args: ["bing"] });
  assert.equal(isIdTaken("bing", { presetOverrides: { bing: { hidden: true } } }), true);
  assert.equal(addEngine({ customEngines: [baidu] }, { ...input, id: "baidu" }).ok, false);
  const ok = addEngine({ customEngines: [baidu] }, { ...input, id: "baidu-2" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.patch.customEngines.map(e => e.id), ["baidu", "baidu-2"]);
});
test("新增引擎的网址校验沿用 validateTemplate", () => {
  assert.equal(addEngine({}, { id: "x", name: "X", url: "https://*.x.com/?q=%s" }).errors.url.code, "tpl_wildcard_host");
  assert.equal(addEngine({}, { id: "x", name: "X", url: "https://x.com/?q=%s&_ss=x,y" }).errors.url.code, "tpl_reserved_param");
});
test("设置默认组合：左侧必须能作左侧", () => {
  const wiki = { id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" };
  assert.equal(setDefaultPair({ customEngines: [wiki] }, "wiki", "kagi").ok, false);
  assert.deepEqual(setDefaultPair({ customEngines: [wiki] }, "kagi", "wiki").patch, { defaultPair: ["kagi", "wiki"] });
});
test("名称必填且不超过 NAME_MAX；找不到引擎时报 form 错误", () => {
  assert.deepEqual(addEngine({}, { id: "x", name: " ", url: baidu.url }).errors, { name: { code: "name_required", args: [] } });
  assert.deepEqual(addEngine({}, { id: "x", name: "a".repeat(41), url: baidu.url }).errors, { name: { code: "name_too_long", args: ["40"] } });
  assert.deepEqual(editEngine({}, "gone", { name: "X", url: baidu.url }), { ok: false, errors: { form: { code: "engine_gone", args: [] } } });
});
test("隐藏、删除、默认组合的错误码", () => {
  assert.deepEqual(hideEngine({}, "google").error, { code: "pair_uses_hide", args: [] });
  assert.deepEqual(hideEngine({ customEngines: [baidu] }, "baidu").error, { code: "only_preset_hide", args: [] });
  assert.deepEqual(deleteEngine({}, "bing").error, { code: "only_custom_delete", args: [] });
  assert.deepEqual(setDefaultPair({}, "google", "nope").error, { code: "pair_missing", args: [] });
  const wiki = { id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" };
  assert.deepEqual(setDefaultPair({ customEngines: [wiki] }, "wiki", "kagi").error, { code: "not_left", args: ["Wiki"] });
});
test("describeTemplate 返回 level 和消息 key", () => {
  assert.deepEqual(describeTemplate("https://x.com/s/%s"), { level: "warn", msg: ["engine_tpl_right_only"] });
  assert.deepEqual(describeTemplate(" https://x.com/?q=%s "), { level: "ok", msg: ["engine_tpl_ok"] });
  assert.deepEqual(describeTemplate("https://*.x.com/?q=%s"), { level: "error", msg: ["err_tpl_wildcard_host"] });
});

test("setNarrowFallback：补丁只含 narrowFallback", () => {
  assert.deepEqual(setNarrowFallback({}, false), { ok: true, patch: { narrowFallback: false } });
  assert.deepEqual(setNarrowFallback({ narrowFallback: false }, true).patch, { narrowFallback: true });
});

const yt = CATALOG.find(e => e.id === "youtube");

test("addFromCatalog：追加自定义引擎并带上 leftDiscouraged", () => {
  const r = addFromCatalog({}, yt, "en");
  assert.equal(r.ok, true);
  assert.deepEqual(r.engine, { id: "youtube", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s", leftDiscouraged: true });
  assert.deepEqual(r.patch.customEngines, [r.engine]);
  assert.equal("cycleExclude" in r.patch, false);
});

test("addFromCatalog：重复添加报 catalog_already_added", () => {
  const first = addFromCatalog({}, yt, "en");
  const again = addFromCatalog({ customEngines: first.patch.customEngines }, yt, "en");
  assert.equal(again.ok, false);
  assert.deepEqual(again.error, { code: "catalog_already_added", args: ["YouTube"] });
});

test("addFromCatalog：id 被占用时加后缀；不带 leftDiscouraged 的条目不写该字段", () => {
  const gh = CATALOG.find(e => e.id === "github");
  const raw = { customEngines: [{ id: "github", name: "mine", url: "https://x.example/?q=%s" }] };
  const r = addFromCatalog(raw, gh, "en");
  assert.equal(r.engine.id, "github-2");
  assert.equal("leftDiscouraged" in r.engine, false);
  assert.equal(r.patch.customEngines.length, 2);
});

test("addFromCatalog：id 加编号后全被占用 → 返回 id_exhausted 错误，不写入", () => {
  const gh = CATALOG.find(e => e.id === "github");
  const customEngines = ["github", ...Array.from({ length: 98 }, (_, k) => `github-${k + 2}`)]
    .map(id => ({ id, name: id, url: `https://x${id}.example/?q=%s` }));
  const r = addFromCatalog({ customEngines }, gh, "en");
  assert.deepEqual(r, { ok: false, error: { code: "id_exhausted", args: ["github"] } });
});

test("addFromCatalog：ai 条目写进 cycleExclude（合成条目）", () => {
  const ai = { id: "fakeai", name: "FakeAI", url: "https://ai.example/?q=%s", category: "ai", ai: true };
  const r = addFromCatalog({ cycleExclude: ["x"] }, ai, "en");
  assert.deepEqual(r.patch.cycleExclude, ["x", "fakeai"]);
  assert.deepEqual(addFromCatalog({}, ai, "en").patch.cycleExclude, ["fakeai"]);
});

test("editEngine：模板 origin 变了就去掉 leftDiscouraged，没变则保留", () => {
  const raw = addFromCatalog({}, yt, "en").patch;
  const moved = editEngine(raw, "youtube", { name: "YouTube", url: "https://example.org/?q=%s" });
  assert.equal(moved.ok, true);
  assert.equal("leftDiscouraged" in moved.patch.customEngines[0], false);
  const same = editEngine(raw, "youtube", { name: "YT", url: "https://www.youtube.com/results?q=%s" });
  assert.equal(same.patch.customEngines[0].leftDiscouraged, true);
  assert.equal(mergeConfig({ ...raw, ...moved.patch }).engines.find(e => e.id === "youtube").leftDiscouraged, undefined);
});

test("needsGrantWarning：只有能作左侧且未授权才提示", async () => {
  const { needsGrantWarning } = await import("../src/options/edits.js");
  assert.equal(needsGrantWarning({ url: "https://www.google.com/maps/search/%s" }, false), false);
  assert.equal(needsGrantWarning({ url: "https://a.com/?q=%s" }, false), true);
  assert.equal(needsGrantWarning({ url: "https://a.com/?q=%s" }, true), false);
});

test("setCycle：排除时加入 cycleExclude（不重复），参与时移除；补丁只含 cycleExclude", () => {
  assert.deepEqual(setCycle({}, "bing", false), { ok: true, patch: { cycleExclude: ["bing"] } });
  assert.deepEqual(setCycle({ cycleExclude: ["kagi"] }, "bing", false).patch, { cycleExclude: ["kagi", "bing"] });
  assert.deepEqual(setCycle({ cycleExclude: ["bing"] }, "bing", false).patch, { cycleExclude: ["bing"] });
  assert.deepEqual(setCycle({ cycleExclude: ["bing", "kagi", "bing"] }, "bing", true).patch, { cycleExclude: ["kagi"] });
  assert.deepEqual(setCycle({}, "bing", true).patch, { cycleExclude: [] });
});
test("setCycle：存储里的 cycleExclude 形状不对时当作空，顺手丢掉非字符串", () => {
  assert.deepEqual(setCycle({ cycleExclude: "bing" }, "kagi", false).patch, { cycleExclude: ["kagi"] });
  assert.deepEqual(setCycle({ cycleExclude: [1, "ddg", null] }, "kagi", false).patch, { cycleExclude: ["ddg", "kagi"] });
});
test("deleteEngine：从 cycleExclude 一并去掉该 id；原来不含它就不写这个键", () => {
  const raw = { customEngines: [baidu], cycleExclude: ["kagi", "baidu"] };
  assert.deepEqual(deleteEngine(raw, "baidu").patch, { customEngines: [], cycleExclude: ["kagi"] });
  assert.deepEqual(deleteEngine({ customEngines: [baidu], cycleExclude: ["kagi"] }, "baidu").patch, { customEngines: [] });
  assert.deepEqual(deleteEngine({ customEngines: [baidu] }, "baidu").patch, { customEngines: [] });
  assert.deepEqual(deleteEngine({ customEngines: [baidu], cycleExclude: "baidu" }, "baidu").patch, { customEngines: [] });
});

test("setLookupEngine：写入、跟随、无效", () => {
  assert.deepEqual(setLookupEngine({}, "ddg"), { ok: true, patch: { lookupEngine: "ddg" } });
  assert.deepEqual(setLookupEngine({ lookupEngine: "ddg" }, null), { ok: true, patch: null, remove: ["lookupEngine"] });
  assert.equal(setLookupEngine({ presetOverrides: { ddg: { hidden: true } } }, "ddg").error.code, "engine_gone");
  assert.equal(setLookupEngine({}, "nope").error.code, "engine_gone");
});
test("隐藏或删除查词引擎时一并删掉 lookupEngine", () => {
  assert.deepEqual(hideEngine({ lookupEngine: "ddg" }, "ddg").remove, ["lookupEngine"]);
  assert.equal(hideEngine({ lookupEngine: "kagi" }, "ddg").remove, undefined);
  const raw = { customEngines: [{ id: "my", name: "M", url: "https://m.com/?q=%s" }], lookupEngine: "my" };
  assert.deepEqual(deleteEngine(raw, "my").remove, ["lookupEngine"]);
  assert.equal(deleteEngine({ ...raw, lookupEngine: "bing" }, "my").remove, undefined);
});
test("新增引擎：名称或网址有错时不报 id 错误（空表单只提示名称和网址），只有 id 有错才报 id", () => {
  const empty = addEngine({}, { id: "", name: "", url: "" });
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.name && empty.errors.url, "空表单应报名称和网址");
  assert.equal("id" in empty.errors, false, "空表单不应报 id");
  const badUrl = addEngine({ customEngines: [baidu] }, { id: "baidu", name: "百度", url: "https://*.x.com/?q=%s" });
  assert.deepEqual(Object.keys(badUrl.errors), ["url"]);
  const badName = addEngine({}, { id: "Bad id", name: " ", url: baidu.url });
  assert.deepEqual(Object.keys(badName.errors), ["name"]);
  const onlyId = addEngine({}, { id: "Bad id", name: "百度", url: baidu.url });
  assert.deepEqual(Object.keys(onlyId.errors), ["id"]);
});
