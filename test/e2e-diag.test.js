import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTargets, collectCdp, formatCdp } from "../scripts/e2e/diag.mjs";
import { formatDiag, runSteps } from "../scripts/e2e/runner.mjs";
import { swByOrigin, swText, t14Verdict } from "../scripts/e2e/steps/sw.mjs";
import { INCOGNITO_TEXT, INCOGNITO_URL } from "../scripts/e2e/steps/t8-manual.mjs";

const EXT = "chrome-extension://alngkkgnobglnfbhcplhpaflcgfiajnj";
const GUIDE = "http://127.0.0.1:8765/guide";

test("mapTargets: 网址相同先配对；窗口里只剩一个时确定，否则按顺序推测；多余目标列为未对应", () => {
  const tabs = [
    { id: 1, windowId: 7, index: 0 }, // 向导页：扩展读不到
    { id: 2, windowId: 7, index: 1, url: `${EXT}/options/options.html` },
    { id: 3, windowId: 8, index: 0 }, { id: 4, windowId: 8, index: 1 },
  ];
  const pages = [
    { targetId: "A", url: `${EXT}/options/options.html`, windowId: 7 }, { targetId: "B", url: GUIDE, windowId: 7 },
    { targetId: "C", url: "https://www.google.com/sorry/index?continue=x", windowId: 8 }, { targetId: "D", url: "chrome://newtab/", windowId: 8 },
    { targetId: "E", url: "about:blank", windowId: 9 },
  ];
  const { byTab, unmatched } = mapTargets(tabs, pages);
  assert.deepEqual([byTab.get(2).page.targetId, byTab.get(2).how], ["A", "网址"]);
  assert.deepEqual([byTab.get(1).page.targetId, byTab.get(1).how], ["B", "唯一"]);
  assert.equal(byTab.get(3).how, "按顺序推测");
  assert.deepEqual(unmatched.map(p => p.targetId), ["E"]);
});

// 假浏览器：两个页面目标；导航历史只在没有网络跳转链时读
function fakeBrowser() {
  const sent = [];
  const client = { send: async (m, p, sid) => {
    sent.push(m);
    if (m === "Target.getTargets") return { targetInfos: [
      { type: "page", targetId: "G1", url: GUIDE }, { type: "page", targetId: "S1", url: "https://www.google.com/search?q=t5&token=zz9" },
      { type: "page", targetId: "S2", url: "http://site-x.localhost:8765/start?n=1" }, { type: "service_worker", targetId: "W", url: "https://x/sw.js" } ] };
    if (m === "Browser.getWindowForTarget") return { windowId: 7 };
    if (m === "Target.attachToTarget") return { sessionId: `s-${p.targetId}` };
    if (m === "Page.getNavigationHistory") return { currentIndex: 1, entries: [{ url: "about:blank", transitionType: "typed" }, { url: "http://site-x.localhost:8765/start?n=1&sid=abc", transitionType: "link" }] };
    return {};
  } };
  return { sent, browser: { client } };
}

test("collectCdp + formatDiag: 读不到网址的标签补上 CDP 网址；步骤页面附跳转链或导航历史；全部脱敏", async () => {
  const { browser, sent } = fakeBrowser();
  const nav = { S1: [{ url: "https://www.google.com/search?q=t5&_ss=google,bing", status: null },
    { url: `${EXT}/go.html?u=https://www.google.com/search?q=t5&_ss=google,bing`, status: 307 },
    { url: "https://www.google.com/search?q=t5", status: null },
    { url: "https://www.google.com/sorry/index?continue=x&google_abuse=GOOGLE_ABUSE_EXEMPTION%3DID%3Dq:IP%3D10.0.0.1", status: 302 }] };
  const state = { windows: [{ id: 7, type: "normal" }], rules: [1],
    tabs: [{ id: 1, windowId: 7, index: 0 }, { id: 2, windowId: 7, index: 1 }, { id: 3, windowId: 7, index: 2, url: "http://site-x.localhost:8765/start?n=1" }] };
  const cdp = await collectCdp({ browser, port: 8765, consoleCollector: { navChain: id => nav[id] ?? [] } }, state);
  const text = formatDiag(state, cdp);
  assert.match(text, /标签 1 .*\(网址不可读\) ｜CDP 目标 G1/);
  assert.match(text, /\[307\] chrome-extension:\/\/.*go\.html/);
  assert.match(text, /\[302\] https:\/\/www\.google\.com\/sorry/);
  assert.match(text, /S2（导航历史）：about:blank（typed） → .*start\?n=1&sid=\*\*\*（link）←当前/);
  for (const secret of ["zz9", "10.0.0.1", "sid=abc"]) assert.ok(!text.includes(secret), secret);
  assert.equal(sent.filter(m => m === "Page.getNavigationHistory").length, 1, "有网络跳转链的页面不再读导航历史");
  assert.ok(!/G1（(网络|导航历史)）/.test(text), "向导页不算步骤页面");
});

test("runSteps: 失败诊断附 CDP 目标；扩展状态读不到时仍有 CDP 部分；result.diag 也脱敏", async () => {
  const { browser } = fakeBrowser();
  const ctx = { browser, port: 8765, guide: {}, abortSignal: new AbortController().signal, ext: { state: async () => { throw new Error("设置页打不开"); } } };
  const [r] = await runSteps([{ id: "T4", title: "t", kind: "assist", needs: [], run: async () => ({ status: "fail", detail: "x" }) }], ctx, { timeoutMs: 1000 });
  assert.match(r.detail, /无法读取状态.*设置页打不开/);
  assert.match(r.detail, /没对应上标签的 CDP 页面目标/);
  assert.ok(!JSON.stringify(r.diag).includes("zz9"));
  assert.deepEqual(formatCdp({ error: "超时" }), ["  CDP 目标：读不到（超时）"]);
});

test("swByOrigin / swText: 合并注册、版本、worker 目标，只看网页 origin，已删除和 redundant 不算", () => {
  const m = swByOrigin({
    registrations: [{ registrationId: "1", scopeURL: "https://www.perplexity.ai/", isDeleted: false }, { registrationId: "2", scopeURL: "https://old.example/", isDeleted: true },
      { registrationId: "3", scopeURL: `${EXT}/`, isDeleted: false }],
    versions: [{ registrationId: "1", scriptURL: "https://www.perplexity.ai/sw.js", status: "activated", runningStatus: "running" },
      { registrationId: "2", scriptURL: "https://old.example/sw.js", status: "redundant", runningStatus: "stopped" }],
    targets: [{ type: "service_worker", url: "https://duckduckgo.com/sw.js" }, { type: "page", url: "https://www.bing.com/" }],
  });
  assert.deepEqual([...m.keys()].sort(), ["https://duckduckgo.com", "https://www.perplexity.ai"]);
  assert.match(swText(m, "https://www.perplexity.ai"), /^有（注册 https:\/\/www\.perplexity\.ai\//);
  assert.equal(swText(m, "https://www.bing.com"), "无");
});

test("t14Verdict: 无 SW 分屏通过、不分屏是真缺陷；触发前有 SW、不分屏且左侧带查询词 → 预期降级（degrade，不算失败）", () => {
  assert.equal(t14Verdict({ name: "Bing", split: true, swBefore: "无", swAfter: "无" }).status, "pass");
  const real = t14Verdict({ name: "Bing", split: false, swBefore: "无", swAfter: "无" });
  assert.equal(real.status, "fail");
  assert.match(real.detail, /分屏：否；SW 注册：触发前无，触发后无；没检测到 Bing 的 Service Worker 却没分屏/);
  assert.equal(real.degraded, false);
  const deg = t14Verdict({ name: "Perplexity", split: false, plain: true, swBefore: "有（注册 https://www.perplexity.ai/）", swAfter: "有（x）", plainText: "标签 5" });
  assert.equal(deg.status, "degrade");
  assert.equal(deg.degraded, true);
  assert.match(deg.detail, /预期降级（G5）.*leftDiscouraged.*标签 5/);
  assert.match(t14Verdict({ name: "Kagi", split: true, swBefore: "有（x）", swAfter: "有（x）" }).detail, /^分屏：是；SW 注册：触发前有/);
});

test("T8(a) 卡片：写明必须点通过/不通过，并说明无痕窗口里 Google 收到 _ss 是正常的", () => {
  assert.match(INCOGNITO_TEXT, /必须回到这里点“通过”或“不通过”/);
  assert.match(INCOGNITO_TEXT, /无痕窗口里扩展不运行，Google 收到 `_ss` 是正常的/);
  // M-7：不依赖 T1 添加的 gb（xauto 的 T1 只建 sse2e 专用条目），直接粘贴触发网址
  assert.ok(!/gb/.test(INCOGNITO_TEXT));
  assert.match(INCOGNITO_URL, /^https:\/\/www\.google\.com\/search\?q=.+&_ss=google,bing$/);
});

test("t14Verdict 三态：有/无/未知 × 分屏/不分屏 × 左侧带查询词；只有“触发前有 + 不分屏 + 左侧带查询词”才是预期降级", () => {
  const HAS = "有（注册 https://www.perplexity.ai/）", NONE = "无", UNK = "未知（ServiceWorker.enable 超时）";
  const cases = [
    // [触发前, 触发后, 分屏, 左侧带查询词, 期望状态, degraded, sw, 说明匹配]
    [NONE, NONE, true, false, "pass", undefined, "无", /^分屏：是/],
    [HAS, HAS, true, true, "pass", undefined, "有", /^分屏：是/],
    [UNK, UNK, true, false, "pass", undefined, "未知", /^分屏：是/],
    [NONE, NONE, false, true, "fail", false, "无", /不是预期降级，需要排查/],
    [HAS, NONE, false, true, "degrade", true, "有", /预期降级（G5）.*leftDiscouraged/],
    [HAS, UNK, false, true, "degrade", true, "有", /预期降级（G5）/],
    [HAS, HAS, false, false, "fail", false, "有", /没确认左侧停在 Perplexity 上并带着这次的查询词，不能算预期降级/],
    [NONE, HAS, false, true, "fail", false, "有", /触发前没有检测到 Perplexity 的 Service Worker（触发后才有）.*不是预期降级/],
    [UNK, HAS, false, true, "fail", false, "有", /触发前 SW 状态读不到、触发后才读到有.*不算预期降级/],
    [UNK, UNK, false, true, "fail", false, "未知", /SW 状态读不到，无法区分降级和缺陷/],
    [UNK, NONE, false, true, "fail", false, "未知", /SW 状态读不到，无法区分降级和缺陷/],
    [NONE, "未知", false, true, "fail", false, "未知", /SW 状态读不到/],
  ];
  for (const [b, a, split, plain, status, degraded, sw, re] of cases) {
    const v = t14Verdict({ name: "Perplexity", split, plain, swBefore: b, swAfter: a });
    const label = `${b} / ${a} / ${split} / ${plain}`;
    assert.equal(v.status, status, label);
    assert.equal(v.degraded, degraded, label);
    assert.equal(v.sw, sw, label);
    assert.match(v.detail, re, label);
    if (status === "fail") assert.ok(!/建议给该预置引擎/.test(v.detail), `${label}：不是预期降级时不给产品建议`);
  }
});
