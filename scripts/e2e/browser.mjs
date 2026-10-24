import { spawn } from "node:child_process";
import { readlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { createClient } from "./cdp.mjs";
import { CHROME_BIN, CHROME_ARGS, PROFILE_DIR, EXT_ID } from "./config.mjs";
import { prepareFontconfig } from "./fonts.mjs";

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

// 用完会话必须 detach：否则每次调用都泄漏一个会话，控制台收集器还会对每个会话 Runtime.enable
export async function withSession(client, sessionId, fn) {
  try { return await fn(sessionId); }
  finally { await client.send("Target.detachFromTarget", { sessionId }).catch(() => {}); }
}

export async function launch({ headless = false, restoreSession = false, profileDir = PROFILE_DIR, bin = CHROME_BIN } = {}) {
  const lock = checkProfileLock(profileDir);
  if (lock.locked) throw new Error(`测试配置已被占用（pid ${lock.pid}），请先关闭使用它的 Chrome`);
  // 9P 挂载（WSL 的 /mnt/c）上的字体会让渲染进程卡在同步字体请求上、CDP 无响应，测试浏览器不用它们（fonts.mjs）。
  // 配置写在测试配置旁边（不在配置目录里）
  const fontEnv = prepareFontconfig({ dir: dirname(profileDir) });
  // detached：Chrome 自成进程组，终端 Ctrl+C 只发给运行器，由它先恢复 storage 再关浏览器
  const proc = spawn(bin, CHROME_ARGS(profileDir, { headless, restoreSession }),
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], detached: true, env: { ...process.env, ...fontEnv } });
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
    try {
      await waitFor(() => evaluate(sid, "!!(globalThis.chrome && chrome.runtime && chrome.runtime.id)", { timeoutMs: 3000 }), { timeoutMs: 10000 });
    } catch (e) {
      await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
      throw e;
    }
    return sid;
  };
  const evalExt = async (expr, opts = {}) => {
    const sid = await extPage();
    return withSession(client, sid, () => evaluate(sid, expr, opts));
  };

  const alive = () => proc.exitCode === null && proc.signalCode === null;
  // graceful：先发 Browser.close 让 Chrome 正常退出并写好会话（--restore-last-session 依赖它）和网站搜索等数据库，
  // 10 秒内没退出再走信号。返回 { graceful }：Chrome 是否因 Browser.close 在发信号之前自行退出且退出码为 0
  const close = async ({ graceful = false } = {}) => {
    let clean = false;
    if (graceful && alive()) {
      await client.send("Browser.close", {}, undefined, { timeoutMs: 5000 }).catch(() => {});
      let t;
      clean = await Promise.race([exited.then(() => proc.signalCode === null && proc.exitCode === 0),
        new Promise(r => { t = setTimeout(() => r(false), 10000); })]);
      clearTimeout(t);
    }
    client.close();
    if (alive()) {
      proc.kill("SIGTERM");
      const t = setTimeout(() => proc.kill("SIGKILL"), 8000);
      await exited;
      clearTimeout(t);
    }
    return { graceful: clean };
  };

  try {
    await client.send("Browser.getVersion", {}, undefined, { timeoutMs: 10000 });
  } catch (e) {
    await close();
    throw new Error(`连接 Chrome 失败：${spawnErr ? spawnErr.message : e.message}`);
  }
  return { client, proc, attach, evaluate, targets, waitFor, extPage, evalExt, close };
}
