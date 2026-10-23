import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, reportBaseName } from "../scripts/e2e/report.mjs";

const results = [
  { id: "B5", title: "DNR 规则", kind: "auto", status: "pass", detail: "规则正确", durationMs: 120 },
  { id: "T7", title: "错误 | 标记", kind: "auto", status: "fail", detail: "正文不含“未知引擎”\n诊断：tab 1", durationMs: 2300 },
  { id: "T9", title: "Kagi 登录", kind: "assist", status: "skip", detail: "用户跳过", durationMs: 5 },
];
const base = {
  startedAt: new Date("2026-10-23T08:00:00Z"),
  args: { autoOnly: true, headless: true, only: ["B5", "T7", "T9"], port: 8765, timeoutMs: 120000 },
  results,
  consoleErrors: [{ text: "[split-search] rebuildRules failed boom", url: "chrome-extension://x/background.js" }],
  chromeVersion: "Chrome/155.0.8059.84",
};

const tableRows = md => {
  const lines = md.split("\n");
  const h = lines.findIndex(l => l.startsWith("| 编号 |"));
  const rows = [];
  for (let i = h + 2; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i]);
  return rows;
};

test("renderReport: 汇总表行数等于步骤数，列齐全", () => {
  const { md } = renderReport(base);
  assert.match(md, /\| 编号 \| 类型 \| 结果 \| 耗时 \| 说明 \|/);
  const rows = tableRows(md);
  assert.equal(rows.length, 3);
  // 标题里的 | 被转义，不会多出列
  for (const r of rows) assert.equal(r.split(/(?<!\\)\|/).length, 7, r);
  assert.match(rows[1], /T7.*失败/);
});

test("renderReport: 有失败时含失败详情，含控制台错误", () => {
  const { md } = renderReport(base);
  assert.ok(md.includes("失败详情"));
  assert.ok(md.includes("诊断：tab 1"));
  assert.ok(md.includes("[split-search] rebuildRules failed boom"));
  assert.ok(md.includes("Chrome/155.0.8059.84"));
});

test("renderReport: 全部通过时没有失败详情，控制台写无", () => {
  const { md } = renderReport({ ...base, results: [results[0]], consoleErrors: [] });
  assert.ok(!md.includes("失败详情"));
  assert.match(md, /控制台[\s\S]*无/);
});

test("renderReport: json 与 md 内容一致", () => {
  const { json } = renderReport({ ...base, storage: { before: "aa", after: "aa", equal: true }, notes: ["测试备注"] });
  assert.deepEqual(json.results.map(r => r.id), ["B5", "T7", "T9"]);
  assert.equal(json.results[1].status, "fail");
  assert.deepEqual(json.summary, { total: 3, pass: 1, fail: 1, skip: 1 });
  assert.equal(json.consoleErrors.length, 1);
  assert.equal(json.storage.equal, true);
  assert.deepEqual(json.notes, ["测试备注"]);
  assert.equal(json.startedAt, "2026-10-23T08:00:00.000Z");
  assert.doesNotThrow(() => JSON.stringify(json));
});

test("renderReport: storage 前后摘要写进 md", () => {
  const { md } = renderReport({ ...base, storage: { before: "abc123", after: "abc123", equal: true } });
  assert.ok(md.includes("abc123"));
  assert.match(md, /一致/);
});

test("reportBaseName: 本地时间戳", () => {
  assert.equal(reportBaseName(new Date(2026, 9, 23, 8, 5, 9)), "report-20261023-080509");
});

test("renderReport: 通过/跳过但表格放不下的说明（多行、超长、judge）完整写进“详细说明”；单元格截断带省略号", () => {
  const t12 = "直接输入时联想：有；快捷字词模式联想：没有；分屏：" + "x".repeat(200);
  const { md } = renderReport({ ...base, results: [
    { id: "T12", title: "联想", kind: "judge", status: "pass", detail: t12, durationMs: 1 },
    { id: "T14", title: "各引擎", kind: "assist", status: "pass", detail: "共 4 项：通过 3，跳过 1，失败 0\nKagi 作左侧：跳过——用户点了“跳过”", durationMs: 1 },
    { id: "B5", title: "DNR", kind: "auto", status: "pass", detail: "规则正确", durationMs: 1 },
  ] });
  assert.match(md, /## 详细说明/);
  assert.ok(md.includes(t12), "T12 的联想回答完整出现");
  assert.ok(md.includes("Kagi 作左侧：跳过"), "T14 跳过的子项看得见");
  assert.ok(!/### B5/.test(md), "放得下的单行说明不重复");
  assert.match(tableRows(md)[0], /…/);
});

test("renderReport: 说明里有 ``` 时代码块围栏更长；多行备注缩进；固定列出未覆盖项", () => {
  const { md, json } = renderReport({ ...base, results: [{ id: "T7", title: "t", kind: "auto", status: "fail", detail: "a ``` b", durationMs: 1 }],
    notes: ["需要恢复：\n1. 改回默认"] });
  assert.ok(md.includes("````\na ``` b\n````"));
  assert.ok(md.includes("- 需要恢复：\n  1. 改回默认"));
  assert.match(md, /## 未覆盖[\s\S]*T3\(b\)[\s\S]*T9\(b\)[\s\S]*T13\(f\)[\s\S]*T15/);
  assert.ok(json.uncovered.length >= 2);
});
