import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapBounds, restoreCalls, rememberWindow, restoreWindow, restorePendingWindow, describeBounds } from "../scripts/e2e/window-snap.mjs";
import { restoreWindowStep, teardown } from "../scripts/e2e/teardown.mjs";
import { EXT_ID } from "../scripts/e2e/config.mjs";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "e2e-win-")), "window-snapshot.json");
const NORMAL = { windowState: "normal", left: 10, top: 20, width: 1600, height: 1000 };

test("snapBounds：normal 记四个整数，其他状态只记 windowState，不合法返回 null", () => {
  assert.deepEqual(snapBounds({ ...NORMAL, extra: 1 }), NORMAL);
  assert.deepEqual(snapBounds({ windowState: "maximized", width: 3 }), { windowState: "maximized" });
  assert.equal(snapBounds({ windowState: "normal", left: 0, top: 0, width: 900 }), null);
  assert.equal(snapBounds({ windowState: "weird" }), null);
  assert.equal(snapBounds(null), null);
});

test("restoreCalls：normal 先回到 normal 再设尺寸；其他状态一步", () => {
  assert.deepEqual(restoreCalls(NORMAL), [{ windowState: "normal" }, { left: 10, top: 20, width: 1600, height: 1000 }]);
  assert.deepEqual(restoreCalls({ windowState: "maximized" }), [{ windowState: "maximized" }]);
});

test("rememberWindow：只记第一次（之后的改动不覆盖运行前的尺寸）", () => {
  const file = tmpFile();
  assert.equal(rememberWindow(NORMAL, { file }), true);
  assert.equal(rememberWindow({ ...NORMAL, width: 900 }, { file }), false);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), NORMAL);
  assert.equal(rememberWindow({ windowState: "bogus" }, { file: tmpFile() }), false);
});

function fakeBrowser(pages = [{ type: "page", targetId: "o", url: `chrome-extension://${EXT_ID}/options/options.html` }]) {
  const sent = [];
  return {
    sent,
    targets: async () => [{ type: "page", targetId: "x", url: "http://site-x/" }, ...pages],
    client: { send: async (m, p) => { sent.push([m, p]); return m === "Browser.getWindowForTarget" ? { windowId: p.targetId === "o" ? 7 : 8 } : {}; } },
  };
}

test("restoreWindow：改回设置页所在窗口的尺寸并删掉快照；没有快照返回 null；格式不对删掉", async () => {
  const file = tmpFile();
  assert.equal(await restoreWindow(fakeBrowser(), { file }), null);
  rememberWindow(NORMAL, { file });
  const b = fakeBrowser();
  assert.deepEqual(await restoreWindow(b, { file }), NORMAL);
  assert.equal(existsSync(file), false);
  assert.deepEqual(b.sent.filter(([m]) => m === "Browser.setWindowBounds").map(([, p]) => p), restoreCalls(NORMAL).map(bounds => ({ windowId: 7, bounds })));
  writeFileSync(file, "{nope");
  assert.deepEqual(await restoreWindow(fakeBrowser(), { file }), { invalid: true });
  assert.equal(existsSync(file), false);
});

test("restoreWindow：没有页面目标时抛错并保留快照", async () => {
  const file = tmpFile();
  rememberWindow(NORMAL, { file });
  const b = { targets: async () => [], client: { send: async () => ({}) } };
  await assert.rejects(restoreWindow(b, { file }), /找不到测试窗口/);
  assert.equal(existsSync(file), true);
  assert.match(await restorePendingWindow(b, { file }), /改回遗留的窗口尺寸失败/);
});

test("restorePendingWindow：启动时有快照就改回并给出备注", async () => {
  const file = tmpFile();
  assert.equal(await restorePendingWindow(fakeBrowser(), { file }), null);
  rememberWindow({ ...NORMAL, width: 900 }, { file });
  assert.match(await restorePendingWindow(fakeBrowser(), { file }), /已改回 900×1000/);
  assert.equal(describeBounds({ windowState: "maximized" }), "maximized");
});

const mkRt = (o = {}) => ({ browser: {}, browserDead: false, restartFailed: false, notes: [], started: [], ...o });
const W = "/x/window-snapshot.json";

test("restoreWindowStep：没有快照不动；有快照改回；浏览器不在或失败时保留快照并记备注", async () => {
  await restoreWindowStep(mkRt(), {}, { win: { WINDOW_FILE: W, restore: () => assert.fail("不该调用") }, exists: () => false });
  const logs = [];
  await restoreWindowStep(mkRt(), {}, { win: { WINDOW_FILE: W, restore: async () => NORMAL, describe: describeBounds }, exists: () => true, log: m => logs.push(m) });
  assert.match(logs[0], /测试窗口已改回运行前的尺寸（1600×1000/);
  const gone = mkRt({ browserDead: true });
  await restoreWindowStep(gone, {}, { win: { WINDOW_FILE: W, restore: () => assert.fail("不该调用") }, exists: () => true });
  assert.match(gone.notes[0], /无法改回测试窗口尺寸.*快照保留/);
  const failed = mkRt();
  await restoreWindowStep(failed, {}, { win: { WINDOW_FILE: W, restore: async () => { throw new Error("boom"); } }, exists: () => true });
  assert.match(failed.notes[0], /改回测试窗口尺寸失败：boom.*快照保留/);
});

test("teardown：在关浏览器之前改回窗口尺寸", async () => {
  const order = [];
  const rt = mkRt({ browser: { close: async () => { order.push("close"); return { graceful: true }; } } });
  await teardown(rt, { args: { autoOnly: true }, results: null, snapshotTaken: false }, {
    exists: f => f === W, win: { WINDOW_FILE: W, restore: async () => { order.push("window"); return NORMAL; } },
    se: { SE_SNAPSHOT_FILE: "/x/se.json" }, cleanupItems: () => [], cleanupNote: () => null, cleanupText: () => "",
    outDir: mkdtempSync(join(tmpdir(), "e2e-rep-")),
  });
  assert.deepEqual(order, ["window", "close"]);
});
