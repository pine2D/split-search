import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRightEngine, cycleCandidates } from "../src/lib/cycle.js";
import { mergeConfig } from "../src/lib/engines.js";

const E = ["a", "b", "c", "d"].map(id => ({ id, url: `https://${id}.com/?q=%s` }));

test("取当前之后的下一个", () => assert.equal(nextRightEngine(E, "b", []).id, "c"));
test("到末尾回到开头，跳过当前", () => assert.equal(nextRightEngine(E, "d", []).id, "a"));
test("跳过被排除的", () => assert.equal(nextRightEngine(E, "b", ["c"]).id, "d"));
test("被排除的在末尾时绕回开头", () => assert.equal(nextRightEngine(E, "c", ["d"]).id, "a"));
test("当前引擎已删除 → 第一个候选", () => assert.equal(nextRightEngine(E, "gone", ["a"]).id, "b"));
test("全部被排除 → null", () => assert.equal(nextRightEngine(E, "a", ["b", "c", "d"]), null));
test("只有当前一个 → null", () => assert.equal(nextRightEngine([E[0]], "a", []), null));
test("没有引擎 → null", () => assert.equal(nextRightEngine([], "a", []), null));
test("当前引擎自己被排除也照样往后取", () => assert.equal(nextRightEngine(E, "b", ["b"]).id, "c"));
test("cycleExclude 缺省视为空", () => assert.equal(nextRightEngine(E, "a").id, "b"));

test("cycleCandidates：image 取以图搜图引擎（lens 在前），不看 cycleExclude", () => {
  const { engines, exclude } = cycleCandidates(mergeConfig({ cycleExclude: ["ddg"] }), "image");
  assert.deepEqual(exclude, []);
  assert.equal(engines[0].id, "lens");
});
test("cycleCandidates：text 取文字引擎和 cycleExclude，不排除左侧（查询对的左侧是网页）", () => {
  const cfg = mergeConfig({ cycleExclude: ["ddg"] });
  const { engines, exclude } = cycleCandidates(cfg, "text", "google");
  assert.deepEqual(exclude, ["ddg"]);
  assert.equal(engines, cfg.engines);
});
test("cycleCandidates：search 取文字引擎，cycleExclude 之外再排除当前左侧", () => {
  const cfg = mergeConfig({ cycleExclude: ["ddg"] });
  const { engines, exclude } = cycleCandidates(cfg, "search", "google");
  assert.deepEqual(exclude, ["ddg", "google"]);
  assert.equal(engines, cfg.engines);
  // 不改 cfg.cycleExclude 本身
  assert.deepEqual(cfg.cycleExclude, ["ddg"]);
  // 没给左侧 id 时只用 cycleExclude
  assert.deepEqual(cycleCandidates(cfg, "search").exclude, ["ddg"]);
});
test("搜索对轮换跳过左侧：google ｜ bing 按一次到 ddg，ddg 之后绕回时跳过 google", () => {
  const cfg = mergeConfig({ cycleExclude: ["perplexity", "kagi"] });
  const { engines, exclude } = cycleCandidates(cfg, "search", "google");
  assert.equal(nextRightEngine(engines, "bing", exclude).id, "ddg");
  assert.equal(nextRightEngine(engines, "ddg", exclude).id, "bing");
  // 只剩左右两个引擎可轮换：没有候选
  assert.equal(nextRightEngine(engines, "bing", [...exclude, "ddg"]), null);
});
