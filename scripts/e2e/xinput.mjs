// xdotool（XTEST）薄封装：真实鼠标/键盘输入、窗口查找、指针与前台窗口查询。
// 一律 execFile（不经 shell），参数逐个传入、带超时；用户字符串从不拼进命令行。
// 安全：用户自己的 chrome-dbg 最大化在测试窗口后面。按下/松开/按键前可传 expectWindow，
// 原语会先核对指针所在窗口（鼠标）或前台窗口（键盘），不符就抛错、不发事件。
import { execFile } from "node:child_process";
import { PROFILE_DIR } from "./config.mjs";

const DEFAULT_TIMEOUT = 5000;

// 默认 exec：resolve stdout（encoding "buffer" 时为 Buffer），失败 reject（err.code 为退出码或 ENOENT）
function defaultExec(cmd, args, { timeout = DEFAULT_TIMEOUT, env, encoding = "utf8", maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, env, encoding, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); } else resolve(stdout);
    });
  });
}

const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// WM_CLASS instance 形如 "google-chrome (/home/u/.cache/split-search-e2e/profile)"；锚定结尾，防止前缀相同的配置误中
export const classRegex = profileDir => `\\(${reEscape(profileDir)}\\)$`;

export function parsePointer(out) {
  const kv = Object.fromEntries(String(out).trim().split("\n").map(l => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
  const x = Number(kv.X), y = Number(kv.Y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !kv.WINDOW) throw new Error(`读不懂指针位置：${String(out).slice(0, 80)}`);
  return { x, y, window: kv.WINDOW };
}

// 只取 Geometry；Position 把窗口装饰（_NET_FRAME_EXTENTS）算了进去，不可信
export function parseGeometry(out) {
  const m = /Geometry:\s*(\d+)x(\d+)/.exec(String(out));
  if (!m) throw new Error(`读不懂窗口 Geometry：${String(out).slice(0, 80)}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

const BUTTONS = new Set([1, 2, 3]);
const COMBO_RE = /^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$/;
const ASCII_RE = /^[\x20-\x7e]*$/;
const isWid = w => typeof w === "string" && /^\d+$/.test(w);
const lines = s => String(s).split("\n").map(x => x.trim()).filter(Boolean);

export function createXinput({ exec = defaultExec, env = process.env, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const call = (cmd, args, opts = {}) => exec(cmd, args.map(String), { timeout: timeoutMs, env, ...opts });
  const run = async (args, opts) => String(await call("xdotool", args, opts)).trim();

  // xdotool search 没有结果时退出码为 1，视为空列表
  const search = async args => {
    try { return lines(await run(["search", ...args])); }
    catch (e) { if (e.code === 1 && !String(e.stdout || "").trim()) return []; throw e; }
  };

  // 测试 Chrome 的可见顶层窗口：必须 --all（否则多个条件是“或”，会命中用户的 chrome-dbg），
  // 再用 --classname 核对 WM_CLASS instance 含测试配置路径，取两次结果的交集
  async function listWindows(pid, profileDir = PROFILE_DIR) {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`pid 不合法：${pid}`);
    const base = ["--all", "--pid", pid, "--onlyvisible"];
    const byClass = await search([...base, "--class", "google-chrome"]);
    if (!byClass.length) return [];
    const byProfile = new Set(await search([...base, "--classname", classRegex(profileDir)]));
    const ok = byClass.filter(w => byProfile.has(w));
    if (!ok.length) throw new Error(`pid ${pid} 的窗口 WM_CLASS 不含测试配置路径 ${profileDir}（窗口 ${byClass.join(",")}），拒绝使用`);
    return ok;
  }

  async function findWindow(pid, profileDir = PROFILE_DIR) {
    const ws = await listWindows(pid, profileDir);
    if (!ws.length) throw new Error(`找不到测试 Chrome（pid ${pid}）的可见窗口`);
    if (ws.length > 1) throw new Error(`测试 Chrome 的可见窗口不唯一（${ws.join(",")}），不猜测`);
    return ws[0];
  }

  const pointer = async () => parsePointer(await run(["getmouselocation", "--shell"]));
  const activeWindow = async () => {
    try { const w = await run(["getactivewindow"]); return isWid(w) ? w : null; }
    catch { return null; }
  };
  const windowSize = async wid => {
    if (!isWid(wid)) throw new Error(`窗口 id 不合法：${wid}`);
    return parseGeometry(await run(["getwindowgeometry", wid]));
  };

  async function assertPointerIn(wid) {
    const p = await pointer();
    if (p.window !== String(wid)) throw new Error(`指针不在测试窗口上（指针 ${p.x},${p.y} 在窗口 ${p.window}，期望 ${wid}），已中止`);
    return p;
  }
  async function assertActive(wid) {
    const a = await activeWindow();
    if (a !== String(wid)) throw new Error(`前台窗口不是测试窗口（前台 ${a ?? "无"}，期望 ${wid}），已中止`);
  }

  const checkBtn = btn => { if (!BUTTONS.has(btn)) throw new Error(`鼠标按键只能是 1/2/3：${btn}`); };
  const mouseOp = op => async (btn = 1, { expectWindow } = {}) => {
    checkBtn(btn);
    if (expectWindow !== undefined) await assertPointerIn(expectWindow);
    await run([op, btn]);
  };

  async function move(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) throw new Error(`坐标必须是非负整数：${x},${y}`);
    await run(["mousemove", x, y]);
  }

  async function key(combo, { expectWindow, clearModifiers = true } = {}) {
    if (typeof combo !== "string" || !COMBO_RE.test(combo)) throw new Error(`组合键不合法：${combo}`);
    if (expectWindow !== undefined) await assertActive(expectWindow);
    await run(["key", ...(clearModifiers ? ["--clearmodifiers"] : []), combo]);
  }

  async function typeAscii(s, { expectWindow, delayMs = 8 } = {}) {
    if (typeof s !== "string" || !ASCII_RE.test(s)) throw new Error(`xauto 只支持 ASCII：${JSON.stringify(String(s)).slice(0, 60)}`);
    if (expectWindow !== undefined) await assertActive(expectWindow);
    // “--” 防止以 - 开头的文本被当成选项；超时按长度放宽
    await run(["type", "--delay", delayMs, "--", s], { timeout: timeoutMs + s.length * (delayMs + 20) });
  }

  // 截窗口的原始 RGB（每像素 3 字节，行优先）；坐标相对窗口
  async function captureRgb(wid, { width, height, x = 0, y = 0 }) {
    if (!isWid(wid)) throw new Error(`窗口 id 不合法：${wid}`);
    for (const v of [width, height, x, y]) if (!Number.isInteger(v) || v < 0) throw new Error(`截图区域不合法：${width}x${height}+${x}+${y}`);
    const buf = await call("import", ["-silent", "-window", wid, "-crop", `${width}x${height}+${x}+${y}`, "-depth", "8", "rgb:-"],
      { encoding: "buffer", timeout: 10000 });
    if (buf.length !== width * height * 3) throw new Error(`截图大小不符：${buf.length} 字节，期望 ${width * height * 3}`);
    return buf;
  }

  // xinput 可用 = DISPLAY 存在、三个命令可执行、XTEST 扩展在、非 headless、未传 --no-xinput
  async function available({ headless = false, noXinput = false } = {}) {
    if (noXinput) return { ok: false, reason: "已传 --no-xinput" };
    if (headless) return { ok: false, reason: "无头（headless）模式没有窗口" };
    if (!env.DISPLAY) return { ok: false, reason: "没有 DISPLAY 环境变量" };
    const probes = [["xdotool", ["version"]], ["import", ["-version"]], ["xdpyinfo", ["-queryExtensions"]]];
    const outs = {};
    for (const [cmd, args] of probes) {
      try { outs[cmd] = String(await call(cmd, args)); }
      catch (e) {
        return { ok: false, reason: e.code === "ENOENT" ? `缺少命令 ${cmd}` : `${cmd} 无法运行：${String(e.message).split("\n")[0]}` };
      }
    }
    if (!/\bXTEST\b/.test(outs.xdpyinfo)) return { ok: false, reason: "X 服务器没有 XTEST 扩展" };
    return { ok: true };
  }

  return {
    run, available, listWindows, findWindow, pointer, activeWindow, windowSize, assertPointerIn, assertActive,
    move, down: mouseOp("mousedown"), up: mouseOp("mouseup"), click: mouseOp("click"), key, typeAscii, captureRgb,
  };
}

const xi = createXinput();
export const {
  run, available, listWindows, findWindow, pointer, activeWindow, windowSize, assertPointerIn, assertActive,
  move, down, up, click, key, typeAscii, captureRgb,
} = xi;
export default xi;
