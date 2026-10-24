// T12 用：Chrome 自动发现的 Kagi 网站搜索条目（快捷字词 kagi.com、网址 host 为 kagi.com、不是 sse2e 专用条目）。
// 这是 settings-se.mjs“只动 sse2e 条目”的唯一例外，范围限定为：给这一个条目的网址追加/改写 _ss=kagi,bing，并把它设为默认。
// 网址带 Kagi 的私有 token：读取、改写都在 chrome://settings 页面里完成，网址从不传回 Node，Node 只拿到“有没有 _ss”。
// 追加的 _ss 保留在测试配置里（下次复用）；默认引擎记进快照的 scriptDefaults，收尾由 settings-se.restore 改回运行前的默认。
import { existsSync } from "node:fs";
import { openSettingsPage, snapshot, readSnap, writeSnap, pickDefault, poll, isOurs, DEEP, SE_SNAPSHOT_FILE } from "./settings-se.mjs";

export const KAGI_KEYWORD = "kagi.com";
export const KAGI_SS = "kagi,bing";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const missing = msg => Object.assign(new Error(msg), { kind: "missing" });

// 纯逻辑（也被原样注入页面执行，所以不能引用外部名字）：网址里写入 _ss=<value>：已有 _ss 就改它的值，没有就追加；保留 # 片段与 %s
export function withSs(url, value) {
  const i = url.indexOf("#");
  const base = i < 0 ? url : url.slice(0, i), frag = i < 0 ? "" : url.slice(i);
  const re = /([?&])_ss=[^&]*/;
  if (re.test(base)) return base.replace(re, `$1_ss=${value}`) + frag;
  return `${base}${base.includes("?") ? "&" : "?"}_ss=${value}${frag}`;
}
// 网址里已经有 _ss=<value>（逗号可写成 %2C）
export function hasSs(url, value) {
  const v = value.split(",").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(?:,|%2C)");
  return new RegExp(`[?&]_ss=${v}(?:&|#|$)`, "i").test(url);
}

// 候选里挑 Chrome 自动发现的那个：快捷字词正好是 kagi.com 的优先；否则只有一个候选才用它；在“未使用的快捷字词”组里的不用
export function pickKagi(cands) {
  const list = (cands ?? []).filter(e => !isOurs(e.keyword));
  const e = list.find(x => x.keyword === KAGI_KEYWORD) ?? (list.length === 1 ? list[0] : null);
  if (!e) throw missing(list.length ? `有 ${list.length} 个指向 kagi.com 的网站搜索（${list.map(x => x.keyword).join("、")}），认不出自动发现的那个` : "chrome://settings 里没有 Chrome 自动发现的 Kagi 条目（先在 kagi.com 搜索一次）");
  if (e.group === "others") throw missing(`Kagi 条目 ${e.keyword} 在“未使用的快捷字词”里，脚本不启用它`);
  return e;
}

const LIST = `(async () => {
  const m = await import("chrome://settings/settings.js");
  const l = await m.SearchEnginesBrowserProxyImpl.getInstance().getSearchEnginesList();
  const hasSs = ${hasSs.toString()};
  const host = u => { try { return new URL(u.replace(/%s/g, "x")).hostname; } catch { return null; } };
  return ["defaults", "actives", "others"].flatMap(g => (l[g] || []).map(e => ({ e, g })))
    .filter(({ e }) => host(e.url) === "kagi.com" && e.url.includes("%s"))
    .map(({ e, g }) => ({ id: e.id, keyword: e.keyword, name: e.name, group: g, default: !!e.default, ss: hasSs(e.url, ${JSON.stringify(KAGI_SS)}) }));
})()`;

// 在页面里点“修改”，把网址输入框的值改成 withSs(原值)，再点保存。只返回 "set"
async function editSs(page, id) {
  const ev = page.ev;
  await ev(`(() => { ${DEEP} row(${id}).shadowRoot.getElementById("editIconButton").click(); return true; })()`);
  await poll(() => ev(`(() => { ${DEEP} return !!dialog(); })()`), { timeoutMs: 5000, msg: "编辑对话框没有出现" });
  await ev(`(() => { ${DEEP} const withSs = ${withSs.toString()}; const ci = dialog().shadowRoot.getElementById("queryUrl");
    const inp = ci.inputElement || ci.shadowRoot.querySelector("input"); inp.focus(); inp.value = withSs(inp.value, ${JSON.stringify(KAGI_SS)});
    inp.dispatchEvent(new Event("input", { bubbles: true, composed: true })); ci.dispatchEvent(new Event("input", { bubbles: true, composed: true })); return true; })()`);
  await sleep(800); // 异步校验完成后“保存”才可点
  const ok = await poll(() => ev(`(() => { ${DEEP} const b = dialog()?.shadowRoot.getElementById("actionButton");
    if (!b || b.disabled) return false; b.click(); return true; })()`), { timeoutMs: 4000, msg: "" }).catch(() => false);
  if (!ok) {
    await ev(`(() => { ${DEEP} dialog()?.shadowRoot.getElementById("cancel")?.click(); return true; })()`).catch(() => {});
    throw new Error("编辑 Kagi 条目时对话框校验没通过（保存按钮不可点）");
  }
  await poll(() => ev(`(() => { ${DEEP} return !dialog(); })()`), { timeoutMs: 5000, msg: "编辑对话框没有关闭" });
  return "set";
}

export async function openKagiPage(browser) {
  const p = await openSettingsPage(browser);
  return { ...p, kagiList: () => p.ev(LIST), editSs: id => editSs(p, id) };
}

// 准备 T12：Kagi 条目带上 _ss=kagi,bing、设为默认。返回 { keyword, edited, madeDefault }。
// 找不到条目抛 kind "missing"（调用方：--auto-only 跳过，引导式回退到人工版本）。opts.open / opts.file 可注入（单测）
export async function useKagi(browser, opts = {}) {
  const file = opts.file ?? SE_SNAPSHOT_FILE;
  const po = (msg) => ({ timeoutMs: opts.timeoutMs ?? 8000, intervalMs: opts.intervalMs ?? 250, msg });
  if (!existsSync(file)) await snapshot(browser, opts);
  const page = await (opts.open ?? openKagiPage)(browser);
  try {
    const e = pickKagi(await page.kagiList());
    let edited = false, madeDefault = false;
    if (!e.ss) {
      await page.editSs(e.id);
      await poll(async () => pickKagi(await page.kagiList()).ss, po(`改完读回 ${e.keyword} 的网址仍没有 _ss=${KAGI_SS}`));
      edited = true;
    }
    const cur = pickDefault(await page.list());
    if (cur?.id !== e.id) {
      // 先登记再切换：中途出错时收尾也会把默认改回去
      const snap = readSnap(file), mine = snap.scriptDefaults ?? [];
      const next = { ...snap, scriptDefaults: [...new Set([...mine, e.keyword])] };
      if (cur && !isOurs(cur.keyword) && !mine.includes(cur.keyword)) Object.assign(next, { defaultKeyword: cur.keyword, defaultName: cur.name });
      writeSnap(file, next);
      await page.rowAction(e.id, "makeDefault");
      await poll(async () => pickDefault(await page.list())?.id === e.id, po(`把 ${e.keyword} 设为默认没有生效`));
      madeDefault = true;
    }
    return { keyword: e.keyword, edited, madeDefault };
  } finally { await page.close(); }
}
