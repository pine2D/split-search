// 设置页与规则相关的自动步骤（B 系列）。Task 5 先实现 B5，其余由 Task 6 补充。
import { EXT_ID, mockEngines } from "../config.mjs";

export const REAL_HOSTS = ["www.google.com", "www.bing.com", "duckduckgo.com", "www.perplexity.ai", "kagi.com"];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 纯函数：检查 DNR 规则，返回问题列表（空表示通过）
export function checkB5(rules, port) {
  const problems = [];
  if (!Array.isArray(rules) || rules.length !== 1) return [`规则应恰好 1 条，实际 ${Array.isArray(rules) ? rules.length : "无"} 条`];
  const r = rules[0];
  if (r.id !== 1) problems.push(`规则 id 应为 1，实际 ${r.id}`);
  const domains = r.condition?.requestDomains || [];
  const engines = mockEngines(port);
  const leftMocks = engines.filter(e => e.id === "ea" || e.id === "eb").map(e => new URL(e.url.replace("%s", "x")).hostname);
  for (const h of [...REAL_HOSTS, ...leftMocks]) if (!domains.includes(h)) problems.push(`requestDomains 缺少 ${h}`);
  const pathOnly = new URL(engines.find(e => e.id === "ec").url.replace("%s", "x")).hostname;
  if (domains.includes(pathOnly)) problems.push(`requestDomains 不应包含只能作右侧的 ${pathOnly}`);
  const sub = r.action?.redirect?.regexSubstitution || "";
  const want = `chrome-extension://${EXT_ID}/go.html?u=`;
  if (!sub.startsWith(want)) problems.push(`regexSubstitution 应以 ${want} 开头，实际 ${sub || "(空)"}`);
  return problems;
}

const B5 = {
  id: "B5",
  title: "DNR 规则覆盖所有可作左侧的引擎",
  kind: "auto",
  needs: [],
  async run(ctx) {
    // 写入模拟引擎后规则是异步重建的：轮询最多 10 秒
    const end = Date.now() + 10000;
    let rules, problems;
    for (;;) {
      ({ rules } = await ctx.ext.state());
      problems = checkB5(rules, ctx.port);
      if (!problems.length || Date.now() >= end || ctx.signal?.aborted) break;
      await sleep(300);
    }
    if (problems.length) return { status: "fail", detail: problems.join("；") };
    return { status: "pass", detail: `1 条规则；requestDomains：${rules[0].condition.requestDomains.join(", ")}` };
  },
};

export const OPTIONS_STEPS = [B5];
