import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickDisplay, chooseMode, startDisplay, cleanupStale, serverAvailable, describeDisplay, prepareDisplay } from "../scripts/e2e/display.mjs";

const withDir = fn => {
  const d = mkdtempSync(join(tmpdir(), "e2e-display-"));
  return Promise.resolve(fn(d)).finally(() => rmSync(d, { recursive: true, force: true }));
};

test("pickDisplay: 跳过已有 socket 或 lock 文件的号；都占用时抛错", () => {
  const taken = new Set(["/tmp/.X11-unix/X90", "/tmp/.X91-lock", "/tmp/.X11-unix/X92", "/tmp/.X92-lock"]);
  assert.equal(pickDisplay({ exists: p => taken.has(p) }), 93);
  assert.equal(pickDisplay({ exists: () => false }), 90);
  assert.equal(pickDisplay({ exists: p => p !== "/tmp/.X11-unix/X100" && p !== "/tmp/.X100-lock", from: 95, to: 100 }), 100);
  assert.throws(() => pickDisplay({ exists: () => true, from: 90, to: 92 }), /没有空闲的显示号/);
});

test("chooseMode: 显式 --display 优先；否则 auto-only 无界面用 xvfb，其余用 xephyr", () => {
  const ok = () => ({ ok: true });
  for (const display of ["xephyr", "xvfb", "host"]) {
    for (const autoOnly of [false, true]) for (const headed of [false, true]) {
      assert.deepEqual(chooseMode({ display, autoOnly, headed, available: ok }), { mode: display });
    }
  }
  assert.deepEqual(chooseMode({ display: null, autoOnly: true, headed: false, available: ok }), { mode: "xvfb" });
  assert.deepEqual(chooseMode({ display: null, autoOnly: true, headed: true, available: ok }), { mode: "xephyr" });
  assert.deepEqual(chooseMode({ display: null, autoOnly: false, headed: false, available: ok }), { mode: "xephyr" });
  assert.deepEqual(chooseMode({ display: undefined, autoOnly: false, headed: true, available: ok }), { mode: "xephyr" });
});

test("chooseMode: 选中的服务器不可用 → 退回 host 并带原因；host 不检查可用性", () => {
  const asked = [];
  const no = m => { asked.push(m); return { ok: false, reason: "缺少命令" }; };
  const r = chooseMode({ display: null, autoOnly: true, headed: false, available: no });
  assert.equal(r.mode, "host");
  assert.match(r.reason, /Xvfb/);
  assert.match(r.reason, /缺少命令/);
  const r2 = chooseMode({ display: "xephyr", autoOnly: true, headed: false, available: no });
  assert.equal(r2.mode, "host");
  assert.match(r2.reason, /Xephyr/);
  assert.deepEqual(asked, ["xvfb", "xephyr"]);
  assert.deepEqual(chooseMode({ display: "host", autoOnly: false, headed: false, available: no }), { mode: "host" });
  assert.equal(asked.length, 2);
});

test("serverAvailable: 在 PATH 里找可执行文件；Xephyr 还需要宿主 DISPLAY", () => {
  const exe = new Set(["/usr/bin/Xvfb", "/usr/bin/Xephyr"]);
  const isExe = p => exe.has(p);
  assert.deepEqual(serverAvailable("xvfb", { env: { PATH: "/bin:/usr/bin" }, isExe }), { ok: true });
  assert.deepEqual(serverAvailable("xephyr", { env: { PATH: "/usr/bin", DISPLAY: ":0" }, isExe }), { ok: true });
  assert.match(serverAvailable("xephyr", { env: { PATH: "/usr/bin" }, isExe }).reason, /DISPLAY/);
  assert.match(serverAvailable("xvfb", { env: { PATH: "/bin" }, isExe }).reason, /找不到 Xvfb/);
});

// 假的子进程：kill 时触发 exit
function fakeProc(pid = 4242) {
  const p = new EventEmitter();
  p.pid = pid; p.exitCode = null; p.signalCode = null; p.killed = [];
  p.stderr = new EventEmitter();
  p.kill = sig => { p.killed.push(sig); setImmediate(() => { p.signalCode = sig; p.emit("exit", null, sig); }); return true; };
  return p;
}

test("startDisplay: Xvfb 的参数、pid 文件、xdpyinfo 就绪后返回；stop 杀进程并删 pid 文件", () => withDir(async dir => {
  const pidFile = join(dir, "sub", "display.pid");
  const spawned = [], probes = [];
  const proc = fakeProc();
  let n = 0;
  const h = await startDisplay("xvfb", {
    pidFile, pick: () => 93, intervalMs: 1,
    spawn: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return proc; },
    exec: async (cmd, args) => { probes.push([cmd, ...args]); if (++n < 3) throw new Error("unable to open display"); return "ok"; },
  });
  assert.deepEqual(spawned.map(s => [s.cmd, s.args]), [["Xvfb", [":93", "-screen", "0", "2400x1500x24", "-nolisten", "tcp"]]]);
  assert.equal(spawned[0].opts.detached, true);
  assert.deepEqual(probes[0], ["xdpyinfo", "-display", ":93"]);
  assert.equal(probes.length, 3);
  assert.deepEqual({ display: h.display, mode: h.mode, pid: h.pid }, { display: ":93", mode: "xvfb", pid: 4242 });
  assert.deepEqual(JSON.parse(readFileSync(pidFile, "utf8")), { pid: 4242, display: ":93", mode: "xvfb" });
  await h.stop();
  assert.deepEqual(proc.killed, ["SIGTERM"]);
  assert.equal(existsSync(pidFile), false);
  await h.stop(); // 幂等
  assert.deepEqual(proc.killed, ["SIGTERM"]);
}));

test("startDisplay: Xephyr 的参数（尺寸、标题、不抢宿主输入）", () => withDir(async dir => {
  const spawned = [];
  const h = await startDisplay("xephyr", {
    pidFile: join(dir, "display.pid"), pick: () => 95, size: "1200x800", title: "测试窗口",
    spawn: (cmd, args) => { spawned.push([cmd, args]); return fakeProc(7); }, exec: async () => "ok",
  });
  assert.deepEqual(spawned, [["Xephyr", [":95", "-screen", "1200x800", "-title", "测试窗口", "-no-host-grab", "-nolisten", "tcp"]]]);
  await h.stop();
}));

test("startDisplay: 超时 → 杀掉服务器、删 pid 文件并抛错；服务器提前退出 → 立即抛错", () => withDir(async dir => {
  const pidFile = join(dir, "display.pid");
  const proc = fakeProc();
  await assert.rejects(startDisplay("xvfb", {
    pidFile, pick: () => 90, timeoutMs: 30, intervalMs: 5,
    spawn: () => proc, exec: async () => { throw new Error("unable to open display"); },
  }), /10s|超时/);
  assert.ok(proc.killed.includes("SIGTERM"));
  assert.equal(existsSync(pidFile), false);

  const early = fakeProc();
  const t0 = Date.now();
  await assert.rejects(startDisplay("xvfb", {
    pidFile, pick: () => 90, timeoutMs: 5000, intervalMs: 5,
    spawn: () => { setTimeout(() => { early.stderr.emit("data", Buffer.from("Server is already active for display 90\n")); early.exitCode = 1; early.emit("exit", 1, null); }, 10); return early; },
    exec: async () => { throw new Error("unable to open display"); },
  }), /already active/);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(existsSync(pidFile), false);
}));

test("startDisplay: 不认识的模式抛错，不启动任何进程", async () => {
  let spawned = 0;
  await assert.rejects(startDisplay("host", { pidFile: "/nonexistent/x", spawn: () => { spawned++; } }), /模式/);
  assert.equal(spawned, 0);
});

// cleanupStale：procs 模拟 /proc；kill 记录被杀的 pid
function staleEnv(procs) {
  const killed = [];
  return {
    killed,
    readProc: pid => procs[pid] ?? null,
    kill: (pid, sig) => { killed.push([pid, sig]); delete procs[pid]; },
  };
}

test("cleanupStale: 没有 pid 文件 → null，不杀", () => withDir(async dir => {
  const e = staleEnv({});
  assert.equal(await cleanupStale(join(dir, "display.pid"), e), null);
  assert.deepEqual(e.killed, []);
}));

test("cleanupStale: 进程已不在 / comm 不符 / 显示号不符 → 不杀，只删 pid 文件", () => withDir(async dir => {
  const pidFile = join(dir, "display.pid");
  const cases = [
    {},
    { 500: { comm: "bash", cmdline: ["bash", ":93"] } },
    { 500: { comm: "Xvfb", cmdline: ["Xvfb", ":99", "-screen", "0", "1280x1024x24"] } },
    { 500: { comm: "Xephyr", cmdline: ["Xephyr", ":93"] } }, // 记录的是 xvfb
  ];
  for (const procs of cases) {
    writeFileSync(pidFile, JSON.stringify({ pid: 500, display: ":93", mode: "xvfb" }));
    const e = staleEnv(procs);
    assert.equal(await cleanupStale(pidFile, e), null);
    assert.deepEqual(e.killed, []);
    assert.equal(existsSync(pidFile), false);
  }
}));

test("cleanupStale: pid 文件损坏或内容不合法 → 不杀，删掉", () => withDir(async dir => {
  const pidFile = join(dir, "display.pid");
  for (const body of ["{oops", JSON.stringify({ pid: "1; rm", display: ":93", mode: "xvfb" }), JSON.stringify({ pid: 500, display: "93", mode: "xvfb" }),
    JSON.stringify({ pid: 500, display: ":0", mode: "xvfb" }), JSON.stringify({ pid: 500, display: ":93", mode: "host" })]) {
    writeFileSync(pidFile, body);
    const e = staleEnv({ 500: { comm: "Xvfb", cmdline: ["Xvfb", ":93"] }, 1: { comm: "Xvfb", cmdline: ["Xvfb", ":93"] } });
    assert.equal(await cleanupStale(pidFile, e), null);
    assert.deepEqual(e.killed, []);
    assert.equal(existsSync(pidFile), false);
  }
}));

test("cleanupStale: 进程在、comm 符合、命令行含记录的显示号 → 杀掉并返回说明", () => withDir(async dir => {
  const pidFile = join(dir, "display.pid");
  writeFileSync(pidFile, JSON.stringify({ pid: 500, display: ":93", mode: "xvfb" }));
  const e = staleEnv({ 500: { comm: "Xvfb", cmdline: ["Xvfb", ":93", "-screen", "0", "2400x1500x24", "-nolisten", "tcp"] } });
  const msg = await cleanupStale(pidFile, { ...e, intervalMs: 1 });
  assert.deepEqual(e.killed, [[500, "SIGTERM"]]);
  assert.match(msg, /Xvfb/);
  assert.match(msg, /:93/);
  assert.match(msg, /500/);
  assert.equal(existsSync(pidFile), false);
}));

test("cleanupStale: SIGTERM 后一直不退 → SIGKILL", () => withDir(async dir => {
  const pidFile = join(dir, "display.pid");
  writeFileSync(pidFile, JSON.stringify({ pid: 501, display: ":94", mode: "xephyr" }));
  const procs = { 501: { comm: "Xephyr", cmdline: ["Xephyr", ":94", "-screen", "2400x1500"] } };
  const killed = [];
  const msg = await cleanupStale(pidFile, {
    readProc: pid => procs[pid] ?? null, intervalMs: 1, graceMs: 20,
    kill: (pid, sig) => { killed.push(sig); if (sig === "SIGKILL") delete procs[pid]; },
  });
  assert.deepEqual(killed, ["SIGTERM", "SIGKILL"]);
  assert.match(msg, /Xephyr/);
}));

test("describeDisplay: 报告头文字", () => {
  assert.equal(describeDisplay({ mode: "xvfb", display: ":90", size: "2400x1500" }), "xvfb :90（2400x1500）");
  assert.equal(describeDisplay({ mode: "host", display: ":0" }), "host :0");
  assert.equal(describeDisplay({ mode: "host", display: ":0", reason: "Xvfb 不可用：找不到 Xvfb" }), "host :0（退回 host：Xvfb 不可用：找不到 Xvfb）");
  assert.equal(describeDisplay({ mode: "host", display: null }), "host（无 DISPLAY）");
  assert.equal(describeDisplay(null), "未知");
});

test("prepareDisplay: 先清理遗留，再选模式、起服务器并把 DISPLAY 指向它；stop 幂等", async () => {
  const order = [], env = { DISPLAY: ":0" };
  let stops = 0;
  const d = await prepareDisplay({ autoOnly: true, headless: true, display: null }, { pidFile: "/p", env, deps: {
    cleanupStale: async f => { order.push(`stale:${f}`); return "遗留已停止"; },
    available: m => { order.push(`avail:${m}`); return { ok: true }; },
    startDisplay: async (m, o) => { order.push(`start:${m}:${o.pidFile}`); return { display: ":91", size: "2400x1500", stop: async () => { stops++; }, stopSync: () => true }; },
  } });
  assert.deepEqual(order, ["stale:/p", "avail:xvfb", "start:xvfb:/p"]);
  assert.equal(env.DISPLAY, ":91");
  assert.deepEqual([d.mode, d.display, d.size, d.reason], ["xvfb", ":91", "2400x1500", undefined]);
  assert.deepEqual(d.notes, ["遗留已停止"]);
  await d.stop();
  assert.equal(stops, 1);
  assert.equal(d.stopSync(), true);
});

test("prepareDisplay: 启动失败 → 退回 host、DISPLAY 不变、原因写进备注；host 不起服务器", async () => {
  const env = { DISPLAY: ":0" };
  const d = await prepareDisplay({ autoOnly: false, headless: false, display: "xephyr" }, { pidFile: "/p", env, deps: {
    cleanupStale: async () => null, available: () => ({ ok: true }),
    startDisplay: async () => { throw new Error("等待超时"); },
  } });
  assert.deepEqual([d.mode, d.display, env.DISPLAY], ["host", ":0", ":0"]);
  assert.match(d.reason, /Xephyr 启动失败：等待超时/);
  assert.match(d.notes.join("\n"), /退回 host/);
  assert.equal(d.stopSync(), false);
  await d.stop();
  let started = 0;
  const h = await prepareDisplay({ display: "host" }, { pidFile: "/p", env, deps: {
    cleanupStale: async () => { throw new Error("坏了"); }, available: () => ({ ok: true }), startDisplay: async () => { started++; },
  } });
  assert.deepEqual([h.mode, h.display, started], ["host", ":0", 0]);
  assert.match(h.notes[0], /清理遗留的嵌套显示服务器出错：坏了/);
});
