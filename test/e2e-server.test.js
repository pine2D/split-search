import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { startServer } from "../scripts/e2e/server.mjs";
import { HOSTS } from "../scripts/e2e/config.mjs";

async function withServer(fn) {
  // 临时端口：先让系统分配再释放
  const port = await new Promise(res => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
  });
  const srv = await startServer({ port });
  // fetch 不允许覆盖 Host，改用 http.request
  const get = (path, host = "127.0.0.1") => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers: { Host: `${host}:${port}` } }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, text: async () => buf.toString("utf8"), json: async () => JSON.parse(buf.toString("utf8")) });
      });
    }).on("error", reject);
  });
  try { return await fn({ srv, port, get }); } finally { await srv.close(); }
}
const title = async r => (await r.text()).match(/<title>(.*?)<\/title>/s)[1];
// 向导页同源 fetch 会带 Origin；这里显式带上（Node 的 fetch 默认不带）
const post = (port, body, headers = { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" }) =>
  fetch(`http://127.0.0.1:${port}/api/answer`, { method: "POST", headers, body: JSON.stringify(body) });

test("引擎 A: /search?q=a+b%26c -> 'A · a b&amp;c'", () => withServer(async ({ get }) => {
  assert.equal(await title(await get("/search?q=a+b%26c", HOSTS.a)), "A · a b&amp;c");
}));
test("引擎 C: /wiki/中文", () => withServer(async ({ get }) => {
  assert.equal(await title(await get("/wiki/%E4%B8%AD%E6%96%87", HOSTS.c)), "C · 中文");
}));
test("反射文本被转义", () => withServer(async ({ get }) => {
  const html = await (await get("/search?q=%3Cscript%3E", HOSTS.b)).text();
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
}));
test("site-x title", () => withServer(async ({ get }) => {
  assert.equal(await title(await get("/foo/bar", HOSTS.site)), "site-x /foo/bar");
}));
test("/guide 仅在 127.0.0.1 上", () => withServer(async ({ get }) => {
  assert.equal((await get("/guide", HOSTS.site)).status, 404);
  assert.equal((await get("/guide")).status, 200);
  assert.equal((await get("/guide/guide.js")).status, 200);
}));
test("setStep -> /api/state 返回 step 且 seq 自增", () => withServer(async ({ srv, get }) => {
  const s0 = (await (await get("/api/state")).json()).seq;
  srv.guide.setStep({ id: "s1", title: "T", kind: "manual", instruction: "I", buttons: ["pass"] });
  const st = await (await get("/api/state")).json();
  assert.equal(st.step.id, "s1");
  assert.equal(st.seq, s0 + 1);
  srv.guide.setProgress(1, 5);
  srv.guide.setResult("s0", "pass", "ok");
  const st2 = await (await get("/api/state")).json();
  assert.deepEqual(st2.progress, { done: 1, total: 5 });
  assert.equal(st2.results[0].id, "s0");
}));
test("answer: 正确 seq resolve，旧 seq 409，只接受一次", () => withServer(async ({ srv, port, get }) => {
  srv.guide.setStep({ id: "a", title: "", kind: "", instruction: "", buttons: ["pass", "fail"] });
  const old = (await (await get("/api/state")).json()).seq;
  srv.guide.setStep({ id: "b", title: "", kind: "", instruction: "", buttons: ["pass", "fail"] });
  const seq = (await (await get("/api/state")).json()).seq;
  const w = srv.guide.waitAnswer({ timeoutMs: 5000 });
  assert.equal((await post(port, { seq: old, answer: "pass" })).status, 409);
  assert.equal((await post(port, { seq, answer: "fail" })).status, 200);
  assert.equal(await w, "fail");
  assert.equal((await post(port, { seq, answer: "pass" })).status, 409);
}));
test("waitAnswer 超时 / cancel / 新 setStep 取消", () => withServer(async ({ srv }) => {
  srv.guide.setStep({ id: "a", title: "", kind: "", instruction: "", buttons: [] });
  assert.equal(await srv.guide.waitAnswer({ timeoutMs: 30 }), "timeout");
  const w = srv.guide.waitAnswer({ timeoutMs: 5000 });
  srv.guide.cancel();
  assert.equal(await w, "timeout");
  const w2 = srv.guide.waitAnswer({ timeoutMs: 5000 });
  srv.guide.setStep({ id: "b", title: "", kind: "", instruction: "", buttons: [] });
  assert.equal(await w2, "timeout");
}));
test("端口被占用 -> 中文错误", async () => {
  const blocker = net.createServer();
  await new Promise(r => blocker.listen(0, "127.0.0.1", r));
  const port = blocker.address().port;
  try {
    await assert.rejects(startServer({ port }), { message: `端口 ${port} 已被占用；可用 --port 换端口，但需要重新授权` });
  } finally { blocker.close(); }
});

test("answer: Origin 不是向导页本身或不是 JSON → 403，答案不被接受", () => withServer(async ({ srv, port, get }) => {
  srv.guide.setStep({ id: "a", title: "", kind: "", instruction: "", buttons: ["pass"] });
  const seq = (await (await get("/api/state")).json()).seq;
  const w = srv.guide.waitAnswer({ timeoutMs: 300 });
  assert.equal((await post(port, { seq, answer: "pass" }, { "content-type": "application/json" })).status, 403, "没有 Origin");
  assert.equal((await post(port, { seq, answer: "pass" }, { origin: "http://evil.example", "content-type": "application/json" })).status, 403);
  assert.equal((await post(port, { seq, answer: "pass" }, { origin: `http://localhost:${port}`, "content-type": "application/json" })).status, 403);
  assert.equal((await post(port, { seq, answer: "pass" }, { origin: `http://127.0.0.1:${port}`, "content-type": "text/plain" })).status, 403);
  assert.equal(await w, "timeout");
  const w2 = srv.guide.waitAnswer({ timeoutMs: 2000 });
  assert.equal((await post(port, { seq, answer: "pass" })).status, 200);
  assert.equal(await w2, "pass");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/answer`, { method: "POST", headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" }, body: "null" })).status, 409, "null 不再是 500");
}));
