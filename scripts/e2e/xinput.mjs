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

const DIGITS = /^\d+$/;
export function parsePointer(out) {
  const kv = Object.fromEntries(String(out).trim().split("\n").map(l => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
  if (![kv.X, kv.Y, kv.WINDOW].every(v => DIGITS.test(v ?? ""))) throw new Error(`读不懂指针位置：${String(out).slice(0, 80)}`);
  return { x: Number(kv.X), y: Number(kv.Y), window: kv.WINDOW };
}

// xdpyinfo 的 "root window id:    0x438" → 十进制字符串（与 xdotool 报的窗口 id 同一写法）
export function parseRoot(out) {
  const m = /root window id:\s*0x([0-9a-f]+)/i.exec(String(out));
  if (!m) throw new Error("xdpyinfo 输出里找不到 root window id");
  return String(parseInt(m[1], 16));
}

// 只给 override-redirect 窗口（右键菜单）用：它们没有 _NET_FRAME_EXTENTS，Position 才可信
export function parseRect(out) {
  const p = /Position:\s*(-?\d+),(-?\d+)/.exec(String(out));
  return { ...parseGeometry(out), ...(p ? { x: Number(p[1]), y: Number(p[2]) } : {}) };
}

// 只取 Geometry；Position 把窗口装饰（_NET_FRAME_EXTENTS）算了进去，不可信
export function parseGeometry(out) {
  const m = /Geometry:\s*(\d+)x(\d+)/.exec(String(out));
  if (!m) throw new Error(`读不懂窗口 Geometry：${String(out).slice(0, 80)}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

// xprop -root _NET_CLIENT_LIST_STACKING 的输出 → 十进制窗口 id（从下到上）；属性不存在 → null
export function parseStacking(out) {
  const m = /_NET_CLIENT_LIST_STACKING\(WINDOW\): window id # (.*)$/m.exec(String(out));
  if (!m) return null;
  return m[1].split(",").map(x => x.trim()).filter(x => /^0x[0-9a-f]+$/i.test(x)).map(x => String(parseInt(x, 16)));
}

// xwininfo -children 的输出 → { parent, children: [{ id, x, y, w, h }] }（id 十进制；x/y 为绝对坐标）。
// children 保持 xwininfo 的打印顺序：实测是从上到下（2026-10-23：两个测试 Chrome 窗口先后打开，后开、在前台的那个的
// 框架窗口排第一；xwininfo 按 XQueryTree 的逆序打印）。WSLg 的 Weston WM 会给顶层窗口套一层框架窗口（根的子窗口）
export function parseChildren(out) {
  const text = String(out);
  const p = /Parent window id: 0x([0-9a-f]+)/i.exec(text);
  const children = [];
  for (const line of text.split("\n")) {
    const m = /^\s+0x([0-9a-f]+)\s.*\s(\d+)x(\d+)\S*\s+([+-]-?\d+)([+-]-?\d+)\s*$/i.exec(line);
    if (!m) continue;
    const num = v => Number(v.replace(/^\+/, ""));
    children.push({ id: String(parseInt(m[1], 16)), w: Number(m[2]), h: Number(m[3]), x: num(m[4]), y: num(m[5]) });
  }
  return { parent: p ? String(parseInt(p[1], 16)) : null, children };
}

const BUTTONS = new Set([1, 2, 3]);
const COMBO_RE = /^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$/;
const ASCII_RE = /^[\x20-\x7e]*$/;
const isWid = w => typeof w === "string" && /^\d+$/.test(w);
const MODIFIERS = ["Control_L", "Control_R", "Alt_L", "Alt_R", "Shift_L", "Shift_R", "Super_L", "Super_R"];
const lines = s => String(s).split("\n").map(x => x.trim()).filter(Boolean);
const NO_EWMH = /_NET_ACTIVE_WINDOW/;

export function createXinput({ exec = defaultExec, env = process.env, timeoutMs = DEFAULT_TIMEOUT, debug = false } = {}) {
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

  // 标题里带 token 的测试窗口（页面先把 document.title 设成 token；token 只含小写字母、数字、连字符）
  async function findWindowByTitle(pid, token, profileDir = PROFILE_DIR) {
    if (!/^[a-z0-9-]{6,40}$/.test(token)) throw new Error(`标题 token 不合法：${token}`);
    const ok = new Set(await listWindows(pid, profileDir));
    const hits = (await search(["--all", "--pid", pid, "--onlyvisible", "--name", token])).filter(w => ok.has(w));
    return hits.length === 1 ? hits[0] : null;
  }

  // 该进程全部可见窗口（含右键菜单这类 override-redirect 窗口，它们没有 WM_CLASS）
  async function pidWindows(pid) {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`pid 不合法：${pid}`);
    return search(["--all", "--pid", pid, "--onlyvisible", "--name", ""]);
  }

  // 屏幕上全部可见窗口（任何进程）：拖拽中核对有没有别的应用新冒出来的窗口
  const visibleWindows = () => search(["--onlyvisible", "--name", ""]);

  async function findWindow(pid, profileDir = PROFILE_DIR) {
    const ws = await listWindows(pid, profileDir);
    if (!ws.length) throw new Error(`找不到测试 Chrome（pid ${pid}）的可见窗口`);
    if (ws.length > 1) throw new Error(`测试 Chrome 的可见窗口不唯一（${ws.join(",")}），不猜测`);
    return ws[0];
  }

  const pointer = async () => parsePointer(await run(["getmouselocation", "--shell"]));
  // 前台窗口：先用 getactivewindow（EWMH）。嵌套显示（Xephyr/Xvfb）没有窗口管理器，它报“不支持 _NET_ACTIVE_WINDOW”：
  // 记在本实例上（focus.noEwmh），之后直接用 getwindowfocus（X 焦点窗口，键盘就送给它）。其他报错或输出不是窗口 id 一律返回 null
  // （与 host 基线一致：WSLg 上 getactivewindow 偶发报错时不能改用 X 焦点放行，见 Global Constraint“host 行为与防护不变”）
  const focus = { noEwmh: false };
  const focusWindow = async () => {
    try { const w = await run(["getwindowfocus"]); return isWid(w) ? w : null; }
    catch { return null; }
  };
  const activeWindow = async () => {
    if (focus.noEwmh) return focusWindow();
    try {
      const w = await run(["getactivewindow"]);
      if (isWid(w)) return w;
      if (!NO_EWMH.test(w)) return null;
    } catch (e) {
      if (!NO_EWMH.test(`${e.message ?? ""}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`)) return null;
    }
    focus.noEwmh = true;
    return focusWindow();
  };
  const windowSize = async wid => {
    if (!isWid(wid)) throw new Error(`窗口 id 不合法：${wid}`);
    return parseGeometry(await run(["getwindowgeometry", wid]));
  };

  const windowRect = async wid => {
    if (!isWid(wid)) throw new Error(`窗口 id 不合法：${wid}`);
    return parseRect(await run(["getwindowgeometry", wid]));
  };
  const rootWindow = async () => parseRoot(await call("xdpyinfo", []));

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

  // 松开所有修饰键（type/key 超时或出错后调用，防止 Ctrl/Alt 卡在按下状态）
  const releaseModifiers = () => run(["keyup", ...MODIFIERS]);

  // 逐字符输入：每个字符前都核对前台（裁定 I3），前台一变就停，剩下的字符不再发出。“--” 防止以 - 开头的字符被当成选项
  async function typeAscii(s, { expectWindow, delayMs = 8 } = {}) {
    if (typeof s !== "string" || !ASCII_RE.test(s)) throw new Error(`xauto 只支持 ASCII：${JSON.stringify(String(s)).slice(0, 60)}`);
    for (const ch of s) {
      if (expectWindow !== undefined) await assertActive(expectWindow);
      await run(["type", "--delay", 0, "--", ch]);
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // 根窗口的子窗口，从下到上（叠放顺序的主来源，裁定 Task 4 fix round 2）；xwininfo 不在或出错 → null
  async function rootChildren() {
    try { return parseChildren(await call("xwininfo", ["-root", "-children"])).children.reverse(); } catch { return null; }
  }
  const windowTree = async wid => {
    if (!isWid(wid)) throw new Error(`窗口 id 不合法：${wid}`);
    return parseChildren(await call("xwininfo", ["-id", wid, "-children"]));
  };
  // "IsViewable" / "IsUnMapped" / "IsUnviewable"；读不到 → null
  const mapState = async wid => {
    if (!isWid(wid)) throw new Error(`窗口 id 不合法：${wid}`);
    return /Map State:\s*(\w+)/.exec(String(await call("xwininfo", ["-id", wid])))?.[1] ?? null;
  };

  // 根窗口的 _NET_CLIENT_LIST_STACKING（从下到上，十进制 id）。xprop 不在、属性不存在或读不了 → null（调用方降级）
  async function stacking() {
    try {
      return parseStacking(await call("xprop", ["-root", "_NET_CLIENT_LIST_STACKING"]));
    } catch { return null; }
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

  // 截图存成 PNG（只读）：target 为窗口 id 或 "root"（整个屏幕——调用方只在嵌套显示上用 root，host 模式会截到用户桌面）
  async function capturePng(target, file) {
    if (target !== "root" && !isWid(target)) throw new Error(`窗口 id 不合法：${target}`);
    if (typeof file !== "string" || !file.endsWith(".png") || file.startsWith("-")) throw new Error(`截图文件名不合法：${file}`);
    await call("import", ["-silent", "-window", target, file], { timeout: 10000 });
    return file;
  }

  // xinput 可用 = DISPLAY 存在、四个命令（xdotool、import、xdpyinfo、xwininfo）可执行、XTEST 扩展在、非 headless、未传 --no-xinput
  async function available({ headless = false, noXinput = false } = {}) {
    if (noXinput) return { ok: false, reason: "已传 --no-xinput" };
    if (headless) return { ok: false, reason: "无头（headless）模式没有窗口" };
    if (!env.DISPLAY) return { ok: false, reason: "没有 DISPLAY 环境变量" };
    const probes = [["xdotool", ["version"]], ["import", ["-version"]], ["xdpyinfo", ["-queryExtensions"]], ["xwininfo", ["-version"]]];
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

  // 不暴露原始的 run（任意 xdotool 子命令）：调用方只能用带检查的原语。debugRun 只在 debug:true（单测）时提供
  return {
    available, listWindows, findWindow, findWindowByTitle, pidWindows, visibleWindows, stacking, rootChildren, windowTree, mapState, rootWindow, pointer, activeWindow, windowSize, windowRect,
    focusMode: () => (focus.noEwmh ? "getwindowfocus" : "getactivewindow"), assertPointerIn, assertActive, move, down: mouseOp("mousedown"), up: mouseOp("mouseup"), click: mouseOp("click"),
    key, typeAscii, releaseModifiers, captureRgb, capturePng, ...(debug ? { debugRun: run } : {}),
  };
}

const xi = createXinput();
export const {
  available, listWindows, findWindow, findWindowByTitle, pidWindows, visibleWindows, stacking, rootChildren, windowTree, mapState, rootWindow, pointer, activeWindow, windowSize, windowRect,
  assertPointerIn, assertActive, move, down, up, click, key, typeAscii, releaseModifiers, captureRgb, capturePng,
} = xi;
export default xi;
