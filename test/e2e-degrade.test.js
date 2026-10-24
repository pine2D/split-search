// Task 5 补充：T14 预期降级（degrade）、Perplexity 普通左侧搜索的认定、指针被拉回真实光标、混合子项的“未覆盖”
import { test } from "node:test";
import assert from "node:assert/strict";
import { carriesQuery, plainEvidence, findPlain, plainTracker, t14Verdict } from "../scripts/e2e/steps/sw.mjs";
import { summarize } from "../scripts/e2e/steps/util.mjs";
import { withAttempts } from "../scripts/e2e/steps/xauto-lib.mjs";
import { moveTo, snap, snapBack, REASON_SNAP, gestureError } from "../scripts/e2e/gesture.mjs";
import { runSteps, startCard } from "../scripts/e2e/runner.mjs";
import { renderReport } from "../scripts/e2e/report.mjs";

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

test("plainEvidence: Perplexity 的 SPA 把网址改写成 /search/<slug>、丢掉 _ss——标题或跳转链带查询词仍认得出", () => {
  const text = "xleft perplexity ab12cd";
  const tab = { id: 9, url: "https://www.perplexity.ai/search/xleft-ab12cd-Zx9", title: "Perplexity", splitViewId: -1 };
  assert.equal(plainEvidence(tab, { host: PX, text }), null, "网址、标题都没有查询词、也没有跳转链");
  assert.equal(plainEvidence({ ...tab, title: `${text} - Perplexity` }, { host: PX, text }), "标题带查询词");
  const trig = "https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd&_ss=perplexity,google";
  assert.equal(plainEvidence(tab, { host: PX, text, chains: [["http://site-x.localhost:8765/start"], [trig, tab.url]] }), "跳转链经过触发网址");
  // 跳转链里只有别的查询（上一次尝试的 nonce）、或者没有 _ss 的网址，不算
  assert.equal(plainEvidence(tab, { host: PX, text, chains: [[trig.replace("ab12cd", "zz99zz")]] }), null);
  assert.equal(plainEvidence(tab, { host: PX, text, chains: [["https://www.perplexity.ai/search?q=xleft+perplexity+ab12cd"]] }), null);
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

// ---- (c) 预期降级 ----
test("t14Verdict: 预期降级必须触发前就有 SW；没检测到 SW（或只在触发后才有）仍是失败", () => {
  const HAS = "有（注册 https://www.perplexity.ai/）";
  assert.equal(t14Verdict({ name: "Perplexity", split: false, plain: true, swBefore: HAS, swAfter: HAS }).status, "degrade");
  assert.equal(t14Verdict({ name: "Perplexity", split: false, plain: true, swBefore: "无", swAfter: "无" }).status, "fail");
  assert.equal(t14Verdict({ name: "Perplexity", split: false, plain: true, swBefore: "无", swAfter: HAS }).status, "fail");
  assert.equal(t14Verdict({ name: "Perplexity", split: false, plain: false, swBefore: HAS, swAfter: HAS }).status, "fail");
});

test("withAttempts: degrade 是确定结论不重试；之前有真实失败也按预期降级判（裁定 I2 的例外）", async () => {
  let n = 0;
  const once = await withAttempts(ctx0(), async () => { n++; return { status: "degrade", detail: "预期降级（G5）" }; });
  assert.equal(n, 1);
  assert.equal(once.status, "degrade");
  assert.match(once.detail, /^第 1 次尝试预期降级：预期降级（G5）/);
  const after = await withAttempts(ctx0(), async k => (k === 1 ? { status: "fail", detail: "30 秒内未等到分屏" } : { status: "degrade", detail: "预期降级（G5）" }));
  assert.equal(after.status, "degrade");
  assert.match(after.detail, /^第 2 次尝试预期降级（之前：第 1 次 30 秒内未等到分屏）/);
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
