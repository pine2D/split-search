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
