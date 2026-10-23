import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSplit, sideOf } from "../src/lib/split-decision.js";

const base = { windowType: "normal", splitViewId: 7, peer: { id: 2, index: 5, url: "https://www.google.com/search?q=x" }, recordedPeerId: undefined, engineOrigins: ["https://kagi.com", "https://www.google.com"] };
test("sideOf", () => { assert.equal(sideOf(4, 5), "left"); assert.equal(sideOf(6, 5), "right"); });
test("非 normal 窗口", () => assert.equal(decideSplit({ ...base, windowType: "popup" }), "other-window"));
test("不在分屏中", () => assert.equal(decideSplit({ ...base, splitViewId: -1, peer: null }), "new"));
test("会话里有记录：即使已跨 origin 跳转也算本扩展分屏", () =>
  assert.equal(decideSplit({ ...base, recordedPeerId: 2, peer: { id: 2, url: "https://consent.google.com/" } }), "reuse"));
test("无记录但 origin 属于已配置引擎", () => assert.equal(decideSplit(base), "reuse"));
test("url 读不到时宁可当作其他分屏", () => assert.equal(decideSplit({ ...base, peer: { id: 2 } }), "foreign"));
test("origin 不是已配置引擎", () => assert.equal(decideSplit({ ...base, peer: { id: 2, url: "https://docs.foo.com/" } }), "foreign"));
test("在分屏中却找不到另一侧", () => assert.equal(decideSplit({ ...base, peer: null }), "foreign"));
test("记录的 peer 已不是当前的另一侧", () => assert.equal(decideSplit({ ...base, recordedPeerId: 99, peer: { id: 2 } }), "foreign"));
test("url 无法解析时不抛错，当作其他分屏", () => assert.equal(decideSplit({ ...base, peer: { id: 2, url: "not a url" } }), "foreign"));
