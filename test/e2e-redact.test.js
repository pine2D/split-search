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

test("redact: 百分号编码的嵌套网址与 access_token/*_token/session_id/sessionid", () => {
  assert.equal(redact("https://kagi.com/signin?next=%2Fsearch%3Ftoken%3Dabc"), "https://kagi.com/signin?next=%2Fsearch%3Ftoken%3D***");
  assert.equal(redact("https://kagi.com/turnstile?r=/search%3Fq%3Dx%26token%3Dabc%26y%3D1"), "https://kagi.com/turnstile?r=/search%3Fq%3Dx%26token%3D***%26y%3D1");
  assert.equal(redact("?a=1%23Code%3Dzz"), "?a=1%23Code%3D***");
  assert.equal(redact("?access_token=1&x_token=2&Session_ID=3&sessionid=4&q=1"), "?access_token=***&x_token=***&Session_ID=***&sessionid=***&q=1");
  assert.equal(redact("?q=a%3Dtoken%3D1&monkey=2"), "?q=a%3Dtoken%3D1&monkey=2");
});

test("guide.setResult: 向导页上的说明也脱敏", async () => {
  const { startServer } = await import("../scripts/e2e/server.mjs");
  const srv = await startServer({ port: 0 });
  try {
    srv.guide.setResult("T9", "fail", "落在 https://kagi.com/?token=abc");
    assert.equal(srv.guide.state().results.at(-1).detail, "落在 https://kagi.com/?token=***");
  } finally { await srv.close(); }
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


// 首次验收报告里的原样形状（ID、IP、S 换成假的）：Google 验证通过后网址带 google_abuse，含用户 IP
const ABUSE_RAW = "https://www.google.com/search?q=t5&google_abuse=GOOGLE_ABUSE_EXEMPTION%3DID%3Dd7f00fake:TM%3D1792753264:C%3DR:IP%3D2602:fea7:dead:beef::1-:S%3DDbxSfake%3B+path%3D/%3B+domain%3Dgoogle.com%3B+expires%3DFri,+23-Oct-2026+18:01:04+GMT&sei=x";
test("redact: google_abuse 与 *_abuse、含 exemption 的参数，原样与百分号嵌套（一次、两次）都换掉", () => {
  const r = redact(ABUSE_RAW);
  assert.ok(!r.includes("2602:fea7") && !r.includes("d7f00fake") && !r.includes("DbxSfake"), r);
  assert.match(r, /google_abuse=\*\*\*/);
  assert.match(r, /&sei=x$/, "后面的参数不动");
  const nested = "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dt5%26google_abuse%3DGOOGLE_ABUSE_EXEMPTION%253DID%253Dfake:IP%253D10.1.2.3%26sei%3Dk&q=Eg";
  assert.equal(redact(nested), "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dt5%26google_abuse%3D***%26sei%3Dk&q=Eg");
  assert.equal(redact("?Google_Abuse=x&q=1"), "?Google_Abuse=***&q=1");
  assert.equal(redact("?yt_abuse=1.2.3.4&abuse_exemption_token=z&q=1"), "?yt_abuse=***&abuse_exemption_token=***&q=1");
  assert.equal(redact("x?a=1%2526token%253Dsecret%2526b%253D2"), "x?a=1%2526token%253D***%2526b%253D2");
  assert.equal(redact("cookie GOOGLE_ABUSE_EXEMPTION=ID=a:TM=1:IP=203.0.113.9-:S=zz; path=/"), "cookie GOOGLE_ABUSE_EXEMPTION=***; path=/");
  assert.equal(redact("?abuse=1&monkey=2&q=token=4"), "?abuse=1&monkey=2&q=token=4", "不是 *_abuse 的参数不动");
});
