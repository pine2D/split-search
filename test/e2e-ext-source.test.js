import { test } from "node:test";
import assert from "node:assert/strict";
import { loadedFrom, sameDir, useSourceDir, verifySourceDir } from "../scripts/e2e/ext-source.mjs";

const ID = "alngkkgnobglnfbhcplhpaflcgfiajnj";
const MAIN = "/home/u/projects/split-search/src";
const WT = "/home/u/projects/split-search.worktrees/v0.2/src";

// 假 CDP：记录调用；getExtensions 返回 list()，loadUnpacked 返回 loadId 并把本扩展的路径改成传入的目录
function fakeBrowser({ list = [{ id: ID, path: MAIN, enabled: true }], loadId = ID, loadError = null } = {}) {
  const calls = [];
  let exts = list.map(e => ({ ...e }));
  const send = async (method, params = {}) => {
    calls.push([method, params]);
    if (method === "Extensions.getExtensions") return { extensions: exts.map(e => ({ ...e })) };
    if (method === "Extensions.loadUnpacked") {
      if (loadError) throw new Error(loadError);
      const e = exts.find(x => x.id === loadId);
      if (e) e.path = params.path; else exts.push({ id: loadId, path: params.path, enabled: true });
      return { id: loadId };
    }
    if (method === "Extensions.uninstall") { exts = exts.filter(x => x.id !== params.id); return {}; }
    throw new Error(`unexpected ${method}`);
  };
  return { browser: { client: { send } }, calls, methods: () => calls.map(c => c[0]) };
}

test("loadedFrom：按 id 取已解压扩展的路径，没有返回 null", () => {
  assert.equal(loadedFrom([{ id: "x", path: "/a" }, { id: ID, path: MAIN }], ID), MAIN);
  assert.equal(loadedFrom([{ id: "x", path: "/a" }], ID), null);
  assert.equal(loadedFrom(undefined, ID), null);
});

test("sameDir：规范化后比较，末尾斜杠与 .. 不影响；非字符串一律不同", () => {
  assert.equal(sameDir(`${MAIN}/`, MAIN), true);
  assert.equal(sameDir("/home/u/projects/split-search/x/../src", MAIN), true);
  assert.equal(sameDir(WT, MAIN), false);
  assert.equal(sameDir(null, MAIN), false);
  assert.equal(sameDir(MAIN, undefined), false);
});

test("useSourceDir：已经装自本检出的 src/ 就什么都不做", async () => {
  const f = fakeBrowser({ list: [{ id: ID, path: WT, enabled: true }] });
  assert.deepEqual(await useSourceDir(f.browser, { srcDir: WT, id: ID }), { ok: true, switched: false, from: WT });
  assert.deepEqual(f.methods(), ["Extensions.getExtensions"]);
});

test("useSourceDir：装自别的检出时用 Extensions.loadUnpacked 改为本检出的 src/", async () => {
  const f = fakeBrowser();
  assert.deepEqual(await useSourceDir(f.browser, { srcDir: WT, id: ID }), { ok: true, switched: true, from: MAIN });
  assert.deepEqual(f.calls[1], ["Extensions.loadUnpacked", { path: WT }]);
  assert.equal(f.methods().includes("Extensions.uninstall"), false);
});

test("useSourceDir：本检出的 manifest key 不对（得到别的 id）时卸掉新装的那个，返回 wrong-id", async () => {
  const f = fakeBrowser({ loadId: "otherid" });
  assert.deepEqual(await useSourceDir(f.browser, { srcDir: WT, id: ID }), { ok: false, reason: "wrong-id", ids: ["otherid"] });
  assert.deepEqual(f.calls.at(-1), ["Extensions.uninstall", { id: "otherid" }]);
});

test("useSourceDir：得到的别的 id 在加载前就已存在时不卸载（不是本次装的）", async () => {
  const f = fakeBrowser({ list: [{ id: ID, path: MAIN }, { id: "otherid", path: "/elsewhere" }], loadId: "otherid" });
  assert.deepEqual(await useSourceDir(f.browser, { srcDir: WT, id: ID }), { ok: false, reason: "wrong-id", ids: ["otherid"] });
  assert.equal(f.methods().includes("Extensions.uninstall"), false);
});

test("useSourceDir：loadUnpacked 报错时抛出带目录的错误", async () => {
  const f = fakeBrowser({ loadError: "Manifest file is missing or unreadable" });
  await assert.rejects(useSourceDir(f.browser, { srcDir: WT, id: ID }), e => e.message.includes(WT) && e.message.includes("Manifest file"));
});

test("verifySourceDir：装载路径与 srcDir 一致时返回路径，不一致时抛出", async () => {
  assert.equal(await verifySourceDir(fakeBrowser({ list: [{ id: ID, path: WT }] }).browser, { srcDir: WT, id: ID }), WT);
  await assert.rejects(verifySourceDir(fakeBrowser().browser, { srcDir: WT, id: ID }), e => e.message.includes(MAIN) && e.message.includes(WT));
  await assert.rejects(verifySourceDir(fakeBrowser({ list: [] }).browser, { srcDir: WT, id: ID }), /没有/);
});

// ---- 状态文件、switchSource、restoreHome ----
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSourceState, writeSourceState, switchSource, restoreHome } from "../scripts/e2e/ext-source.mjs";

const stateFile = () => join(mkdtempSync(join(tmpdir(), "ext-source-")), "sub", "ext-source.json");
const readJson = f => JSON.parse(readFileSync(f, "utf8"));

test("readSourceState / writeSourceState：没有文件或内容不对按空状态；全空时删文件", () => {
  const f = stateFile();
  assert.deepEqual(readSourceState(f), { home: null, switching: false });
  writeSourceState(f, { home: MAIN, switching: true });
  assert.deepEqual(readSourceState(f), { home: MAIN, switching: true });
  writeSourceState(f, { home: null, switching: false });
  assert.equal(existsSync(f), false);
  writeFileSync(join(f, "..", "bad.json"), "{oops");
  assert.deepEqual(readSourceState(join(f, "..", "bad.json")), { home: null, switching: false });
});

test("switchSource：改装时先记 switching，reload 时状态文件里 switching 为真，完成后清掉并记下 home", async () => {
  const f = stateFile(), fb = fakeBrowser();
  let during = null;
  const r = await switchSource(fb.browser, { srcDir: WT, file: f, id: ID, reload: async () => { during = readJson(f); } });
  assert.deepEqual(r, { ok: true, switched: true, from: MAIN });
  assert.deepEqual(during, { home: MAIN, switching: true });
  assert.deepEqual(readJson(f), { home: MAIN, switching: false });
});

test("switchSource：reload 抛错时原样抛出，switching 留在状态文件里", async () => {
  const f = stateFile(), fb = fakeBrowser();
  await assert.rejects(switchSource(fb.browser, { srcDir: WT, file: f, id: ID, reload: async () => { throw new Error("boom"); } }), /boom/);
  assert.deepEqual(readJson(f), { home: MAIN, switching: true });
});

test("switchSource：已经装自本检出时不 reload；上次没改回的 home 沿用，switching 清掉", async () => {
  const f = stateFile();
  writeSourceState(f, { home: MAIN, switching: true });
  let reloads = 0;
  const r = await switchSource(fakeBrowser({ list: [{ id: ID, path: WT }] }).browser, { srcDir: WT, file: f, id: ID, reload: async () => { reloads++; } });
  assert.equal(r.switched, false);
  assert.equal(reloads, 0);
  assert.deepEqual(readJson(f), { home: MAIN, switching: false });
});

test("switchSource：本来就装自本检出且没有旧状态时不写状态文件", async () => {
  const f = stateFile();
  await switchSource(fakeBrowser({ list: [{ id: ID, path: WT }] }).browser, { srcDir: WT, file: f, id: ID, reload: async () => {} });
  assert.equal(existsSync(f), false);
});

test("switchSource：wrong-id 时不 reload，状态文件回到原样", async () => {
  const f = stateFile();
  let reloads = 0;
  const r = await switchSource(fakeBrowser({ loadId: "otherid" }).browser, { srcDir: WT, file: f, id: ID, reload: async () => { reloads++; } });
  assert.equal(r.reason, "wrong-id");
  assert.equal(reloads, 0);
  assert.equal(existsSync(f), false);
});

test("restoreHome：改回 home、reload、核对后删状态文件", async () => {
  const f = stateFile(), fb = fakeBrowser({ list: [{ id: ID, path: WT }] });
  writeSourceState(f, { home: MAIN, switching: false });
  let during = null;
  const r = await restoreHome(fb.browser, { file: f, id: ID, exists: () => true, reload: async () => { during = readJson(f); } });
  assert.deepEqual(r, { restored: true, home: MAIN });
  assert.deepEqual(during, { home: MAIN, switching: true });
  assert.deepEqual(fb.calls.find(c => c[0] === "Extensions.loadUnpacked"), ["Extensions.loadUnpacked", { path: MAIN }]);
  assert.equal(existsSync(f), false);
});

test("restoreHome：没有 home 什么都不做；home 目录已不存在时丢掉状态", async () => {
  const fb = fakeBrowser({ list: [{ id: ID, path: WT }] });
  assert.deepEqual(await restoreHome(fb.browser, { file: stateFile(), id: ID, reload: async () => {} }), { restored: false });
  const f = stateFile();
  writeSourceState(f, { home: "/gone/src", switching: false });
  assert.deepEqual(await restoreHome(fb.browser, { file: f, id: ID, exists: () => false, reload: async () => {} }), { restored: false, missing: "/gone/src" });
  assert.equal(existsSync(f), false);
  assert.deepEqual(fb.methods(), []);
});

test("restoreHome：reload 失败时抛出，状态文件保留 home 与 switching", async () => {
  const f = stateFile();
  writeSourceState(f, { home: MAIN, switching: false });
  await assert.rejects(restoreHome(fakeBrowser({ list: [{ id: ID, path: WT }] }).browser,
    { file: f, id: ID, exists: () => true, reload: async () => { throw new Error("boom"); } }), /boom/);
  assert.deepEqual(readJson(f), { home: MAIN, switching: true });
});

test("restoreHome：本扩展不在已解压列表里时抛出，不 loadUnpacked（不凭空装临时扩展）", async () => {
  const f = stateFile(), fb = fakeBrowser({ list: [] });
  writeSourceState(f, { home: MAIN, switching: false });
  await assert.rejects(restoreHome(fb.browser, { file: f, id: ID, exists: () => true, reload: async () => {} }), /没有/);
  assert.equal(fb.methods().includes("Extensions.loadUnpacked"), false);
  assert.deepEqual(readJson(f), { home: MAIN, switching: false });
});
