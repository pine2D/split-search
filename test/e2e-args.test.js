import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, USAGE } from "../scripts/e2e/args.mjs";

test("parseArgs: 默认值", () => {
  assert.deepEqual(parseArgs([]), { autoOnly: false, headless: false, only: null, port: 8765, timeoutMs: 120000 });
});

test("parseArgs: --auto-only 隐含 headless", () => {
  const a = parseArgs(["--auto-only"]);
  assert.equal(a.autoOnly, true);
  assert.equal(a.headless, true);
});

test("parseArgs: --auto-only --headed 强制有界面", () => {
  const a = parseArgs(["--auto-only", "--headed"]);
  assert.equal(a.autoOnly, true);
  assert.equal(a.headless, false);
  assert.equal(parseArgs(["--headed"]).headless, false);
});

test("parseArgs: --only 拆分、去空白、转大写", () => {
  assert.deepEqual(parseArgs(["--only", "B5,T7"]).only, ["B5", "T7"]);
  assert.deepEqual(parseArgs(["--only=b5, t7,"]).only, ["B5", "T7"]);
});

test("parseArgs: --port 与 --timeout", () => {
  assert.equal(parseArgs(["--port", "9000"]).port, 9000);
  assert.equal(parseArgs(["--port=9001"]).port, 9001);
  assert.equal(parseArgs(["--timeout", "5000"]).timeoutMs, 5000);
});

test("parseArgs: 非法输入抛出并附中文用法", () => {
  assert.throws(() => parseArgs(["--bogus"]), e => e.message.includes("未知参数") && e.message.includes(USAGE));
  assert.throws(() => parseArgs(["--port", "abc"]), /端口/);
  assert.throws(() => parseArgs(["--port", "70000"]), /端口/);
  assert.throws(() => parseArgs(["--port"]), /缺少取值/);
  assert.throws(() => parseArgs(["--only", ""]), /--only/);
  assert.throws(() => parseArgs(["--timeout", "0"]), /超时/);
});

test("parseArgs: --help 抛出 code=HELP", () => {
  assert.throws(() => parseArgs(["--help"]), e => e.code === "HELP" && e.message === USAGE);
});
