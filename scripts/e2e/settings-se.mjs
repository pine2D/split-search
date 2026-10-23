// 网站搜索自动管理：经 CDP 操作 chrome://settings/searchEngines（WebUI 的 shadow DOM，按元素 id 点击），
// 只增删改脚本专用的 sse2e 前缀快捷字词；用户的其他条目只会被“设为默认”（恢复运行前的默认引擎时）。
// 快照 .e2e/settings-snapshot.json 只记默认引擎的 keyword/name 和专用快捷字词，不记任何网址
// （Kagi 条目的网址带私有 token）。读回用 SearchEnginesBrowserProxyImpl.getSearchEnginesList()，
// 非专用条目的网址在页面里就丢掉，不传回 Node。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { OUT_DIR } from "./ext.mjs";

export const PREFIX = "sse2e";
export const SE_SNAPSHOT_FILE = join(OUT_DIR, "settings-snapshot.json");
const SETTINGS_URL = "chrome://settings/searchEngines";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const isOurs = kw => typeof kw === "string" && kw.startsWith(PREFIX);
function assertOurs(kw) {
  if (!isOurs(kw)) throw new Error(`只允许操作 ${PREFIX} 前缀的快捷字词，拒绝：${kw}`);
}

// ---- 页面驱动（真实 chrome://settings）----
const DEEP = `const deepAll = (sel, root = document) => { const out = []; const walk = r => { out.push(...r.querySelectorAll(sel));
  for (const el of r.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); }; walk(root); return out; };
  const deep = (sel, root) => deepAll(sel, root)[0];
  const row = id => { const r = deepAll("settings-search-engine-entry").find(x => x.engine && x.engine.id === id);
    if (!r) throw new Error("页面上找不到条目行 " + id); return r; };
  const dialog = () => { const d = deep("settings-search-engine-edit-dialog"); const c = d && d.shadowRoot.querySelector("cr-dialog");
    return c && c.open ? d : null; };`;
const LIST_EXPR = `(async () => {
  const m = await import("chrome://settings/settings.js");
  const l = await m.SearchEnginesBrowserProxyImpl.getInstance().getSearchEnginesList();
  return [...(l.defaults || []), ...(l.actives || []), ...(l.others || [])].map(e => ({ id: e.id, name: e.name, keyword: e.keyword,
    default: !!e.default, confirm: !!e.shouldConfirmRemoval, url: e.keyword.startsWith(${JSON.stringify(PREFIX)}) ? e.url : null }));
})()`;
const ACTIONS = new Set(["makeDefault", "delete"]);

async function poll(fn, { timeoutMs = 8000, intervalMs = 250, msg = "等待超时" } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= end) throw new Error(msg);
    await sleep(intervalMs);
  }
}

export async function openSettingsPage(browser) {
  const { client, evaluate } = browser;
  const { targetId } = await client.send("Target.createTarget", { url: SETTINGS_URL, background: true });
  let sid;
  const close = async () => {
    if (sid) await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
  };
  try {
    sid = await browser.attach(targetId);
    const ev = expr => evaluate(sid, expr, { timeoutMs: 10000 });
    await poll(() => ev(`(() => { ${DEEP} return !!deep("#addSearchEngine") && deepAll("settings-search-engine-entry").length > 0; })()`)
      .catch(() => false), { timeoutMs: 15000, msg: "chrome://settings 搜索引擎页没有加载出来" });
    const fill = async e => {
      await poll(() => ev(`(() => { ${DEEP} return !!dialog(); })()`), { timeoutMs: 5000, msg: "编辑对话框没有出现" });
      await ev(`(() => { ${DEEP} const d = dialog();
        for (const [id, v] of Object.entries(${JSON.stringify({ searchEngine: e.name, keyword: e.keyword, queryUrl: e.url })})) {
          const ci = d.shadowRoot.getElementById(id); const inp = ci.inputElement || ci.shadowRoot.querySelector("input");
          inp.focus(); inp.value = v; inp.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          ci.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        } return true; })()`);
      await sleep(800); // 异步校验完成后“保存/添加”按钮才可点
      const ok = await poll(() => ev(`(() => { ${DEEP} const d = dialog(); const b = d && d.shadowRoot.getElementById("actionButton");
        if (!b || b.disabled) return false; b.click(); return true; })()`), { timeoutMs: 4000, msg: "" }).catch(() => false);
      if (!ok) {
        const bad = await ev(`(() => { ${DEEP} const d = dialog(); if (!d) return "对话框已关闭";
          const r = ["searchEngine", "keyword", "queryUrl"].filter(i => d.shadowRoot.getElementById(i).invalid).join(",");
          const c = d.shadowRoot.getElementById("cancel"); if (c) c.click(); return r || "按钮不可点"; })()`).catch(e => e.message);
        throw new Error(`网站搜索对话框校验没通过（${bad}）`);
      }
      await poll(() => ev(`(() => { ${DEEP} return !dialog(); })()`), { timeoutMs: 5000, msg: "编辑对话框没有关闭" });
    };
    return {
      list: () => ev(LIST_EXPR),
      add: async e => { await ev(`(() => { ${DEEP} deep("#addSearchEngine").click(); return true; })()`); await fill(e); },
      edit: async (id, e) => { await ev(`(() => { ${DEEP} row(${id}).shadowRoot.getElementById("editIconButton").click(); return true; })()`); await fill(e); },
      // 先点行尾“更多操作”（按 class，不依赖界面语言的 aria-label），再点菜单里按 id 找到的按钮
      rowAction: async (id, action) => {
        if (!ACTIONS.has(action)) throw new Error(`未知操作：${action}`);
        await ev(`(() => { ${DEEP} const b = row(${id}).shadowRoot.querySelector("cr-icon-button.icon-more-vert");
          if (!b) throw new Error("找不到“更多操作”按钮"); b.click(); return true; })()`);
        await sleep(300);
        await ev(`(() => { ${DEEP} const b = row(${id}).shadowRoot.querySelector("button#${action}");
          if (!b || b.hidden) throw new Error("菜单里没有 ${action}"); b.click(); return true; })()`);
      },
      close,
    };
  } catch (e) { await close(); throw e; }
}

// ---- 逻辑层（opts.open 可注入假页面，opts.file 可换快照路径）----
async function withPage(browser, opts, fn) {
  const page = await (opts.open ?? openSettingsPage)(browser);
  try { return await fn(page); } finally { await page.close(); }
}
const pollOpts = (opts, msg) => ({ timeoutMs: opts.timeoutMs ?? 8000, intervalMs: opts.intervalMs ?? 250, msg });
const readSnap = file => JSON.parse(readFileSync(file, "utf8"));
function writeSnap(file, snap) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(snap, null, 2));
  renameSync(`${file}.tmp`, file);
}
const pickDefault = list => list.find(e => e.default);
function findEntry(list, keyword, name) {
  const all = list.filter(e => e.keyword === keyword);
  return all.find(e => e.name === name) ?? all[0];
}

async function doMakeDefault(page, keyword, opts, name) {
  const list = await page.list();
  const t = findEntry(list, keyword, name);
  if (!t) throw new Error(`找不到快捷字词为 ${keyword} 的网站搜索`);
  if (t.default) return;
  await page.rowAction(t.id, "makeDefault");
  await poll(async () => pickDefault(await page.list())?.id === t.id, pollOpts(opts, `设为默认没有生效：${keyword}`))
    .catch(() => { throw new Error(`设为默认没有生效：${keyword}`); });
}

async function doRemove(page, keyword, opts) {
  assertOurs(keyword);
  const hits = (await page.list()).filter(e => e.keyword === keyword);
  if (!hits.length) return false;
  if (hits.some(e => e.default)) throw new Error(`${keyword} 是当前默认引擎，先把默认改回去再删除`);
  for (const e of hits) {
    if (e.confirm) throw new Error(`${keyword} 删除需要确认，脚本不处理`);
    await page.rowAction(e.id, "delete");
  }
  await poll(async () => !(await page.list()).some(e => e.keyword === keyword), pollOpts(opts, `删除后读回仍有 ${keyword}`));
  return true;
}

export async function snapshot(browser, opts = {}) {
  const file = opts.file ?? SE_SNAPSHOT_FILE;
  if (existsSync(file)) throw new Error(`网站搜索快照已存在：${file}（应先恢复它，不能覆盖）`);
  return withPage(browser, opts, async page => {
    const list = await page.list();
    const def = pickDefault(list);
    if (!def) throw new Error("读不到当前默认搜索引擎");
    if (isOurs(def.keyword)) throw new Error(`当前默认引擎是专用条目 ${def.keyword}，无法确定运行前的默认引擎；请先在测试浏览器里改回`);
    const snap = { defaultKeyword: def.keyword, defaultName: def.name, ours: [...new Set(list.filter(e => isOurs(e.keyword)).map(e => e.keyword))] };
    writeSnap(file, snap);
    return snap;
  });
}

// 返回 "unchanged" | "added" | "updated"
export async function ensure(browser, entry, opts = {}) {
  const { keyword, name, url } = entry;
  assertOurs(keyword);
  if (!name || typeof url !== "string" || !url.includes("%s")) throw new Error(`网站搜索条目不完整：${keyword}`);
  const file = opts.file ?? SE_SNAPSHOT_FILE;
  return withPage(browser, opts, async page => {
    const ex = (await page.list()).find(e => e.keyword === keyword);
    if (ex && ex.url === url && ex.name === name) return "unchanged";
    // 先登记再动手：中途崩溃时恢复也会删掉它（恢复本来就会删全部 sse2e 条目，这里是双保险）
    if (existsSync(file)) {
      const snap = readSnap(file);
      if (!snap.ours.includes(keyword)) writeSnap(file, { ...snap, ours: [...snap.ours, keyword] });
    }
    if (ex) await page.edit(ex.id, { keyword, name, url });
    else await page.add({ keyword, name, url });
    await poll(async () => (await page.list()).some(e => e.keyword === keyword && e.url === url && e.name === name),
      pollOpts(opts, "")).catch(() => { throw new Error(`读回没有看到网站搜索 ${keyword}`); });
    return ex ? "updated" : "added";
  });
}

export const makeDefault = (browser, keyword, opts = {}) => withPage(browser, opts, page => doMakeDefault(page, keyword, opts));

export async function remove(browser, keyword, opts = {}) {
  assertOurs(keyword); // 先于打开页面
  return withPage(browser, opts, page => doRemove(page, keyword, opts));
}

// 先把默认改回运行前的条目，再删除全部 sse2e 条目；读回核对通过后才删快照文件，任何失败都保留它
export async function restore(browser, opts = {}) {
  const file = opts.file ?? SE_SNAPSHOT_FILE;
  const snap = readSnap(file);
  return withPage(browser, opts, async page => {
    await doMakeDefault(page, snap.defaultKeyword, opts, snap.defaultName);
    const now = (await page.list()).filter(e => isOurs(e.keyword)).map(e => e.keyword);
    const removed = [];
    for (const kw of [...new Set([...(snap.ours || []), ...now])].filter(isOurs)) {
      if (await doRemove(page, kw, opts)) removed.push(kw);
    }
    const after = await page.list();
    if (pickDefault(after)?.keyword !== snap.defaultKeyword || after.some(e => isOurs(e.keyword))) {
      throw new Error(`恢复后读回的网站搜索不符合快照，快照文件已保留：${file}`);
    }
    unlinkSync(file);
    return { defaultKeyword: snap.defaultKeyword, removed };
  });
}

export async function restorePending(browser, opts = {}) {
  if (!existsSync(opts.file ?? SE_SNAPSHOT_FILE)) return false;
  await restore(browser, opts);
  return true;
}

// ctx.se：绑定当前浏览器（重启后 getBrowser 返回新的）。ensure 前没有快照就先拍一个，保证结束时能恢复
export function bindSettings(getBrowser, opts = {}) {
  const file = opts.file ?? SE_SNAPSHOT_FILE;
  return {
    ensure: async entry => {
      assertOurs(entry.keyword);
      if (!existsSync(file)) await snapshot(getBrowser(), opts);
      return ensure(getBrowser(), entry, opts);
    },
    makeDefault: keyword => makeDefault(getBrowser(), keyword, opts),
    remove: keyword => remove(getBrowser(), keyword, opts),
    restore: () => restore(getBrowser(), opts),
    hasSnapshot: () => existsSync(file),
  };
}
