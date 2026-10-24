// Task 5 补充：T14 预期降级（degrade）、Perplexity 普通左侧搜索的认定、指针被拉回真实光标、混合子项的“未覆盖”
import { test } from "node:test";
import assert from "node:assert/strict";
import { carriesQuery, plainEvidence, findPlain, plainTracker, t14Verdict, goCarries, tabChains, strayRight, takeoverEvidence } from "../scripts/e2e/steps/sw.mjs";
import { summarize } from "../scripts/e2e/steps/util.mjs";
import { withAttempts } from "../scripts/e2e/steps/xauto-lib.mjs";
import { moveTo, snap, snapBack, REASON_SNAP, gestureError } from "../scripts/e2e/gesture.mjs";
import { runSteps, startCard } from "../scripts/e2e/runner.mjs";
import { renderReport } from "../scripts/e2e/report.mjs";
import { exitCodeOf, writeReport } from "../scripts/e2e/teardown.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PX = "www.perplexity.ai";
const ctx0 = () => ({ gx: { stop: null, xi: {}, sleep: async () => {} }, log: () => {} });

// ---- (d) 普通左侧搜索：不要求 _ss 留在网址里 ----
test("carriesQuery: 原文、+ 还原空格、百分号解码任一处包含都算；空值不算", () => {
  assert.ok(carriesQuery("https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd", "xleft perplexity ab12cd"));
  assert.ok(carriesQuery("https://x/s?q=%E5%B7%A6%E4%BE%A7%20Bing", "左侧 Bing"));
  assert.ok(carriesQuery("xleft perplexity ab12cd - Perplexity", "xleft perplexity ab12cd"));
  assert.ok(carriesQuery("https://x/?q=100%", "100%"), "解码失败时退回原文");
  assert.equal(carriesQuery("https://www.perplexity.ai/search/new-thread-abc", "xleft perplexity ab12cd"), false);
  assert.equal(carriesQuery(undefined, "x"), false);
  assert.equal(carriesQuery("x", ""), false);
});

test("plainEvidence: Perplexity 的 SPA 把网址改写成 /search/<slug>、丢掉 _ss——标题或它自己的跳转链带查询词仍认得出", () => {
  const text = "xleft perplexity ab12cd";
  const tab = { id: 9, url: "https://www.perplexity.ai/search/xleft-ab12cd-Zx9", title: "Perplexity", splitViewId: -1 };
  assert.equal(plainEvidence(tab, { host: PX, text }), null, "网址、标题都没有查询词、也没有跳转链");
  assert.equal(plainEvidence({ ...tab, title: `${text} - Perplexity` }, { host: PX, text }), "标题带查询词");
  const trig = "https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd&_ss=perplexity,google";
  assert.equal(plainEvidence(tab, { host: PX, text, chain: [trig, tab.url] }), "跳转链经过触发网址");
  // 跳转链里只有别的查询（上一次尝试的 nonce）、或者没有 _ss 的网址，不算
  assert.equal(plainEvidence(tab, { host: PX, text, chain: [trig.replace("ab12cd", "zz99zz")] }), null);
  assert.equal(plainEvidence(tab, { host: PX, text, chain: ["https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd"] }), null);
  assert.equal(plainEvidence({ ...tab, url: "https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd" }, { host: PX, text }), "网址带查询词");
  assert.equal(plainEvidence({ ...tab, url: trig }, { host: PX, text }), "网址带查询词");
});

test("plainEvidence: 别的 host、在分屏里的标签都不算", () => {
  const text = "xleft perplexity ab12cd";
  const url = "https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd";
  assert.equal(plainEvidence({ id: 1, url: url.replace(PX, "www.google.com"), splitViewId: -1 }, { host: PX, text }), null);
  assert.equal(plainEvidence({ id: 1, url, splitViewId: 4 }, { host: PX, text }), null);
  assert.equal(plainEvidence({ id: 1, url }, { host: PX, text }), "网址带查询词", "没有 splitViewId 视为不在分屏里");
});

test("findPlain 只看新出现的标签；plainTracker 同一个标签连续 3 秒才返回，换标签或消失就重计", () => {
  const text = "xleft perplexity ab12cd";
  const url = "https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd";
  const st = { tabs: [{ id: 1, url, splitViewId: -1 }, { id: 2, url, splitViewId: -1 }] };
  assert.equal(findPlain(st, { host: PX, text, beforeTabs: new Set([1]) }).tab.id, 2);
  assert.equal(findPlain(st, { host: PX, text, beforeTabs: new Set([1, 2]) }), null);
  let t = 0;
  const tr = plainTracker(3000, () => t);
  const hit = id => ({ tab: { id }, how: "网址带查询词" });
  assert.equal(tr.see(hit(2)), null);
  t = 2000; assert.equal(tr.see(hit(3)), null, "换了标签重新计时");
  t = 4000; assert.equal(tr.see(hit(3)), null);
  t = 5000; assert.equal(tr.see(hit(3)).tab.id, 3);
  assert.equal(tr.see(null), null);
  t = 9000; assert.equal(tr.see(hit(3)), null, "中间消失过，重新计时");
  tr.reset();
});

// ---- 扩展接管过的反证：go.js 分屏失败后 location.replace(左侧) 的形状不能算预期降级 ----
const TEXT = "xleft perplexity ab12cd";
const TRIG = "https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd&_ss=perplexity,google";
const GO = `chrome-extension://alngkkgnobglnfbhcplhpaflcgfiajnj/go.html?u=${TRIG}`; // \0 未经编码
const LEFT = "https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd"; // stripMarker 后的左侧网址
const HAS = "有（注册 https://www.perplexity.ai/）";

test("goCarries: go.html?u= 之后的原网址带这次的查询词才算；GUID 网址也认；别的查询、别的页面不算", () => {
  assert.ok(goCarries(GO, TEXT));
  assert.ok(goCarries(GO.replace("alngkkgnobglnfbhcplhpaflcgfiajnj", "6f1c2a8e-0b7d-4c55-9f3e-1d2a3b4c5d6e"), TEXT));
  assert.ok(goCarries(`chrome-extension://x/go.html?u=${encodeURI("https://x/?q=左侧 Bing 测试 ab12&_ss=bing,google")}`, "左侧 Bing 测试 ab12"));
  assert.equal(goCarries(GO.replace("ab12cd", "zz99zz"), TEXT), false);
  assert.equal(goCarries(TRIG, TEXT), false);
  assert.equal(goCarries("chrome-extension://x/options/options.html?u=" + TRIG, TEXT), false);
  assert.equal(goCarries(undefined, TEXT), false);
});

test("go.js 退回左侧的形状（引擎网址带查询词、无 _ss，链里有 go.html?u=…）：plainEvidence 不认，takeoverEvidence 有反证，t14Verdict 判 fail", () => {
  const tab = { id: 7, url: LEFT, title: "Perplexity", splitViewId: -1 };
  assert.equal(plainEvidence(tab, { host: PX, text: TEXT, chain: [TRIG, GO, LEFT] }), null, "它自己的链经过 go.html");
  assert.equal(plainEvidence(tab, { host: PX, text: TEXT, chain: [] }), "网址带查询词", "单看网址和退回左侧分不开");
  const tk = takeoverEvidence({ text: TEXT, chains: [["http://site-x.localhost:8765/start"], [TRIG, GO, LEFT]] });
  assert.match(tk, /go\.html/);
  const v = t14Verdict({ name: "Perplexity", split: false, plain: true, takeover: tk, swBefore: HAS, swAfter: HAS });
  assert.equal(v.status, "fail");
  assert.match(v.detail, /扩展接管过这次触发/);
  assert.equal(t14Verdict({ name: "Perplexity", split: false, plain: true, takeover: null, swBefore: HAS, swAfter: HAS }).status, "degrade");
});

test("takeoverEvidence: 没有收集器、触发后新增扩展控制台错误、孤立的 Google 右侧都算反证；SW 绕过时（链里只有触发网址）为 null", () => {
  assert.match(takeoverEvidence({ text: TEXT, chains: null }), /没有控制台收集器/);
  assert.match(takeoverEvidence({ text: TEXT, chains: [], errors: [{ text: "[split-search] 分屏失败，只打开左侧 Error: x" }] }), /分屏失败/);
  assert.match(takeoverEvidence({ text: TEXT, chains: [], stray: [{ id: 12 }] }), /Google 标签 12/);
  assert.equal(takeoverEvidence({ text: TEXT, chains: [[TRIG, "https://www.perplexity.ai/search/xleft-ab12cd-Zx9"]], errors: [], stray: [] }), null);
  assert.equal(takeoverEvidence({ text: TEXT, chains: [[GO.replace("ab12cd", "zz99zz")]] }), null, "上一次尝试的 go.html 不算");
});

test("strayRight 只要新出现的、不在分屏里的 Google 标签；tabChains 按网址唯一对应目标，同网址多个目标不认", () => {
  const st = { tabs: [{ id: 1, url: "https://www.google.com/search?q=a", splitViewId: -1 }, { id: 2, url: "https://www.google.com/search?q=b", splitViewId: 3 },
    { id: 4, url: "https://www.google.com/search?q=c", splitViewId: -1 }, { id: 5, url: LEFT, splitViewId: -1 }] };
  assert.deepEqual(strayRight(st, new Set([1])).map(t => t.id), [4]);
  const pages = [{ type: "page", targetId: "A", url: LEFT }, { type: "page", targetId: "B", url: "https://x/1" }, { type: "page", targetId: "C", url: "https://x/1" },
    { type: "service_worker", targetId: "S", url: "https://x/2" }];
  const chains = { A: [{ url: TRIG }, { url: LEFT }], B: [{ url: "https://x/1" }] };
  const m = tabChains([{ id: 5, url: LEFT }, { id: 6, url: "https://x/1" }, { id: 7, url: "https://x/2" }, { id: 8 }], pages, id => chains[id] ?? []);
  assert.deepEqual([...m], [[5, [TRIG, LEFT]]]);
  // findPlain 用的是候选标签自己的链：别的标签的链经过触发网址不算
  const tab = { id: 9, url: "https://www.perplexity.ai/", title: "Perplexity", splitViewId: -1 };
  assert.equal(findPlain({ tabs: [tab] }, { host: PX, text: TEXT, beforeTabs: new Set(), chains: new Map([[10, [TRIG]]]) }), null);
  assert.equal(findPlain({ tabs: [tab] }, { host: PX, text: TEXT, beforeTabs: new Set(), chains: new Map([[9, [TRIG, tab.url]]]) }).how, "跳转链经过触发网址");
});

// ---- (c) 预期降级 ----
test("t14Verdict: 预期降级必须触发前就有 SW；没检测到 SW（或只在触发后才有）仍是失败", () => {
  const HAS = "有（注册 https://www.perplexity.ai/）";
  assert.equal(t14Verdict({ name: "Perplexity", split: false, plain: true, swBefore: HAS, swAfter: HAS }).status, "degrade");
  assert.equal(t14Verdict({ name: "Perplexity", split: false, plain: true, swBefore: "无", swAfter: "无" }).status, "fail");
  assert.equal(t14Verdict({ name: "Perplexity", split: false, plain: true, swBefore: "无", swAfter: HAS }).status, "fail");
  assert.equal(t14Verdict({ name: "Perplexity", split: false, plain: false, swBefore: HAS, swAfter: HAS }).status, "fail");
});

test("withAttempts: degrade 是确定结论不重试；之前有真实失败时判失败（I2 只给通过开例外）", async () => {
  let n = 0;
  const once = await withAttempts(ctx0(), async () => { n++; return { status: "degrade", detail: "预期降级（G5）" }; });
  assert.equal(n, 1);
  assert.equal(once.status, "degrade");
  assert.match(once.detail, /^第 1 次尝试预期降级：预期降级（G5）/);
  const after = await withAttempts(ctx0(), async k => (k === 1 ? { status: "fail", detail: "30 秒内未等到分屏" } : { status: "degrade", detail: "预期降级（G5）" }));
  assert.equal(after.status, "fail");
  assert.match(after.detail, /^第 2 次尝试判为预期降级（预期降级（G5）），但之前有真实失败（之前：第 1 次 30 秒内未等到分屏）/);
  // 之前只是环境失败：仍按预期降级
  const envFirst = await withAttempts(ctx0(), async k => { if (k === 1) throw gestureError("env", "拿不到前台"); return { status: "degrade", detail: "预期降级（G5）" }; });
  assert.equal(envFirst.status, "degrade");
  // 真实失败之后只是跳过：仍判失败（I2 不变）
  const skip = await withAttempts(ctx0(), async k => { if (k === 1) return { status: "fail", detail: "坏" }; throw gestureError("skip", "光标不在测试窗口上"); });
  assert.equal(skip.status, "fail");
});

test("summarize: 有预期降级（无失败）判 degrade，计数单列；失败优先", () => {
  const items = [{ name: "Bing 作左侧", status: "pass", detail: "ok" }, { name: "Perplexity 作左侧", status: "degrade", detail: "分屏：否；SW…\n第二行" }];
  const r = summarize(items);
  assert.equal(r.status, "degrade");
  assert.equal(r.detail.split("\n")[0], "共 2 项：通过 1，跳过 0，失败 0，预期降级 1（未覆盖：Perplexity 作左侧（预期降级））");
  assert.match(r.detail, /Perplexity 作左侧：预期降级——分屏：否/);
  assert.deepEqual(r.uncovered, [{ name: "Perplexity 作左侧", status: "degrade", detail: "分屏：否；SW…" }]);
  assert.equal(summarize([...items, { name: "Kagi 作左侧", status: "fail", detail: "坏" }]).status, "fail");
});

test("runSteps: 接受 degrade 状态，终端单独标注，带上子项的 uncovered（脱敏）", async () => {
  const logs = [], results = [];
  const ctx = { browser: {}, port: 8765, abortSignal: new AbortController().signal, ext: { state: async () => ({ tabs: [], windows: [] }) },
    guide: { setProgress() {}, setResult: (id, s) => results.push([id, s]), setStep() {} }, log: m => logs.push(m) };
  const run = async () => ({ status: "degrade", detail: "共 1 项", uncovered: [{ name: "Perplexity 作左侧", status: "degrade", detail: "https://x/?token=abc" }] });
  const [r] = await runSteps([{ id: "T14", title: "各引擎", kind: "xauto", run }], ctx, { timeoutMs: 1000 });
  assert.equal(r.status, "degrade");
  assert.equal(r.uncovered[0].detail, "https://x/?token=***");
  assert.ok(logs.some(l => l.includes("预期降级")));
  assert.deepEqual(results, [["T14", "degrade"]]);
  assert.equal(r.diag, undefined, "预期降级不附诊断");
});

test("renderReport: 预期降级单独计数、显示在汇总行与表格；子项的跳过/预期降级列进“未覆盖”", () => {
  const results = [
    { id: "T2", title: "地址栏", kind: "xauto", status: "pass", detail: "共 2 项：通过 1，跳过 1，失败 0（未覆盖：(b) Alt+Enter（跳过））\n…", durationMs: 1,
      uncovered: [{ name: "(b) Alt+Enter", status: "skip", detail: "跳过：检测到用户在操作鼠标" }] },
    { id: "T14", title: "各引擎", kind: "xauto", status: "degrade", detail: "共 4 项：通过 3，跳过 0，失败 0，预期降级 1\n…", durationMs: 1,
      uncovered: [{ name: "Perplexity 作左侧", status: "degrade", detail: "分屏：否；SW 注册：触发前有 https://www.perplexity.ai/?sid=9" }] },
  ];
  const { md, json } = renderReport({ startedAt: new Date(0), args: {}, results });
  assert.deepEqual(json.summary, { total: 2, pass: 1, fail: 0, skip: 0, degrade: 1 });
  assert.match(md, /- 汇总：共 2 步，通过 1，失败 0，跳过 0，预期降级 1/);
  assert.match(md, /\| T14 各引擎 \| [^|]+ \| ↘️ 预期降级 \|/);
  assert.ok(!md.includes("失败详情"), "预期降级不进失败详情");
  const unc = md.slice(md.indexOf("## 未覆盖"));
  assert.match(unc, /- T2 \(b\) Alt\+Enter：跳过——跳过：检测到用户在操作鼠标/);
  assert.match(unc, /- T14 Perplexity 作左侧：预期降级——分屏：否；SW 注册：触发前有 https:\/\/www\.perplexity\.ai\/\?sid=\*\*\*/);
  assert.equal(json.uncoveredItems.length, 2);
  assert.equal(json.uncoveredItems[1].id, "T14");
});

test("exitCodeOf: 预期降级退出码 0；有失败 1；预期降级加失败 1；运行出错、存储没恢复也是 1", () => {
  const s = results => ({ results, storage: { equal: true } });
  const rt = {};
  assert.equal(exitCodeOf(s([{ status: "pass" }, { status: "skip" }, { status: "degrade" }]), rt, null), 0);
  assert.equal(exitCodeOf(s([{ status: "fail" }]), rt, null), 1);
  assert.equal(exitCodeOf(s([{ status: "degrade" }, { status: "fail" }]), rt, null), 1);
  assert.equal(exitCodeOf(s([{ status: "degrade" }]), rt, new Error("x")), 1);
  assert.equal(exitCodeOf({ results: [], storage: { equal: false } }, rt, null), 1);
  assert.equal(exitCodeOf(s([]), { stopReason: "按键可能卡住" }, null), 1);
});

test("writeReport: 终端汇总行带预期降级计数", () => {
  const dir = mkdtempSync(join(tmpdir(), "sse2e-report-"));
  try {
    const logs = [];
    writeReport({ startedAt: new Date(0), args: {}, consoleErrors: [], results: [
      { id: "T1", title: "a", kind: "xauto", status: "pass", detail: "ok", durationMs: 1 },
      { id: "T14", title: "b", kind: "xauto", status: "degrade", detail: "共 4 项", durationMs: 1 }] }, { outDir: dir, log: m => logs.push(m) });
    assert.ok(logs.some(l => l.includes("汇总：共 2 步，通过 1，失败 0，跳过 0，预期降级 1；")), logs.join("|"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- (e) 指针被拉回真实光标 ----
test("moveTo: 读回连续两次落在同一点（±3px）→ 单独的原因“指针被拉回真实光标位置”；不同点仍是普通的读回不符", async () => {
  snap.last = null;
  const xi = pts => { let i = 0; return { move: async () => {}, pointer: async () => pts[Math.min(i++, pts.length - 1)] }; };
  await assert.rejects(moveTo(xi([{ x: 557, y: 371, window: "1" }]), 100, 100), e => e.kind === "env" && /用户可能在动鼠标/.test(e.message));
  // 中间成功的读回不清掉上一次的不符点
  assert.equal((await moveTo(xi([{ x: 200, y: 200, window: "1" }]), 200, 200)).x, 200);
  await assert.rejects(moveTo(xi([{ x: 559, y: 370, window: "1" }]), 300, 300),
    e => e.kind === "env" && e.message.startsWith(REASON_SNAP) && /559,370/.test(e.message));
  await assert.rejects(moveTo(xi([{ x: 780, y: 689, window: "1" }]), 300, 300), e => !e.message.startsWith(REASON_SNAP));
  snap.last = null;
});

test("snapBack: 超过 10 分钟的旧不符点不算", () => {
  snap.last = null;
  assert.equal(snapBack({ x: 5, y: 5 }, 0), false);
  assert.equal(snapBack({ x: 5, y: 5 }, 11 * 60 * 1000), false);
  assert.equal(snapBack({ x: 6, y: 4 }, 11 * 60 * 1000 + 1), true);
  snap.last = null;
});

test("withAttempts: 指针被拉回时向导页提示把手拿开，按环境问题重试；xauto 开始卡片也写着这条提示", async () => {
  const steps = [];
  const ctx = { ...ctx0(), guide: { setStep: s => steps.push(s) } };
  const r = await withAttempts(ctx, async n => {
    if (n === 1) throw gestureError("env", `${REASON_SNAP}：移动后读回 557,371`);
    return { status: "pass", detail: "ok" };
  });
  assert.equal(r.status, "pass");
  assert.equal(steps[0].title, REASON_SNAP);
  assert.match(steps[0].instruction, /把手从鼠标\/触摸板上拿开/);
  assert.match(startCard({ id: "T3", title: "拖拽", kind: "xauto" }).instruction, /把手从鼠标\/触摸板上拿开/);
});

// ---- T8(b) 中断时的重新启用、T8(a) 的前提核对 ----
import { disabledAuto, incognitoPrecondition } from "../scripts/e2e/steps/t8.mjs";

const t8ctx = signal => ({ signal, port: 8765, browser: { client: { send: async m => (m === "Target.getTargets" ? { targetInfos: [] } : {}) },
  targets: async () => [], waitFor: async fn => fn(), evalExt: async () => true }, ext: { state: async () => ({ tabs: [], windows: [] }) }, log: () => {} });
const detailsPage = calls => ({ setEnabled: async on => { calls.push(on ? "enable" : "disable"); return on ? "toggle" : "toggle"; }, close: async () => { calls.push("close"); } });

test("disabledAuto: 停用期间被中断 → 立刻重新启用、不等扩展页（收尾期限内结束），判跳过", async () => {
  const ac = new AbortController();
  const calls = [];
  let waited = 0;
  const p = disabledAuto(t8ctx(ac.signal), { open: async () => detailsPage(calls), check: () => new Promise(() => {}), reset: async () => {},
    alive: async () => { waited++; return true; }, enable: async () => true });
  setTimeout(() => ac.abort("收到 SIGINT"), 50);
  const t0 = Date.now();
  const r = await p;
  assert.ok(Date.now() - t0 < 1000, "不等停用期间的检查跑完");
  assert.deepEqual(calls, ["disable", "enable", "close"]);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /停用期间运行被中断；已重新启用（详情页开关）/);
  assert.equal(waited, 0);
});

test("disabledAuto: 正常完成 → finally 重新启用并等扩展页可用；检查出错（非中断）照样重新启用再抛出", async () => {
  const calls = [];
  const r = await disabledAuto(t8ctx(new AbortController().signal), { open: async () => detailsPage(calls),
    check: async () => ({ status: "pass", detail: "普通左侧搜索" }), reset: async () => {}, alive: async () => true, enable: async () => true });
  assert.equal(r.status, "pass");
  assert.match(r.detail, /读回 DISABLED.*普通左侧搜索；已重新启用（详情页开关）/);
  const calls2 = [];
  await assert.rejects(disabledAuto(t8ctx(new AbortController().signal), { open: async () => detailsPage(calls2),
    check: async () => { throw new Error("boom"); }, reset: async () => {}, alive: async () => true }), /boom/);
  assert.deepEqual(calls2, ["disable", "enable", "close"]);
});

test("incognitoPrecondition: 无痕开关已打开判失败；未打开/打不开写进说明；读不到只注明", () => {
  assert.match(incognitoPrecondition({ isActive: true, isEnabled: true }).fail, /打开了扩展的“在无痕模式下启用”/);
  assert.match(incognitoPrecondition({ isActive: false, isEnabled: false }).note, /未打开，也打不开：manifest incognito: not_allowed/);
  assert.doesNotMatch(incognitoPrecondition({ isActive: false, isEnabled: true }).note, /打不开/);
  assert.match(incognitoPrecondition({ error: "详情页没有加载出来" }).note, /未能读取.*详情页没有加载出来/);
  assert.equal(incognitoPrecondition(null).fail, undefined);
});
