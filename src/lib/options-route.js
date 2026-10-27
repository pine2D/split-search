// 设置页的 tab 路由（纯逻辑，不碰 chrome）：tab 的 key 与 hash、按 hash 与“开始使用”卡的档位选首个 tab、方向键换 tab。
// tab 状态只放在网址 hash 里（#tab-<key>）；#setup、#guide-steps 是定位请求，不是 tab。

export const TAB_KEYS = ["add", "pair", "engines", "lookup"];

export const tabHash = key => `#tab-${key}`;

// #tab-<key>（key 认得出）→ { tab }；#setup、#guide-steps → { reveal }；其他（含元素 id、大小写不同、编码过的）→ {}
export function routeFromHash(hash) {
  if (typeof hash !== "string") return {};
  if (hash === "#setup") return { reveal: "setup" };
  if (hash === "#guide-steps") return { reveal: "guide-steps" };
  const key = hash.startsWith("#tab-") ? hash.slice("#tab-".length) : null;
  return key && TAB_KEYS.includes(key) ? { tab: key } : {};
}

// mode 是 setupView 的 mode（steps / regrant / done / hidden）：卡片显示（steps、regrant）时默认进 ①，否则进 ②
export function initialTab(hash, { mode } = {}) {
  const route = routeFromHash(hash);
  if (route.tab) return route.tab;
  if (route.reveal === "guide-steps") return "add";
  return mode === "steps" || mode === "regrant" ? "add" : "pair";
}

// APG Tabs：←/→ 循环，Home/End 到首尾；别的键（含 ↑/↓）返回 null，不处理
export function stepTab(keys, current, key) {
  if (key === "Home") return keys[0] ?? null;
  if (key === "End") return keys[keys.length - 1] ?? null;
  const delta = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  const i = keys.indexOf(current);
  if (!delta || i < 0) return null;
  return keys[(i + delta + keys.length) % keys.length];
}

// go.html 出错页“打开设置”按错误码去哪个 tab（错误码见 lib/trigger.js 的 parseTrigger 与 go.js）：
// 要重新复制触发网址的进“添加到 Chrome”，要检查或重新添加引擎的进“搜索引擎”；其余（没收到触发网址、读不出设置）返回 null，照旧打开设置页
const ERROR_TABS = {
  bad_url: "add", marker_format: "add", template_mismatch: "add",
  unknown_engine: "engines", not_left: "engines", bad_template: "engines",
};
export const errorTab = code => (Object.hasOwn(ERROR_TABS, code) ? ERROR_TABS[code] : null);
