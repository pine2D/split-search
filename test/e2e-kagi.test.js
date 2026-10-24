// T12 自动化：Kagi 条目的 _ss 改写、条目挑选、设默认与快照恢复；Kagi 登录闸门；Kagi ｜ Bing 分屏判定；截图参数校验
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSs, hasSs, pickKagi, useKagi, KAGI_SS } from "../scripts/e2e/settings-kagi.mjs";
import { restore, makeDefault } from "../scripts/e2e/settings-se.mjs";
import { kagiGate } from "../scripts/e2e/steps/setup.mjs";
import { kagiBingPair, T12 } from "../scripts/e2e/steps/xauto-t12.mjs";
import { createXinput } from "../scripts/e2e/xinput.mjs";

test("withSs: 追加或改写 _ss，保留 %s、其他参数与 # 片段", () => {
  assert.equal(withSs("https://kagi.com/search?q=%s", KAGI_SS), "https://kagi.com/search?q=%s&_ss=kagi,bing");
  assert.equal(withSs("https://kagi.com/search?token=T&q=%s", KAGI_SS), "https://kagi.com/search?token=T&q=%s&_ss=kagi,bing");
  assert.equal(withSs("https://kagi.com/search?q=%s&_ss=kagi,google&x=1", KAGI_SS), "https://kagi.com/search?q=%s&_ss=kagi,bing&x=1");
  assert.equal(withSs("https://kagi.com/search?_ss=a&q=%s", KAGI_SS), "https://kagi.com/search?_ss=kagi,bing&q=%s");
  assert.equal(withSs("https://kagi.com/s/%s", KAGI_SS), "https://kagi.com/s/%s?_ss=kagi,bing");
  assert.equal(withSs("https://kagi.com/search?q=%s#frag", KAGI_SS), "https://kagi.com/search?q=%s&_ss=kagi,bing#frag");
  assert.equal(withSs("https://kagi.com/search?q=%s&x_ss=1", KAGI_SS), "https://kagi.com/search?q=%s&x_ss=1&_ss=kagi,bing");
});

test("hasSs: 认 _ss=kagi,bing 与 %2C，不认别的值或前缀相同的参数", () => {
  for (const u of ["https://kagi.com/search?q=%s&_ss=kagi,bing", "https://kagi.com/search?_ss=kagi%2Cbing&q=%s", "https://kagi.com/search?q=%s&_ss=kagi,bing#f"]) {
    assert.equal(hasSs(u, KAGI_SS), true, u);
  }
  for (const u of ["https://kagi.com/search?q=%s", "https://kagi.com/search?q=%s&_ss=kagi,google", "https://kagi.com/search?q=%s&_ss=kagi,bingo", "https://kagi.com/search?q=%s&x_ss=kagi,bing"]) {
    assert.equal(hasSs(u, KAGI_SS), false, u);
  }
  // 注入页面执行：源码里不能引用外部名字
  assert.equal(new Function(`return (${withSs.toString()})("https://k/?q=%s", "a,b")`)(), "https://k/?q=%s&_ss=a,b");
  assert.equal(new Function(`return (${hasSs.toString()})("https://k/?_ss=a%2Cb", "a,b")`)(), true);
});

test("pickKagi: 快捷字词 kagi.com 优先；唯一候选可用；多个认不出、在未使用组里、没有都抛 missing", () => {
  const e = (keyword, group = "actives") => ({ id: keyword.length, keyword, name: "Kagi", group });
  assert.equal(pickKagi([e("kg"), e("kagi.com", "defaults")]).keyword, "kagi.com");
  assert.equal(pickKagi([e("kgx"), e("sse2e-kagi")]).keyword, "kgx");
  for (const list of [[], [e("kg"), e("kgx")], [e("kagi.com", "others")], [e("sse2e-kagi")]]) {
    assert.throws(() => pickKagi(list), err => err.kind === "missing", JSON.stringify(list));
  }
});

// 假页面：条目带 ss 标志（真实页面里网址不出页面），list() 是 settings-se 的读回形状
function fakePage(entries) {
  const calls = [];
  const page = {
    list: async () => entries.map(x => ({ ...x })),
    kagiList: async () => entries.filter(x => x.kagi).map(({ id, keyword, name, group, default: d, ss }) => ({ id, keyword, name, group, default: d, ss })),
    editSs: async id => { calls.push(`editSs:${id}`); entries.find(x => x.id === id).ss = true; },
    rowAction: async (id, a) => { calls.push(`${a}:${id}`); if (a === "makeDefault") for (const x of entries) x.default = x.id === id; else entries.splice(entries.findIndex(x => x.id === id), 1); },
    close: async () => {},
  };
  return { page, calls, entries, open: async () => page };
}
const base = () => [
  { id: 2, keyword: "google.com", name: "Google", group: "defaults", default: true, prepopulated: true },
  { id: 15, keyword: "kagi.com", name: "Kagi", group: "actives", default: false, kagi: true, ss: false },
];
async function withFile(fn) {
  const d = mkdtempSync(join(tmpdir(), "e2e-kagi-"));
  try { return await fn(join(d, "settings-snapshot.json")); } finally { rmSync(d, { recursive: true, force: true }); }
}

test("useKagi: 追加 _ss、设为默认、记进 scriptDefaults；收尾 restore 改回运行前的默认", () => withFile(async file => {
  const f = fakePage(base());
  const o = { open: f.open, file, intervalMs: 1, timeoutMs: 50 };
  assert.deepEqual(await useKagi(null, o), { keyword: "kagi.com", edited: true, madeDefault: true });
  assert.deepEqual(f.calls, ["editSs:15", "makeDefault:15"]);
  const snap = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual([snap.defaultKeyword, snap.scriptDefaults], ["google.com", ["kagi.com"]]);
  assert.doesNotMatch(readFileSync(file, "utf8"), /https?:/);
  // 再来一次：都已就绪，不再改
  f.calls.length = 0;
  assert.deepEqual(await useKagi(null, o), { keyword: "kagi.com", edited: false, madeDefault: false });
  assert.deepEqual(f.calls, []);
  const r = await restore(null, o);
  assert.deepEqual([r.defaultKeyword, r.defaultChanged], ["google.com", true]);
  assert.equal(f.entries.find(x => x.default).keyword, "google.com");
  assert.equal(existsSync(file), false);
}));

test("useKagi 之后 T14 把默认切到专用条目：不把 Kagi 当成“要恢复的默认”", () => withFile(async file => {
  const f = fakePage([...base(), { id: 30, keyword: "sse2e-bing", name: "sse2e-bing", group: "actives", default: false }]);
  const o = { open: f.open, file, intervalMs: 1, timeoutMs: 50 };
  await useKagi(null, o);
  await makeDefault(null, "sse2e-bing", o);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).defaultKeyword, "google.com");
  const r = await restore(null, o);
  assert.equal(r.defaultKeyword, "google.com");
}));

test("Kagi 运行前就是默认：useKagi 不切换，restore 也不动它", () => withFile(async file => {
  const f = fakePage([{ ...base()[0], default: false }, { ...base()[1], default: true, ss: true }]);
  const o = { open: f.open, file, intervalMs: 1, timeoutMs: 50 };
  assert.deepEqual(await useKagi(null, o), { keyword: "kagi.com", edited: false, madeDefault: false });
  const r = await restore(null, o);
  assert.deepEqual([r.defaultKeyword, r.defaultChanged], ["kagi.com", false]);
}));

test("kagiGate: --auto-only 只探测一次、没登录判跳过；引导式交给 ensureKagi", async () => {
  let probes = 0, ensures = 0;
  const probe = async () => { probes++; return "https://account.kagi.com/loginname?x=1"; };
  const ensure = async () => { ensures++; return null; };
  const r = await kagiGate({ autoOnly: true }, { probe, ensure });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /Kagi 未登录.*--auto-only 不等登录/);
  assert.equal(await kagiGate({ autoOnly: true }, { probe: async () => "https://kagi.com/settings?p=1", ensure }), null);
  assert.equal(await kagiGate({}, { probe, ensure }), null);
  assert.deepEqual([probes, ensures], [1, 1]);
  assert.equal((await kagiGate({ autoOnly: true }, { probe: async () => { throw new Error("断网"); }, ensure })).status, "skip");
});

test("kagiBingPair: 左 kagi.com/search、右 Bing，两侧关键词一致", () => {
  const tab = (id, index, url) => ({ id, index, windowId: 1, splitViewId: 7, url });
  const st = { tabs: [tab(1, 0, "https://kagi.com/search?q=xkagi+ab12"), tab(2, 1, "https://www.bing.com/search?q=xkagi%20ab12")] };
  assert.ok(kagiBingPair(st, "xkagi ab12"));
  assert.equal(kagiBingPair(st, "xkagi zz"), undefined);
  assert.equal(kagiBingPair({ tabs: [tab(1, 0, "https://kagi.com/turnstile?q=xkagi+ab12"), st.tabs[1]] }, "xkagi ab12"), undefined);
});

test("T12 是 xauto，回退是人工 judge 版本（需要 Kagi）", () => {
  assert.equal(T12.kind, "xauto");
  assert.equal(T12.fallback.kind, "judge");
  assert.ok(T12.fallback.needs.includes("kagi"));
});

test("capturePng: 只接受窗口 id 或 root、.png 文件名，参数逐个传给 import", async () => {
  const calls = [];
  const xi = createXinput({ exec: async (cmd, args) => { calls.push([cmd, ...args]); return ""; } });
  await xi.capturePng("root", "/tmp/a.png");
  await xi.capturePng("123", "/tmp/b.png");
  assert.deepEqual(calls, [["import", "-silent", "-window", "root", "/tmp/a.png"], ["import", "-silent", "-window", "123", "/tmp/b.png"]]);
  await assert.rejects(xi.capturePng("0x1; rm", "/tmp/a.png"), /窗口 id/);
  await assert.rejects(xi.capturePng("root", "/tmp/a.jpg"), /文件名/);
  await assert.rejects(xi.capturePng("root", "-x.png"), /文件名/);
});
