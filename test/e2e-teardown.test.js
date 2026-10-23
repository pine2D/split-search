import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  restoreStorageStep, restoreSettingsStep, closeStep, cleanupStep, fillResults, writePartialReportSync, teardown,
} from "../scripts/e2e/teardown.mjs";

const mkRt = (o = {}) => ({ browser: { close: async () => ({ graceful: true }) }, col: null, browserDead: false, restartFailed: false,
  started: [], notes: [], ...o });
const mkS = (o = {}) => ({ args: { autoOnly: true }, steps: [], startedAt: new Date("2026-10-23T08:00:00Z"), storage: null,
  snapshotTaken: false, results: null, partial: [], signalName: null, aborted: () => false, seTouched: false, seFailed: false, seVerified: false, ...o });
const SE_FILE = "/x/settings-snapshot.json";

test("restoreStorageStep: 恢复成功写进 storage；浏览器不在了只记备注、保留快照", async () => {
  const s = mkS({ snapshotTaken: true, storage: { before: "a", after: null, equal: false } });
  const ext = { SNAPSHOT_FILE: "/x/s.json", restoreStorage: async () => ({ digest: "a", equal: true }) };
  await restoreStorageStep(mkRt(), s, { ext, extAlive: async () => true });
  assert.deepEqual(s.storage, { before: "a", after: "a", equal: true });
  const rt = mkRt({ browserDead: true });
  await restoreStorageStep(rt, s, { ext: { ...ext, restoreStorage: () => assert.fail("不该调用") } });
  assert.match(rt.notes[0], /浏览器已退出，无法恢复 storage/);
});

test("restoreStorageStep: 恢复失败 → 备注里说明扩展可能停用、快照保留", async () => {
  const rt = mkRt();
  const s = mkS({ snapshotTaken: true, storage: { before: "a", after: null, equal: false } });
  await restoreStorageStep(rt, s, { ext: { SNAPSHOT_FILE: "/x/s.json", restoreStorage: async () => { throw new Error("boom"); } }, extAlive: async () => false });
  assert.match(rt.notes[0], /恢复 storage 失败（扩展当前不可用.*boom.*快照保留/);
  assert.equal(s.storage.equal, false);
});

test("restoreSettingsStep: 没有快照 → 不动；有快照 → keepFile 恢复并标记已核对", async () => {
  const calls = [];
  const se = { SE_SNAPSHOT_FILE: SE_FILE, restore: async (b, o) => { calls.push(o); return { defaultKeyword: "gb", defaultChanged: false, removed: ["sse2e"], warning: null }; } };
  const s = mkS();
  await restoreSettingsStep(mkRt(), s, { se, exists: () => false });
  assert.deepEqual(calls, []);
  assert.equal(s.seTouched, false);
  const logs = [];
  await restoreSettingsStep(mkRt(), s, { se, exists: () => true, log: m => logs.push(m) });
  assert.deepEqual(calls, [{ keepFile: true }]);
  assert.equal(s.seTouched && s.seVerified, true);
  assert.match(logs[0], /默认引擎保持 gb（不是脚本设的，不动）/);
});

test("restoreSettingsStep: 浏览器不在了或恢复失败 → seFailed，快照保留", async () => {
  const se = { SE_SNAPSHOT_FILE: SE_FILE, restore: async () => { throw new Error("页面打不开"); } };
  const s1 = mkS(), rt1 = mkRt({ browser: null });
  await restoreSettingsStep(rt1, s1, { se, exists: () => true });
  assert.equal(s1.seFailed, true);
  assert.match(rt1.notes[0], /浏览器不可用.*快照保留/);
  const s2 = mkS(), rt2 = mkRt();
  await restoreSettingsStep(rt2, s2, { se, exists: () => true });
  assert.equal(s2.seFailed && !s2.seVerified, true);
  assert.match(rt2.notes[0], /恢复网站搜索失败：页面打不开/);
});

test("closeStep: 动过网站搜索才 graceful；正常退出才删快照，删快照出错不抛只记备注", async () => {
  const opts = [];
  const rt = mkRt({ browser: { close: async o => { opts.push(o); return { graceful: true }; } } });
  let dropped = 0;
  await closeStep(rt, mkS({ seTouched: true, seVerified: true }), { se: { SE_SNAPSHOT_FILE: SE_FILE, dropSnapshot: () => { dropped++; } } });
  assert.deepEqual(opts, [{ graceful: true }]);
  assert.equal(dropped, 1);
  assert.equal(rt.closing, true);
  const rt2 = mkRt();
  await closeStep(rt2, mkS({ seTouched: true, seVerified: true }), { se: { SE_SNAPSHOT_FILE: SE_FILE, dropSnapshot: () => { throw new Error("EACCES"); } } });
  assert.match(rt2.notes[0], /删除已核对的网站搜索快照失败：EACCES/);
  const rt3 = mkRt({ browser: { close: async () => ({ graceful: false }) } });
  await closeStep(rt3, mkS({ seTouched: true, seVerified: true }), { se: { SE_SNAPSHOT_FILE: SE_FILE, dropSnapshot: () => assert.fail("不该删") } });
  assert.match(rt3.notes[0], /没有正常退出.*快照保留/);
  const opts4 = [];
  await closeStep(mkRt({ browser: { close: async o => { opts4.push(o); return { graceful: false }; } } }), mkS(), { se: {} });
  assert.deepEqual(opts4, [{ graceful: false }]);
});

test("cleanupStep: auto-only 不出清单；引导式按步骤给出保留说明；中断且开始过 restores 步骤时提示", () => {
  const d = { cleanupItems: () => ["改回站点访问"], cleanupNote: () => "保留即可", cleanupText: i => i.join("\n") };
  const rt1 = mkRt();
  cleanupStep(rt1, mkS(), d);
  assert.deepEqual(rt1.notes, []);
  const rt2 = mkRt({ started: [{ id: "T8", restores: true }] });
  cleanupStep(rt2, mkS({ args: { autoOnly: false }, signalName: "SIGINT" }), d);
  assert.equal(rt2.notes[0], "保留即可");
  assert.match(rt2.notes[1], /需要恢复的测试浏览器设置/);
  assert.match(rt2.notes[2], /重新启用扩展/);
});

test("fillResults: 已有结果保留，其余补成 skip", () => {
  const steps = [{ id: "A", title: "a", kind: "auto" }, { id: "B", title: "b", kind: "xauto" }];
  const r = fillResults(steps, [{ id: "A", status: "pass" }], "未执行（强制退出）");
  assert.deepEqual(r.map(x => [x.id, x.status]), [["A", "pass"], ["B", "skip"]]);
  assert.equal(r[1].detail, "未执行（强制退出）");
});

function withOut(fn) {
  const d = mkdtempSync(join(tmpdir(), "e2e-td-"));
  return Promise.resolve(fn(d)).finally(() => rmSync(d, { recursive: true, force: true }));
}

test("writePartialReportSync: 同步写出部分报告（含备注），已写过就不再写", () => withOut(dir => {
  const rt = mkRt();
  const s = mkS({ snapshotTaken: true, signalName: "SIGINT", steps: [{ id: "A", title: "a", kind: "auto" }, { id: "B", title: "b", kind: "auto" }],
    partial: [{ id: "A", title: "a", kind: "auto", status: "pass", detail: "", durationMs: 1 }] });
  const base = writePartialReportSync(rt, s, { outDir: dir });
  assert.ok(base);
  const json = JSON.parse(readFileSync(`${base}.json`, "utf8"));
  assert.deepEqual(json.results.map(r => [r.id, r.status]), [["A", "pass"], ["B", "skip"]]);
  assert.match(json.notes.join("\n"), /强制退出/);
  assert.equal(writePartialReportSync(rt, s, { outDir: dir }), null);
  assert.equal(readdirSync(dir).length, 2);
}));

test("teardown: 顺序为 storage → 网站搜索 → 关浏览器 → 报告；中断时写“报告不完整”", () => withOut(async dir => {
  const order = [];
  const rt = mkRt({ browser: { close: async o => { order.push(`close:${o.graceful}`); return { graceful: true }; } } });
  const s = mkS({ snapshotTaken: true, signalName: "SIGINT", storage: { before: "a" }, steps: [{ id: "A", title: "a", kind: "auto" }] });
  await teardown(rt, s, {
    ext: { SNAPSHOT_FILE: "/x", restoreStorage: async () => { order.push("storage"); return { digest: "a", equal: true }; } },
    extAlive: async () => true,
    se: { SE_SNAPSHOT_FILE: SE_FILE, restore: async () => { order.push("se"); return { defaultKeyword: "google.com", defaultChanged: true, removed: [], warning: null }; },
      dropSnapshot: () => order.push("drop") },
    exists: () => true, cleanupItems: () => [], cleanupNote: () => null, cleanupText: () => "", outDir: dir,
  });
  assert.deepEqual(order, ["storage", "se", "close:true", "drop"]);
  assert.equal(s.reportWritten, true);
  assert.deepEqual(s.results.map(r => r.status), ["skip"]);
  assert.match(rt.notes.join("\n"), /SIGINT 中断，报告不完整/);
}));

test("closeStep: 关闭浏览器后处理仍按着的鼠标键，结果写进备注", async () => {
  const rt = mkRt();
  await closeStep(rt, mkS(), { se: {}, afterClose: async () => "released" });
  assert.match(rt.notes[0], /已在浏览器关闭后.*松开/);
  const rt2 = mkRt();
  await closeStep(rt2, mkS(), { se: {}, afterClose: async () => "stuck" });
  assert.match(rt2.notes[0], /可能仍按着/);
  const rt3 = mkRt();
  await closeStep(rt3, mkS(), { se: {}, afterClose: async () => "none" });
  assert.deepEqual(rt3.notes, []);
});
