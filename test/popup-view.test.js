import { test } from "node:test";
import assert from "node:assert/strict";
import { popupView, targetTabId } from "../src/lib/popup-view.js";
import { mergeConfig } from "../src/lib/engines.js";

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
