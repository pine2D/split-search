// T25 的弹窗子项（设计稿 11.1 (h)(i)(j)(k)）：规则选的右侧在弹窗里说明原因、“换回”、手动换右侧去掉标记，
// 以及 ⑦ 补成分屏的建议排序与 go.html 的规则结果一致。现场一律由 v05-rules.mjs 的 rulePairOn 建（resetTabs 后触发）。
import { resetTabs, engineA, waitState } from "./util.mjs";
import { sub, verdict, readRecords } from "./v03-lib.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import { openActionPopup, openTabIn } from "./v04-lib.mjs";
import { expectLeft, expectRight, engineName, ruleRecordProblems, waitRulePair } from "./v05-lib.mjs";
import { msg } from "../i18n.mjs";

const J = JSON.stringify;

// 弹窗里的 #rule-note 一段与换右侧列表（POPUP_SNAPSHOT 不含 #rule-note，这里单独读）
const NOTE = `(() => {
  const $ = id => document.getElementById(id), note = $("rule-note"), revert = $("rule-revert");
  const first = document.querySelector("#choices button");
  return { shown: !!note && note.checkVisibility(), text: $("rule-note-text")?.textContent ?? "",
    revert: revert && revert.checkVisibility() ? revert.textContent : null,
    choices: [...document.querySelectorAll("#choices button")].map(b => b.dataset.engine),
    focusFirst: !!first && document.activeElement === first, focus: document.activeElement?.id || document.activeElement?.tagName };
})()`;
const readNote = page => page.ev(NOTE);
const untilNote = (ctx, page, pred, what) => ctx.browser.waitFor(async () => { const n = await readNote(page); return pred(n) && n; },
  { timeoutMs: 10000, intervalMs: 150 }).catch(e => { throw new Error(`弹窗没有等到：${what}（${e.message}）`); });

// 右侧标签 R 换到 url，返回新状态里的 [L, R]（分屏不拆）
const waitRight = (ctx, L, R, url) => waitState(ctx, st => {
  const l = st.tabs.find(t => t.id === L.id), r = st.tabs.find(t => t.id === R.id);
  return l && r && r.url === url && r.status === "complete" && r.splitViewId === L.splitViewId && l.splitViewId === L.splitViewId && [l, r];
}, `右侧 ${R.id} 打开 ${url}`);

async function withPopup(ctx, L, fn) {
  const page = await popupPage(ctx, { url: `${POPUP_URL}?tabId=${L.id}` });
  try { await page.read(); return await fn(page); } finally { await page.close(); }
}

export const popupRevert = (ctx, rulePairOn, tok) => sub("(h) 弹窗说明与换回：写明命中的词和规则引擎，“换回”默认右侧后标记消失、说明隐藏、焦点给换右侧列表第一个", async () => {
  const raw = `wiki ${tok()}`;
  const [L, R] = await rulePairOn(ctx, raw, "ec", { rule: "r2" });
  return withPopup(ctx, L, async page => {
    const p = [];
    const n = await untilNote(ctx, page, x => x.shown, "#rule-note 显示");
    const want = msg("popup_rule_word", "wiki", engineName(ctx.port, "ec"));
    const wantRevert = msg("popup_rule_revert", engineName(ctx.port, "eb"));
    if (n.text !== want) p.push(`说明应为“${want}”，实际“${n.text}”`);
    if (n.revert !== wantRevert) p.push(`“换回”按钮应为“${wantRevert}”，实际 ${J(n.revert)}`);
    if (n.choices.includes("eb")) p.push(`换右侧列表不该再列 eb（已有“换回”），实际 ${n.choices.join(",")}`);
    if (p.length) return verdict(p, "");
    await page.ev(`document.getElementById("rule-revert").click(); true`);
    const url = expectRight(ctx.port, "eb", raw);
    const [l, r] = await waitRight(ctx, L, R, url);
    p.push(...ruleRecordProblems(await readRecords(ctx, [l.id, r.id]), l, r, { left: "ea", right: "eb", query: raw }));
    const after = await untilNote(ctx, page, x => !x.shown && x.focusFirst, "说明隐藏、焦点在换右侧列表第一个按钮")
      .catch(async e => { p.push(`${e.message}；实际 ${J(await readNote(page))}`); return null; });
    return verdict(p, `“${n.text}”“${n.revert}”；点换回后右侧 ${url}、记录无 rule/base，说明隐藏${after ? "、焦点在列表第一个" : ""}`);
  });
});

export const popupScript = (ctx, rulePairOn, tok) => sub("(i) 弹窗按文字：说明写“汉字”", async () => {
  const raw = `苹果 ${tok()}`;
  const [L] = await rulePairOn(ctx, raw, "ed", { rule: "r3" });
  return withPopup(ctx, L, async page => {
    const want = msg("popup_rule_script", msg("script_han"), engineName(ctx.port, "ed"));
    const n = await untilNote(ctx, page, x => x.shown, "#rule-note 显示");
    return verdict(n.text === want ? [] : [`说明应为“${want}”，实际“${n.text}”`], `说明“${n.text}”`);
  });
});

export const popupManual = (ctx, rulePairOn, tok) => sub("(j) 手动换右侧：在弹窗里点 ed，右侧换成 ed、记录去掉 rule/base", async () => {
  const raw = `wiki ${tok()}`;
  const [L, R] = await rulePairOn(ctx, raw, "ec", { rule: "r2" });
  return withPopup(ctx, L, async page => {
    if (!(await page.click("ed"))) return { status: "fail", detail: `换右侧列表里没有 ed（${J((await readNote(page)).choices)}）` };
    const url = expectRight(ctx.port, "ed", raw);
    const [l, r] = await waitRight(ctx, L, R, url);
    const p = ruleRecordProblems(await readRecords(ctx, [l.id, r.id]), l, r, { left: "ea", right: "ed", query: raw });
    return verdict(p, `右侧换成 ${url}，记录无 rule/base`);
  });
});

export const completeSuggest = (ctx, tok) => sub("(k) ⑦ 补成分屏：没有 _ss 的结果页，建议排第一的是规则引擎 ec；点它建对，记录无 rule", async () => {
  const raw = `wiki ${tok()}`;
  const base = await resetTabs(ctx);
  const T = await openTabIn(ctx, base.windowId, engineA(ctx.port, encodeURIComponent(raw)));
  const page = await openActionPopup(ctx, T.tabTargetId);
  try {
    const s = await page.read();
    const p = [];
    if (!s.complete) return { status: "fail", detail: `弹窗应显示“补成分屏”区，实际 ${J({ ours: s.ours, notOurs: s.notOursText })}` };
    if (s.suggested !== "ec" || s.completeChoices[0] !== "ec") p.push(`建议应是 ec 且排第一，实际建议 ${s.suggested}、顺序 ${s.completeChoices.join(",")}`);
    if (p.length) return verdict(p, "");
    if (!(await page.click("ec", "complete-choices"))) return { status: "fail", detail: "“补成分屏”区里找不到 ec" };
    const [l, r] = await waitRulePair(ctx, expectLeft(ctx.port, raw), expectRight(ctx.port, "ec", raw));
    if (l.id !== T.id) p.push(`左侧应是原标签 ${T.id}，实际 ${l.id}`);
    p.push(...ruleRecordProblems(await readRecords(ctx, [l.id, r.id]), l, r, { left: "ea", right: "ec", query: raw }));
    return verdict(p, `建议 ec 排第一（${s.completeChoices.join(",")}）；点后建成 ${l.id}｜${r.id}，记录无 rule`);
  } finally { await page.close(); }
});
