import { test } from "node:test";
import assert from "node:assert/strict";
import { popupView, targetTabId, popupMode, completeView } from "../src/lib/popup-view.js";
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

test("popupView：关键词原样、左右引擎按 id 查名字，按钮是显示顺序里除当前右侧外的全部引擎", () => {
  const cfg = mergeConfig({});
  const v = popupView(pair("google", "bing"), cfg);
  assert.equal(v.query, QUERY);
  assert.equal(v.left.name, "Google");
  assert.equal(v.right.name, "Bing");
  assert.deepEqual(v.choices.map(e => e.id), ["google", "ddg", "perplexity", "kagi"]);
});

test("popupView：按钮不看 cycleExclude（每次都是用户亲手点选），可以与左侧相同", () => {
  const cfg = mergeConfig({ cycleExclude: ["ddg", "perplexity", "kagi"], order: ["kagi", "bing", "google"] });
  const v = popupView(pair("google", "bing"), cfg);
  assert.deepEqual(v.choices.map(e => e.id), ["kagi", "google", "ddg", "perplexity"]);
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
  assert.deepEqual(v.choices.map(e => e.id), ["google", "perplexity", "kagi"]);
});

test("popupView：空关键词原样给出（页面显示“空关键词”文案）；只有一个引擎且它就在右侧时没有按钮", () => {
  const cfg = { engines: [{ id: "solo", name: "Solo", url: "https://s.example/?q=%s" }], hidden: [] };
  const v = popupView(pair("solo", "solo", ""), cfg);
  assert.equal(v.query, "");
  assert.deepEqual(v.choices, []);
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
test("popupMode：在别的分屏里 → not-ours", () => {
  assert.equal(popupMode({ pair: null, tab: { splitViewId: 3 }, windowType: "normal", match: {} }), "not-ours");
});
test("popupMode：窗口不是 normal、识别不出 → not-ours", () => {
  assert.equal(popupMode({ pair: null, tab: { splitViewId: -1 }, windowType: "pip", match: {} }), "not-ours");
  assert.equal(popupMode({ pair: null, tab: {}, windowType: "normal", match: null }), "not-ours");
  assert.equal(popupMode({ pair: null, tab: {}, windowType: "normal", match: undefined }), "not-ours");
});
test("popupMode：不在分屏、normal 窗口、识别出结果页 → complete（没有 splitViewId 字段按 -1）", () => {
  assert.equal(popupMode({ pair: null, tab: {}, windowType: "normal", match: {} }), "complete");
  assert.equal(popupMode({ pair: null, tab: { splitViewId: -1 }, windowType: "normal", match: {} }), "complete");
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
