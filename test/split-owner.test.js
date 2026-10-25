import { test } from "node:test";
import assert from "node:assert/strict";
import { RECORD_PREFIX, recordKey, parseRecord, makeRecords, looksLikeSearchPage, judgeOwnership, staleMarker } from "../src/lib/split-owner.js";
import { PLACEHOLDER } from "../src/lib/engines.js";

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

test("judgeOwnership：两条记录的 mode 或 splitViewId 不一致 → stale", () => {
  assert.equal(judgeOwnership({ tab, peer, record: rec(2), peerRecord: rec(1, { splitViewId: 8 }), engines }), "stale");
  assert.equal(judgeOwnership({ tab, peer, record: rec(2), peerRecord: rec(1, { mode: "adjacent", splitViewId: -1 }), engines }), "stale");
  const t = { ...tab, splitViewId: -1, index: 4 }, p = { ...peer, splitViewId: -1, index: 5 };
  const adj = (x) => rec(x, { mode: "adjacent", splitViewId: -1 });
  assert.equal(judgeOwnership({ tab: t, peer: p, record: adj(2), peerRecord: rec(1, { splitViewId: -1 }), engines }), "stale");
});

test("looksLikeSearchPage：%s 前面只有根路径 / 时不认（否则同 origin 的任何页面都像搜索页）", () => {
  const tpl = "https://x.example/%s";
  assert.equal(looksLikeSearchPage("https://x.example/anything", tpl), false);
  assert.equal(looksLikeSearchPage("https://x.example/", tpl), false);
  assert.equal(looksLikeSearchPage("https://x.example/s/a", "https://x.example/s/%s"), true);
  assert.equal(looksLikeSearchPage("https://x.example/sa", "https://x.example/s%s"), true);
});

test("looksLikeSearchPage：模板里的占位与 engines.js 共用 PLACEHOLDER，网址里恰好含它也不误判", () => {
  assert.equal(typeof PLACEHOLDER, "string");
  const tpl = "https://x.example/find?q=%s";
  assert.equal(looksLikeSearchPage(`https://x.example/${PLACEHOLDER}`, tpl), false);
  assert.equal(looksLikeSearchPage("https://x.example/find?q=a", tpl), true);
});

test("staleMarker：形状合法、引擎与关键词保留，任何位置关系下都判 stale", () => {
  const m = staleMarker(rec(2, { mode: "adjacent", splitViewId: -1, engine: "ea", query: "w" }));
  assert.deepEqual(m, { peer: 2, splitViewId: -1, mode: "split", engine: "ea", query: "w" });
  assert.deepEqual(parseRecord(m), m);
  const back = staleMarker(rec(1, { mode: "adjacent", splitViewId: -1 }));
  const url = "https://www.google.com/search?q=x";
  const t = { id: 1, index: 4, windowId: 9, splitViewId: -1 }, p = { id: 2, index: 5, windowId: 9, splitViewId: -1, url };
  assert.equal(judgeOwnership({ tab: t, peer: p, record: m, peerRecord: back, engines }), "stale"); // 拖回相邻
  assert.equal(judgeOwnership({ tab: { ...t, splitViewId: 8 }, peer: { ...p, splitViewId: 8 }, record: m, peerRecord: back, engines }), "stale"); // 手动拼成分屏
});

test("looksLikeSearchPage：query 型还要求网址带着 %s 所在的参数且值不为空（AI 输入框首页不算搜索页）", () => {
  const gpt = "https://chatgpt.com/?q=%s", claude = "https://claude.ai/new?q=%s";
  assert.equal(looksLikeSearchPage("https://chatgpt.com/", gpt), false);
  assert.equal(looksLikeSearchPage("https://chatgpt.com/?temporary-chat=true", gpt), false);
  assert.equal(looksLikeSearchPage("https://chatgpt.com/?q=", gpt), false);
  assert.equal(looksLikeSearchPage("https://chatgpt.com/?q=x", gpt), true);
  assert.equal(looksLikeSearchPage("https://claude.ai/new", claude), false);
  assert.equal(looksLikeSearchPage("https://claude.ai/new?q=x", claude), true);
  assert.equal(looksLikeSearchPage("https://duckduckgo.com/", "https://duckduckgo.com/?q=%s"), false);
  assert.equal(looksLikeSearchPage("https://www.youtube.com/results", "https://www.youtube.com/results?search_query=%s"), false);
  // 参数值里 %s 前后带固定文字时按参数名认
  assert.equal(looksLikeSearchPage("https://x.example/find?q=site%3Aa+b", "https://x.example/find?q=site:a %s"), true);
  // %s 不在查询参数里（如在 # 后面）时无法核对，一律不认
  assert.equal(looksLikeSearchPage("https://x.example/find", "https://x.example/find#q=%s"), false);
});

test("judgeOwnership：兜底不把用户分屏里的 ChatGPT 首页、Claude 新对话页当成本扩展的", () => {
  const ai = [{ id: "chatgpt", url: "https://chatgpt.com/?q=%s" }, { id: "claude", url: "https://claude.ai/new?q=%s" }];
  const t = { id: 1, index: 4, windowId: 9, splitViewId: 7 };
  for (const url of ["https://chatgpt.com/", "https://claude.ai/new"]) {
    assert.equal(judgeOwnership({ tab: t, peer: { id: 2, index: 5, windowId: 9, splitViewId: 7, url }, record: null, peerRecord: null, engines: ai }), "none");
  }
});
