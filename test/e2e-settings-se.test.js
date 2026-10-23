import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PREFIX, isOurs, snapshot, ensure, makeDefault, remove, restore, restorePending, bindSettings,
} from "../scripts/e2e/settings-se.mjs";

const KAGI_URL = "https://kagi.com/search?token=SECRET123abc&q=%s";
const MOCK = { keyword: "sse2e", name: "sse2e 模拟 A|B", url: "http://engine-a.localhost:8765/search?q=%s&_ss=ea,eb" };

// 假 settings 页：在内存里模拟条目列表（list 按真实页面的读回形状返回，含 Kagi 的私有网址）
function fakeSettings(initial, { failMakeDefault = false, ignoreAdd = false } = {}) {
  let entries = structuredClone(initial);
  let nextId = 100;
  const calls = [];
  const page = {
    list: async () => { calls.push("list"); return structuredClone(entries); },
    add: async e => { calls.push(`add:${e.keyword}`); if (!ignoreAdd) entries.push({ id: nextId++, ...e, default: false }); },
    edit: async (id, e) => { calls.push(`edit:${id}`); Object.assign(entries.find(x => x.id === id), e); },
    rowAction: async (id, action) => {
      calls.push(`${action}:${id}`);
      if (action === "makeDefault") {
        if (failMakeDefault) throw new Error("点不到设为默认");
        for (const x of entries) x.default = x.id === id;
      } else if (action === "delete") entries = entries.filter(x => x.id !== id);
    },
    close: async () => { calls.push("close"); },
  };
  return { calls, page, get entries() { return entries; }, open: async () => page };
}
const base = () => [
  { id: 2, name: "Google", keyword: "google.com", url: "https://www.google.com/search?q=%s", default: true },
  { id: 15, name: "Kagi", keyword: "kagi.com", url: KAGI_URL, default: false },
  { id: 16, name: "gb", keyword: "gb", url: "https://www.google.com/search?q=%s&_ss=google,bing", default: false },
];
function withDir(fn) {
  const d = mkdtempSync(join(tmpdir(), "e2e-se-"));
  return Promise.resolve(fn(join(d, "settings-snapshot.json"))).finally(() => rmSync(d, { recursive: true, force: true }));
}
const opts = (f, file) => ({ open: f.open, file, intervalMs: 1, timeoutMs: 50 });

test("isOurs: 只认 sse2e 前缀", () => {
  assert.equal(PREFIX, "sse2e");
  assert.equal(isOurs("sse2e"), true);
  assert.equal(isOurs("sse2e-kagi"), true);
  for (const k of ["gb", "kagi.com", "google.com", "xsse2e", "", null]) assert.equal(isOurs(k), false);
});

test("remove: 拒绝非 sse2e 前缀，且不碰页面", () => withDir(async file => {
  const f = fakeSettings(base());
  for (const k of ["gb", "kagi.com", "google.com"]) await assert.rejects(remove(null, k, opts(f, file)), /sse2e/);
  assert.deepEqual(f.calls, []);
  assert.equal(f.entries.length, 3);
}));

test("remove: 默认引擎是专用条目时拒绝删除；否则删除并读回确认", () => withDir(async file => {
  const f = fakeSettings([...base().map(e => ({ ...e, default: false })), { id: 9, ...MOCK, default: true }]);
  await assert.rejects(remove(null, "sse2e", opts(f, file)), /默认/);
  f.entries.find(e => e.id === 2).default = true;
  f.entries.find(e => e.id === 9).default = false;
  assert.equal(await remove(null, "sse2e", opts(f, file)), true);
  assert.equal(f.entries.some(e => e.keyword === "sse2e"), false);
  assert.equal(await remove(null, "sse2e", opts(f, file)), false);
}));

test("snapshot: 只记默认引擎的 keyword/name 与专用条目，不含任何网址；已有快照时拒绝覆盖", () => withDir(async file => {
  const f = fakeSettings([...base(), { id: 9, ...MOCK, default: false }]);
  const s = await snapshot(null, opts(f, file));
  assert.deepEqual(s, { defaultKeyword: "google.com", defaultName: "Google", ours: ["sse2e"] });
  const text = readFileSync(file, "utf8");
  assert.doesNotMatch(text, /token=|SECRET123|https?:/);
  assert.deepEqual(JSON.parse(text), s);
  await assert.rejects(snapshot(null, opts(f, file)), /已存在/);
}));

test("snapshot: 当前默认是专用条目时拒绝（无法确定运行前的默认引擎）", () => withDir(async file => {
  const f = fakeSettings([...base().map(e => ({ ...e, default: false })), { id: 9, ...MOCK, default: true }]);
  await assert.rejects(snapshot(null, opts(f, file)), /专用/);
  assert.equal(existsSync(file), false);
}));

test("ensure: 拒绝非 sse2e 前缀；不存在则新增，网址一致则跳过（幂等），不一致则改正", () => withDir(async file => {
  const f = fakeSettings(base());
  await assert.rejects(ensure(null, { ...MOCK, keyword: "gb" }, opts(f, file)), /sse2e/);
  assert.equal(await ensure(null, MOCK, opts(f, file)), "added");
  assert.equal(await ensure(null, MOCK, opts(f, file)), "unchanged");
  assert.equal(f.calls.filter(c => c.startsWith("add") || c.startsWith("edit")).length, 1);
  assert.equal(f.entries.filter(e => e.keyword === "sse2e").length, 1);
  const url2 = MOCK.url.replace("ea,eb", "eb,ea");
  assert.equal(await ensure(null, { ...MOCK, url: url2 }, opts(f, file)), "updated");
  assert.equal(f.entries.find(e => e.keyword === "sse2e").url, url2);
  // 用户条目原样不动
  assert.deepEqual(f.entries.filter(e => !isOurs(e.keyword)), base());
}));

test("ensure: 页面没有真正加上条目时报错", () => withDir(async file => {
  const f = fakeSettings(base(), { ignoreAdd: true });
  await assert.rejects(ensure(null, MOCK, opts(f, file)), /读回/);
}));

test("ensure: 已有快照时把新建的快捷字词记进 ours", () => withDir(async file => {
  const f = fakeSettings(base());
  await snapshot(null, opts(f, file));
  await ensure(null, MOCK, opts(f, file));
  await ensure(null, { ...MOCK, keyword: "sse2e-r", name: "sse2e-r" }, opts(f, file));
  await ensure(null, MOCK, opts(f, file));
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).ours, ["sse2e", "sse2e-r"]);
}));

test("makeDefault + restore: 默认改回运行前的条目、删除全部专用条目、成功后才删快照", () => withDir(async file => {
  const f = fakeSettings(base());
  await snapshot(null, opts(f, file));
  await ensure(null, MOCK, opts(f, file));
  await makeDefault(null, "sse2e", opts(f, file));
  assert.equal(f.entries.find(e => e.default).keyword, "sse2e");
  const r = await restore(null, opts(f, file));
  assert.deepEqual(r, { defaultKeyword: "google.com", removed: ["sse2e"] });
  assert.deepEqual(f.entries, base());
  assert.equal(existsSync(file), false);
  // 设默认在删除之前（默认引擎删不掉）
  const acts = f.calls.filter(c => /^(makeDefault|delete):/.test(c));
  assert.deepEqual(acts, ["makeDefault:100", "makeDefault:2", "delete:100"]);
}));

test("makeDefault: 读回不是目标时报错", () => withDir(async file => {
  const f = fakeSettings([...base(), { id: 9, ...MOCK, default: false }], { failMakeDefault: true });
  await assert.rejects(makeDefault(null, "sse2e", opts(f, file)), /设为默认/);
  await assert.rejects(makeDefault(null, "nope", opts(f, file)), /找不到/);
}));

test("restorePending: 无快照返回 false 且不开页面；有遗留快照时先恢复再删文件", () => withDir(async file => {
  const f = fakeSettings([...base().map(e => ({ ...e, default: false })), { id: 9, ...MOCK, default: true }]);
  assert.equal(await restorePending(null, opts(f, file)), false);
  assert.deepEqual(f.calls, []);
  writeFileSync(file, JSON.stringify({ defaultKeyword: "google.com", defaultName: "Google", ours: ["sse2e"] }));
  const page = f.page, seen = [];
  for (const k of ["rowAction", "list"]) {
    const orig = page[k];
    page[k] = async (...a) => { seen.push(existsSync(file)); return orig(...a); };
  }
  assert.equal(await restorePending(null, opts(f, file)), true);
  assert.ok(seen.length > 0 && seen.every(Boolean), "恢复过程中快照文件一直在");
  assert.equal(existsSync(file), false);
  assert.deepEqual(f.entries, base());
}));

test("restorePending: 恢复失败时保留快照文件", () => withDir(async file => {
  const f = fakeSettings([...base().map(e => ({ ...e, default: false })), { id: 9, ...MOCK, default: true }], { failMakeDefault: true });
  writeFileSync(file, JSON.stringify({ defaultKeyword: "google.com", defaultName: "Google", ours: ["sse2e"] }));
  await assert.rejects(restorePending(null, opts(f, file)), /设为默认/);
  assert.equal(existsSync(file), true);
  assert.equal(f.entries.some(e => e.keyword === "sse2e"), true, "默认没改回之前不删条目");
}));

test("restore: 运行前的默认引擎不见了时报错并保留快照", () => withDir(async file => {
  const f = fakeSettings(base().filter(e => e.id !== 2).concat({ id: 9, ...MOCK, default: true }));
  writeFileSync(file, JSON.stringify({ defaultKeyword: "google.com", defaultName: "Google", ours: ["sse2e"] }));
  await assert.rejects(restore(null, opts(f, file)), /找不到/);
  assert.equal(existsSync(file), true);
}));

test("bindSettings: ensure 前自动快照；每次调用都关闭页面", () => withDir(async file => {
  const f = fakeSettings(base());
  const se = bindSettings(() => null, opts(f, file));
  await se.ensure(MOCK);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { defaultKeyword: "google.com", defaultName: "Google", ours: ["sse2e"] });
  await se.makeDefault("sse2e");
  await se.restore();
  assert.equal(existsSync(file), false);
  assert.equal(f.calls.filter(c => c === "close").length, 4);
}));
