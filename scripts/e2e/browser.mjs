import { spawn } from "node:child_process";
import { readlinkSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "./cdp.mjs";
import { CHROME_BIN, CHROME_ARGS, PROFILE_DIR, EXT_ID } from "./config.mjs";

// Linux 的 SingletonLock 是符号链接，目标形如 "<hostname>-<pid>"
export function checkProfileLock(profileDir) {
  let target;
  try { target = readlinkSync(join(profileDir, "SingletonLock")); }
  catch { return { locked: false }; }
  const pid = Number(target.slice(target.lastIndexOf("-") + 1));
  if (!Number.isInteger(pid) || pid <= 0) return { locked: false };
  try { process.kill(pid, 0); return { locked: true, pid }; }
  catch (e) { return e.code === "EPERM" ? { locked: true, pid } : { locked: false }; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ headless = false, restoreSession = false, profileDir = PROFILE_DIR, bin = CHROME_BIN } = {}) {
  const lock = checkProfileLock(profileDir);
  if (lock.locked) throw new Error(`测试配置已被占用（pid ${lock.pid}），请先关闭使用它的 Chrome`);
  // detached：Chrome 自成进程组，终端 Ctrl+C 只发给运行器，由它先恢复 storage 再关浏览器
  const proc = spawn(bin, CHROME_ARGS(profileDir, { headless, restoreSession }),
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], detached: true });
  const exited = new Promise(r => proc.once("exit", r));
  let spawnErr = null;
  proc.once("error", e => { spawnErr = e; });
  const client = createClient(proc.stdio[3], proc.stdio[4]);

  const waitFor = async (fn, { timeoutMs = 10000, intervalMs = 250 } = {}) => {
    const end = Date.now() + timeoutMs;
    let last;
    for (;;) {
      try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
      if (Date.now() >= end) throw new Error(`等待条件超时${last ? "：" + last.message : ""}`);
      await sleep(intervalMs);
    }
  };

  const targets = async () => (await client.send("Target.getTargets")).targetInfos;
  const attach = async targetId =>
    (await client.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  const evaluate = async (sessionId, expression, { userGesture = false, timeoutMs } = {}) => {
    const r = await client.send("Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, userGesture }, sessionId, { timeoutMs });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || "页面脚本异常");
    }
    return r.result.value;
  };

  // 扩展 SW 空闲约 30 秒会被回收，扩展 API 一律在扩展页面里调用
  const extPage = async () => {
    const prefix = `chrome-extension://${EXT_ID}/options/`;
    const find = async () => (await targets()).find(t => t.type === "page" && t.url.startsWith(prefix));
    let t = await find();
    if (!t) {
      await client.send("Target.createTarget", { url: prefix + "options.html", background: true });
      t = await waitFor(find, { timeoutMs: 10000 });
    }
    const sid = await attach(t.targetId); // 每次重新 attach，扩展重载后复用旧会话会挂起
    // 新建页面刚创建时尚未进入扩展上下文，等 chrome.runtime 可用
    await waitFor(() => evaluate(sid, "!!(globalThis.chrome && chrome.runtime && chrome.runtime.id)", { timeoutMs: 3000 }), { timeoutMs: 10000 });
    return sid;
  };
  const evalExt = async (expr, opts = {}) => evaluate(await extPage(), expr, opts);

  const close = async () => {
    client.close();
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      const t = setTimeout(() => proc.kill("SIGKILL"), 8000);
      await exited;
      clearTimeout(t);
    }
  };

  try {
    await client.send("Browser.getVersion", {}, undefined, { timeoutMs: 10000 });
  } catch (e) {
    await close();
    throw new Error(`连接 Chrome 失败：${spawnErr ? spawnErr.message : e.message}`);
  }
  return { client, proc, attach, evaluate, targets, waitFor, extPage, evalExt, close };
}
