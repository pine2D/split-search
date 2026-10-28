// v0.7 自动步骤 T26：关键词规则“去掉这些词”（strip）。经 CDP 导航触发，核对左右网址（左侧只改查询参数、其余参数逐字保留、
// _ss 去掉；右侧用去词后的查询展开）、两侧记录（query 是去词后的，右侧带 rule/base）、只有规则词时不去、规则去掉 strip 后照旧，
// 以及隐私（照 T25(l)）。rightRules、customEngines、defaultPair 由 guarded 写回；查询都带一次性 token。
import { HOSTS } from "../config.mjs";
import { resetTabs, navigate, summarize, nonce } from "./util.mjs";
import { guarded } from "./optpage.mjs";
import { sub, verdict, readRecords } from "./v03-lib.mjs";
import { ruleTrigger, expectLeft, expectRight, ruleRecordProblems, waitRulePair, privacyProblems } from "./v05-lib.mjs";

const J = JSON.stringify;
export const WORD = "vd";
export const STRIP_RULE = { id: "r1", when: "words", words: [WORD], engine: "ec", strip: true };

// 纯函数：模拟引擎 A 上带额外参数的触发网址，查询按网站搜索的习惯把空格编成 +（如 q=vd+tok&src=e2e&_ss=ea,eb）
export const extraTrigger = (port, raw, extra, ss = "ea,eb") =>
  `http://${HOSTS.a}:${port}/search?q=${encodeURIComponent(raw).replace(/%20/g, "+")}&${extra}&_ss=${ss}`;
// 纯函数：去词后左侧的期望网址：只有 q 换成去词后的查询（encodeURIComponent），额外参数逐字保留，_ss 去掉
export const expectExtraLeft = (port, raw, extra) => `${expectLeft(port, raw)}&${extra}`;

// 纯函数：日志里有没有整词出现的规则词（日志不得带命中的词）
export function wordLogProblems(logs, word) {
  const re = new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, "i");
  return (logs ?? []).filter(e => re.test(String(e?.text ?? ""))).map(e => `日志里出现了规则词 ${word}：${String(e.text).slice(0, 80)}`);
}

// 一次性 token：不含规则词，免得 token 自己被当成词（整词匹配本来也不会命中，这里再保险一层）
export function makeToken(gen = () => `t${nonce()}${nonce()}`) {
  for (;;) { const t = gen(); if (!t.includes(WORD)) return t; }
}

const setRules = (ctx, rules) => ctx.ext.eval(`chrome.storage.sync.set({ rightRules: ${J(rules)} }).then(() => true)`);

// 整理现场后在 site-x 标签上打开 url，等一对 left ｜ right，核对两条记录（want 交给 ruleRecordProblems）。记录不对就抛错
async function pairOn(ctx, url, left, right, want) {
  const base = await resetTabs(ctx);
  await navigate(ctx, base.targetId, url);
  const pair = await waitRulePair(ctx, left, right);
  const p = ruleRecordProblems(await readRecords(ctx, pair.map(t => t.id)), ...pair, { left: "ea", ...want });
  if (p.length) throw new Error(p.join("；"));
  return pair;
}

const R1 = { right: "ec", rule: "r1", base: "eb" };

const stripped = (ctx, tok) => sub("(a) 去词：“vd <token>”两侧都搜 <token>，右侧是 ec；两侧记录 query 为 <token>，右侧 rule r1、base eb", async () => {
  const t = tok(), raw = `${WORD} ${t}`;
  const [L, R] = await pairOn(ctx, ruleTrigger(ctx.port, raw), expectLeft(ctx.port, t), expectRight(ctx.port, "ec", t), { ...R1, query: t });
  return { status: "pass", detail: `“${raw}”→ ${L.url} ｜ ${R.url}` };
});

const onlyWord = ctx => sub("(b) 只有规则词：“vd”不去，两侧都搜 vd，右侧是 ec（rule r1）", async () => {
  const [L, R] = await pairOn(ctx, ruleTrigger(ctx.port, WORD), expectLeft(ctx.port, WORD), expectRight(ctx.port, "ec", WORD), { ...R1, query: WORD });
  return { status: "pass", detail: `“${WORD}”→ ${L.url} ｜ ${R.url}` };
});

const extraParams = (ctx, tok) => sub("(c) 其他参数：q=vd+<token>&src=e2e&_ss=ea,eb 的左侧是 q=<token>&src=e2e（src 逐字保留、_ss 去掉）", async () => {
  const t = tok(), extra = "src=e2e";
  const url = extraTrigger(ctx.port, `${WORD} ${t}`, extra);
  const [L, R] = await pairOn(ctx, url, expectExtraLeft(ctx.port, t, extra), expectRight(ctx.port, "ec", t), { ...R1, query: t });
  return { status: "pass", detail: `${url} → ${L.url} ｜ ${R.url}` };
});

const noStrip = (ctx, tok) => sub("(d) 规则去掉 strip：“vd <token>”两侧都搜“vd <token>”，右侧仍是 ec（rule r1）", async () => {
  const { strip, ...plain } = STRIP_RULE;
  await setRules(ctx, [plain]);
  const t = tok(), raw = `${WORD} ${t}`;
  const [L, R] = await pairOn(ctx, ruleTrigger(ctx.port, raw), expectLeft(ctx.port, raw), expectRight(ctx.port, "ec", raw), { ...R1, query: raw });
  return { status: "pass", detail: `“${raw}”→ ${L.url} ｜ ${R.url}` };
});

const privacy = (ctx, tokens) => sub("(e) 隐私：sync、local、日志不含查询 token，日志不含规则词；local 只有 setupDone；记录键都在白名单内", async () => {
  const [sync, local, session] = await ctx.ext.eval(`Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null), chrome.storage.session.get(null)])`);
  const col = ctx.consoleCollector;
  const logs = col ? [...col.errors, ...col.infos] : [];
  const p = [...privacyProblems({ sync, local, session, logs }, tokens), ...wordLogProblems(logs, WORD)];
  const n = Object.keys(session).filter(k => k.startsWith("split:")).length;
  return verdict(p, `核对 ${tokens.length} 个 token：sync ${Object.keys(sync).length} 个键、local ${J(Object.keys(local))}、${n} 条记录、` +
    (col ? `${logs.length} 条日志（error + info）` : "没有控制台收集器，未查日志"));
});

const T26 = {
  id: "T26", title: "关键词规则去掉命中的词：两侧搜去词后的查询、其他参数逐字保留、只有规则词时不去、关掉后照旧、隐私（自动判定）",
  kind: "auto", needs: [], timeoutMs: 180000,
  run: ctx => guarded(ctx, ["rightRules", "customEngines", "defaultPair"], async () => {
    await ctx.ext.eval(`chrome.storage.sync.set({ defaultPair: ["ea", "eb"] }).then(() => true)`);
    await setRules(ctx, [STRIP_RULE]);
    const tokens = [];
    const tok = () => { const t = makeToken(); tokens.push(t); return t; };
    const items = [await stripped(ctx, tok), await onlyWord(ctx), await extraParams(ctx, tok), await noStrip(ctx, tok), await privacy(ctx, tokens)];
    await resetTabs(ctx).catch(() => {});
    return summarize(items);
  }),
};

export const V07_STRIP_STEPS = [T26];
