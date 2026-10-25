import { test } from "node:test";
import assert from "node:assert/strict";
import { RECORD_PREFIX, recordKey, parseRecord, makeRecords, looksLikeSearchPage, judgeOwnership } from "../src/lib/split-owner.js";

test("recordKey", () => {
  assert.equal(RECORD_PREFIX, "split:");
  assert.equal(recordKey(3), "split:3");
});
test("parseRecord 拒绝裸数字和缺字段", () => {
  assert.equal(parseRecord(42), null);
  assert.equal(parseRecord({ peer: 2, splitViewId: 7, mode: "split", engine: "ea" }), null); // 缺 query
  assert.deepEqual(parseRecord({ peer: 2, splitViewId: 7, mode: "split", engine: "ea", query: "" }),
    { peer: 2, splitViewId: 7, mode: "split", engine: "ea", query: "" });
});
test("parseRecord 拒绝类型不对的字段", () => {
  const ok = { peer: 2, splitViewId: 7, mode: "split", engine: "ea", query: "q" };
  assert.equal(parseRecord(null), null);
  assert.equal(parseRecord({ ...ok, peer: "2" }), null);
  assert.equal(parseRecord({ ...ok, mode: "x" }), null);
  assert.equal(parseRecord({ ...ok, splitViewId: undefined }), null);
});
test("makeRecords 写两个方向", () => {
  assert.deepEqual(makeRecords({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "ea", engineB: "eb", query: "q" }), {
    "split:1": { peer: 2, splitViewId: 7, mode: "split", engine: "ea", query: "q" },
    "split:2": { peer: 1, splitViewId: 7, mode: "split", engine: "eb", query: "q" },
  });
});
test("looksLikeSearchPage：query 型比 origin+pathname", () => {
  const yt = "https://www.youtube.com/results?search_query=%s";
  assert.equal(looksLikeSearchPage("https://www.youtube.com/results?search_query=a", yt), true);
  assert.equal(looksLikeSearchPage("https://www.youtube.com/watch?v=x", yt), false);
  assert.equal(looksLikeSearchPage("https://consent.youtube.com/results", yt), false);
});
test("looksLikeSearchPage：path 型比前缀", () => {
  const maps = "https://www.google.com/maps/search/%s";
  assert.equal(looksLikeSearchPage("https://www.google.com/maps/search/tokyo%20tower", maps), true);
  assert.equal(looksLikeSearchPage("https://www.google.com/maps/place/x", maps), false);
});
test("looksLikeSearchPage：坏网址返回 false", () => {
  assert.equal(looksLikeSearchPage("not a url", "https://a.com/?q=%s"), false);
  assert.equal(looksLikeSearchPage("https://a.com/?q=x", "not a template"), false);
});

const tab = { id: 1, index: 4, windowId: 9, splitViewId: 7 };
const peer = { id: 2, index: 5, windowId: 9, splitViewId: 7 };
const rec = (p, over = {}) => ({ peer: p, splitViewId: 7, mode: "split", engine: "e", query: "q", ...over });
const engines = [{ id: "google", url: "https://www.google.com/search?q=%s" }];

test("judgeOwnership：互指且 splitViewId 一致 → own", () =>
  assert.equal(judgeOwnership({ tab, peer, record: rec(2), peerRecord: rec(1), engines }), "own"));
test("judgeOwnership：splitViewId 变了 → stale，即使对侧是 Google 搜索页", () =>
  assert.equal(judgeOwnership({
    tab, peer: { ...peer, url: "https://www.google.com/search?q=x" },
    record: rec(2, { splitViewId: 6 }), peerRecord: rec(1, { splitViewId: 6 }), engines,
  }), "stale"));
test("judgeOwnership：对侧记录缺失或没指回 → stale", () => {
  assert.equal(judgeOwnership({ tab, peer, record: rec(2), peerRecord: null, engines }), "stale");
  assert.equal(judgeOwnership({ tab, peer, record: rec(2), peerRecord: rec(9), engines }), "stale");
});
test("judgeOwnership：记录的 peer 不是当前对侧、或对侧不存在 → stale", () => {
  assert.equal(judgeOwnership({ tab, peer, record: rec(99), peerRecord: rec(1), engines }), "stale");
  assert.equal(judgeOwnership({ tab, peer: null, record: rec(2), peerRecord: null, engines }), "stale");
});
test("judgeOwnership：split 记录 splitViewId 为 -1 → stale", () => {
  const t = { ...tab, splitViewId: -1 }, p = { ...peer, splitViewId: -1 };
  assert.equal(judgeOwnership({ tab: t, peer: p, record: rec(2, { splitViewId: -1 }), peerRecord: rec(1, { splitViewId: -1 }), engines }), "stale");
});
test("judgeOwnership：adjacent", () => {
  const adj = (p, over) => rec(p, { mode: "adjacent", splitViewId: -1, ...over });
  const t = { id: 1, index: 4, windowId: 9, splitViewId: -1 };
  const p = { id: 2, index: 5, windowId: 9, splitViewId: -1 };
  const j = (tt, pp) => judgeOwnership({ tab: tt, peer: pp, record: adj(2), peerRecord: adj(1), engines });
  assert.equal(j(t, p), "own");
  assert.equal(j(t, { ...p, index: 7 }), "stale");
  assert.equal(j(t, { ...p, windowId: 10 }), "stale");
  assert.equal(j({ ...t, index: 5 }, { ...p, index: 4 }), "own");
  assert.equal(j(t, { ...p, splitViewId: 7 }), "stale");
});
test("judgeOwnership：无记录兜底", () => {
  const url = "https://www.google.com/search?q=x";
  assert.equal(judgeOwnership({ tab, peer: { ...peer, url }, record: null, peerRecord: null, engines }), "fallback-own");
  assert.equal(judgeOwnership({ tab, peer: { ...peer, url: "https://other.com/" }, record: null, peerRecord: null, engines }), "none");
  assert.equal(judgeOwnership({ tab, peer, record: null, peerRecord: null, engines }), "none");
  assert.equal(judgeOwnership({ tab, peer: null, record: null, peerRecord: null, engines }), "none");
});
test("judgeOwnership：当前标签无记录但对侧有记录 → stale，不走兜底", () => {
  const url = "https://www.google.com/search?q=x";
  const peerRecord = { peer: tab.id, splitViewId: 3, mode: "split", engine: "bing", query: "x" };
  assert.equal(judgeOwnership({ tab, peer: { ...peer, url }, record: null, peerRecord, engines }), "stale");
  // 对侧记录指向别的标签，同样说明这一对来历不明
  assert.equal(judgeOwnership({ tab, peer: { ...peer, url }, record: null, peerRecord: { ...peerRecord, peer: 999 }, engines }), "stale");
});
test("judgeOwnership：无记录、对侧像 Google 搜索页，但两者不在同一个分屏 → none", () => {
  const url = "https://www.google.com/search?q=x";
  const j = (t, p) => judgeOwnership({ tab: t, peer: { ...p, url }, record: null, peerRecord: null, engines });
  assert.equal(j({ ...tab, splitViewId: -1 }, { ...peer, splitViewId: -1 }), "none");
  assert.equal(j(tab, { ...peer, splitViewId: 8 }), "none");
  assert.equal(j({ ...tab, splitViewId: -1 }, peer), "none");
  assert.equal(j(tab, { ...peer, splitViewId: undefined }), "none");
});
