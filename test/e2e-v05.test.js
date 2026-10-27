import { test } from "node:test";
import assert from "node:assert/strict";
import { mockEngineD, ruleTrigger, expectRight, RECORD_KEYS, privacyProblems } from "../scripts/e2e/steps/v05-lib.mjs";
import { collectConsole } from "../scripts/e2e/console.mjs";
import { expandTemplate } from "../src/lib/trigger.js";
import { mockEngines } from "../scripts/e2e/config.mjs";

test("mockEngineD：与 ec 同 host，按 /search 区分", () => {
  assert.deepEqual(mockEngineD(8765), { id: "ed", name: "模拟引擎 D", url: "http://engine-c.localhost:8765/search?q=%s" });
});

test("ruleTrigger：raw 先 encodeURIComponent，默认 _ss=ea,eb", () => {
  assert.equal(ruleTrigger(8765, "wiki 百科 x"), "http://engine-a.localhost:8765/search?q=wiki%20%E7%99%BE%E7%A7%91%20x&_ss=ea,eb");
  assert.equal(ruleTrigger(8765, "a", "ea,ed"), "http://engine-a.localhost:8765/search?q=a&_ss=ea,ed");
});

test("expectRight：ec 路径型、eb 与 ed 查询型，编码同 encodeURIComponent", () => {
  assert.equal(expectRight(8765, "ec", "a b/c"), "http://engine-c.localhost:8765/wiki/a%20b%2Fc");
  assert.equal(expectRight(8765, "ed", "a b/c"), "http://engine-c.localhost:8765/search?q=a%20b%2Fc");
  assert.equal(expectRight(8765, "eb", "苹果"), "http://engine-b.localhost:8765/search?q=%E8%8B%B9%E6%9E%9C");
  assert.throws(() => expectRight(8765, "zz", "a"));
});

test("expectRight 与扩展的 expandTemplate 逐字相同", () => {
  const all = [...mockEngines(8765), mockEngineD(8765)];
  for (const id of ["eb", "ec", "ed"]) {
    const e = all.find(x => x.id === id);
    for (const q of ["wiki 百科", "a&b #c+d", "苹果 x/y"]) assert.equal(expectRight(8765, id, q), expandTemplate(e.url, q));
  }
});

test("RECORD_KEYS：记录白名单", () => {
  assert.deepEqual(RECORD_KEYS, ["peer", "splitViewId", "mode", "role", "input", "engine", "query", "rule", "base"]);
});

test("privacyProblems：存储与日志不含查询 token，local 只有 setupDone，记录键在白名单内", () => {
  const ok = { sync: { rightRules: [{ id: "r1", when: "words", words: ["wiki"], engine: "ec" }] }, local: { setupDone: true },
    session: { "split:1": { peer: 2, splitViewId: 3, mode: "split", role: "search", engine: "ec", query: "wiki tok1", rule: "r1", base: "eb" } }, logs: [] };
  assert.deepEqual(privacyProblems(ok, ["tok1"]), []);
  assert.ok(privacyProblems({ ...ok, sync: { x: "tok1" } }, ["tok1"]).length > 0);
  assert.ok(privacyProblems({ ...ok, local: { setupDone: true, q: 1 } }, ["tok1"]).length > 0);
  assert.ok(privacyProblems({ ...ok, session: { "split:1": { ...ok.session["split:1"], hit: "wiki" } } }, ["tok1"]).length > 0);
  assert.ok(privacyProblems({ ...ok, logs: [{ text: "[split-search] tok1" }] }, ["tok1"]).length > 0);
});

test("privacyProblems：local 里藏着 token 也报；非记录的 session 键（setupTryTabs）不按记录白名单查", () => {
  const base = { sync: {}, local: {}, session: { setupTryTabs: [1, 2] }, logs: [] };
  assert.deepEqual(privacyProblems(base, ["tok1"]), []);
  assert.ok(privacyProblems({ ...base, local: { setupDone: "tok1" } }, ["tok1"]).length > 0);
});

function fakeBrowser() {
  const handlers = new Map();
  const client = {
    on: (m, fn) => handlers.set(m, fn), off: m => handlers.delete(m), send: async () => ({}),
    emit: (m, p, sid) => handlers.get(m)?.(p, sid),
  };
  return { client };
}

test("collectConsole：infos 只收带 [split-search] 的 info，errors 不受影响；carry 沿用 infos", async () => {
  const b1 = fakeBrowser();
  const c1 = await collectConsole(b1);
  b1.client.emit("Target.attachedToTarget", { sessionId: "s1", targetInfo: { type: "page", url: "chrome-extension://x/go.html" } });
  b1.client.emit("Runtime.consoleAPICalled", { type: "info", args: [{ type: "string", value: "[split-search] ignored" }], timestamp: 1 }, "s1");
  b1.client.emit("Runtime.consoleAPICalled", { type: "info", args: [{ type: "string", value: "unrelated" }], timestamp: 2 }, "s1");
  b1.client.emit("Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "[split-search] log" }], timestamp: 3 }, "s1");
  assert.deepEqual(c1.infos.map(e => e.text), ["[split-search] ignored"]);
  assert.deepEqual(c1.errors, []);
  await c1.stop();
  const c2 = await collectConsole(fakeBrowser(), { carry: c1 });
  assert.equal(c2.infos, c1.infos);
});

test("ruleRecordProblems：右侧带 rule/base、左侧不带；多了或少了键都报", async () => {
  const { ruleRecordProblems } = await import("../scripts/e2e/steps/v05-lib.mjs");
  const L = { id: 1, splitViewId: 9 }, R = { id: 2, splitViewId: 9 };
  const rec = (peer, engine, extra = {}) => ({ peer, splitViewId: 9, mode: "split", role: "search", engine, query: "wiki t", ...extra });
  const good = { 1: rec(2, "ea"), 2: rec(1, "ec", { rule: "r2", base: "eb" }) };
  assert.deepEqual(ruleRecordProblems(good, L, R, { left: "ea", right: "ec", query: "wiki t", rule: "r2", base: "eb" }), []);
  assert.ok(ruleRecordProblems(good, L, R, { left: "ea", right: "ec", query: "wiki t" }).length > 0, "期望无 rule 时带了 rule 要报");
  const leftMarked = { ...good, 1: rec(2, "ea", { rule: "r2", base: "eb" }) };
  assert.ok(ruleRecordProblems(leftMarked, L, R, { left: "ea", right: "ec", query: "wiki t", rule: "r2", base: "eb" }).length > 0, "左侧带标记要报");
  const plain = { 1: rec(2, "ea"), 2: rec(1, "eb") };
  assert.deepEqual(ruleRecordProblems(plain, L, R, { left: "ea", right: "eb", query: "wiki t" }), []);
  assert.ok(ruleRecordProblems({ 1: rec(2, "ea") }, L, R, { left: "ea", right: "eb", query: "wiki t" }).length > 0, "缺记录要报");
});
