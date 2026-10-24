import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsRetry } from "../scripts/e2e/steps/xauto-lib.mjs";
import { runSteps } from "../scripts/e2e/runner.mjs";

test("settingsRetry: 前两次超时、第三次成功 → 返回结果", async () => {
  let n = 0;
  const v = await settingsRetry({}, async () => { if (++n < 3) throw new Error("chrome://settings 搜索引擎页没有加载出来"); return "ok"; }, { waitMs: 0 });
  assert.equal(v, "ok");
  assert.equal(n, 3);
});

test("settingsRetry: 3 次都失败 → kind skip，说明带原始原因", async () => {
  let n = 0;
  await assert.rejects(settingsRetry({}, async () => { n++; throw new Error("编辑对话框没有出现"); }, { waitMs: 0 }),
    e => e.kind === "skip" && /3 次都没成功/.test(e.message) && /编辑对话框没有出现/.test(e.message));
  assert.equal(n, 3);
});

test("settingsRetry: 已中断 → 原样抛出，不重试", async () => {
  const ac = new AbortController(); ac.abort();
  let n = 0;
  await assert.rejects(settingsRetry({ signal: ac.signal }, async () => { n++; throw new Error("x"); }, { waitMs: 0 }), e => e.message === "x" && !e.kind);
  assert.equal(n, 1);
});

test("runSteps: 步骤抛出 kind skip 的错误 → 记为跳过（测试设施问题），普通异常仍是失败", async () => {
  const ctx = {
    browser: {}, port: 8765, timeoutMs: 1000, abortSignal: new AbortController().signal,
    ext: { state: async () => ({ tabs: [], windows: [], rules: [] }) },
    guide: { setProgress() {}, setResult() {}, setStep() {} }, log() {},
  };
  const mk = (id, err) => ({ id, title: id, kind: "auto", needs: [], run: async () => { throw err; } });
  const [a, b] = await runSteps([mk("T1", Object.assign(new Error("设置页操作 3 次都没成功"), { kind: "skip" })), mk("T2", new Error("坏了"))], ctx, { timeoutMs: 1000, settleMs: 0 });
  assert.equal(a.status, "skip");
  assert.match(a.detail, /设置页操作/);
  assert.equal(b.status, "fail");
  assert.match(b.detail, /异常：坏了/);
});
