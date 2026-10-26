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
// 按钮是同一类引擎里除当前右侧外的全部引擎：不看 cycleExclude，每一次都是用户亲手点选；
// 搜索对再去掉当前左侧（左右同一个引擎没有意义），查询对的左侧是网页，不受影响。
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
    leftIsPage: isQueryPair(pair),
    choices: enginesFor(c, kind).filter(e => e.id !== pair.right.engineId && !isSearchLeft(pair, e.id)),
  };
}

// 没有 kind 的旧调用按搜索对处理（查询对总带 kind "text" | "image"）
const isQueryPair = (pair) => pair.kind === "text" || pair.kind === "image";
const isSearchLeft = (pair, id) => !isQueryPair(pair) && id === pair.left?.engineId;

// 弹窗点了某个引擎按钮：按这一对的 kind 在同一类引擎里找它（图片查询对只认以图搜图引擎，其余只认未隐藏的文字引擎）。
// 这一对已经不是本扩展的、这个引擎已经不在同一类里、或它就是搜索对当前的左侧时返回 null，弹窗什么都不换
export function switchTarget(pair, cfg, engineId) {
  if (!pair || !cfg || isSearchLeft(pair, engineId)) return null;
  return enginesFor(cfg, pair.kind).find(e => e.id === engineId) ?? null;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

// 弹窗显示哪一区（spec 3.2 的表）：本扩展的一对 → "pair"；在任何分屏中、窗口不能分屏（windowType 来自
// splitWindowType，只有 "normal" 可以）、识别不出结果页 → "not-ours"（v0.3 的说明）；
// engines（未隐藏的文字引擎）里除了识别出的引擎再没有别的 → 也是 "not-ours"（补成区不会只剩一个没有按钮的标题）；
// 其余 → "complete"（补成分屏）。
export function popupMode({ pair, tab, windowType, match, engines }) {
  if (pair) return "pair";
  if ((tab?.splitViewId ?? -1) !== -1 || windowType !== "normal" || match == null) return "not-ours";
  if (completeView(match, engines ?? []).choices.length === 0) return "not-ours";
  return "complete";
}

// “补成分屏”区：按钮是 engines（未隐藏的文字引擎，显示顺序）去掉识别出的引擎，建议的右侧排第一。
// 不看 cycleExclude（每次都是用户亲手点选）。
export function completeView(match, engines) {
  const rest = engines.filter(e => e.id !== match.engine.id);
  const isSuggested = e => e.id === match.suggestedId;
  return { engine: match.engine, query: match.query, suggestedId: match.suggestedId,
    choices: [...rest.filter(isSuggested), ...rest.filter(e => !isSuggested(e))] };
}

// 分屏外（mode "not-ours"）怎么引导，三档（v0.4 critique P1）：
// setup：默认组合左侧没授权，照着试只会得到一次普通搜索 → 只留“还没设置好”和主按钮“完成设置”（打开设置页 #setup），
//        不显示“不是本扩展的拆分视图”、怎么试、默认组合和页脚（快捷键、“打开设置”：主按钮已经是去设置页）；
// try：左侧已授权、setupDone 不是 true（新装的、从 v0.2 升级还没搜过的）→ 照常说怎么试，再加一句和去第 2 步的次级入口；
// ready：setupDone 为 true → 与 v0.3 相同。
// regrant：setup 档里 setupDone 为 true（完成过设置、左侧授权后来没了，设置页显示的是“需要授权”）→ 弹窗换成“已无权访问”的说法，按钮不变。
// leftGranted、setupDone 读不出来（null 或缺省）时按 ready 处理：不拿可能不对的状态吓用户。
export function idleView({ leftGranted = null, setupDone = null } = {}) {
  const tier = leftGranted === false ? "setup"
    : leftGranted === true && setupDone === false ? "try"
    : "ready";
  const setup = tier === "setup";
  return { tier, regrant: setup && setupDone === true, notOurs: !setup, tryHint: !setup, setupButton: setup,
    setupLink: tier === "try", pair: !setup, footer: !setup };
}
