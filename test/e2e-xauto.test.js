import { test } from "node:test";
import assert from "node:assert/strict";
import { withAttempts, assertAscii, mockEntry, xauto } from "../scripts/e2e/steps/xauto-lib.mjs";
import { WORDS, query } from "../scripts/e2e/steps/xauto.mjs";
import { t14Entry } from "../scripts/e2e/steps/xauto-t14.mjs";
import { LEFTS } from "../scripts/e2e/steps/assisted-2.mjs";
import { STEPS, selectSteps } from "../scripts/e2e/steps/index.mjs";
import { isOurs } from "../scripts/e2e/settings-se.mjs";
import { gestureError, held, REASON_STUCK } from "../scripts/e2e/gesture.mjs";
import { startCard } from "../scripts/e2e/runner.mjs";

const ctx0 = () => ({ gx: { stop: null, xi: {}, sleep: async () => {} }, log: () => {} });
const XA = ["T1", "T2", "T3", "T4", "T5-DRAG", "T6-NTP", "T11", "T14"];

test("withAttempts: 失败后完整重来，最多 3 次，记下第几次成功", async () => {
  const seen = [];
  const r = await withAttempts(ctx0(), async n => { seen.push(n); if (n < 3) throw new Error(`落点不对 ${n}`); return { status: "pass", detail: "ok" }; });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(r.status, "pass");
  assert.equal(r.attempt, 3);
  assert.match(r.detail, /^第 3 次尝试通过（之前：第 1 次 落点不对 1；第 2 次 落点不对 2）：ok/);
  const first = await withAttempts(ctx0(), async () => ({ status: "pass", detail: "ok" }));
  assert.equal(first.detail, "第 1 次尝试通过：ok");
});

test("withAttempts: 3 次都失败 → fail（返回 fail 也算）；不再试第 4 次", async () => {
  let n = 0;
  const r = await withAttempts(ctx0(), async i => { n++; if (i === 2) throw new Error("没分屏"); return { status: "fail", detail: `判定不符 ${i}` }; });
  assert.equal(n, 3);
  assert.equal(r.status, "fail");
  assert.match(r.detail, /^3 次尝试都没成功\n第 1 次 判定不符 1\n第 2 次 没分屏\n第 3 次 判定不符 3$/);
});

test("withAttempts: skip（光标不在、用户在动鼠标）不重试；env 重试后仍是 env → skip", async () => {
  let n = 0;
  const s = await withAttempts(ctx0(), async () => { n++; throw gestureError("skip", "光标不在测试窗口上（…）"); });
  assert.equal(n, 1);
  assert.equal(s.status, "skip");
  assert.match(s.detail, /^跳过：光标不在测试窗口上/);
  n = 0;
  const e = await withAttempts(ctx0(), async () => { n++; throw gestureError("env", "新窗口未获得前台"); });
  assert.equal(n, 3);
  assert.equal(e.status, "skip");
  assert.match(e.detail, /环境不支持/);
});

test("withAttempts: stuck → 停掉剩余 xauto 步骤；final 的失败不重试", async () => {
  const ctx = ctx0();
  held.current = null;
  const r = await withAttempts(ctx, async () => { throw gestureError("stuck", `${REASON_STUCK}：左键可能仍按着`); });
  assert.equal(r.status, "fail");
  assert.equal(ctx.gx.stop, REASON_STUCK);
  let called = false;
  const next = await withAttempts(ctx, async () => { called = true; return { status: "pass", detail: "" }; });
  assert.equal(called, false);
  assert.equal(next.status, "skip");
  assert.match(next.detail, /可能有按键卡住，剩余 xauto 步骤已停止/);
  let n = 0;
  const f = await withAttempts(ctx0(), async () => { n++; return { status: "fail", detail: "预期降级", degraded: true }; }, { final: x => x.degraded });
  assert.equal(n, 1);
  assert.equal(f.degraded, true);
});

test("selectSteps: xinput 不可用 → 回退版本；可用 → xauto；--auto-only 时 xauto 也执行；B15 仍最后", () => {
  const off = selectSteps(STEPS, { xinput: false });
  const on = selectSteps(STEPS, { xinput: true });
  for (const id of XA) {
    assert.notEqual(off.find(s => s.id === id).kind, "xauto", id);
    assert.equal(on.find(s => s.id === id).kind, "xauto", id);
  }
  assert.equal(off.at(-1).id, "B15");
  assert.equal(on.at(-1).id, "B15");
  const auto = selectSteps(STEPS, { autoOnly: true, xinput: true }).map(s => s.id);
  for (const id of XA) assert.ok(auto.includes(id), id);
  assert.equal(auto.at(-1), "B15");
  const autoOff = selectSteps(STEPS, { autoOnly: true, xinput: false }).map(s => s.id);
  for (const id of XA) assert.ok(!autoOff.includes(id), id);
  assert.deepEqual(selectSteps(STEPS, { only: ["T3"], xinput: false }).map(s => s.kind), ["assist"]);
  // T14 回退版本仍要求 Kagi 登录；xauto 版本不要求
  assert.ok(off.find(s => s.id === "T14").needs.includes("kagi"));
  assert.deepEqual(on.find(s => s.id === "T14").needs, []);
});

test("xauto: 回退步骤编号必须一致；xauto 版本不带收尾清理项", () => {
  assert.throws(() => xauto({ id: "T1", run: async () => {} }, { id: "T2" }), /回退步骤/);
  for (const s of STEPS.filter(x => x.kind === "xauto")) {
    assert.equal(s.cleanup, undefined, s.id);
    assert.equal(typeof s.timeoutMs, "number", s.id);
  }
});

test("ASCII：xauto 的关键词、查询词、网站搜索条目全部是 ASCII 且是 sse2e 专用条目", () => {
  assert.throws(() => assertAscii("测试"), /ASCII/);
  assert.throws(() => assertAscii(""), /ASCII/);
  for (const w of WORDS) {
    const { text, q } = query(w);
    assert.equal(assertAscii(text), text);
    assert.match(q, /^[a-z0-9+]+$/);
    assert.equal(q, text.replace(/ /g, "+"));
  }
  const entries = [mockEntry(8765), ...LEFTS.map(t14Entry)];
  for (const e of entries) {
    assert.ok(isOurs(e.keyword), e.keyword);
    assertAscii(e.keyword); assertAscii(e.name); assertAscii(e.url);
    assert.ok(e.url.includes("%s") && /_ss=[a-z0-9-]+,[a-z0-9-]+$/.test(e.url), e.url);
  }
  assert.deepEqual(entries.map(e => e.keyword), ["sse2e", "sse2e-bing", "sse2e-ddg", "sse2e-perplexity", "sse2e-kagi"]);
  assert.match(mockEntry(8765).url, /^http:\/\/engine-a\.localhost:8765\/search\?q=%s&_ss=ea,eb$/);
});

test("startCard: xauto 步骤提示把光标停在窗口里、不要动鼠标键盘", () => {
  const c = startCard({ id: "T3", title: "拖拽", kind: "xauto" });
  assert.match(c.title, /自动操作中/);
  assert.match(c.instruction, /光标停在测试浏览器窗口里/);
  assert.deepEqual(c.buttons, []);
});
