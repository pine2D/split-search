// v0.5 自动步骤 T25（设计稿 11.1）：按关键词换右侧。经 CDP 导航触发（中文查询也不走键盘），
// 核对左右网址、两侧记录（只有右侧带 rule/base）、复用、显式组合、弹窗（v05-rules-popup.mjs）和隐私。
// 规则、模拟引擎 D、默认组合都在 guarded 里写，结束写回；查询都带一次性 token，(l) 按 token 找泄漏。
import { resetTabs, navigate, waitState, waitTarget, summarize, nonce } from "./util.mjs";
import { guarded, addCustom } from "./optpage.mjs";
import { sub, verdict, readRecords } from "./v03-lib.mjs";
import { mockEngineD, ruleTrigger, expectLeft, expectRight, ruleRecordProblems, waitRulePair, privacyProblems } from "./v05-lib.mjs";
import { popupRevert, popupScript, popupManual, completeSuggest } from "./v05-rules-popup.mjs";

const J = JSON.stringify;

// 顺序即优先级：r1 例外（存 keep 标记，不存 eb）；r4 等于左侧、r5 引擎不存在，都暂不生效
export const T25_RULES = [
  { id: "r1", when: "words", words: ["keep"], keep: true },
  { id: "r2", when: "words", words: ["wiki", "百科"], engine: "ec" },
  { id: "r3", when: "script", script: "han", engine: "ed" },
  { id: "r4", when: "words", words: ["zz"], engine: "ea" },
  { id: "r5", when: "words", words: ["gone"], engine: "zz-gone" },
];

const setSync = (ctx, obj) => ctx.ext.eval(`chrome.storage.sync.set(${J(obj)}).then(() => true)`);
const errorCount = ctx => ctx.consoleCollector?.errors?.length ?? 0;

// 整理现场后在 site-x 标签上触发 raw，等一对 ea ｜ rightId，再核对记录（auto：{ rule, base? }，缺省表示右侧不该带标记）。
// 返回 [左, 右]；记录不对就抛错（子项判失败，原因写在异常里）
async function rulePairOn(ctx, raw, rightId, auto = null, ss = "ea,eb") {
  const base = await resetTabs(ctx);
  await navigate(ctx, base.targetId, ruleTrigger(ctx.port, raw, ss));
  const pair = await waitRulePair(ctx, expectLeft(ctx.port, raw), expectRight(ctx.port, rightId, raw));
  const want = { left: "ea", right: rightId, query: raw, ...(auto ? { rule: auto.rule, base: auto.base ?? "eb" } : {}) };
  const p = ruleRecordProblems(await readRecords(ctx, pair.map(t => t.id)), ...pair, want);
  if (p.length) throw new Error(p.join("；"));
  return pair;
}

// 一个子项里依次触发若干查询：cases = [[raw, rightId, auto?, ss?]]
const triggers = (ctx, name, cases) => sub(name, async () => {
  for (const [raw, right, auto, ss] of cases) await rulePairOn(ctx, raw, right, auto, ss);
  return { status: "pass", detail: cases.map(([raw, right, auto]) => `“${raw}”→ ${right}${auto ? `（${auto.rule}）` : "（无 rule）"}`).join("；") };
});

// (f) 复用：在 wiki 那一对的左侧再搜两次，同一对按新关键词重新比
const reuse = (ctx, tok) => sub("(f) 复用：同一对按新关键词重新比，标记随之消失、出现；分屏不变、没有新标签", async () => {
  const first = `wiki ${tok()}`;
  const [L, R] = await rulePairOn(ctx, first, "ec", { rule: "r2" });
  const n0 = (await ctx.ext.state()).tabs.length;
  const steps = [];
  let leftUrl = L.url;
  for (const [raw, right, auto] of [[`plain ${tok()}`, "eb", null], [`wiki ${tok()}`, "ec", { rule: "r2", base: "eb" }]]) {
    const target = await waitTarget(ctx, t => t.url === leftUrl, leftUrl);
    await navigate(ctx, target.targetId, ruleTrigger(ctx.port, raw));
    const [lUrl, rUrl] = [expectLeft(ctx.port, raw), expectRight(ctx.port, right, raw)];
    const st = await waitState(ctx, s => {
      const l = s.tabs.find(t => t.id === L.id), r = s.tabs.find(t => t.id === R.id);
      return l && r && l.url === lUrl && r.url === rUrl && l.status === "complete" && r.status === "complete" && s;
    }, `同一对换成 ${lUrl} ｜ ${rUrl}`);
    const [l, r] = [L.id, R.id].map(id => st.tabs.find(t => t.id === id));
    const p = [];
    if (l.splitViewId !== L.splitViewId || r.splitViewId !== L.splitViewId) p.push(`splitViewId 应保持 ${L.splitViewId}，实际 ${l.splitViewId}/${r.splitViewId}`);
    if (st.tabs.length !== n0) p.push(`标签数从 ${n0} 变成 ${st.tabs.length}`);
    p.push(...ruleRecordProblems(await readRecords(ctx, [l.id, r.id]), l, r, { left: "ea", right, query: raw, ...(auto ?? {}) }));
    if (p.length) return verdict(p.map(x => `“${raw}”：${x}`), "");
    steps.push(`“${raw}”→ ${right}${auto ? "（r2）" : "（无 rule）"}`);
    leftUrl = lUrl;
  }
  return { status: "pass", detail: `${L.id}｜${R.id}（splitViewId ${L.splitViewId}）：${steps.join("；")}` };
});

// (c') 例外跟着默认组合：默认组合改成 ea ｜ ed，r1 仍是例外，右侧是新的默认右侧
const keepFollows = (ctx, tok) => sub("(c') 例外跟着默认组合：默认组合改成 ea ｜ ed 后，keep 规则命中，右侧是 ed、不是 eb", async () => {
  await setSync(ctx, { defaultPair: ["ea", "ed"] });
  try {
    const raw = `keep wiki ${tok()}`;
    await rulePairOn(ctx, raw, "ed", null, "ea,ed");
    return { status: "pass", detail: `“${raw}”（_ss=ea,ed）→ ed，记录无 rule` };
  } finally { await setSync(ctx, { defaultPair: ["ea", "eb"] }); }
});

const offRules = (ctx, tok) => sub("(e) 暂不生效：等于左侧（r4）、引擎已删（r5）的规则被跳过，右侧是 eb，没有新的扩展控制台错误", async () => {
  const n0 = errorCount(ctx);
  const cases = [[`zz ${tok()}`], [`gone ${tok()}`]];
  for (const [raw] of cases) await rulePairOn(ctx, raw, "eb");
  const fresh = (ctx.consoleCollector?.errors ?? []).slice(n0);
  if (fresh.length) return { status: "fail", detail: `新增 ${fresh.length} 条扩展控制台错误：${fresh.slice(0, 3).map(e => e.text).join("；")}` };
  return { status: "pass", detail: `${cases.map(c => `“${c[0]}”`).join("、")}→ eb，无 rule${ctx.consoleCollector ? "，无新控制台错误" : "（没有控制台收集器，未查控制台错误）"}` };
});

const privacy = (ctx, tokens) => sub("(l) 隐私：sync、local、日志不含查询 token；local 只有 setupDone；记录键都在白名单内", async () => {
  const [sync, local, session] = await ctx.ext.eval(`Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null), chrome.storage.session.get(null)])`);
  const col = ctx.consoleCollector;
  const logs = col ? [...col.errors, ...col.infos] : [];
  const p = privacyProblems({ sync, local, session, logs }, tokens);
  const n = Object.keys(session).filter(k => k.startsWith("split:")).length;
  return verdict(p, `核对 ${tokens.length} 个 token：sync ${Object.keys(sync).length} 个键、local ${J(Object.keys(local))}、${n} 条记录、` +
    (col ? `${logs.length} 条日志（error + info）` : "没有控制台收集器，未查日志"));
});

const T25 = {
  id: "T25", title: "按关键词换右侧：词、文字、例外、暂不生效、复用、显式组合、弹窗说明与换回、补成分屏建议、隐私（自动判定）",
  kind: "auto", needs: [], timeoutMs: 300000,
  run: ctx => guarded(ctx, ["customEngines", "rightRules", "defaultPair", "presetOverrides"], async () => {
    await addCustom(ctx.ext, mockEngineD(ctx.port));
    await setSync(ctx, { defaultPair: ["ea", "eb"] });
    await ctx.ext.eval(`chrome.storage.sync.remove("rightRules").then(() => true)`);
    const tokens = [];
    const tok = () => { const t = `t${nonce()}${nonce()}`; tokens.push(t); return t; };
    const items = [await triggers(ctx, "(a0) 没有规则：与 v0.4 相同，两侧记录都没有 rule/base", [[`plain ${tok()}`, "eb"]])];
    await setSync(ctx, { rightRules: T25_RULES });
    items.push(await triggers(ctx, "(a) 词命中：wiki 换成 ec，右侧记录 rule r2、base eb，左侧不带", [[`wiki ${tok()}`, "ec", { rule: "r2" }]]));
    items.push(await triggers(ctx, "(b) 英文整词：wikis 不命中", [[`wikis ${tok()}`, "eb"]]));
    items.push(await triggers(ctx, "(c) 例外：keep 规则先命中，右侧保持 eb，不往下比", [[`keep wiki ${tok()}`, "eb"]]));
    items.push(await keepFollows(ctx, tok));
    items.push(await triggers(ctx, "(d) 文字与顺序：有汉字换成 ed（r3）；百科排在汉字前面，换成 ec（r2）",
      [[`苹果 ${tok()}`, "ed", { rule: "r3" }], [`百科 ${tok()}`, "ec", { rule: "r2" }]]));
    items.push(await offRules(ctx, tok));
    items.push(await reuse(ctx, tok));
    items.push(await triggers(ctx, "(g) 显式组合：_ss=ea,ed 不比规则，右侧是 ed（/search）、不是 ec", [[`wiki ${tok()}`, "ed", null, "ea,ed"]]));
    items.push(await popupRevert(ctx, rulePairOn, tok));
    items.push(await popupScript(ctx, rulePairOn, tok));
    items.push(await popupManual(ctx, rulePairOn, tok));
    items.push(await completeSuggest(ctx, tok));
    items.push(await privacy(ctx, tokens));
    await resetTabs(ctx).catch(() => {});
    return summarize(items);
  }),
};

export const V05_RULE_STEPS = [T25];
