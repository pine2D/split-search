// 设置页“开始使用”卡的纯逻辑：显示哪几步、每步什么状态，以及一次 storage.session 变化算不算“设置完成”。
// 不得引用 chrome。
import { RECORD_PREFIX, parseRecord } from "./split-owner.js";

// 输入：左右两侧是否已授权、右侧是否是另一个引擎、storage.local 的 setupDone、本页是否刚看到它变成 true。
// mode：steps（首次，三步）、regrant（完成过但左侧没授权：只显示第 1 步）、done（本页刚完成：一句确认）、hidden。
// 步骤状态：grant todo|done，add todo（Chrome 里的设置读不到，只能靠完成判定收尾），try ready|blocked（左侧没授权不能试）。
// rightPending：右侧是另一个引擎且没授权，第 1 步要留一个“建议”的授权入口。
export function setupView({ leftGranted = false, rightGranted = false, rightDistinct = false, setupDone = false, justCompleted = false } = {}) {
  const rightPending = rightDistinct && !rightGranted;
  if (setupDone && !leftGranted) return { mode: "regrant", steps: [{ id: "grant", state: "todo" }], rightPending };
  if (setupDone) return { mode: justCompleted ? "done" : "hidden", steps: [], rightPending };
  return {
    mode: "steps",
    steps: [
      { id: "grant", state: leftGranted ? "done" : "todo" },
      { id: "add", state: "todo" },
      { id: "try", state: leftGranted ? "ready" : "blocked" },
    ],
    rightPending,
  };
}

const tabIdOf = key => {
  if (typeof key !== "string" || !key.startsWith(RECORD_PREFIX)) return null;
  const id = Number(key.slice(RECORD_PREFIX.length));
  return Number.isInteger(id) ? id : null;
};

// 这条记录代表一次新的搜索：现在是搜索记录，之前没有、不是搜索记录或关键词不同。
// 关键词不变的改写（换右侧引擎、相邻对拼成分屏、标成失效）不算
function freshSearch(change) {
  const now = parseRecord(change?.newValue);
  if (now?.role !== "search") return null;
  const before = parseRecord(change?.oldValue);
  return before?.role === "search" && before.query === now.query ? null : now;
}

// changes：storage.session.onChanged 的 changes；tryTabs：Map<“试一下”打开的标签 id, 当时用的示例关键词>。
// 算完成：同一次写入里出现互相指向的一对新搜索记录，而且哪一侧都不是“试一下”的标签带着当时的示例关键词
// （“试一下”绕过了用户的网站搜索设置；之后在那个标签里经地址栏或拖拽换了关键词再搜，就是真的触发成功）
export function isCompletion(changes, tryTabs = new Map()) {
  const fresh = new Map();
  for (const [key, change] of Object.entries(changes || {})) {
    const id = tabIdOf(key);
    const rec = id === null ? null : freshSearch(change);
    if (rec) fresh.set(id, rec);
  }
  const fromTry = (id, rec) => tryTabs.has(id) && tryTabs.get(id) === rec.query;
  for (const [id, rec] of fresh) {
    const peer = fresh.get(rec.peer);
    if (!peer || peer.peer !== id) continue;
    if (!fromTry(id, rec) && !fromTry(rec.peer, peer)) return true;
  }
  return false;
}
