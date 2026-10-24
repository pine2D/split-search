// 让每次运行测的都是启动它的那个检出的 src/（ext.SRC_DIR）。
// 测试配置里只能登记一个本扩展（id 由 manifest key 决定），它可能装自另一个检出（主检出或别的 worktree）。
// 机制（2026-10-24 在测试配置的副本上实测）：CDP Extensions.loadUnpacked 装同一 id 的另一个目录，会就地替换登记，
// 授权和 storage 都保留；但这样装的是“临时”扩展（同 --load-extension，下次启动被移除，授权随之丢失），
// 紧接着的一次重新加载（chrome.runtime.reload，即 ext.reloadExtension）把它转成普通的已解压扩展，登记路径持久改为新目录。
// 所以 useSourceDir 之后必须立刻 reloadExtension。之后从别的检出运行，同样会改回那个检出。
import { resolve } from "node:path";
import { EXT_ID } from "./config.mjs";

// 纯逻辑：Extensions.getExtensions 的结果里，本扩展装自哪个目录（没有返回 null）
export function loadedFrom(list, id = EXT_ID) {
  return (list ?? []).find(e => e?.id === id)?.path ?? null;
}

export const sameDir = (a, b) => typeof a === "string" && typeof b === "string" && resolve(a) === resolve(b);

const listUnpacked = async client => (await client.send("Extensions.getExtensions")).extensions ?? [];

// 返回 { ok: true, switched, from } | { ok: false, reason: "wrong-id", ids }。
// 本检出的 manifest key 不对时 loadUnpacked 会装出另一个 id：卸掉它（只卸本次新装的），登记的本扩展不受影响
export async function useSourceDir(browser, { srcDir, id = EXT_ID }) {
  const { client } = browser;
  const before = await listUnpacked(client);
  const from = loadedFrom(before, id);
  if (sameDir(from, srcDir)) return { ok: true, switched: false, from };
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
