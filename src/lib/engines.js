// 预置引擎、模板校验、配置合并。纯逻辑，不得引用 chrome。
import { fail } from "./errors.js";
import { normalizeLocalePref } from "./i18n.js";

export const PRESETS = [
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=%s" },
  { id: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  // 站点的 Service Worker 接管导航（Workbox 路由所有 document 请求），DNR main_frame 规则看不到，作左侧时退化为普通搜索（G5）
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/search?q=%s", leftDiscouraged: true },
  { id: "kagi", name: "Kagi", url: "https://kagi.com/search?q=%s" },
];

export const DEFAULT_PAIR = ["google", "bing"];
export const ID_PATTERN = /^[a-z0-9-]{1,20}$/;

const PLACEHOLDER = "__SS__";

export function validateTemplate(url) {
  if (typeof url !== "string" || !url.includes("%s")) {
    return fail("tpl_no_placeholder");
  }
  let u;
  try {
    u = new URL(url.replace("%s", PLACEHOLDER));
  } catch {
    return fail("bad_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return fail("tpl_bad_scheme");
  }
  // 通配域名会让授权变成宽泛的 host 权限；IPv6 字面量会让整条 DNR 规则的 requestDomains 失效
  if (!u.hostname) return fail("tpl_no_host");
  if (u.hostname.includes("*")) return fail("tpl_wildcard_host");
  if (u.hostname.startsWith("[")) return fail("tpl_ipv6");
  // 右侧模板带 _ss 会让右侧标签再次被重定向到 go.html
  if (u.searchParams.has("_ss")) return fail("tpl_reserved_param");
  let leftParam = null;
  const once = url.split("%s").length === 2;
  if (once && !url.includes("#")) {
    for (const [k, v] of u.searchParams) {
      if (v === PLACEHOLDER) { leftParam = k; break; }
    }
    if (leftParam !== null && u.searchParams.getAll(leftParam).length !== 1) leftParam = null;
  }
  return { ok: true, canBeLeft: leftParam !== null, leftParam };
}

function canBeLeft(engine) {
  const r = validateTemplate(engine.url);
  return r.ok && r.canBeLeft;
}

export function mergeConfig(stored = {}) {
  const { customEngines = [], presetOverrides = {}, order = [], defaultPair } = stored;
  const all = [];
  const hidden = [];
  for (const p of PRESETS) {
    const o = presetOverrides[p.id] || {};
    const e = { ...p };
    if (o.name) e.name = o.name;
    if (o.url) e.url = o.url;
    if (o.hidden) hidden.push(e); else all.push(e);
  }
  for (const c of customEngines) all.push({ ...c });

  const byId = new Map(all.map(e => [e.id, e]));
  const engines = [];
  const seen = new Set();
  for (const id of order) {
    const e = byId.get(id);
    if (e && !seen.has(id)) { engines.push(e); seen.add(id); }
  }
  for (const e of all) if (!seen.has(e.id)) engines.push(e);

  let pair = null;
  if (Array.isArray(defaultPair) && defaultPair.length === 2) {
    const l = byId.get(defaultPair[0]);
    const r = byId.get(defaultPair[1]);
    if (l && r && canBeLeft(l)) pair = [defaultPair[0], defaultPair[1]];
  }
  if (!pair) {
    const l = byId.get(DEFAULT_PAIR[0]);
    const r = byId.get(DEFAULT_PAIR[1]);
    if (l && r && canBeLeft(l)) {
      pair = [...DEFAULT_PAIR];
    } else {
      // 默认组合不可用（被隐藏，或模板不能作左侧）：取显示顺序里第一个可作左侧的引擎和第一个不同的引擎
      const left = engines.find(canBeLeft);
      if (left) pair = [left.id, (engines.find(e => e.id !== left.id) || left).id];
      else pair = [...DEFAULT_PAIR];
    }
  }
  return { engines, hidden, defaultPair: pair, uiLocale: normalizeLocalePref(stored.uiLocale) };
}

export function isIdTaken(id, stored = {}) {
  const { customEngines = [] } = stored;
  return PRESETS.some(p => p.id === id) || customEngines.some(c => c.id === id);
}

export function engineOrigin(engine) {
  return new URL(engine.url.replace("%s", "x")).origin;
}
