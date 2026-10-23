import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { encodeFrame, createDecoder, createClient } from "../scripts/e2e/cdp.mjs";

test("encodeFrame: JSON 加 \\0", () => {
  assert.equal(encodeFrame({ a: 1 }), '{"a":1}\0');
});
test("解码器: 一个 chunk 含 2 条消息", () => {
  const got = [];
  const feed = createDecoder(m => got.push(m));
  feed(encodeFrame({ id: 1 }) + encodeFrame({ id: 2 }));
  assert.deepEqual(got, [{ id: 1 }, { id: 2 }]);
});
test("解码器: 1 条消息拆成 3 个 chunk", () => {
  const got = [];
  const feed = createDecoder(m => got.push(m));
  const s = encodeFrame({ id: 7, text: "拆包" });
  feed(s.slice(0, 3)); feed(s.slice(3, 9)); assert.equal(got.length, 0);
  feed(s.slice(9));
  assert.deepEqual(got, [{ id: 7, text: "拆包" }]);
});

function fakeChrome(reply) {
  const toChrome = new PassThrough(), fromChrome = new PassThrough();
  const feed = createDecoder(msg => { const r = reply(msg); if (r) fromChrome.write(encodeFrame({ id: msg.id, ...r })); });
  toChrome.on("data", d => feed(d.toString("utf8")));
  return { toChrome, fromChrome };
}

test("createClient: send 取得 result", async () => {
  const { toChrome, fromChrome } = fakeChrome(m => ({ result: { echo: m.method, sid: m.sessionId } }));
  const c = createClient(toChrome, fromChrome);
  assert.deepEqual(await c.send("Foo.bar", {}, "S1"), { echo: "Foo.bar", sid: "S1" });
  c.close();
});
test("createClient: CDP error 时 reject 且含 method", async () => {
  const { toChrome, fromChrome } = fakeChrome(() => ({ error: { code: -1, message: "坏了" } }));
  const c = createClient(toChrome, fromChrome);
  await assert.rejects(c.send("Foo.bar"), /Foo\.bar: 坏了/);
  c.close();
});
test("createClient: 无回复时超时 reject", async () => {
  const { toChrome, fromChrome } = fakeChrome(() => null);
  const c = createClient(toChrome, fromChrome);
  await assert.rejects(c.send("Foo.hang", {}, undefined, { timeoutMs: 50 }), /Foo\.hang 超时/);
  c.close();
});
test("createClient: 事件分发与 off", async () => {
  const { toChrome, fromChrome } = fakeChrome(() => null);
  const c = createClient(toChrome, fromChrome);
  const got = [];
  const fn = p => got.push(p);
  c.on("A.b", fn);
  fromChrome.write(encodeFrame({ method: "A.b", params: { x: 1 } }));
  await new Promise(r => setTimeout(r, 20));
  c.off("A.b", fn);
  fromChrome.write(encodeFrame({ method: "A.b", params: { x: 2 } }));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(got, [{ x: 1 }]);
  c.close();
});

for (const side of ["readable", "writable"]) {
  test(`createClient: ${side} 流 error 时挂起与后续 send 均 reject,不崩溃`, async () => {
    const { toChrome, fromChrome } = fakeChrome(() => null);
    const c = createClient(toChrome, fromChrome);
    const pend = c.send("Foo.pend", {}, undefined, { timeoutMs: 5000 });
    (side === "readable" ? fromChrome : toChrome).destroy(new Error("x"));
    await assert.rejects(pend, /CDP 连接错误：x/);
    const t0 = Date.now();
    await assert.rejects(c.send("Foo.after"), /CDP 连接已关闭/);
    assert.ok(Date.now() - t0 < 500);
  });
}
test("createClient: close() 后 send 立即 reject", async () => {
  const { toChrome, fromChrome } = fakeChrome(() => null);
  const c = createClient(toChrome, fromChrome);
  c.close();
  const t0 = Date.now();
  await assert.rejects(c.send("Foo.x"), /CDP 连接已关闭/);
  assert.ok(Date.now() - t0 < 500);
});
