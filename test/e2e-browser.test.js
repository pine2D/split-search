import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { checkProfileLock } from "../scripts/e2e/browser.mjs";
import { CHROME_ARGS, mockEngines, GRANT_ORIGINS, EXT_ID, CHROME_BIN } from "../scripts/e2e/config.mjs";

function withDir(fn) {
  const d = mkdtempSync(join(tmpdir(), "e2e-lock-"));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
}

test("checkProfileLock: 指向当前进程 -> locked", () => withDir(d => {
  symlinkSync(`${hostname()}-${process.pid}`, join(d, "SingletonLock"));
  assert.deepEqual(checkProfileLock(d), { locked: true, pid: process.pid });
}));
test("checkProfileLock: 指向不存在的进程 -> 未锁", () => withDir(d => {
  symlinkSync(`${hostname()}-999999`, join(d, "SingletonLock"));
  assert.equal(checkProfileLock(d).locked, false);
}));
test("checkProfileLock: 无锁文件 -> 未锁", () => withDir(d => {
  assert.equal(checkProfileLock(d).locked, false);
}));

test("CHROME_ARGS: 必备参数与禁用项", () => {
  const a = CHROME_ARGS("/p", { headless: false });
  for (const f of ["--disable-sync", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check", "--user-data-dir=/p"]) assert.ok(a.includes(f), f);
  assert.ok(!a.includes("--enable-automation"));
  assert.ok(!a.includes("--headless=new"));
  assert.ok(CHROME_ARGS("/p", { headless: true }).includes("--headless=new"));
});
test("config: 引擎与授权 origin", () => {
  const e = mockEngines(8765);
  assert.equal(e[0].url, "http://engine-a.localhost:8765/search?q=%s");
  assert.equal(e[2].url, "http://engine-c.localhost:8765/wiki/%s");
  const g = GRANT_ORIGINS(8765);
  assert.ok(g.includes("http://site-x.localhost:8765/*") && g.includes("https://kagi.com/*"));
  assert.equal(EXT_ID, "alngkkgnobglnfbhcplhpaflcgfiajnj");
  assert.equal(CHROME_BIN, "/opt/google/chrome/google-chrome");
});

test("withSession: 成功与失败都会 detach 会话", async () => {
  const { withSession } = await import("../scripts/e2e/browser.mjs");
  const calls = [];
  const client = { send: async (m, p) => { calls.push([m, p]); if (m === "Target.detachFromTarget") throw new Error("already gone"); } };
  assert.equal(await withSession(client, "S1", async sid => `ok-${sid}`), "ok-S1");
  await assert.rejects(withSession(client, "S2", async () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(calls, [
    ["Target.detachFromTarget", { sessionId: "S1" }],
    ["Target.detachFromTarget", { sessionId: "S2" }],
  ]);
});

// 假 Chrome：在 fd 3 读、fd 4 写 \0 分帧的 CDP；收到 Browser.close 就应答并正常退出
const FAKE_CHROME = `#!/usr/bin/env node
const net = require("node:net");
// 用 net.Socket 读写管道：fs 流在线程池里阻塞读 fd 3，会让 process.exit 卡住
const out = new net.Socket({ fd: 4, readable: false, writable: true });
let buf = "";
new net.Socket({ fd: 3, readable: true, writable: false }).on("data", d => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\0")) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    out.write(JSON.stringify({ id: m.id, result: m.method === "Browser.getVersion" ? { product: "Fake/1" } : {} }) + "\\0");
    if (m.method === "Browser.close") setTimeout(() => process.exit(0), 50);
  }
});
setInterval(() => {}, 1000);
`;
test("close: 返回 { graceful }——Browser.close 后自行退出为 true，直接发信号为 false", async () => {
  const { launch } = await import("../scripts/e2e/browser.mjs");
  const { writeFileSync, chmodSync } = await import("node:fs");
  const d = mkdtempSync(join(tmpdir(), "e2e-fakechrome-"));
  try {
    const bin = join(d, "chrome");
    writeFileSync(bin, FAKE_CHROME);
    chmodSync(bin, 0o755);
    const b1 = await launch({ bin, profileDir: join(d, "p1") });
    assert.deepEqual(await b1.close({ graceful: true }), { graceful: true });
    const b2 = await launch({ bin, profileDir: join(d, "p2") });
    assert.deepEqual(await b2.close(), { graceful: false });
    assert.notEqual(b2.proc.signalCode, null);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
