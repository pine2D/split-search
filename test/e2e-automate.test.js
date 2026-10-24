// 2026-10-24 把人工步骤改为自动：B4（横幅授权）、T8（无痕、停用、站点访问）、恢复检查的纯逻辑与回退规则
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXT_ID } from "../scripts/e2e/config.mjs";
import { onClickVerdict, infra } from "../scripts/e2e/ext-webui.mjs";
import { otrVerdict, autoOr } from "../scripts/e2e/steps/t8.mjs";
import { requestProblems, GB_ORIGINS } from "../scripts/e2e/steps/b4.mjs";
import { ensureRecovered } from "../scripts/e2e/steps/recover.mjs";
import { cleanupItems } from "../scripts/e2e/steps/setup.mjs";
import { summarize } from "../scripts/e2e/steps/util.mjs";

test("onClickVerdict: 逐站开关列表 → 不适用；有 ON_CLICK 下拉 → 适用；都没有 → 测试设施问题", () => {
  const na = onClickVerdict({ runtime: false, toggleList: true, options: [] });
  assert.equal(na.applicable, false);
  assert.match(na.detail, /^不适用：/);
  assert.equal(onClickVerdict({ runtime: true, options: ["ON_CLICK", "SPECIFIC_SITES", "ALL_SITES"] }).applicable, true);
  assert.equal(onClickVerdict({ runtime: true, options: ["SPECIFIC_SITES"] }).applicable, false);
  assert.throws(() => onClickVerdict({ runtime: false, toggleList: false }), e => e.kind === "infra");
  assert.throws(() => onClickVerdict(null), e => e.kind === "infra");
});

test("T8(d) 自动判“不适用”记跳过，收尾不提示改回站点访问", () => {
  const d = onClickVerdict({ toggleList: true });
  const res = summarize([{ name: "(a) 无痕窗口", status: "pass", detail: "x" }, { name: "(d) 站点访问“点击时”", status: "skip", detail: d.detail }]);
  assert.deepEqual(cleanupItems([{ id: "T8", cleanup: ["access"] }], [{ id: "T8", ...res }]), []);
});

const GO = `chrome-extension://${EXT_ID}/go.html?u=x`;
test("otrVerdict: 普通左侧搜索、在新上下文里、导航记录无 go.html 才通过", () => {
  const url = "http://engine-a.localhost:8765/search?q=t8a+x&_ss=ea,eb";
  const ok = { url, ctxId: "C1", target: { url, browserContextId: "C1" }, history: [url] };
  assert.equal(otrVerdict(ok).status, "pass");
  const cases = [
    [{ target: null }, /不见了/],
    [{ target: { url, browserContextId: "DEFAULT" } }, /不在新建的无痕上下文/],
    [{ target: { url: GO, browserContextId: "C1" } }, /go\.html/],
    [{ target: { url: "http://engine-a.localhost:8765/search?q=t8a+x", browserContextId: "C1" } }, /网址变了/],
    [{ history: [GO, url] }, /导航记录里有 go\.html/],
    [{ history: null }, /读不到/],
    [{ right: ["http://engine-b.localhost:8765/search?q=x"] }, /右侧引擎页面/],
    [{ splits: 1 }, /不应分屏/],
  ];
  for (const [over, re] of cases) {
    const v = otrVerdict({ ...ok, ...over });
    assert.equal(v.status, "fail", JSON.stringify(over));
    assert.match(v.detail, re);
  }
});

test("requestProblems: 横幅点一次只申请一次，且同时含 Google 与 Bing", () => {
  assert.deepEqual(requestProblems([[...GB_ORIGINS]]), []);
  assert.deepEqual(requestProblems([["https://www.bing.com/*", "https://www.google.com/*", "https://x.com/*"]]), []);
  assert.match(requestProblems([])[0], /应申请 1 次，实际 0 次/);
  assert.match(requestProblems([[GB_ORIGINS[0]], [GB_ORIGINS[1]]])[0], /实际 2 次/);
  assert.match(requestProblems([[GB_ORIGINS[0]]])[0], /缺少 https:\/\/www\.bing\.com/);
  assert.match(requestProblems(null)[0], /记录器/);
});

test("autoOr: 自动版本通过就用它；测试设施问题时引导式回退到人工、--auto-only 判跳过；其他异常照抛", async () => {
  let manual = 0;
  const man = async () => { manual++; return { status: "pass", detail: "人工" }; };
  assert.equal((await autoOr({}, async () => ({ status: "pass", detail: "自动" }), man)).detail, "自动");
  const r = await autoOr({}, async () => { throw infra("详情页打不开"); }, man);
  assert.equal(manual, 1);
  assert.match(r.detail, /^人工（自动版本做不了：详情页打不开，改由人工完成）$/);
  const s = await autoOr({ autoOnly: true }, async () => { throw infra("详情页打不开"); }, man);
  assert.deepEqual([s.status, manual], ["skip", 1]);
  await assert.rejects(autoOr({}, async () => { throw new Error("bug"); }, man), /bug/);
});

// ---- 恢复检查：先自动启用；--auto-only 不等人 ----
function deps({ alive = [true], has = [true], grants = [], enable = false } = {}) {
  const calls = { requests: [], waits: 0, enables: 0 };
  return {
    calls,
    deps: {
      alive: async () => (alive.length > 1 ? alive.shift() : alive[0]),
      has: async () => (has.length > 1 ? has.shift() : has[0]),
      request: async (ctx, origins, o) => { calls.requests.push(o); return grants.shift() ?? false; },
      wait: async (ctx, o) => { calls.waits++; return (await o.probe()) ? { kind: "met" } : { kind: "timeout" }; },
      focus: async () => {},
      enable: async () => { calls.enables++; return enable; },
    },
  };
}
const ctx = (over = {}) => ({ port: 8765, timeoutMs: 1000, guide: { setStep() {} }, ...over });

test("ensureRecovered: 扩展不可用先经详情页自动启用，成功就不请用户", async () => {
  const d = deps({ alive: [false, true], enable: true });
  assert.equal((await ensureRecovered(ctx(), d.deps)).ok, true);
  assert.deepEqual([d.calls.enables, d.calls.waits], [1, 0]);
});

test("ensureRecovered: --auto-only 自动启用失败直接判“扩展未恢复”，不等人", async () => {
  const d = deps({ alive: [false], enable: false });
  const r = await ensureRecovered(ctx({ autoOnly: true }), d.deps);
  assert.deepEqual([r.ok, r.reason, d.calls.waits], [false, "扩展未恢复", 0]);
  const g = deps({ alive: [false, true], enable: false });
  assert.equal((await ensureRecovered(ctx(), g.deps)).ok, true, "引导式运行仍可请用户启用");
  assert.equal(g.calls.waits, 1);
});

test("STEPS: B4、B14、T8 是 auto，--auto-only 也跑；B4、T8 仍标 restores", async () => {
  const { STEPS, selectSteps } = await import("../scripts/e2e/steps/index.mjs");
  const byId = Object.fromEntries(STEPS.map(s => [s.id, s]));
  for (const id of ["B4", "B14", "T8"]) assert.equal(byId[id].kind, "auto", id);
  for (const id of ["B4", "T8"]) assert.equal(byId[id].restores, true, id);
  const auto = selectSteps(STEPS, { autoOnly: true, xinput: false }).map(s => s.id);
  for (const id of ["B4", "B14", "T8"]) assert.ok(auto.includes(id), id);
});
