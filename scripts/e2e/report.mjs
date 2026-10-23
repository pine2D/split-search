// 报告生成（纯函数）：同一份内容输出 Markdown 与 JSON
const KIND = { auto: "自动", assist: "协助", judge: "判断" };
const STATUS = { pass: "✅ 通过", fail: "❌ 失败", skip: "⏭ 跳过" };

const pad = n => String(n).padStart(2, "0");
export function reportBaseName(d) {
  return `report-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const cell = s => String(s ?? "").split("\n")[0].replace(/\|/g, "\\|").slice(0, 120);
const secs = ms => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "-");
const iso = d => (d instanceof Date ? d.toISOString() : d ?? null);

function summarize(results) {
  const s = { total: results.length, pass: 0, fail: 0, skip: 0 };
  for (const r of results) if (r.status in s) s[r.status]++;
  return s;
}

export function renderReport({ startedAt, finishedAt, args, results, consoleErrors = [], chromeVersion, storage, notes = [] }) {
  const summary = summarize(results);
  const json = {
    startedAt: iso(startedAt), finishedAt: iso(finishedAt), chromeVersion: chromeVersion ?? null, args,
    summary, results, consoleErrors, storage: storage ?? null, notes,
  };

  const md = [];
  md.push("# Split Search 端到端验收报告", "");
  md.push(`- 开始：${json.startedAt ?? "-"}${json.finishedAt ? `；结束：${json.finishedAt}` : ""}`);
  md.push(`- 浏览器：${chromeVersion ?? "未知"}`);
  md.push(`- 参数：\`${JSON.stringify(args)}\``);
  md.push(`- 汇总：共 ${summary.total} 步，通过 ${summary.pass}，失败 ${summary.fail}，跳过 ${summary.skip}`, "");

  md.push("## 汇总", "", "| 编号 | 类型 | 结果 | 耗时 | 说明 |", "|---|---|---|---|---|");
  for (const r of results) {
    md.push(`| ${cell(r.id)} ${cell(r.title)} | ${KIND[r.kind] ?? cell(r.kind)} | ${STATUS[r.status] ?? cell(r.status)} | ${secs(r.durationMs)} | ${cell(r.detail)} |`);
  }
  md.push("");

  const failed = results.filter(r => r.status === "fail");
  if (failed.length) {
    md.push("## 失败详情", "");
    for (const r of failed) md.push(`### ${r.id} ${r.title ?? ""}`, "", "```", String(r.detail ?? ""), "```", "");
  }

  md.push("## 控制台中的 [split-search] 错误", "");
  if (!consoleErrors.length) md.push("无", "");
  else {
    md.push(`**共 ${consoleErrors.length} 条**`, "");
    for (const e of consoleErrors) md.push(`- 🔴 \`${String(e.text).replace(/`/g, "'")}\`${e.url ? `（${e.url}）` : ""}`);
    md.push("");
  }

  if (storage) {
    md.push("## chrome.storage.sync 前后对比", "");
    md.push(`- 运行前摘要：\`${storage.before ?? "-"}\``);
    md.push(`- 运行后摘要：\`${storage.after ?? "-"}\``);
    md.push(`- 结论：${storage.equal ? "一致" : "不一致或未恢复"}`, "");
  }
  if (notes.length) {
    md.push("## 备注", "");
    for (const n of notes) md.push(`- ${n}`);
    md.push("");
  }
  return { md: md.join("\n"), json };
}
