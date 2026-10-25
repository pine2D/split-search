// 工具栏弹窗的纯逻辑：目标标签参数与显示内容。不得引用 chrome。
import { enginesFor, engineById } from "./engines.js";

// ?tabId=<非负整数> 是给 e2e 留的测试接缝（popup.html 不在 web_accessible_resources 里，网页打不开它）。
// 其余情况返回 null，弹窗改用所在窗口的活动标签。
export function targetTabId(search) {
  const raw = new URLSearchParams(search).get("tabId");
  if (raw === null || !/^\d{1,15}$/.test(raw)) return null;
  return Number(raw);
}

// pair 来自 ownedPair（搜索对左右按当前标签顺序；查询对 left 是网页、right 是查询结果）。
// 引擎按 kind 查：图片查询对在以图搜图引擎里查，其余在已配置和已隐藏的文字引擎里查；
// 查不到（已删除）为 null，页面显示“已删除的引擎”。查询对的左侧是用户的网页（engine 为 ""），
// left 总是 null，页面按 leftIsPage 显示“原网页”。
// 按钮是同一类引擎里除当前右侧外的全部引擎：不看 cycleExclude，每一次都是用户亲手点选。
// imageHost 只给图片查询对：弹窗只显示图片网址的 host，不加载图片（不向图片的服务器发请求）。
export function popupView(pair, cfg) {
  const c = { ...cfg, hidden: cfg.hidden ?? [] };
  const { kind } = pair;
  return {
    kind,
    query: pair.query,
    imageHost: kind === "image" ? hostOf(pair.query) : null,
    left: engineById(c, kind, pair.left.engineId),
    right: engineById(c, kind, pair.right.engineId),
    leftIsPage: kind === "text" || kind === "image",
    choices: enginesFor(c, kind).filter(e => e.id !== pair.right.engineId),
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
