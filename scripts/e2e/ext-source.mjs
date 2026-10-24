// 让每次运行测的都是启动它的那个检出的 src/（ext.SRC_DIR）。
// 测试配置里只能登记一个本扩展（id 由 manifest key 决定），它可能装自另一个检出（主检出或别的 worktree）。
// 机制（2026-10-24 在测试配置的副本上实测）：CDP Extensions.loadUnpacked 装同一 id 的另一个目录，会就地替换登记，
// 授权和 storage 都保留；但这样装的是“临时”扩展（同 --load-extension，下次启动被移除，授权随之丢失），
// 紧接着的一次重新加载（chrome.runtime.reload，即 ext.reloadExtension）把它转成普通的已解压扩展，登记路径持久改为新目录。
// 所以 useSourceDir 之后必须立刻 reloadExtension。
// 收尾时再改回运行前的目录（restoreHome）：不依赖别的检出有没有这套逻辑，主检出之后运行测的仍是主检出。
// 状态文件（run.mjs 放在本检出的 .e2e/ext-source.json）：{ home, switching }。home 是运行前的登记目录，
// 改回之后才删；switching 只在 loadUnpacked 到 reload 完成之间为真，被强制退出时留下，下次启动据此提示。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { EXT_ID } from "./config.mjs";

// 纯逻辑：Extensions.getExtensions 的结果里，本扩展装自哪个目录（没有返回 null）
export function loadedFrom(list, id = EXT_ID) {
  return (list ?? []).find(e => e?.id === id)?.path ?? null;
}

export const sameDir = (a, b) => typeof a === "string" && typeof b === "string" && resolve(a) === resolve(b);

const listUnpacked = async client => (await client.send("Extensions.getExtensions")).extensions ?? [];

// 返回 { ok: true, switched, from } | { ok: false, reason: "wrong-id", ids }。
// 本检出的 manifest key 不对时 loadUnpacked 会装出另一个 id：卸掉它（只卸本次新装的），登记的本扩展不受影响
// beforeLoad(from)：真正 loadUnpacked 之前调用（记状态文件）
export async function useSourceDir(browser, { srcDir, id = EXT_ID, beforeLoad }) {
  const { client } = browser;
  const before = await listUnpacked(client);
  const from = loadedFrom(before, id);
  if (sameDir(from, srcDir)) return { ok: true, switched: false, from };
  beforeLoad?.(from);
  let got;
  try { got = (await client.send("Extensions.loadUnpacked", { path: srcDir })).id; }
  catch (e) { throw new Error(`从 ${srcDir} 加载扩展失败：${e.message}`); }
  if (got !== id) {
    if (!before.some(e => e.id === got)) await client.send("Extensions.uninstall", { id: got }).catch(() => {});
    return { ok: false, reason: "wrong-id", ids: [got] };
  }
  return { ok: true, switched: true, from };
}

// 核对本扩展当前装自 srcDir，返回装载路径；不一致时抛出
export async function verifySourceDir(browser, { srcDir, id = EXT_ID }) {
  const at = loadedFrom(await listUnpacked(browser.client), id);
  if (!at) throw new Error(`已解压扩展里没有 ${id}`);
  if (!sameDir(at, srcDir)) throw new Error(`扩展装自 ${at}，不是本检出的 ${srcDir}`);
  return at;
}

export function readSourceState(file) {
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return { home: typeof j?.home === "string" ? j.home : null, switching: j?.switching === true };
  } catch { return { home: null, switching: false }; }
}

export function writeSourceState(file, st) {
  if (!st.home && !st.switching) { rmSync(file, { force: true }); return; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ home: st.home ?? null, switching: !!st.switching }, null, 2));
}

// 改装本检出的 src/ 并让改动持久（reload），记下运行前的目录 home（上次没改回时沿用上次记下的）。
// reload 抛错时 switching 保持为真并原样抛出。返回 useSourceDir 的结果
export async function switchSource(browser, { srcDir, file, reload, id = EXT_ID }) {
  const st = readSourceState(file);
  const home = from => (st.home ?? (sameDir(from, srcDir) ? null : from));
  const r = await useSourceDir(browser, { srcDir, id, beforeLoad: from => writeSourceState(file, { home: home(from), switching: true }) });
  if (!r.ok) { writeSourceState(file, { home: st.home, switching: false }); return r; }
  if (r.switched) await reload(browser);
  writeSourceState(file, { home: home(r.from), switching: false });
  return r;
}

// 收尾：改回状态文件记下的 home 并持久（reload），核对后删状态文件。
// 返回 { restored: false } | { restored: false, missing } | { restored: true, home }；失败时抛出，状态文件保留
export async function restoreHome(browser, { file, reload, id = EXT_ID, exists = existsSync }) {
  const st = readSourceState(file);
  if (!st.home) { writeSourceState(file, { home: null, switching: false }); return { restored: false }; }
  if (!exists(st.home)) { writeSourceState(file, { home: null, switching: false }); return { restored: false, missing: st.home }; }
  // 本扩展不在已解压列表里（运行中被卸掉等）时不改回：loadUnpacked 会凭空装出一个临时扩展
  if (!loadedFrom(await listUnpacked(browser.client), id)) throw new Error(`已解压扩展里没有 ${id}`);
  const r = await useSourceDir(browser, { srcDir: st.home, id, beforeLoad: () => writeSourceState(file, { home: st.home, switching: true }) });
  if (!r.ok) { writeSourceState(file, { home: st.home, switching: false }); throw new Error(`改回 ${st.home} 时装出了别的 id：${r.ids.join(", ")}`); }
  if (r.switched) await reload(browser);
  await verifySourceDir(browser, { srcDir: st.home, id });
  writeSourceState(file, { home: null, switching: false });
  return { restored: true, home: st.home };
}
