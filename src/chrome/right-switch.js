// 换右侧：弹窗和快捷键共用。对 chrome.tabs 与分屏记录的薄封装。
import { inspectTab, writeEngine } from "./split-state.js";
import { expandTemplate } from "../lib/trigger.js";

// 只有确认是本扩展的一对（ownership === "own"）才返回；fallback-own 没有记录、也就没有关键词，返回 null。
// kind：搜索对是 "search"，查询对取记录的 input（"text" | "image"）。
// 搜索对的左右只看当前标签顺序：index 小的在左，所以原生“互换位置”之后作用的仍是看得见的右侧。
// 查询对的 right 固定是 lookup 一侧、left 是 page 一侧，与标签顺序无关：换右侧绝不会把用户的网页导航走。
// tabs.query 失败照常抛出（inspectTab 的约定），由调用方记日志。
export async function ownedPair(tab, engines) {
  const { ownership, peer, record, peerRecord } = await inspectTab(tab, engines);
  if (ownership !== "own" || !peer || !record || !peerRecord) return null;
  const self = { tabId: tab.id, engineId: record.engine, record };
  const other = { tabId: peer.id, engineId: peerRecord.engine, record: peerRecord };
  const kind = record.role === "search" ? "search" : record.input;
  const selfIsLeft = kind === "search" ? tab.index < peer.index : record.role === "page";
  const [left, right] = selfIsLeft ? [self, other] : [other, self];
  return { kind, left, right, query: record.query };
}

// 网址与 go.html 首次打开时一样由 expandTemplate 展开（空关键词打开模板的 origin）；
// 只发给用户选的这个引擎。tabs.update 失败照常抛出、不改记录；写记录失败只记日志（writeEngine）。
export async function switchRight(pair, engine) {
  await chrome.tabs.update(pair.right.tabId, { url: expandTemplate(engine.url, pair.query) });
  await writeEngine(pair.right.tabId, pair.right.record, engine.id);
}
