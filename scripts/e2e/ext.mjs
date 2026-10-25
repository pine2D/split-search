// 扩展操作：确认已安装、reload、storage 快照与恢复、读取 tabs/windows/rules 状态。
// 扩展 SW 空闲会被回收，所有扩展 API 一律经 browser.evalExt（在扩展设置页里执行）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { EXT_ID, PROFILE_DIR, mockEngines } from "./config.mjs";
import { E2E_LOCALE } from "./i18n.mjs";

export const SRC_DIR = resolve(fileURLToPath(new URL("../../src/", import.meta.url)));
export const OUT_DIR = resolve(fileURLToPath(new URL("../../.e2e/", import.meta.url)));
export const SNAPSHOT_FILE = join(OUT_DIR, "storage-snapshot.json");
export const MOCK_PAIR = ["ea", "eb"];

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })])
    .finally(() => clearTimeout(t));
}

// ---- storage ----
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
export function storageDigest(data) {
  return createHash("sha256").update(JSON.stringify(canonical(data))).digest("hex").slice(0, 16);
}

const syncGet = b => b.evalExt("chrome.storage.sync.get(null)");
// 整体替换：先 clear 再 set，保证没有残留键
const syncReplace = (b, data) => b.evalExt(
  `(async () => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(${JSON.stringify(data)}); return true; })()`);

export async function readStorage(browser) {
  const data = await syncGet(browser);
  return { data, digest: storageDigest(data) };
}

export async function snapshotStorage(browser, file = SNAPSHOT_FILE) {
  if (existsSync(file)) throw new Error(`快照文件已存在：${file}（应先恢复它，不能覆盖）`);
  const data = await syncGet(browser);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
  return { data, digest: storageDigest(data) };
}

// 恢复成功（读回与快照一致）后才删除快照文件；任何失败都保留文件，下次启动再恢复
export async function restoreStorage(browser, file = SNAPSHOT_FILE) {
  const snap = JSON.parse(readFileSync(file, "utf8"));
  await syncReplace(browser, snap);
  const after = await syncGet(browser);
  const digest = storageDigest(after);
  const equal = digest === storageDigest(snap);
  if (!equal) throw new Error(`恢复后读回的 storage 与快照不一致（${digest}），快照文件已保留：${file}`);
  unlinkSync(file);
  return { equal, digest };
}

export async function restorePendingSnapshot(browser, file = SNAPSHOT_FILE) {
  if (!existsSync(file)) return false;
  await restoreStorage(browser, file);
  return true;
}

// e2e 的基线配置：模拟引擎、默认组合，界面语言固定为 E2E_LOCALE（期望文字按它的目录算，见 i18n.mjs）。
// 凡是整份写基线的地方都用它，不要另外单独 set uiLocale：基线重置会先 clear，单独写的键会被清掉。
// narrowFallback: false：e2e 的窗口宽度不总受控（host 无头约 800 宽），关掉窄窗口降级，现有分屏步骤才不受影响；
// 只有 T17 测默认值（删掉这个键）和开关
export function mockBaseline(port) {
  return { customEngines: mockEngines(port), defaultPair: MOCK_PAIR, uiLocale: E2E_LOCALE, narrowFallback: false };
}

// 从干净基线开始（原始配置在快照里，结束后恢复）
export async function configureMocks(browser, port) {
  await syncReplace(browser, mockBaseline(port));
}

// ---- 安装检查与 reload ----
// 测试配置的 Preferences 里登记了哪些扩展指向源码目录（只读测试配置，用于区分“未安装”和“ID 不对”）
export function installedIds(profileDir = PROFILE_DIR, srcDir = SRC_DIR) {
  const ids = new Set();
  for (const f of ["Preferences", "Secure Preferences"]) {
    let j;
    try { j = JSON.parse(readFileSync(join(profileDir, "Default", f), "utf8")); } catch { continue; }
    for (const [id, s] of Object.entries(j?.extensions?.settings || {})) {
      if (typeof s?.path === "string" && s.path.startsWith("/") && resolve(s.path) === resolve(srcDir)) ids.add(id);
    }
  }
  return [...ids];
}

// 测试配置里登记的本扩展，不论装自哪个目录（在 worktree 里跑时，测试配置装的可能是主检出的 src/）。
// 返回 { path, disabled } | null；disable_reasons 新版是数组、旧版是位掩码数字
export function registeredEntry(profileDir = PROFILE_DIR, id = EXT_ID) {
  for (const f of ["Preferences", "Secure Preferences"]) {
    let s;
    try { s = JSON.parse(readFileSync(join(profileDir, "Default", f), "utf8"))?.extensions?.settings?.[id]; } catch { continue; }
    if (!s) continue;
    const r = s.disable_reasons;
    return { path: s.path ?? null, disabled: Array.isArray(r) ? r.length > 0 : !!r };
  }
  return null;
}

// 返回 { ok: true } | { ok: false, reason: "not-installed" | "wrong-id", ids?, hint? }。
// 与 brief 的差异：不返回 swSession（SW 会被回收，扩展 API 一律经 evalExt）。
export async function ensureExtension(browser, { timeoutMs = 12000, profileDir = PROFILE_DIR, srcDir = SRC_DIR } = {}) {
  let id = null;
  try { id = await withTimeout(browser.evalExt("chrome.runtime.id", { timeoutMs: 3000 }), timeoutMs, "扩展页打不开"); }
  catch { id = null; }
  if (id === EXT_ID) return { ok: true };
  if (id) return { ok: false, reason: "wrong-id", ids: [id] };
  const ids = installedIds(profileDir, srcDir);
  const others = ids.filter(x => x !== EXT_ID);
  if (others.length) return { ok: false, reason: "wrong-id", ids: others };
  const reg = registeredEntry(profileDir);
  if (reg?.disabled) return { ok: false, reason: "not-installed", hint: "扩展已登记但处于停用状态" };
  if (ids.includes(EXT_ID) || reg) return { ok: false, reason: "not-installed", hint: "扩展已登记但设置页打不开，可能被停用" };
  return { ok: false, reason: "not-installed" };
}

// 启动时用：扩展已登记但设置页打不开（hint）时，先稍等重试一次（冷启动慢）；仍不行多半是被停用了
// （例如上次运行在 T8(b) 停用期间被第二次 Ctrl+C 强制退出），经 enable()（chrome://extensions 详情页）启用后再查。
// check() 即 ensureExtension；返回它的结果，经启用恢复的另带 reenabled: true
export async function ensureExtensionUp(check, { enable, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let ens = await check();
  if (ens.ok || !ens.hint) return ens;
  await wait(3000);
  ens = await check();
  if (ens.ok || !ens.hint || !enable) return ens;
  if (!(await enable().catch(() => false))) return ens;
  const again = await check();
  return again.ok ? { ...again, reenabled: true } : again;
}

// 让扩展重新读取磁盘上的代码。chrome.runtime.reload() 会关闭扩展页面，所以：
// 先给当前设置页打标记、延迟调用 reload，再轮询直到能在“没有标记的新页面”里执行。
// 与 brief 的差异：不返回 swSession（无返回值）；之后的 evalExt 会自动 attach 新页面。
export async function reloadExtension(browser, { timeoutMs = 20000 } = {}) {
  await browser.evalExt("globalThis.__e2eStale = true; setTimeout(() => chrome.runtime.reload(), 100); true");
  const prefix = `chrome-extension://${EXT_ID}/`;
  await browser.waitFor(async () => {
    try {
      return (await browser.evalExt("!globalThis.__e2eStale && chrome.runtime.id", { timeoutMs: 3000 })) === EXT_ID;
    } catch (e) {
      // reload 期间新建的设置页可能停在错误页，关掉让下一轮重建
      for (const t of await browser.targets()) {
        if (t.type === "page" && t.url.startsWith(prefix)) {
          await browser.client.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
        }
      }
      throw e;
    }
  }, { timeoutMs, intervalMs: 500 });
}

// ---- 状态 ----
const STATE_EXPR = `(async () => {
  const tabs = (await chrome.tabs.query({})).map(t => ({ id: t.id, index: t.index, windowId: t.windowId,
    splitViewId: t.splitViewId, pinned: t.pinned, groupId: t.groupId, url: t.url, title: t.title, status: t.status, active: t.active }));
  const windows = (await chrome.windows.getAll()).map(w => ({ id: w.id, type: w.type, focused: w.focused }));
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return { tabs, windows, rules };
})()`;

export function state(browser) {
  return browser.evalExt(STATE_EXPR, { timeoutMs: 8000 });
}

// ctx.ext：绑定了 browser/port 的便捷接口
export function bindExt(browser, { port }) {
  return {
    state: () => state(browser),
    reload: () => reloadExtension(browser),
    configureMocks: () => configureMocks(browser, port),
    readStorage: () => readStorage(browser),
    eval: (expr, opts) => browser.evalExt(expr, opts),
  };
}
