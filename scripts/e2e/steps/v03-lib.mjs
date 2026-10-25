// v0.3 步骤（T16–T18）的公共工具：分屏记录（storage.session）读取与核对、相邻对查找、子项包装。
// 记录形状见 src/lib/split-owner.js：split:<tabId> → { peer, splitViewId, mode, engine, query }。
import { recordKey } from "../../../src/lib/split-owner.js";
import { trigger, expectPair, findPair, resetTabs, navigate, waitState } from "./util.mjs";

// 运行一个子项：异常记为失败（附原因），返回 { name, status, detail }
export async function sub(name, fn) {
  try { return { name, ...(await fn()) }; }
  catch (e) { return { name, status: "fail", detail: `异常：${e.message}` }; }
}
export const verdict = (problems, ok) => (problems.length ? { status: "fail", detail: problems.join("；") } : { status: "pass", detail: ok });

// 触发网址里的 q（已编码，+ 为空格）还原成扩展记下的关键词
export const queryOf = q => decodeURIComponent(q.replace(/\+/g, " "));

// 读若干标签的记录：返回 { [tabId]: 原始值 | undefined }（不做形状校验，交给 checkPairRecords）
export async function readRecords(ctx, tabIds) {
  const keys = tabIds.map(recordKey);
  const got = await ctx.ext.eval(`chrome.storage.session.get(${JSON.stringify(keys)})`);
  return Object.fromEntries(tabIds.map(id => [id, got[recordKey(id)]]));
}

// 纯函数：核对一对标签的两条记录。want = { mode, splitViewId, engines: [左, 右], query }；返回问题列表（空 = 通过）
export function checkPairRecords(recs, left, right, want) {
  const problems = [];
  const expect = [[left, right, want.engines[0], "左"], [right, left, want.engines[1], "右"]];
  for (const [self, peer, engine, side] of expect) {
    const r = recs?.[self.id];
    if (!r || typeof r !== "object") { problems.push(`${side}侧标签 ${self.id} 没有记录（实际 ${JSON.stringify(r)}）`); continue; }
    const exp = { peer: peer.id, splitViewId: want.splitViewId, mode: want.mode, engine, query: want.query };
    const keys = Object.keys(r).sort().join(",");
    if (keys !== "engine,mode,peer,query,splitViewId") problems.push(`${side}侧记录字段应为 engine,mode,peer,query,splitViewId，实际 ${keys}`);
    for (const [k, v] of Object.entries(exp)) {
      if (r[k] !== v) problems.push(`${side}侧记录 ${k} 应为 ${JSON.stringify(v)}，实际 ${JSON.stringify(r[k])}`);
    }
  }
  return problems;
}

// 纯函数：找相邻对（窄窗口降级）：同一窗口、都不在分屏中、右侧紧挨左侧，网址是期望的一对且都加载完成
export function findAdjacent(state, port, q) {
  const [l, r] = expectPair(port, q);
  const tabs = (state?.tabs || []).filter(t => (t.splitViewId ?? -1) === -1 && t.status === "complete");
  for (const a of tabs.filter(t => t.url === l)) {
    const b = tabs.find(t => t.url === r && t.windowId === a.windowId && t.index === a.index + 1);
    if (b) return [a, b];
  }
  return null;
}

// 整理现场后在 site-x 标签上触发，等出现分屏。返回 { base, pair }（base 为 resetTabs 的结果，pair[0] 就是它）
export async function pairOn(ctx, q) {
  const base = await resetTabs(ctx);
  await navigate(ctx, base.targetId, trigger(ctx.port, q));
  const pair = await waitState(ctx, st => findPair(st, ctx.port, q), `分屏 ${expectPair(ctx.port, q).join(" ｜ ")}`);
  return { base, pair };
}

// 状态里某个标签的当前网址（标签不见了为 undefined）
export const tabUrl = (st, id) => st.tabs.find(t => t.id === id)?.url;
