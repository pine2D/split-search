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
