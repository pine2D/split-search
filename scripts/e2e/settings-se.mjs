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

// sse2e 或 sse2e-<小写字母数字段>（段可多个，对应引擎 id 里的连字符）；sse2efoo 这类用户条目不算
const OURS_RE = /^sse2e(-[a-z0-9]+)*$/;
export const isOurs = kw => typeof kw === "string" && OURS_RE.test(kw);
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
  const ours = new RegExp(${JSON.stringify(OURS_RE.source)});
  return ["defaults", "actives", "others"].flatMap(g => (l[g] || []).map(e => ({ id: e.id, name: e.name, keyword: e.keyword, group: g,
    default: !!e.default, canBeDefault: e.canBeDefault !== false, prepopulated: !!e.isPrepopulated, confirm: !!e.shouldConfirmRemoval,
    url: ours.test(e.keyword) ? e.url : null })));
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
  // 单独的后台窗口：不改动步骤用来测量标签的那个窗口的标签栏；关闭标签即关闭窗口
  const { targetId } = await client.send("Target.createTarget", { url: SETTINGS_URL, newWindow: true, background: true });
  let sid;
  const close = async () => {
    if (sid) await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
    // closeTarget 先于窗口真正消失返回；等它从目标列表里消失，免得调用方紧接着数窗口/标签时多算一个
    await poll(async () => !(await browser.targets()).some(t => t.targetId === targetId), { timeoutMs: 3000, intervalMs: 100 }).catch(() => {});
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
  await poll(async () => pickDefault(await page.list())?.id === t.id, pollOpts(opts, "读回的默认引擎没变"))
    .catch(e => { throw new Error(`设为默认没有生效：${keyword}（${e.message}）`); });
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
      pollOpts(opts, "等待超时")).catch(e => { throw new Error(`读回没有看到网站搜索 ${keyword}（${e.message}）`); });
    return ex ? "updated" : "added";
  });
}

export const makeDefault = (browser, keyword, opts = {}) => withPage(browser, opts, page => doMakeDefault(page, keyword, opts));

export async function remove(browser, keyword, opts = {}) {
  assertOurs(keyword); // 先于打开页面
  return withPage(browser, opts, page => doRemove(page, keyword, opts));
}

// 快照里的默认引擎不在了时选谁：当前默认不是专用条目就保持不动；仍是专用条目则改为预置 Google，
// 没有就取 defaults 组里第一个可设为默认的非专用条目
function fallbackDefault(list) {
  const cur = pickDefault(list);
  if (cur && !isOurs(cur.keyword)) return { entry: cur, change: false };
  const ok = e => !isOurs(e.keyword) && e.canBeDefault !== false;
  const e = list.find(x => ok(x) && x.prepopulated && x.keyword === "google.com") ?? list.find(x => ok(x) && x.group === "defaults");
  if (!e) throw new Error("快照里的默认引擎已不存在，也找不到可以设为默认的其他条目");
  return { entry: e, change: true };
}

// 先把默认改回运行前的条目，再删除全部 sse2e 条目，读回核对。幂等：状态已经对就只核对。
// opts.keepFile：核对通过也保留快照（Chrome 要正常退出才保证写进磁盘，由调用方在正常关闭后删除），
// 此时若默认引擎换成了兜底条目，快照改写为实际生效的那个，下次核对不再重复提示。任何失败都保留快照
export async function restore(browser, opts = {}) {
  const file = opts.file ?? SE_SNAPSHOT_FILE;
  const snap = readSnap(file);
  return withPage(browser, opts, async page => {
    const list = await page.list();
    let def = findEntry(list, snap.defaultKeyword, snap.defaultName), warning = null;
    if (def) await doMakeDefault(page, def.keyword, opts, def.name);
    else {
      const fb = fallbackDefault(list);
      def = fb.entry;
      if (fb.change) {
        await doMakeDefault(page, def.keyword, opts, def.name);
        warning = `快照里的默认引擎已不存在，已改为 ${def.name}`;
      } else warning = `快照里的默认引擎 ${snap.defaultName}（${snap.defaultKeyword}）已不存在，保持当前默认 ${def.name}`;
    }
    const now = (await page.list()).filter(e => isOurs(e.keyword)).map(e => e.keyword);
    const removed = [];
    for (const kw of [...new Set([...(snap.ours || []), ...now])].filter(isOurs)) {
      if (await doRemove(page, kw, opts)) removed.push(kw);
    }
    const after = await page.list();
    if (pickDefault(after)?.keyword !== def.keyword || after.some(e => isOurs(e.keyword))) {
      throw new Error(`恢复后读回的网站搜索不符合快照，快照文件已保留：${file}`);
    }
    if (!opts.keepFile) unlinkSync(file);
    else if (warning) writeSnap(file, { ...snap, defaultKeyword: def.keyword, defaultName: def.name });
    return { defaultKeyword: def.keyword, removed, warning };
  });
}

// 正常关闭浏览器之后调用：删除已核对过的快照
export function dropSnapshot(file = SE_SNAPSHOT_FILE) {
  if (existsSync(file)) unlinkSync(file);
}

export async function restorePending(browser, opts = {}) {
  if (!existsSync(opts.file ?? SE_SNAPSHOT_FILE)) return false;
  await restore(browser, opts);
  return true;
}

// ctx.se：绑定当前浏览器（重启后 getBrowser 返回新的）。ensure / makeDefault 前没有快照就先拍一个，保证结束时能恢复。
// 步骤只能把默认切到 sse2e 条目；切回用户条目只在 restore 里做
export function bindSettings(getBrowser, opts = {}) {
  const file = opts.file ?? SE_SNAPSHOT_FILE;
  const guarded = fn => async (keyword, ...rest) => {
    assertOurs(keyword);
    if (!existsSync(file)) await snapshot(getBrowser(), opts);
    return fn(getBrowser(), keyword, ...rest);
  };
  return {
    ensure: entry => guarded((b, _kw, e) => ensure(b, e, opts))(entry?.keyword, entry),
    makeDefault: guarded((b, kw) => makeDefault(b, kw, opts)),
    remove: keyword => remove(getBrowser(), keyword, opts),
    restore: () => restore(getBrowser(), opts),
    hasSnapshot: () => existsSync(file),
  };
}
