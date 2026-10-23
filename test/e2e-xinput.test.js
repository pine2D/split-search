import { test } from "node:test";
import assert from "node:assert/strict";
import { createXinput, parsePointer, parseGeometry, parseRoot, parseRect, parseStacking, classRegex } from "../scripts/e2e/xinput.mjs";

const PROFILE = "/home/u/.cache/split-search-e2e/profile";

// 假 exec：按命令和参数返回预设输出；记录调用。返回值为函数时调用它，Error 时 reject
function fakeExec(table) {
  const calls = [];
  const exec = async (cmd, args, opts) => {
    calls.push([cmd, ...args]);
    for (const [match, out] of table) {
      if (match(cmd, args)) {
        const v = typeof out === "function" ? out(cmd, args, opts) : out;
        if (v instanceof Error) throw v;
        return v;
      }
    }
    throw Object.assign(new Error(`未预设：${cmd} ${args.join(" ")}`), { code: 99 });
  };
  return { exec, calls };
}
const is = (c, first) => (cmd, args) => cmd === c && (first === undefined || args[0] === first);
const has = (c, flag) => (cmd, args) => cmd === c && args.includes(flag);
const exit1 = () => Object.assign(new Error("Command failed"), { code: 1, stdout: "" });
const enoent = c => Object.assign(new Error(`spawn ${c} ENOENT`), { code: "ENOENT" });

// ---- findWindow ----
test("findWindow: --all --pid --onlyvisible --class，WM_CLASS 核对通过 -> 返回 wid", async () => {
  const { exec, calls } = fakeExec([
    [has("xdotool", "--classname"), "20971523\n"],
    [has("xdotool", "--class"), "20971523\n"],
  ]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  assert.equal(await xi.findWindow(4242, PROFILE), "20971523");
  const search = calls.find(c => c.includes("--class"));
  assert.deepEqual(search, ["xdotool", "search", "--all", "--pid", "4242", "--onlyvisible", "--class", "google-chrome"]);
  const cls = calls.find(c => c.includes("--classname"));
  assert.deepEqual(cls.slice(0, 6), ["xdotool", "search", "--all", "--pid", "4242", "--onlyvisible"]);
  assert.equal(cls[cls.length - 1], classRegex(PROFILE));
});

test("findWindow: WM_CLASS 不含测试配置路径 -> 抛错", async () => {
  const { exec } = fakeExec([
    [has("xdotool", "--classname"), exit1],
    [has("xdotool", "--class"), "111\n222\n"],
  ]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  await assert.rejects(xi.findWindow(4242, PROFILE), /WM_CLASS/);
});

test("findWindow: 没有可见窗口 -> 抛错；多个测试窗口 -> 抛错（不猜）", async () => {
  const none = createXinput({ exec: fakeExec([[is("xdotool", "search"), exit1]]).exec, env: { DISPLAY: ":0" } });
  await assert.rejects(none.findWindow(4242, PROFILE), /找不到/);
  const two = createXinput({ exec: fakeExec([[is("xdotool", "search"), "1\n2\n"]]).exec, env: { DISPLAY: ":0" } });
  await assert.rejects(two.findWindow(4242, PROFILE), /不唯一/);
  assert.deepEqual(await two.listWindows(4242, PROFILE), ["1", "2"]);
});

test("findWindow: 只保留两次搜索的交集", async () => {
  const { exec } = fakeExec([
    [has("xdotool", "--classname"), "222\n"],
    [has("xdotool", "--class"), "111\n222\n"],
  ]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  assert.equal(await xi.findWindow(4242, PROFILE), "222");
});

test("findWindow: pid 非正整数 -> 抛错且不执行命令", async () => {
  const { exec, calls } = fakeExec([]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  await assert.rejects(xi.findWindow("1; rm -rf /", PROFILE), /pid/);
  assert.equal(calls.length, 0);
});

test("classRegex: 转义正则元字符并锚定结尾", () => {
  assert.equal(classRegex("/a/b.c(1)"), "\\(/a/b\\.c\\(1\\)\\)$");
  const re = new RegExp(classRegex(PROFILE));
  assert.ok(re.test(`google-chrome (${PROFILE})`));
  assert.ok(!re.test(`google-chrome (${PROFILE}2)`));
  assert.ok(!re.test("google-chrome (/home/u/.chrome-debug-profile)"));
});

// ---- pointer / activeWindow / geometry ----
test("parsePointer / pointer()", async () => {
  assert.deepEqual(parsePointer("X=100\nY=200\nSCREEN=0\nWINDOW=12345\n"), { x: 100, y: 200, window: "12345" });
  const { exec, calls } = fakeExec([[is("xdotool", "getmouselocation"), "X=5\nY=6\nSCREEN=0\nWINDOW=77\n"]]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  assert.deepEqual(await xi.pointer(), { x: 5, y: 6, window: "77" });
  assert.deepEqual(calls[0], ["xdotool", "getmouselocation", "--shell"]);
});

test("activeWindow: 成功返回 wid，失败返回 null", async () => {
  const ok = createXinput({ exec: fakeExec([[is("xdotool", "getactivewindow"), "42\n"]]).exec, env: { DISPLAY: ":0" } });
  assert.equal(await ok.activeWindow(), "42");
  const bad = createXinput({ exec: fakeExec([[is("xdotool", "getactivewindow"), exit1]]).exec, env: { DISPLAY: ":0" } });
  assert.equal(await bad.activeWindow(), null);
});

test("parseGeometry: 只取 Geometry（Position 含窗口装饰，不可信）", () => {
  assert.deepEqual(parseGeometry("Window 20971523\n  Position: 50,113 (screen: 0)\n  Geometry: 2400x1500\n"), { width: 2400, height: 1500 });
  assert.throws(() => parseGeometry("garbage"), /Geometry/);
});

// ---- 输入原语 ----
test("typeAscii: 非 ASCII 抛错且不执行命令；ASCII 用 -- 隔开参数", async () => {
  const { exec, calls } = fakeExec([[is("xdotool", "type"), ""]]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  await assert.rejects(xi.typeAscii("中"), { message: /^xauto 只支持 ASCII：/ });
  await assert.rejects(xi.typeAscii("a\nb"), /ASCII/);
  assert.equal(calls.length, 0);
  await xi.typeAscii("-x y", { delayMs: 0 });
  assert.deepEqual(calls, ["-", "x", " ", "y"].map(c => ["xdotool", "type", "--delay", "0", "--", c]), "逐字符输入");
});

test("typeAscii: 每个字符前都核对前台；中途前台被换走 → 剩下的字符不再发出", async () => {
  let typed = 0;
  const { exec, calls } = fakeExec([
    [is("xdotool", "getactivewindow"), () => (typed >= 3 ? "99\n" : "7\n")],
    [is("xdotool", "type"), () => { typed++; return ""; }],
  ]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  await assert.rejects(xi.typeAscii("abcdef", { expectWindow: "7", delayMs: 0 }), /前台窗口/);
  assert.deepEqual(calls.filter(c => c[1] === "type").map(c => c.at(-1)), ["a", "b", "c"]);
  for (const [i, c] of calls.entries()) if (c[1] === "type") assert.equal(calls[i - 1][1], "getactivewindow");
});

test("stacking / parseStacking: 读 _NET_CLIENT_LIST_STACKING；xprop 不在或属性不存在 → null", async () => {
  assert.deepEqual(parseStacking("_NET_CLIENT_LIST_STACKING(WINDOW): window id # 0xc00003, 0x1600004\n"), ["12582915", "23068676"]);
  assert.equal(parseStacking("_NET_CLIENT_LIST_STACKING:  not found.\n"), null);
  const ok = fakeExec([[is("xprop"), "_NET_CLIENT_LIST_STACKING(WINDOW): window id # 0x438\n"]]);
  assert.deepEqual(await createXinput({ exec: ok.exec, env: { DISPLAY: ":0" } }).stacking(), ["1080"]);
  assert.deepEqual(ok.calls[0], ["xprop", "-root", "_NET_CLIENT_LIST_STACKING"]);
  const missing = fakeExec([[is("xprop"), enoent("xprop")]]);
  assert.equal(await createXinput({ exec: missing.exec, env: { DISPLAY: ":0" } }).stacking(), null);
});

test("move/down/up/click/key: 参数校验", async () => {
  const { exec, calls } = fakeExec([[is("xdotool"), ""]]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  await assert.rejects(xi.move(1.5, 2), /坐标/);
  await assert.rejects(xi.down(9), /按键/);
  await assert.rejects(xi.key("ctrl+l; ls"), /组合键/);
  assert.equal(calls.length, 0);
  await xi.move(10, 20); await xi.down(1); await xi.up(1); await xi.click(3); await xi.key("ctrl+l");
  assert.deepEqual(calls, [
    ["xdotool", "mousemove", "10", "20"], ["xdotool", "mousedown", "1"], ["xdotool", "mouseup", "1"],
    ["xdotool", "click", "3"], ["xdotool", "key", "--clearmodifiers", "ctrl+l"],
  ]);
});

test("down/up/click 带 expectWindow：指针不在目标窗口 -> 抛错且不按下", async () => {
  const { exec, calls } = fakeExec([
    [is("xdotool", "getmouselocation"), "X=1\nY=2\nSCREEN=0\nWINDOW=999\n"],
    [is("xdotool"), ""],
  ]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  for (const f of [() => xi.down(1, { expectWindow: "42" }), () => xi.up(1, { expectWindow: "42" }), () => xi.click(1, { expectWindow: "42" })]) {
    await assert.rejects(f(), /指针不在测试窗口/);
  }
  assert.ok(!calls.some(c => ["mousedown", "mouseup", "click"].includes(c[1])));
  await xi.down(1, { expectWindow: "999" });
  assert.deepEqual(calls.at(-1), ["xdotool", "mousedown", "1"]);
});

test("key/typeAscii 带 expectWindow：前台窗口不符 -> 抛错且不按键", async () => {
  const { exec, calls } = fakeExec([[is("xdotool", "getactivewindow"), "7\n"], [is("xdotool"), ""]]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  await assert.rejects(xi.key("Return", { expectWindow: "42" }), /前台窗口/);
  await assert.rejects(xi.typeAscii("abc", { expectWindow: "42" }), /前台窗口/);
  assert.ok(!calls.some(c => c[1] === "key" || c[1] === "type"));
  await xi.key("Return", { expectWindow: "7" });
  assert.deepEqual(calls.at(-1), ["xdotool", "key", "--clearmodifiers", "Return"]);
});

test("debugRun: 用 exec 传参数组并带超时与 DISPLAY 环境", async () => {
  let seen;
  const xi = createXinput({ exec: async (cmd, args, opts) => { seen = { cmd, args, opts }; return " 5 \n"; }, env: { DISPLAY: ":9" }, timeoutMs: 1234, debug: true });
  assert.equal(await xi.debugRun(["getactivewindow"]), "5");
  assert.equal(createXinput({ env: {} }).debugRun, undefined, "默认不提供 debugRun");
  assert.equal(xi.run, undefined, "不暴露原始 run");
  assert.equal(seen.cmd, "xdotool");
  assert.deepEqual(seen.args, ["getactivewindow"]);
  assert.equal(seen.opts.timeout, 1234);
  assert.equal(seen.opts.env.DISPLAY, ":9");
});

// ---- available ----
const goodProbes = () => fakeExec([
  [is("xdotool", "version"), "xdotool version 3.20160805.1\n"],
  [is("import", "-version"), "Version: ImageMagick 6.9\n"],
  [is("xdpyinfo", "-queryExtensions"), "number of extensions: 3\n    XTEST  (opcode: 132)\n    XFIXES\n"],
]);

test("available: 一切就绪 -> ok", async () => {
  const xi = createXinput({ exec: goodProbes().exec, env: { DISPLAY: ":0" } });
  assert.deepEqual(await xi.available(), { ok: true });
});

test("available: 无 DISPLAY / headless / --no-xinput -> 不可用且不探测", async () => {
  const p = goodProbes();
  const r1 = await createXinput({ exec: p.exec, env: {} }).available();
  assert.equal(r1.ok, false); assert.match(r1.reason, /DISPLAY/);
  const r2 = await createXinput({ exec: p.exec, env: { DISPLAY: ":0" } }).available({ headless: true });
  assert.equal(r2.ok, false); assert.match(r2.reason, /无头|headless/);
  const r3 = await createXinput({ exec: p.exec, env: { DISPLAY: ":0" } }).available({ noXinput: true });
  assert.equal(r3.ok, false); assert.match(r3.reason, /--no-xinput/);
  assert.equal(p.calls.length, 0);
});

test("available: 缺命令 / 无 XTEST -> 不可用并写明原因", async () => {
  const missing = fakeExec([
    [is("xdotool", "version"), "ok\n"],
    [is("import"), enoent("import")],
    [is("xdpyinfo"), "XTEST\n"],
  ]);
  const r1 = await createXinput({ exec: missing.exec, env: { DISPLAY: ":0" } }).available();
  assert.equal(r1.ok, false); assert.match(r1.reason, /缺少命令 import/);
  const noX = fakeExec([
    [is("xdotool"), "ok\n"], [is("import"), "ok\n"],
    [is("xdpyinfo"), "number of extensions: 1\n    XFIXES\n"],
  ]);
  const r2 = await createXinput({ exec: noX.exec, env: { DISPLAY: ":0" } }).available();
  assert.equal(r2.ok, false); assert.match(r2.reason, /XTEST/);
});

test("parsePointer: 只认纯数字的 X/Y/WINDOW", () => {
  for (const bad of ["X=1.5\nY=2\nWINDOW=3", "X=-1\nY=2\nWINDOW=3", "X=1\nY=2\nWINDOW=0x10", "X=\nY=2\nWINDOW=3", "X=1 \nY=2e3\nWINDOW=3"]) {
    assert.throws(() => parsePointer(bad), /读不懂/, bad);
  }
});

test("parseRoot / parseRect / rootWindow", async () => {
  assert.equal(parseRoot("screen #0:\n  root window id:    0x438\n"), "1080");
  assert.throws(() => parseRoot("nothing"), /root window id/);
  assert.deepEqual(parseRect("Window 5\n  Position: 325,219 (screen: 0)\n  Geometry: 650x470\n"), { width: 650, height: 470, x: 325, y: 219 });
  const { exec, calls } = fakeExec([[is("xdpyinfo"), "  root window id:    0x438\n"]]);
  assert.equal(await createXinput({ exec, env: { DISPLAY: ":0" } }).rootWindow(), "1080");
  assert.deepEqual(calls[0], ["xdpyinfo"]);
});

test("findWindowByTitle: 标题命中且属于测试配置 -> wid；token 不合法 -> 抛错；不唯一 -> null", async () => {
  const { exec, calls } = fakeExec([
    [has("xdotool", "--classname"), "11\n22\n"],
    [has("xdotool", "--class"), "11\n22\n"],
    [has("xdotool", "--name"), "22\n99\n"],
  ]);
  const xi = createXinput({ exec, env: { DISPLAY: ":0" } });
  assert.equal(await xi.findWindowByTitle(42, "sse2e-win-abc123", PROFILE), "22");
  assert.deepEqual(calls.at(-1), ["xdotool", "search", "--all", "--pid", "42", "--onlyvisible", "--name", "sse2e-win-abc123"]);
  await assert.rejects(xi.findWindowByTitle(42, "a.*", PROFILE), /token/);
  const two = createXinput({ exec: fakeExec([[is("xdotool", "search"), "1\n2\n"]]).exec, env: { DISPLAY: ":0" } });
  assert.equal(await two.findWindowByTitle(42, "sse2e-win-abc123", PROFILE), null);
});

test("releaseModifiers: keyup 全部修饰键", async () => {
  const { exec, calls } = fakeExec([[is("xdotool", "keyup"), ""]]);
  await createXinput({ exec, env: { DISPLAY: ":0" } }).releaseModifiers();
  assert.deepEqual(calls[0].slice(0, 3), ["xdotool", "keyup", "Control_L"]);
  assert.ok(calls[0].includes("Alt_L") && calls[0].includes("Shift_L"));
});
