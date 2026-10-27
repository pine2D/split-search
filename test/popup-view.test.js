import { test } from "node:test";
import assert from "node:assert/strict";
import { popupView, targetTabId, popupMode, completeView, idleView } from "../src/lib/popup-view.js";
import { mergeConfig } from "../src/lib/engines.js";
import { IMAGE_CATALOG } from "../src/lib/image-engines.js";

const QUERY = "a&b #c+d 中文 😀";
const pair = (left, right, query = QUERY) => ({
  left: { tabId: 10, engineId: left }, right: { tabId: 11, engineId: right }, query,
});

test("targetTabId：只认 ?tabId=<非负整数>，其余返回 null（改用活动标签）", () => {
  assert.equal(targetTabId("?tabId=12"), 12);
  assert.equal(targetTabId("?tabId=0"), 0);
  assert.equal(targetTabId("?x=1&tabId=7"), 7);
  for (const s of ["", "?", "?tabId=", "?tabId=abc", "?tabId=1.5", "?tabId=-3", "?tabId=1e3", "?tabId= 4",
    "?tabId=12abc", "?tabid=12", "?tabId=99999999999999999999"]) {
    assert.equal(targetTabId(s), null, s);
  }
});

test("popupView：关键词原样、左右引擎按 id 查名字，按钮是显示顺序里除当前左右两侧外的全部引擎", () => {
  const cfg = mergeConfig({});
  const v = popupView(pair("google", "bing"), cfg);
  assert.equal(v.query, QUERY);
  assert.equal(v.left.name, "Google");
  assert.equal(v.right.name, "Bing");
  assert.deepEqual(v.choices.map(e => e.id), ["ddg", "perplexity", "kagi"]);
});

test("popupView：按钮不看 cycleExclude（每次都是用户亲手点选），搜索对不含当前左侧", () => {
  const cfg = mergeConfig({ cycleExclude: ["ddg", "perplexity", "kagi"], order: ["kagi", "bing", "google"] });
  const v = popupView({ ...pair("google", "bing"), kind: "search" }, cfg);
  assert.deepEqual(v.choices.map(e => e.id), ["kagi", "ddg", "perplexity"]);
});

test("popupView：记录里的引擎已被删除时显示为 null，按钮列出全部引擎，照常可换", () => {
  const cfg = mergeConfig({});
  const v = popupView(pair("gone-left", "gone-right"), cfg);
  assert.equal(v.left, null);
  assert.equal(v.right, null);
  assert.deepEqual(v.choices.map(e => e.id), ["google", "bing", "ddg", "perplexity", "kagi"]);
});

test("popupView：被隐藏的引擎仍显示名字，但不出现在按钮里", () => {
  const cfg = mergeConfig({ presetOverrides: { bing: { hidden: true }, ddg: { hidden: true } } });
  const v = popupView(pair("google", "bing"), cfg);
  assert.equal(v.right.name, "Bing");
  assert.deepEqual(v.choices.map(e => e.id), ["perplexity", "kagi"]);
});

test("popupView：空关键词原样给出（页面显示“空关键词”文案）；只有一个引擎且它就在右侧时没有按钮", () => {
  const cfg = { engines: [{ id: "solo", name: "Solo", url: "https://s.example/?q=%s" }], hidden: [] };
  const v = popupView(pair("solo", "solo", ""), cfg);
  assert.equal(v.query, "");
  assert.deepEqual(v.choices, []);
  // 只有左右两个引擎时也没有按钮
  const two = { engines: [...cfg.engines, { id: "duo", name: "Duo", url: "https://d.example/?q=%s" }], hidden: [] };
  assert.deepEqual(popupView(pair("solo", "duo"), two).choices, []);
  // 没有 hidden 字段也不出错
  assert.equal(popupView(pair("x", "solo"), { engines: cfg.engines }).right.name, "Solo");
});

test("popupView：图片查询对", () => {
  const cfg = mergeConfig({ imageEngines: [IMAGE_CATALOG[0]] });
  const pair = { kind: "image", query: "https://img.example.com/a.png?sig=1",
    left: { engineId: "" }, right: { engineId: "lens" } };
  const v = popupView(pair, cfg);
  assert.equal(v.imageHost, "img.example.com");
  assert.equal(v.leftIsPage, true);
  assert.equal(v.left, null);
  assert.equal(v.right.id, "lens");
  assert.deepEqual(v.choices.map(e => e.id), ["bing-img"]);
});
test("popupView：图片网址解析失败时 imageHost 为空串", () => {
  assert.equal(popupView({ kind: "image", query: "::", left: { engineId: "" }, right: { engineId: "lens" } }, mergeConfig({})).imageHost, "");
});
test("popupView：搜索对 imageHost 为 null、leftIsPage 为 false", () => {
  const v = popupView({ kind: "search", query: "q", left: { engineId: "google" }, right: { engineId: "bing" } }, mergeConfig({}));
  assert.equal(v.imageHost, null); assert.equal(v.leftIsPage, false); assert.equal(v.left.id, "google");
});
test("popupView：文字查询对左侧是网页，候选是文字引擎（不含以图搜图引擎），右侧按文字引擎查", () => {
  const cfg = mergeConfig({ imageEngines: [IMAGE_CATALOG[0]] });
  const v = popupView({ kind: "text", query: QUERY, left: { engineId: "" }, right: { engineId: "bing" } }, cfg);
  assert.equal(v.kind, "text");
  assert.equal(v.leftIsPage, true);
  assert.equal(v.imageHost, null);
  assert.equal(v.left, null);
  assert.equal(v.right.name, "Bing");
  assert.deepEqual(v.choices.map(e => e.id), ["google", "ddg", "perplexity", "kagi"]);
});
test("popupView：没有 kind 的旧调用不算查询对（leftIsPage 为 false）", () => {
  assert.equal(popupView(pair("google", "bing"), mergeConfig({})).leftIsPage, false);
});

test("popupMode：本扩展的一对 → pair（哪怕在分屏里、窗口不是 normal）", () => {
  const pairRec = { kind: "search", left: { engineId: "google" }, right: { engineId: "bing" } };
  assert.equal(popupMode({ pair: pairRec, tab: { splitViewId: 3 }, windowType: "popup", match: null }), "pair");
});
// 识别出的结果页（match）与未隐藏的文字引擎（engines）：至少还有一个别的引擎才有按钮可点
const M = { engine: { id: "google" } };
const E = [{ id: "google" }, { id: "bing" }];
test("popupMode：在别的分屏里 → not-ours", () => {
  assert.equal(popupMode({ pair: null, tab: { splitViewId: 3 }, windowType: "normal", match: M, engines: E }), "not-ours");
});
test("popupMode：窗口不是 normal、识别不出 → not-ours", () => {
  assert.equal(popupMode({ pair: null, tab: { splitViewId: -1 }, windowType: "pip", match: M, engines: E }), "not-ours");
  assert.equal(popupMode({ pair: null, tab: {}, windowType: "normal", match: null, engines: E }), "not-ours");
  assert.equal(popupMode({ pair: null, tab: {}, windowType: "normal", match: undefined, engines: E }), "not-ours");
});
test("popupMode：不在分屏、normal 窗口、识别出结果页 → complete（没有 splitViewId 字段按 -1）", () => {
  assert.equal(popupMode({ pair: null, tab: {}, windowType: "normal", match: M, engines: E }), "complete");
  assert.equal(popupMode({ pair: null, tab: { splitViewId: -1 }, windowType: "normal", match: M, engines: E }), "complete");
});
test("popupMode：除了识别出的引擎再没有别的文字引擎（没有按钮可点）→ not-ours", () => {
  assert.equal(popupMode({ pair: null, tab: {}, windowType: "normal", match: M, engines: [{ id: "google" }] }), "not-ours");
  assert.equal(popupMode({ pair: null, tab: {}, windowType: "normal", match: M, engines: [] }), "not-ours");
  assert.equal(popupMode({ pair: null, tab: {}, windowType: "normal", match: M }), "not-ours");
});
test("completeView：choices 不含识别出的引擎，建议的排第一，其余保持显示顺序", () => {
  const { engines } = mergeConfig({});
  const google = engines.find(e => e.id === "google");
  const v = completeView({ engine: google, query: "x y", suggestedId: "kagi" }, engines);
  assert.equal(v.engine, google);
  assert.equal(v.query, "x y");
  assert.equal(v.suggestedId, "kagi");
  assert.deepEqual(v.choices.map(e => e.id), ["kagi", "bing", "ddg", "perplexity"]);
});
test("completeView：建议的引擎不在列表里时其余照显示顺序", () => {
  const { engines } = mergeConfig({});
  const v = completeView({ engine: engines[1], query: "x", suggestedId: "gone" }, engines);
  assert.deepEqual(v.choices.map(e => e.id), ["google", "ddg", "perplexity", "kagi"]);
});

test("switchTarget：搜索对点了当前左侧引擎（弹窗没显示它，旧页面或连点）返回 null，不把右侧换成和左侧一样", async () => {
  const { switchTarget } = await import("../src/lib/popup-view.js");
  const cfg = mergeConfig({});
  const search = { kind: "search", query: "q", left: { engineId: "google" }, right: { engineId: "bing" } };
  assert.equal(switchTarget(search, cfg, "google"), null);
  assert.equal(switchTarget(search, cfg, "ddg").id, "ddg");
  // 查询对的左侧是网页：哪个文字引擎都能选
  const lookup = { kind: "text", query: "q", left: { engineId: "" }, right: { engineId: "bing" } };
  assert.equal(switchTarget(lookup, cfg, "google").id, "google");
  assert.equal(switchTarget(null, cfg, "ddg"), null);
});

test("idleView：默认组合左侧没授权 → setup（完成设置是主按钮，不显示快捷键和“打开设置”，不列默认组合）", () => {
  for (const setupDone of [false, null]) {
    assert.deepEqual(idleView({ leftGranted: false, setupDone }),
      { tier: "setup", regrant: false, notOurs: false, tryHint: false, setupButton: true, setupLink: false, pair: false, footer: false }, String(setupDone));
  }
});

test("idleView：完成过设置（setupDone 为 true）但左侧授权没了 → 仍是 setup 档，regrant 为 true（弹窗换成“已无权访问”的说法）", () => {
  assert.deepEqual(idleView({ leftGranted: false, setupDone: true }),
    { tier: "setup", regrant: true, notOurs: false, tryHint: false, setupButton: true, setupLink: false, pair: false, footer: false });
});

test("idleView：左侧已授权、setupDone 不是 true → try（试试看 + 去第 2 步的次级入口）", () => {
  assert.deepEqual(idleView({ leftGranted: true, setupDone: false }),
    { tier: "try", regrant: false, notOurs: true, tryHint: true, setupButton: false, setupLink: true, pair: true, footer: true });
});

test("idleView：setupDone 为 true → ready（与 v0.3 相同）", () => {
  assert.deepEqual(idleView({ leftGranted: true, setupDone: true }),
    { tier: "ready", regrant: false, notOurs: true, tryHint: true, setupButton: false, setupLink: false, pair: true, footer: true });
});

test("idleView：读不出授权或 setupDone（null、缺省）按 ready 处理，不吓用户", () => {
  const ready = idleView({ leftGranted: true, setupDone: true });
  assert.deepEqual(idleView({ leftGranted: null, setupDone: false }), ready);
  assert.deepEqual(idleView({ leftGranted: null, setupDone: null }), ready);
  assert.deepEqual(idleView({ leftGranted: true, setupDone: null }), ready);
  assert.deepEqual(idleView({}), ready);
  assert.deepEqual(idleView(), ready);
});

// v0.5 按关键词换右侧：右侧记录带 rule、base 时弹窗说明为什么换、提供“换回”
const RE = (id) => ({ id, name: id.toUpperCase(), url: `https://${id}.test/s?q=%s` });
const ENG = ["ea", "eb", "ec", "ed"];
const RW = (id, words, x) => ({ id, when: "words", words, off: null, ...x });
const ruleCfg = ({ ids = ENG, hidden = [], rules = [RW("r2", ["wiki"], { engine: "ec" })] } = {}) => ({
  engines: ids.filter(id => !hidden.includes(id)).map(RE), hidden: hidden.map(RE),
  defaultPair: ["ea", "eb"], rightRules: rules,
});
const rulePair = (rightRecord = { rule: "r2", base: "eb" }, x = {}) => ({
  kind: "search", query: "wiki x",
  left: { tabId: 10, engineId: "ea", record: { peer: 11, role: "search", engine: "ea", query: "wiki x" } },
  right: { tabId: 11, engineId: "ec", record: { peer: 10, role: "search", engine: "ec", query: "wiki x", ...rightRecord } },
  ...x,
});

test("auto：记录没有 rule → null（没有 record 的旧调用同样是 null）", () => {
  assert.equal(popupView(rulePair({}), ruleCfg()).auto, null);
  assert.equal(popupView(pair("ea", "ec"), ruleCfg()).auto, null);
});
test("auto：可换回 → base 是 eb、hit 是命中的词，choices 里没有 eb", () => {
  const v = popupView(rulePair(), ruleCfg());
  assert.equal(v.auto.base.id, "eb");
  assert.deepEqual(v.auto.hit, { by: "word", word: "wiki" });
  assert.deepEqual(v.choices.map(e => e.id), ["ed"]);
});
test("auto：base 已隐藏 → base 为 null（choices 照常）", () => {
  const v = popupView(rulePair(), ruleCfg({ hidden: ["eb"] }));
  assert.equal(v.auto.base, null);
  assert.deepEqual(v.auto.hit, { by: "word", word: "wiki" });
  assert.deepEqual(v.choices.map(e => e.id), ["ed"]);
});
test("auto：base 等于当前左侧 → base 为 null", () => {
  const v = popupView(rulePair({ rule: "r2", base: "ea" }), ruleCfg());
  assert.equal(v.auto.base, null);
  assert.deepEqual(v.choices.map(e => e.id), ["eb", "ed"]);
});
test("auto：base 已删除 → base 为 null", () => {
  assert.equal(popupView(rulePair({ rule: "r2", base: "gone" }), ruleCfg()).auto.base, null);
});
test("auto：规则已改成 keep → hit 为 null，base 仍是 eb（Review Focus 5）", () => {
  const v = popupView(rulePair(), ruleCfg({ rules: [RW("r2", ["wiki"], { keep: true })] }));
  assert.equal(v.auto.hit, null);
  assert.equal(v.auto.base.id, "eb");
});
test("auto：规则的词改了、规则已删 → hit 为 null，base 不变", () => {
  for (const rules of [[RW("r2", ["mdn"], { engine: "ec" })], []]) {
    const v = popupView(rulePair(), ruleCfg({ rules }));
    assert.equal(v.auto.hit, null);
    assert.equal(v.auto.base.id, "eb");
  }
  // cfg 没有 rightRules 也不抛
  const { rightRules, ...noRules } = ruleCfg();
  assert.equal(popupView(rulePair(), noRules).auto.hit, null);
});
test("auto：查询对（kind \"text\"）记录上即使有 rule 也是 null", () => {
  const v = popupView(rulePair(undefined, { kind: "text", left: { tabId: 10, engineId: "" } }), ruleCfg());
  assert.equal(v.auto, null);
  assert.deepEqual(v.choices.map(e => e.id), ["ea", "eb", "ed"]);
});
test("choices：只有 ea、eb、ec 三个引擎时去掉 base 后为 []", () => {
  const v = popupView(rulePair(), ruleCfg({ ids: ["ea", "eb", "ec"] }));
  assert.equal(v.auto.base.id, "eb");
  assert.deepEqual(v.choices, []);
});
