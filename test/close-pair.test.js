import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPair, observeClose, closingPeer, cleanupKeys, linkKey } from "../src/lib/close-pair.js";
import { mergeConfig } from "../src/lib/engines.js";
import * as edits from "../src/options/edits.js";

const record = (peer, engine, extra = {}) => ({ peer, engine, query: "test", role: "search", mode: "split", splitViewId: 7, ...extra });
const records = (a = {}, b = {}) => ({ "split:10": record(11, "google", a), "split:11": record(10, "bing", b) });
const pair = { a: 10, b: 11, splitViewId: 7 };
const evidence = { ...pair, closed: 10, peer: 11, seen: [10, 11] };

test("联动默认关闭，只接受布尔 true；写开关不会覆盖其他配置", () => {
  for (const value of [undefined, null, false, 1, "true", {}, []]) {
    assert.equal(mergeConfig({ closePairTogether: value }).closePairTogether, false);
  }
  assert.equal(mergeConfig({ closePairTogether: true }).closePairTogether, true);
  assert.deepEqual(edits.setClosePairTogether({ narrowFallback: false }, true), { ok: true, patch: { closePairTogether: true } });
  assert.deepEqual(edits.setClosePairTogether({}, "true"), { ok: true, patch: { closePairTogether: false } });
});

test("互指的搜索分屏生成同一身份；旧记录缺少 role 仍按搜索对", () => {
  assert.deepEqual(searchPair(10, records()), pair);
  assert.deepEqual(searchPair(11, records()), pair);
  const old = records(); delete old["split:10"].role; delete old["split:11"].role;
  assert.deepEqual(searchPair(10, old), pair);
  assert.equal(linkKey(7), "linked:7");
});

test("相邻、查询、失效、单边、改配及无记录的分屏均不取得关闭资格", () => {
  for (const data of [
    {}, { "split:10": record(11, "google") },
    records({ mode: "adjacent", splitViewId: -1 }, { mode: "adjacent", splitViewId: -1 }),
    records({ role: "page", engine: "", input: "text" }, { role: "lookup", input: "text" }),
    records({ splitViewId: -1 }, { splitViewId: -1 }), records({}, { splitViewId: 8 }),
    records({}, { peer: 12 }), records({ peer: 10 }), records({}, { query: "new search" }),
  ]) assert.equal(searchPair(10, data), null, JSON.stringify(data));
});

test("两侧同实例的单次快照一致确认同一侧不在，才具备证据", () => {
  const first = observeClose(pair, 10, [11, 99], null);
  assert.deepEqual(first, { kind: "pending", evidence: { ...evidence, seen: [10] } });
  assert.equal(closingPeer(first.evidence, records(), [10, 11]), null);
  const second = observeClose(pair, 11, [11, 99], first.evidence);
  assert.deepEqual(second, { kind: "pending", evidence });
  assert.equal(closingPeer(second.evidence, records(), [10, 11]), 11);
  const right = observeClose(pair, 11, [10], observeClose(pair, 10, [10], null).evidence);
  assert.equal(closingPeer(right.evidence, records(), [10, 11]), 10);
});

test("重复的一侧事件不补足证据；未知、两侧仍在、都已关闭均不推断正常单侧关闭", () => {
  const first = observeClose(pair, 10, [11], null).evidence;
  assert.deepEqual(observeClose(pair, 10, [11], first).evidence.seen, [10]);
  assert.deepEqual(observeClose(pair, 11, null, first), { kind: "ignore" });
  assert.deepEqual(observeClose(pair, 11, [10, 11], first), { kind: "end" });
  assert.deepEqual(observeClose(pair, 11, [], first), { kind: "end" });
  assert.deepEqual(observeClose(pair, 99, [11], first), { kind: "ignore" });
});

test("不同配对/不同消失方向的旧证据不拼接；许可或记录变化就不关闭", () => {
  const first = observeClose(pair, 10, [11], null).evidence;
  assert.deepEqual(observeClose({ ...pair, splitViewId: 8 }, 11, [11], first).evidence.seen, [11]);
  assert.deepEqual(observeClose(pair, 11, [10], first).evidence.seen, [11]);
  for (const link of [undefined, null, [10, 12], [11, 10], [10, 11, 12]]) {
    assert.equal(closingPeer(evidence, records(), link), null);
  }
  assert.equal(closingPeer(evidence, records({}, { peer: 12 }), [10, 11]), null);
  assert.equal(closingPeer(evidence, records({}, { role: "lookup", input: "text" }), [10, 11]), null);
});

test("关闭只清理自己的旧记录、仍指回自己的 peer 及相关许可，保留后来建立的对", () => {
  const data = { ...records(), "linked:7": [10, 11], "linked:8": [20, 21], setupTryTabs: [10] };
  assert.deepEqual(cleanupKeys(10, data).sort(), ["linked:7", "split:10", "split:11"]);
  data["split:11"] = record(12, "bing", { mode: "adjacent", splitViewId: -1 });
  data["split:12"] = record(11, "ddg", { mode: "adjacent", splitViewId: -1 });
  assert.deepEqual(cleanupKeys(10, data).sort(), ["linked:7", "split:10"]);
});
