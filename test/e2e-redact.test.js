import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, redactDeep, renderReport } from "../scripts/e2e/report.mjs";
import { formatDiag, runSteps } from "../scripts/e2e/runner.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 脱敏 ----
test("redact: token/session/sid/auth/key/code 的值换成 ***，大小写不限，别的参数不动", () => {
  assert.equal(redact("https://kagi.com/search?token=abc123&q=x"), "https://kagi.com/search?token=***&q=x");
  assert.equal(redact("https://a.com/?q=1&Session=S1#Code=zz"), "https://a.com/?q=1&Session=***#Code=***");
  assert.equal(redact("x?sid=1&AUTH=2;key=3"), "x?sid=***&AUTH=***;key=***");
  assert.equal(redact("https://a.com/?a=1&amp;token=t9"), "https://a.com/?a=1&amp;token=***");
  assert.equal(redact("当前标签：https://k.com/?token=abc；下一个"), "当前标签：https://k.com/?token=***；下一个");
  assert.equal(redact("https://a.com/?monkey=1&keyword=2&codes=3&q=token=4"), "https://a.com/?monkey=1&keyword=2&codes=3&q=token=4");
  assert.equal(redact(undefined), undefined);
  assert.deepEqual(redactDeep({ a: ["?key=1"], n: 3, d: { u: "&sid=2" } }), { a: ["?key=***"], n: 3, d: { u: "&sid=***" } });
});

test("renderReport: 说明、诊断、控制台错误、备注在 md 与 json 里都已脱敏", () => {
  const secret = "SeCrEt42";
  const { md, json } = renderReport({
    startedAt: new Date(), args: {},
    results: [{ id: "T9", title: "Kagi", kind: "assist", status: "fail", detail: `左侧 https://kagi.com/search?token=${secret}`,
      diag: { tabs: [{ url: `https://kagi.com/?session=${secret}` }] }, durationMs: 1 }],
    consoleErrors: [{ text: `[split-search] x ?auth=${secret}`, url: `https://k.com/?code=${secret}` }],
    notes: [`备注 ?sid=${secret}`],
  });
  assert.ok(!md.includes(secret), md);
  assert.ok(!JSON.stringify(json).includes(secret));
  assert.match(md, /token=\*\*\*/);
});

test("formatDiag 与 runSteps：诊断与说明里的网址已脱敏", async () => {
  const st = { windows: [], tabs: [{ id: 1, url: "https://kagi.com/search?q=a&token=zz9" }], rules: [] };
  assert.match(formatDiag(st), /token=\*\*\*/);
  assert.ok(!formatDiag(st).includes("zz9"));
  const logs = [];
  const ctx = { ext: { state: async () => st }, guide: {}, log: m => logs.push(m), abortSignal: new AbortController().signal };
  const [r] = await runSteps([{ id: "T9", title: "t", kind: "assist", needs: [], run: async () => ({ status: "fail", detail: "落在 ?session=abc" }) }], ctx, { timeoutMs: 1000 });
  for (const s of [r.detail, JSON.stringify(r.diag), ...logs]) { assert.ok(!s.includes("zz9") && !s.includes("abc"), s); }
});

test("runSteps: timeoutFactor 按单步超时的倍数放宽", async () => {
  const ctx = { guide: {}, abortSignal: new AbortController().signal, ext: { state: async () => ({}) } };
  const slow = { id: "T1", title: "t", kind: "assist", needs: [], timeoutFactor: 3, run: async () => { await sleep(120); return { status: "pass", detail: "" }; } };
  const [r] = await runSteps([slow], ctx, { timeoutMs: 60 });
  assert.equal(r.status, "pass");
});

