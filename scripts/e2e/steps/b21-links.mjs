// B21 的 hash 与语言子项（从 b21.mjs 拆出，免得单文件超过 300 行；步骤说明见 b21.mjs 文件头）：
// (m) 停在 ③ 时切换界面语言：tab 不变、hash 不变，tab 名与 ① 的读屏标记换成新语言；
// (n) 地址栏手改 hash：#setup（卡片不显示）、#tab-foo 什么都不做，#tab-lookup 换到 ④，#guide-steps 换到 ① 并写 #tab-add、焦点给 5 步说明的小标题。
// 跨 tab 链接与焦点兜底（(f)(g)(h)(k)）由后续任务加在这里。
import { openOptions, showTab, sleep } from "./optpage.mjs";
import { setDone } from "./b19.mjs";
import { sub, verdict } from "./v03-lib.mjs";
import { msgIn } from "../i18n.mjs";

const J = JSON.stringify;

// 当前选中的 tab（key）、hash、焦点、滚动位置、历史长度、选中的面板是否看得见（b21.mjs 也用）
export const NOW = `(() => { const a = document.activeElement, s = document.querySelector('[role="tab"][aria-selected="true"]');
  return { tab: s ? s.id.replace(/^tabbtn-/, "") : null, hash: location.hash, focus: a?.id || a?.tagName || "",
    scrollY: Math.round(scrollY), hist: history.length, panel: !!s && !!document.getElementById("panel-" + s.id.replace(/^tabbtn-/, ""))?.checkVisibility() }; })()`;
export const fmtNow = n => `tab ${n.tab}，hash ${J(n.hash)}，焦点 ${n.focus}`;

// (m) steps 档（① 带“未完成”标记）打开、切到 ③，把 uiLocale 写成 en（uiLocale 由 B21 的 guarded 写回）
async function localeKeepsTab(ctx) {
  await setDone(ctx, null);
  const page = await openOptions(ctx.browser);
  try {
    await showTab(page, "engines");
    await ctx.ext.eval(`chrome.storage.sync.set({ uiLocale: "en" }).then(() => true)`);
    const want = { name: msgIn("en", "options_tab_engines"), todo: msgIn("en", "options_tab_todo") };
    const READ = `({ ...${NOW}, lang: document.documentElement.lang, name: document.getElementById("tabname-engines").textContent,
      todo: document.querySelector("#tab-flag-add.todo .sr-only")?.textContent ?? null })`;
    const s = await page.until(`const s = ${READ}; return s.lang === "en" && s.name === ${J(want.name)} && s.todo === ${J(want.todo)} && s;`, 5000)
      .catch(() => page.ev(READ));
    const p = [];
    if (s.lang !== "en" || s.name !== want.name || s.todo !== want.todo) {
      p.push(`切到 en 后 lang 应为 en、tab 名“${want.name}”、① 的标记“${want.todo}”：lang ${s.lang}，“${s.name}”，“${s.todo}”`);
    }
    if (s.tab !== "engines" || s.hash !== "#tab-engines") p.push(`切换语言后应仍是 ③、hash #tab-engines：${fmtNow(s)}`);
    return verdict(p, `lang en，“${s.name}”，① 标记“${s.todo}”，${fmtNow(s)}`);
  } finally { await page.close(); }
}

// (n) 卡片不显示、已授权，停在 ③；每次改 hash 后等 100 ms 读一次
const HASHES = [
  ["#setup", n => n.tab === "engines" && n.focus === "BODY", "仍是 ③、焦点 BODY"],
  ["#tab-foo", n => n.tab === "engines", "仍是 ③"],
  ["#tab-lookup", n => n.tab === "lookup" && n.hash === "#tab-lookup", "换到 ④、hash #tab-lookup"],
  ["#guide-steps", n => n.tab === "add" && n.hash === "#tab-add" && n.focus === "guide-steps-title", "换到 ①、hash #tab-add、焦点 #guide-steps-title"],
];
async function manualHash(ctx) {
  await setDone(ctx, true);
  const page = await openOptions(ctx.browser, { tab: "engines" });
  try {
    await page.ev(`document.activeElement?.blur(); true`);
    const p = [], seen = [];
    for (const [hash, ok, want] of HASHES) {
      await page.ev(`location.hash = ${J(hash)}; true`);
      await sleep(100);
      const n = await page.ev(NOW);
      seen.push(`${hash}→${n.tab}`);
      if (!ok(n)) p.push(`改成 ${hash} 后应${want}：${fmtNow(n)}`);
    }
    return verdict(p, seen.join("；"));
  } finally { await page.close(); }
}

export async function hashLocaleChecks(ctx) {
  return [
    await sub("(m) 停在 ③ 时切换语言：tab 与 hash 不变，tab 名与标记换成新语言", () => localeKeepsTab(ctx)),
    await sub("(n) 地址栏手改 hash", () => manualHash(ctx)),
  ];
}
