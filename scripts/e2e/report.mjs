// 报告生成（纯函数）：同一份内容输出 Markdown 与 JSON。所有写进报告或终端的文字先经 redact 脱敏
const KIND = { auto: "自动", assist: "协助", judge: "判断" };
const STATUS = { pass: "✅ 通过", fail: "❌ 失败", skip: "⏭ 跳过" };

// 隐私：网址里名为 token/session/sid/auth/key/code、access_token 等 *_token、session_id/sessionid、
// google_abuse 等 *_abuse、含 exemption 的（不区分大小写）查询参数，值一律换成 ***。参数名前须是 ? & ; # 或开头
// （含 HTML 转义后的 &amp;），或它们的一次、两次百分号编码 %3F %26 %23 / %253F %2526 %2523（嵌套在 next=、r=、continue= 里的网址）；
// 名后是 = 或 %3D / %253D。所以 monkey=1、keyword=x、q=token=4 不受影响。
// Google 人机验证通过后的 google_abuse=GOOGLE_ABUSE_EXEMPTION%3DID%3D…:IP%3D<用户 IP>… 整段换掉；
// 不带参数名单独出现的 …ABUSE_EXEMPTION=…（含 IP）同样换掉
const NAME = "(?:[a-z0-9_]*_abuse|[a-z0-9_]*exemption[a-z0-9_]*|[a-z0-9]*_token|token|session_id|sessionid|session|sid|auth|key|code)";
const STOP = "%26|%23|%3B|%2526|%2523|%253B";
const VALUE = `(?:(?!${STOP})[^&#;\\s；，。、（）)\\]|"'<>])*`;
const SECRET = new RegExp(`(^|[?&;#]|%3F|%26|%23|%253F|%2526|%2523)(${NAME})(=|%3D|%253D)(${VALUE})`, "gi");
const EXEMPTION = new RegExp(`([a-z0-9_]*ABUSE_EXEMPTION)(=|%3D|%253D)(?!\\*\\*\\*)(${VALUE})`, "gi");
export const redact = s => (typeof s === "string"
  ? s.replace(SECRET, (_, pre, name, eq) => `${pre}${name}${eq}***`).replace(EXEMPTION, (_, name, eq) => `${name}${eq}***`)
  : s);
export function redactDeep(v) {
  if (typeof v === "string") return redact(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === "object" && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)]));
  return v;
}

const pad = n => String(n).padStart(2, "0");
export function reportBaseName(d) {
  return `report-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const CELL_MAX = 120;
const cell = s => {
  const line = String(s ?? "").split("\n")[0].replace(/\|/g, "\\|");
  return line.length > CELL_MAX ? `${line.slice(0, CELL_MAX)}…` : line;
};
// 表格单元格放不下的说明（多行、超长或 judge 的回答）要在“详细说明”里完整给出
const needsFull = r => r.kind === "judge" || String(r.detail ?? "").includes("\n") || String(r.detail ?? "").length > CELL_MAX;
// 代码块围栏比说明里最长的连续反引号多一个，说明里有 ``` 也不会提前结束代码块
const fenced = text => {
  const t = String(text ?? "");
  const f = "`".repeat(Math.max(3, ...(t.match(/`+/g) ?? []).map(m => m.length + 1)));
  return [f, t, f];
};
// 多子项步骤（T14 等）每个子项一行，渲染成列表项：长行自动折行，任何 Markdown 查看器里都看得见；
// 单行说明（T12 联想回答、超长单行）仍放代码块
const detailBody = detail => {
  const lines = String(detail ?? "").split("\n").filter(l => l.trim());
  return lines.length < 2 ? fenced(detail) : [lines[0], "", ...lines.slice(1).map(l => `- ${l}`)];
};
// spec 3.5：e2e 不覆盖的项目，固定写进报告
export const UNCOVERED = [
  "T3(b) 从外部 Windows 应用拖入：留给 Windows 冒烟（docs/acceptance-v0.1.md 第 2 节）",
  "B9 快捷字词 bk（地址栏快捷字词机制由 T1 覆盖）、T9(b) 经 Turnstile 跳转的 Kagi、T13(f) PWA/应用窗口、T15 uBlock Origin：未覆盖",
  "扩展 Service Worker 空闲回收后的冷启动：e2e 运行中调试会话让 SW 一直存活，测不到，靠 Windows 冒烟或手测",
];
const secs = ms => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "-");
const iso = d => (d instanceof Date ? d.toISOString() : d ?? null);

function summarize(results) {
  const s = { total: results.length, pass: 0, fail: 0, skip: 0 };
  for (const r of results) if (r.status in s) s[r.status]++;
  return s;
}

export function renderReport(input) {
  const { startedAt, finishedAt, args, chromeVersion, storage } = input;
  const results = redactDeep(input.results);
  const consoleErrors = redactDeep(input.consoleErrors ?? []);
  const notes = redactDeep(input.notes ?? []);
  const summary = summarize(results);
  const json = {
    startedAt: iso(startedAt), finishedAt: iso(finishedAt), chromeVersion: chromeVersion ?? null, args,
    summary, results, consoleErrors, storage: storage ?? null, notes, uncovered: UNCOVERED,
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
    for (const r of failed) md.push(`### ${r.id} ${r.title ?? ""}`, "", ...fenced(r.detail), "");
  }
  // 通过/跳过的步骤里，表格只显示了第一行的那些（多子项的计数与各子项、T12 的联想回答、T8(d) 是否适用、T14 各引擎）
  const full = results.filter(r => r.status !== "fail" && needsFull(r));
  if (full.length) {
    md.push("## 详细说明（通过与跳过的步骤）", "");
    for (const r of full) md.push(`### ${r.id} ${r.title ?? ""}（${STATUS[r.status] ?? r.status}）`, "", ...detailBody(r.detail), "");
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
    for (const n of notes) md.push(`- ${String(n).replace(/\n/g, "\n  ")}`); // 多行备注缩进，留在同一个列表项里
    md.push("");
  }
  md.push("## 未覆盖", "");
  for (const u of UNCOVERED) md.push(`- ${u}`);
  md.push("");
  return { md: md.join("\n"), json };
}
