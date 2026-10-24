// 嵌套 X 显示服务器（Xephyr / Xvfb）的生命周期：挑空闲显示号、启动并等 xdpyinfo 连上、写 pid 文件、停止；
// 下次启动时按 pid 文件清理遗留实例（只清理自己起的：进程在 + comm 是记录的服务器 + 命令行里有记录的显示号）。
// 外部命令一律 spawn/execFile，不经 shell；spawn、exec、/proc 读取都可注入，便于单测。
import fs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn, execFile } from "node:child_process";

export const MODES = ["xephyr", "xvfb", "host"];
export const BIN = { xephyr: "Xephyr", xvfb: "Xvfb" };
// 测试窗口 CSS 1600×1000 × 包装脚本固定的 --force-device-scale-factor=1.5
export const DEFAULT_SIZE = "2400x1500";
const READY_TIMEOUT = 10000;
const DISPLAY_RE = /^:(\d+)$/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const defaultExec = (cmd, args, { timeout = 3000 } = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

// 第一个既没有 /tmp/.X11-unix/X<n> 也没有 /tmp/.X<n>-lock 的号（用户已有的 :0、别的 Xvfb 都会被跳过）
export function pickDisplay({ exists = fs.existsSync, from = 90, to = 119 } = {}) {
  for (let n = from; n <= to; n++) {
    if (!exists(`/tmp/.X11-unix/X${n}`) && !exists(`/tmp/.X${n}-lock`)) return n;
  }
  throw new Error(`没有空闲的显示号（:${from}–:${to} 都已占用）`);
}

// available(mode) -> { ok, reason }。显式 --display 优先；否则 auto-only 无界面用 xvfb，其余用 xephyr；不可用 → host 并带原因
export function chooseMode({ display, autoOnly, headed, available }) {
  const mode = display || (autoOnly && !headed ? "xvfb" : "xephyr");
  if (mode === "host") return { mode };
  const a = available(mode);
  if (a?.ok) return { mode };
  return { mode: "host", reason: `${BIN[mode]} 不可用：${a?.reason ?? "未知原因"}` };
}

const defaultIsExe = p => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };

// 在 PATH 里找服务器可执行文件；Xephyr 是宿主显示上的一个窗口，还需要宿主 DISPLAY
export function serverAvailable(mode, { env = process.env, isExe = defaultIsExe } = {}) {
  const bin = BIN[mode];
  if (!bin) return { ok: false, reason: `不认识的显示模式 ${mode}` };
  const found = String(env.PATH ?? "").split(":").filter(Boolean).some(dir => isExe(path.join(dir, bin)));
  if (!found) return { ok: false, reason: `找不到 ${bin}（PATH 里没有可执行文件）` };
  if (mode === "xephyr" && !env.DISPLAY) return { ok: false, reason: "没有宿主 DISPLAY，Xephyr 无法打开窗口" };
  return { ok: true };
}

export function serverArgs(mode, display, { size = DEFAULT_SIZE, title = `e2e 测试显示 ${display}` } = {}) {
  if (mode === "xephyr") return [display, "-screen", size, "-title", title, "-no-host-grab", "-nolisten", "tcp"];
  if (mode === "xvfb") return [display, "-screen", "0", `${size}x24`, "-nolisten", "tcp"];
  throw new Error(`不认识的嵌套显示模式：${mode}`);
}

// pid 文件只在仍是本次记录的 pid 时才删（防止删掉之后又一次运行写的）
function dropPidFile(pidFile, pid) {
  try {
    if (pid !== undefined && JSON.parse(fs.readFileSync(pidFile, "utf8")).pid !== pid) return;
  } catch (e) { if (e.code === "ENOENT") return; }
  try { fs.unlinkSync(pidFile); } catch {}
}

const running = proc => proc.exitCode === null && proc.signalCode === null;

// 起服务器 → 写 pid 文件 → 轮询 xdpyinfo -display :N（最多 timeoutMs）；超时或服务器提前退出 → 杀掉、删 pid 文件、抛错。
// 返回 { display, mode, pid, size, stop(), stopSync() }；stop/stopSync 幂等
export async function startDisplay(mode, {
  size = DEFAULT_SIZE, title, pidFile, spawn = nodeSpawn, exec = defaultExec, pick = pickDisplay,
  timeoutMs = READY_TIMEOUT, intervalMs = 200, killGraceMs = 3000,
} = {}) {
  if (!BIN[mode]) throw new Error(`不认识的嵌套显示模式：${mode}`);
  const display = `:${pick()}`;
  const args = serverArgs(mode, display, { size, title });
  // detached：自成进程组，终端 Ctrl+C 不会直接打到它，由运行器在关掉浏览器后再停
  const proc = spawn(BIN[mode], args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
  let stderr = "", spawnErr = null;
  proc.stderr?.on("data", b => { stderr = (stderr + String(b)).slice(-2000); });
  proc.once?.("error", e => { spawnErr = e; });
  const exited = new Promise(r => { if (!running(proc)) r(); else proc.once("exit", () => r()); });
  const pid = proc.pid;

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (running(proc)) {
      try { proc.kill("SIGTERM"); } catch {}
      let t;
      const late = await Promise.race([exited.then(() => false), new Promise(r => { t = setTimeout(() => r(true), killGraceMs); })]);
      clearTimeout(t);
      if (late && running(proc)) { try { proc.kill("SIGKILL"); } catch {} await exited; }
    }
    proc.stderr?.destroy?.();
    if (pidFile) dropPidFile(pidFile, pid);
  };
  // 第二次 Ctrl+C：来不及等，同步发信号并删 pid 文件
  const stopSync = () => {
    if (stopped) return false;
    stopped = true;
    try { if (pid) process.kill(pid, "SIGTERM"); } catch {}
    if (pidFile) dropPidFile(pidFile, pid);
    return true;
  };

  if (pidFile && pid) {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, JSON.stringify({ pid, display, mode }));
  }
  const tail = () => (stderr.trim() ? `：${stderr.trim().split("\n").slice(-3).join(" / ")}` : "");
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (spawnErr || !pid) { await stop(); throw new Error(`无法启动 ${BIN[mode]}：${spawnErr?.message ?? "没有 pid"}`); }
    if (!running(proc)) { await stop(); throw new Error(`${BIN[mode]} ${display} 启动后立即退出${tail()}`); }
    try { await exec("xdpyinfo", ["-display", display], { timeout: 3000 }); break; } catch {}
    if (Date.now() >= end) {
      await stop();
      throw new Error(`${BIN[mode]} ${display} 在 ${Math.round(READY_TIMEOUT / 1000)}s 内没能连上（等待超时）${tail()}`);
    }
    await sleep(intervalMs);
  }
  return { display, mode, pid, size, stop, stopSync };
}

// /proc/<pid> → { comm, cmdline: [..] }；进程不在 → null
export function readProcFs(pid) {
  try {
    const comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    return { comm, cmdline };
  } catch { return null; }
}

// 遗留实例：pid 文件里的进程仍在、comm 是记录模式对应的服务器、命令行里有记录的显示号 → 杀掉并返回说明；
// 其余情况（没文件、文件坏、进程不在或已被别的程序复用）只删 pid 文件，返回 null。绝不碰 :0
export async function cleanupStale(pidFile, { readProc = readProcFs, kill = process.kill.bind(process), intervalMs = 100, graceMs = 3000 } = {}) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(pidFile, "utf8")); }
  catch (e) {
    if (e.code === "ENOENT") return null;
    dropPidFile(pidFile);
    return null;
  }
  const m = DISPLAY_RE.exec(rec?.display ?? "");
  const ok = rec && Number.isInteger(rec.pid) && rec.pid > 1 && m && Number(m[1]) !== 0 && BIN[rec.mode];
  const p = ok ? readProc(rec.pid) : null;
  if (!p || p.comm !== BIN[rec.mode] || !p.cmdline.includes(rec.display)) { dropPidFile(pidFile); return null; }
  try { kill(rec.pid, "SIGTERM"); } catch {}
  const end = Date.now() + graceMs;
  while (readProc(rec.pid) && Date.now() < end) await sleep(intervalMs);
  let how = "SIGTERM";
  if (readProc(rec.pid)) { try { kill(rec.pid, "SIGKILL"); how = "SIGKILL"; } catch {} }
  dropPidFile(pidFile);
  return `发现上次遗留的 ${BIN[rec.mode]} ${rec.display}（pid ${rec.pid}），已停止（${how}）`;
}

// 报告头与终端用：xvfb :90（2400x1500）/ host :0（退回 host：原因）
export function describeDisplay(d) {
  if (!d) return "未知";
  const base = d.display ? `${d.mode} ${d.display}` : `${d.mode}（无 DISPLAY）`;
  if (d.mode !== "host") return d.size ? `${base}（${d.size}）` : base;
  return d.reason ? `${base}（退回 host：${d.reason}）` : base;
}

// run.mjs 用：清理遗留 → 选模式 → 起服务器（失败退回 host）。嵌套模式把 env.DISPLAY 指向它（Chrome、xinput、截图都继承）。
// 返回 { mode, display, size, reason, notes, stop(), stopSync() }
export async function prepareDisplay(args, { pidFile, env = process.env, log = () => {}, deps = {} } = {}) {
  const notes = [];
  const stale = await (deps.cleanupStale ?? cleanupStale)(pidFile).catch(e => `清理遗留的嵌套显示服务器出错：${e.message}`);
  if (stale) { log(stale); notes.push(stale); }
  let { mode, reason } = chooseMode({ display: args.display, autoOnly: args.autoOnly, headed: !args.headless,
    available: deps.available ?? (m => serverAvailable(m, { env })) });
  let h = null;
  if (mode !== "host") {
    try { h = await (deps.startDisplay ?? startDisplay)(mode, { pidFile, title: deps.title }); }
    catch (e) { reason = `${BIN[mode]} 启动失败：${e.message}`; mode = "host"; }
  }
  if (h) env.DISPLAY = h.display;
  if (reason) notes.push(`显示：退回 host（${reason}）`);
  return {
    mode, display: h ? h.display : (env.DISPLAY || null), size: h ? h.size : null, ...(reason ? { reason } : {}), notes,
    stop: async () => { await h?.stop(); }, stopSync: () => (h ? h.stopSync() : false),
  };
}
