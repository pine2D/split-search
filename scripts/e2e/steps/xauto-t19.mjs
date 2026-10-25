// xauto T19（spec 3.8 V5）：经 chrome://extensions/shortcuts 给 cycle-right 绑测试用快捷键（ext-shortcuts.mjs 的 TEST_KEYS），
// 在本扩展分屏所在的前台窗口里按真实快捷键（XTEST），断言右侧换成显示顺序里下一个参与轮换的引擎、被排除的被跳过。
// 轮换候选：cycleExclude 排除全部预置引擎（右侧不去真实网站）和 ec，只剩模拟引擎 A、B。显示顺序是预置、ea、eb、ec：
//   第 1 次按：当前右侧 eb，之后的 ec 被排除，回到开头跳过预置 → ea（可以与左侧相同）；第 2 次按：ea 之后 → eb。
// 收尾：finally 里按快照改回运行前的绑定（restoreShortcut；中断时收尾与下次启动再兜一次），cycleExclude 由 guarded 写回。
// 快捷键页结构认不出（infra）：--auto-only 判跳过，引导式运行回退到人工版本（judge：用户按快捷键并确认，脚本再读记录核对）。
import { mockEngines } from "../config.mjs";
import { PRESETS } from "../../../src/lib/engines.js";
import { expandTemplate } from "../../../src/lib/trigger.js";
import { newFocusedWindow } from "../screen.mjs";
import { deps, idle, gestureError, REASON_BUSY } from "../gesture.mjs";
import { resetTabs, findPair, waitState, siteX, nonce, trigger, expectPair, navigate } from "./util.mjs";
import { xauto, withAttempts } from "./xauto-lib.mjs";
import { query } from "./xauto.mjs";
import { readRecords, checkPairRecords, tabUrl, pairOn, queryOf } from "./v03-lib.mjs";
import { guarded } from "./optpage.mjs";
import { judge, focusGuide } from "./guided.mjs";
import { COMMAND, TEST_KEYS, SHORTCUTS_URL, bindShortcut, restoreShortcut, xdoCombo } from "../ext-shortcuts.mjs";

export const CYCLE_EXCLUDE = [...PRESETS.map(p => p.id), "ec"];
export const T19_PRESSES = ["ea", "eb"]; // 每按一次，右侧应换成的引擎
export const T19_WORDS = ["xcycle"];
const KEY_LABEL = "Alt+Shift+.（句点）";

const setExclude = ctx => ctx.ext.eval(`chrome.storage.sync.set({ cycleExclude: ${JSON.stringify(CYCLE_EXCLUDE)} }).then(() => true)`);
const engineUrl = (ctx, id, text) => expandTemplate(mockEngines(ctx.port).find(e => e.id === id).url, text);
const splitWant = (L, text) => ({ mode: "split", splitViewId: L.splitViewId, engines: ["ea", "eb"], query: text });

// 按一次后核对：右侧网址与记录换成 want，左侧网址与记录不动，仍在同一个分屏里。返回问题列表
async function afterPress(ctx, L, R, want, text) {
  const url = engineUrl(ctx, want, text);
  const st = await waitState(ctx, s => s.tabs.some(t => t.id === R.id && t.url === url && t.status === "complete") && s,
    `按快捷键后右侧 ${R.id} 打开 ${url}`, { timeoutMs: 10000 }).catch(e => ({ err: e.message }));
  if (st.err) return [st.err];
  const recs = await readRecords(ctx, [L.id, R.id]);
  const p = [];
  if (recs[R.id]?.engine !== want || recs[R.id]?.query !== text) p.push(`右侧记录应为 engine ${want}、query ${JSON.stringify(text)}，实际 ${JSON.stringify(recs[R.id])}`);
  if (recs[L.id]?.engine !== "ea" || recs[L.id]?.query !== text) p.push(`左侧记录应保持 engine ea，实际 ${JSON.stringify(recs[L.id])}`);
  if (tabUrl(st, L.id) !== L.url) p.push(`左侧应保持 ${L.url}，实际 ${tabUrl(st, L.id)}`);
  if (st.tabs.find(t => t.id === R.id)?.splitViewId !== L.splitViewId) p.push("换右侧后分屏被拆开了");
  return p;
}

// 一次尝试：整理现场 → 新开前台窗口 → 在它的标签上触发建分屏 → 按快捷键两次
async function attempt(ctx) {
  const { xi, sleep, profileDir, nested } = deps(ctx);
  await resetTabs(ctx);
  const { text, q } = query("xcycle");
  if ((await idle(xi, { sleep, ...ctx.gx.idleOpts })) === "busy") throw gestureError("skip", REASON_BUSY);
  let nf;
  try { nf = await newFocusedWindow(ctx.browser, siteX(ctx.port, `/cycle?n=${nonce()}`), { xi, profileDir, nested, ...ctx.gx.focusOpts }); }
  catch (e) { throw gestureError("env", `${e.message}（新窗口没拿到前台，未按任何键）`); }
  await navigate(ctx, nf.targetId, trigger(ctx.port, q));
  const [L, R] = await waitState(ctx, st => findPair(st, ctx.port, q), `分屏 ${expectPair(ctx.port, q).join(" ｜ ")}`, { timeoutMs: 20000 });
  const pre = checkPairRecords(await readRecords(ctx, [L.id, R.id]), L, R, splitWant(L, text));
  if (pre.length) return { status: "fail", detail: `按键前记录不对：${pre.join("；")}` };
  const done = [];
  for (const want of T19_PRESSES) {
    try { await xi.key(xdoCombo(TEST_KEYS), { expectWindow: nf.wid }); }
    catch (e) {
      await xi.releaseModifiers().catch(() => {});
      throw gestureError(/前台窗口/.test(e.message) ? "env" : "fail", e.message);
    }
    const p = await afterPress(ctx, L, R, want, text);
    if (p.length) return { status: "fail", detail: `第 ${done.length + 1} 次按 ${TEST_KEYS}：${p.join("；")}${done.length ? `（之前：${done.join("；")}）` : ""}` };
    done.push(`第 ${done.length + 1} 次 → ${want}`);
  }
  return { status: "pass", detail: `分屏 ${L.id}｜${R.id}（关键词“${text}”）：按 ${TEST_KEYS} ${done.join("，")}（ec 与预置引擎被排除、跳过），右侧网址都是 expandTemplate 的结果，左侧不动` };
}

// ---- 人工版本（judge）：快捷键能自动绑就自动绑，绑不了请用户在快捷键页自己绑、用完清除 ----
const MANUAL_Q = "t19+manual";
const fallback = {
  id: "T19", title: "快捷键换右侧：跳过被排除的引擎（人工按键，脚本核对记录）", kind: "judge", needs: [], timeoutFactor: 4,
  run: ctx => guarded(ctx, ["cycleExclude"], async () => {
    await setExclude(ctx);
    let manualBind = null;
    try {
      try { await bindShortcut(ctx.browser, COMMAND, TEST_KEYS); }
      catch (e) {
        if (e.kind !== "infra") throw e;
        if (ctx.autoOnly) return { status: "skip", detail: `${e.message}；--auto-only 不回退到人工` };
        manualBind = e.message;
      }
      const { pair: [L, R] } = await pairOn(ctx, MANUAL_Q);
      await focusGuide(ctx);
      const text = queryOf(MANUAL_Q);
      const bindStep = manualBind
        ? `0. 脚本没能自动绑定快捷键（${manualBind}）：请新开一个标签打开 ${SHORTCUTS_URL}，给 Split Search 的“${COMMAND}”命令设成 ${KEY_LABEL}；\n` : "";
      const r = await judge(ctx, {
        title: "T19 快捷键换右侧", timeoutMs: ctx.timeoutMs * 3,
        instruction: `${bindStep}1. 切到分屏所在的标签（左侧模拟引擎 A、右侧模拟引擎 B，关键词“${text}”），让它所在的窗口在前台；\n`
          + `2. 按一次 ${KEY_LABEL}。\n期望：右侧换成模拟引擎 A 的搜索（模拟引擎 C 被排除、跳过）。看到了点“通过”。`
          + (manualBind ? `\n做完后回到 ${SHORTCUTS_URL} 清除这个快捷键。` : ""),
      });
      if (r.status !== "pass") return r;
      const p = await afterPress(ctx, L, R, "ea", text);
      return p.length ? { status: "fail", detail: `用户判通过，但脚本核对不符：${p.join("；")}` }
        : { status: "pass", detail: `用户按 ${KEY_LABEL} 后右侧 ${R.id} 换成模拟引擎 A（${engineUrl(ctx, "ea", text)}），记录一致` };
    } finally {
      if (!manualBind) await restoreShortcut(ctx.browser).catch(e => ctx.log?.(`  改回快捷键失败（收尾会再试）：${e.message}`));
    }
  }),
};

export const T19 = xauto({
  id: "T19", title: "快捷键换右侧：真实按键后右侧换成下一个参与轮换的引擎、跳过被排除的（真实键盘）",
  run: ctx => guarded(ctx, ["cycleExclude"], async () => {
    await setExclude(ctx);
    try {
      try { await bindShortcut(ctx.browser, COMMAND, TEST_KEYS); }
      catch (e) {
        if (e.kind !== "infra") throw e;
        if (ctx.autoOnly) return { status: "skip", detail: `${e.message}；--auto-only 不回退到人工` };
        const r = await fallback.run(ctx);
        return { ...r, detail: `${r.detail}（自动版本做不了：${e.message}，改由人工完成）` };
      }
      return await withAttempts(ctx, () => attempt(ctx));
    } finally {
      await restoreShortcut(ctx.browser).catch(e => ctx.log?.(`  改回快捷键失败（收尾会再试）：${e.message}`));
    }
  }),
}, fallback);

export const XAUTO_T19 = [T19];
