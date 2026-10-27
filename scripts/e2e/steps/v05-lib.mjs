// v0.5 步骤（T25、B20，I18N 与 B14 的规则界面）的公共工具：模拟引擎 D、按原文编码的触发网址与期望右侧、
// 等一对规则分屏、记录形状核对、隐私核对（privacyProblems，有 node 测试），以及“带规则标记的弹窗”现场（withRulePopup）。
// 查询词一律带一次性 token（nonce），隐私核对按 token 找泄漏。
import { HOSTS, mockEngines } from "../config.mjs";
import { engineA, trigger, splitPairs, waitState, openTab, nonce, pageTargets } from "./util.mjs";
import { guarded } from "./optpage.mjs";
import { readRecords } from "./v03-lib.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";

const J = JSON.stringify;

// 模拟引擎 D：与 ec 同 host（不加 host、不重新授权），按路径区分：/search 是 D，/wiki 是 C
export const mockEngineD = port => ({ id: "ed", name: "模拟引擎 D", url: `http://${HOSTS.c}:${port}/search?q=%s` });

// trigger 要求已编码的查询串（util.mjs）；这里收原文
export const ruleTrigger = (port, raw, ss = "ea,eb") => trigger(port, encodeURIComponent(raw), ss);
// 左侧 = 触发网址去掉 _ss
export const expectLeft = (port, raw) => engineA(port, encodeURIComponent(raw));
// 右侧 = 引擎模板的 expandTemplate 结果（encodeURIComponent）
export function expectRight(port, engineId, raw) {
  const q = encodeURIComponent(raw);
  if (engineId === "ec") return `http://${HOSTS.c}:${port}/wiki/${q}`;
  if (engineId === "eb") return `http://${HOSTS.b}:${port}/search?q=${q}`;
  if (engineId === "ed") return `http://${HOSTS.c}:${port}/search?q=${q}`;
  throw new Error(`expectRight 不认识引擎 ${engineId}`);
}

export const engineName = (port, id) => [...mockEngines(port), mockEngineD(port)].find(e => e.id === id)?.name;

// 分屏记录的白名单（src/lib/split-owner.js 的 parseRecord）
export const RECORD_KEYS = ["peer", "splitViewId", "mode", "role", "input", "engine", "query", "rule", "base"];

// 纯函数：sync、local 序列化后不含任何 token；local 只有 setupDone；split:* 记录的键都在 RECORD_KEYS 里；日志不含 token
export function privacyProblems({ sync, local, session, logs }, tokens) {
  const p = [];
  const leaks = (what, text) => { for (const t of tokens) if (text.includes(t)) p.push(`${what}里出现了查询 token ${t}`); };
  leaks("storage.sync ", J(sync ?? {}));
  leaks("storage.local ", J(local ?? {}));
  const extra = Object.keys(local ?? {}).filter(k => k !== "setupDone");
  if (extra.length) p.push(`storage.local 只该有 setupDone，多了 ${extra.join(",")}`);
  for (const [k, rec] of Object.entries(session ?? {})) {
    if (!k.startsWith("split:")) continue;
    const bad = Object.keys(rec ?? {}).filter(f => !RECORD_KEYS.includes(f));
    if (bad.length) p.push(`记录 ${k} 有白名单以外的键 ${bad.join(",")}`);
  }
  for (const e of logs ?? []) leaks("日志", String(e?.text ?? ""));
  return p;
}

// 等左侧网址为 leftUrl、右侧为 rightUrl 的一对分屏（都加载完成），返回 [左, 右]
export const waitRulePair = (ctx, leftUrl, rightUrl, what = `${leftUrl} ｜ ${rightUrl}`) => waitState(ctx,
  st => splitPairs(st).find(([l, r]) => l.url === leftUrl && r.url === rightUrl && l.status === "complete" && r.status === "complete"),
  `分屏 ${what}`);

// 纯函数：一对搜索记录（分屏，mode split）的形状。L、R 是状态里的标签（带 splitViewId）。
// want = { left, right（引擎 id）, query, rule?, base? }；rule 缺省表示右侧不该带 rule/base；左侧永远不带
export function ruleRecordProblems(recs, L, R, want) {
  const p = [];
  const base = ["engine", "mode", "peer", "query", "role", "splitViewId"];
  const sides = [[L, R, want.left, null, "左"], [R, L, want.right, want.rule ? { rule: want.rule, base: want.base } : null, "右"]];
  for (const [self, peer, engine, auto, side] of sides) {
    const r = recs?.[self.id];
    if (!r || typeof r !== "object") { p.push(`${side}侧标签 ${self.id} 没有记录`); continue; }
    const keys = Object.keys(r).sort().join(",");
    const wantKeys = [...base, ...(auto ? ["base", "rule"] : [])].sort().join(",");
    if (keys !== wantKeys) p.push(`${side}侧记录的键应为 ${wantKeys}，实际 ${keys}`);
    const exp = { peer: peer.id, mode: "split", splitViewId: self.splitViewId, role: "search", engine, query: want.query, ...(auto ?? {}) };
    for (const [k, v] of Object.entries(exp)) if (r[k] !== v) p.push(`${side}侧记录 ${k} 应为 ${J(v)}，实际 ${J(r[k])}`);
  }
  return p;
}

// 关掉网址里带 token 的页面目标（token 是 nonce()，只出现在本次的触发网址、go.html 与两侧结果页里）；出错不抛
async function closeTokenTargets(ctx, token) {
  const targets = await pageTargets(ctx.browser).catch(() => []);
  for (const t of targets.filter(t => t.url.includes(token))) {
    await ctx.browser.client.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  }
}

// “带规则标记的弹窗”现场（B14 与 v05I18nChecks 共用）：写一条 wiki → ec 的规则，在新标签打开触发网址，
// 等右侧记录带 rule，再打开 popup.html?tabId=<左标签>，交给 fn(page)。结束时关弹窗和这一对标签（等不到一对时按 token 关掉触发标签），guarded 写回 rightRules。
// 不整理现场（I18N 还要用它之前建的一对）
export function withRulePopup(ctx, fn) {
  return guarded(ctx, ["rightRules"], async () => {
    await ctx.ext.eval(`chrome.storage.sync.set({ rightRules: ${J([{ id: "r1", when: "words", words: ["wiki"], engine: "ec" }])} }).then(() => true)`);
    const token = nonce();
    const raw = `wiki ${token}`;
    let page = null, pair = null;
    try {
      await openTab(ctx, ruleTrigger(ctx.port, raw));
      pair = await waitRulePair(ctx, expectLeft(ctx.port, raw), expectRight(ctx.port, "ec", raw));
      const [L, R] = pair;
      await waitState(ctx, async () => (await readRecords(ctx, [R.id]))[R.id]?.rule === "r1", "右侧记录带 rule");
      page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${L.id}` });
      return await fn(page);
    } finally {
      await page?.close();
      if (pair) await ctx.ext.eval(`chrome.tabs.remove(${J(pair.map(t => t.id))}).then(() => true, () => false)`).catch(() => false);
      // 等不到这一对时，触发标签（或已建出的一侧）还开着：按本次 token 找页面目标关掉，不留给后续检查
      await closeTokenTargets(ctx, token);
    }
  });
}
