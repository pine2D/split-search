import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, ID_PATTERN, isIdTaken, mergeConfig } from "../src/lib/engines.js";
import { CATALOG } from "../src/lib/engine-catalog.js";
import {
  addEngine, editEngine, hideEngine, deleteEngine, restoreEngine, setDefaultPair, setNarrowFallback, describeTemplate, addFromCatalog,
  setCycle, setLookupEngine, generatorPick, moveId, reconcileOrder, movePosition, siblingMoveId,
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

// ---- 其他组合生成器的初值 ----
const wiki = { id: "wiki", name: "Wiki", url: "https://x.com/wiki/%s" }; // 路径型，只能作右侧

test("生成器初值：左取默认左侧，右取第一个既不是默认右侧也不是左侧的引擎", () => {
  assert.deepEqual(generatorPick(PRESETS, ["google", "bing"]), ["google", "ddg"]);
  assert.deepEqual(generatorPick(PRESETS, ["bing", "google"]), ["bing", "ddg"]);
  assert.deepEqual(generatorPick(PRESETS, ["ddg", "google"]), ["ddg", "bing"]);
  // 右侧专用引擎也可以作右侧初值
  assert.deepEqual(generatorPick([wiki, ...PRESETS], ["google", "bing"]), ["google", "wiki"]);
});
test("生成器初值：默认左侧不能作左侧或不在列表里时退回第一个可作左侧的", () => {
  assert.deepEqual(generatorPick([wiki, preset("bing"), preset("ddg")], ["google", "bing"]), ["bing", "wiki"]);
  assert.deepEqual(generatorPick([wiki, preset("bing"), preset("kagi")], ["wiki", "kagi"]), ["bing", "wiki"]);
});
test("生成器初值：没有别的引擎时右侧退回默认右侧", () => {
  const two = [preset("google"), preset("bing")];
  assert.deepEqual(generatorPick(two, ["google", "bing"]), ["google", "bing"]);
  // 默认右侧也不在列表里：退回第一个引擎
  assert.deepEqual(generatorPick([preset("google")], ["google", "bing"]), ["google", "google"]);
});
test("生成器初值：没有可作左侧的引擎时左侧为空", () => {
  assert.deepEqual(generatorPick([wiki], ["google", "wiki"]), [undefined, "wiki"]);
  assert.deepEqual(generatorPick([], ["google", "bing"]), [undefined, undefined]);
});
test("生成器：用户改过的选择仍然有效就保留，失效才重新取初值", () => {
  assert.deepEqual(generatorPick(PRESETS, ["google", "bing"], ["kagi", "bing"]), ["kagi", "bing"]);
  assert.deepEqual(generatorPick(PRESETS, ["google", "bing"], ["google", "google"]), ["google", "google"]);
  // 左侧引擎被隐藏或改成右侧专用
  assert.deepEqual(generatorPick(PRESETS.filter(e => e.id !== "kagi"), ["google", "bing"], ["kagi", "bing"]), ["google", "ddg"]);
  assert.deepEqual(generatorPick([wiki, ...PRESETS], ["google", "bing"], ["wiki", "bing"]), ["google", "wiki"]);
  // 右侧引擎不在列表里
  assert.deepEqual(generatorPick(PRESETS, ["google", "bing"], ["kagi", "gone"]), ["google", "ddg"]);
});
test("生成器：没改过的初值跟着默认组合变，不会停在新的默认组合上", () => {
  // 设置页只把用户在下拉框里改过的选择作 prev 传入；初值不传，重渲染时按新的默认组合重新算
  const first = generatorPick(PRESETS, ["google", "bing"]);
  assert.deepEqual(first, ["google", "ddg"]);
  const next = generatorPick(PRESETS, ["google", "ddg"]);
  assert.deepEqual(next, ["google", "bing"]);
  assert.notDeepEqual(next, ["google", "ddg"]);
});

// ---- 排序（“调整顺序”模式）----

test("moveId：上移、下移交换相邻两项，越界或找不到时返回同一个数组", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveId(ids, "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveId(ids, "b", 1), ["a", "c", "b"]);
  assert.deepEqual(ids, ["a", "b", "c"], "不改原数组");
  assert.equal(moveId(ids, "a", -1), ids);
  assert.equal(moveId(ids, "c", 1), ids);
  assert.equal(moveId(ids, "x", 1), ids);
});

test("reconcileOrder：没有 pending 时就是 ids", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(reconcileOrder(null, ids), ids);
  assert.deepEqual(reconcileOrder(undefined, ids), ids);
});

test("reconcileOrder：按 pending 的先后保留，ids 里缺的（防抖期内刚恢复的引擎）按原顺序补到末尾", () => {
  assert.deepEqual(reconcileOrder(["c", "a"], ["a", "b", "c", "d"]), ["c", "a", "b", "d"]);
});

test("reconcileOrder：pending 里已不可见的 id（另一页隐藏或删除）去掉", () => {
  assert.deepEqual(reconcileOrder(["b", "x", "a"], ["a", "b"]), ["b", "a"]);
});

test("reconcileOrder 的结果能直接交给 moveId：刚恢复的引擎也能移动", () => {
  const base = reconcileOrder(["b", "a"], ["b", "a", "ddg"]);
  assert.deepEqual(moveId(base, "ddg", -1), ["b", "ddg", "a"]);
});

test("movePosition：位置从 1 起、总数，找不到返回 null", () => {
  assert.deepEqual(movePosition(["a", "b", "c"], "a"), { pos: 1, total: 3 });
  assert.deepEqual(movePosition(["a", "b", "c"], "c"), { pos: 3, total: 3 });
  assert.equal(movePosition(["a"], "x"), null);
});

test("siblingMoveId：move-up-x 与 move-down-x 互换，其他 id 返回 null", () => {
  assert.equal(siblingMoveId("move-up-google"), "move-down-google");
  assert.equal(siblingMoveId("move-down-my-engine"), "move-up-my-engine");
  assert.equal(siblingMoveId("edit-google"), null);
  assert.equal(siblingMoveId("move-left-x"), null);
  assert.equal(siblingMoveId(""), null);
  assert.equal(siblingMoveId(undefined), null);
});

// v0.5：删除自定义引擎连带删掉指向它的关键词规则（keep 规则不算），提示里带条数
const ec5 = { id: "ec", name: "Engine C", url: "https://c.example/search?q=%s" };
const ed5 = { id: "ed", name: "Engine D", url: "https://d.example/?q=%s" };
const ruleTo = (id, engine) => ({ id, when: "words", words: [id], engine });
test("deleteEngine：去掉指向它的规则，返回 rulesDropped", () => {
  const raw = { customEngines: [ec5, ed5], rightRules: [ruleTo("r1", "ed"), ruleTo("r2", "ec"), ruleTo("r3", "ed")] };
  const r = deleteEngine(raw, "ed");
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch.rightRules, [ruleTo("r2", "ec")]);
  assert.equal(r.rulesDropped, 2);
  assert.equal(r.remove, undefined);
});
test("deleteEngine：没有规则用到它时不写 rightRules，rulesDropped 为 0", () => {
  const raw = { customEngines: [ec5, ed5], rightRules: [ruleTo("r1", "ec"), { id: "r2", when: "words", words: ["x"], keep: true }] };
  const r = deleteEngine(raw, "ed");
  assert.equal(r.rulesDropped, 0);
  assert.ok(!Object.hasOwn(r.patch, "rightRules"));
  assert.equal(r.remove, undefined);
  assert.equal(deleteEngine({ customEngines: [ec5] }, "ec").rulesDropped, 0);
});
test("deleteEngine：规则删光时 remove 含 rightRules，与 lookupEngine 合并", () => {
  const raw = { customEngines: [ec5, ed5], rightRules: [ruleTo("r1", "ed"), ruleTo("r2", "ed")] };
  const r = deleteEngine(raw, "ed");
  assert.deepEqual(r.remove, ["rightRules"]);
  assert.ok(!Object.hasOwn(r.patch, "rightRules"));
  assert.equal(r.rulesDropped, 2);
  const both = deleteEngine({ ...raw, lookupEngine: "ed" }, "ed");
  assert.deepEqual([...both.remove].sort(), ["lookupEngine", "rightRules"]);
});
test("deleteEngine：默认组合在用时仍先报 pair_uses_delete，不碰规则", () => {
  const raw = { customEngines: [ec5, ed5], defaultPair: ["google", "ed"], rightRules: [ruleTo("r1", "ed")] };
  const r = deleteEngine(raw, "ed");
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "pair_uses_delete");
  assert.equal(r.rulesDropped, undefined);
});
