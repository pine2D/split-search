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
test("cycleCandidates：text、search 取文字引擎和 cycleExclude", () => {
  const cfg = mergeConfig({ cycleExclude: ["ddg"] });
  for (const kind of ["text", "search"]) {
    const { engines, exclude } = cycleCandidates(cfg, kind);
    assert.deepEqual(exclude, ["ddg"]);
    assert.equal(engines, cfg.engines);
  }
});
