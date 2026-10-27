// 预置引擎、模板校验、配置合并。纯逻辑，不得引用 chrome。
import { fail } from "./errors.js";
import { normalizeLocalePref } from "./i18n.js";
import { IMAGE_PRESET } from "./image-engines.js";
import { cleanRules } from "./right-rules.js";

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

// 校验模板时 %s 的替身（URL 能解析、不会被编码）；split-owner.js 判定搜索页时共用
export const PLACEHOLDER = "__SS__";

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
  for (const c of customEngines) {
    const e = { id: c.id, name: c.name, url: c.url };
    if (c.leftDiscouraged === true) e.leftDiscouraged = true;
    all.push(e);
  }

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
  const imageEngines = [IMAGE_PRESET, ...cleanImageEngines(stored.imageEngines, customEngines)];
  // 查词引擎：存的 id 是未隐藏的文字引擎才用，否则跟随默认组合的右侧（spec 3.5）；
  // lookupFollow 为 true 表示正在跟随（设置页据此选中“跟随默认组合”一项）
  const lookupFollow = !engines.some(e => e.id === stored.lookupEngine);
  const lookupEngine = lookupFollow ? pair[1] : stored.lookupEngine;
  const imageEngine = imageEngines.some(e => e.id === stored.imageEngine) ? stored.imageEngine : IMAGE_PRESET.id;
  return { engines, hidden, defaultPair: pair, uiLocale: normalizeLocalePref(stored.uiLocale),
    narrowFallback: stored.narrowFallback !== false, cycleExclude: cleanIdList(stored.cycleExclude),
    imageEngines, imageEngine, lookupEngine, lookupFollow,
    rightRules: cleanRules(stored.rightRules, { engines, hidden, defaultPair: pair, isEngineId: id => ID_PATTERN.test(id) }) };
}

// 自定义以图搜图引擎：不是数组当作空；只认 { id, name, url } 三个字段，按 id 去重保留首次。
// 丢掉：id 不合法；id 与内置 lens、预置文字引擎或 customEngines 里的文字引擎撞车（两类共用一个 id 命名空间，spec 3.5）；
// 模板过不了 validateTemplate（没有 %s、不是 http(s)、通配域名、带 _ss 等）
export function cleanImageEngines(value, customEngines = []) {
  if (!Array.isArray(value)) return [];
  const textIds = new Set(PRESETS.map(p => p.id));
  if (Array.isArray(customEngines)) {
    for (const c of customEngines) if (c && typeof c === "object" && typeof c.id === "string") textIds.add(c.id);
  }
  const out = [];
  const seen = new Set();
  for (const e of value) {
    if (!e || typeof e !== "object") continue;
    const { id, name, url } = e;
    if (typeof id !== "string" || !ID_PATTERN.test(id) || id === IMAGE_PRESET.id || textIds.has(id) || seen.has(id)) continue;
    if (typeof name !== "string" || !name || typeof url !== "string" || !validateTemplate(url).ok) continue;
    seen.add(id);
    out.push({ id, name, url });
  }
  return out;
}

// kind 为 "image" 取以图搜图引擎，其余（text、search 等）取文字引擎
export function enginesFor(cfg, kind) {
  return kind === "image" ? cfg.imageEngines : cfg.engines;
}

// 文字引擎同时在已隐藏的里查（记录里的引擎可能后来被隐藏）
export function engineById(cfg, kind, id) {
  const list = kind === "image" ? cfg.imageEngines : [...cfg.engines, ...cfg.hidden];
  return list.find(e => e.id === id) || null;
}

// 不参与快捷键轮换的引擎 id：不是数组当作空，只留字符串，去重并保留首次出现的顺序
export function cleanIdList(value) {
  return Array.isArray(value) ? [...new Set(value.filter(x => typeof x === "string"))] : [];
}

export function isIdTaken(id, stored = {}) {
  const { customEngines = [] } = stored;
  // 文字引擎与以图搜图引擎共用一个 id 命名空间（spec 3.5）
  return PRESETS.some(p => p.id === id) || customEngines.some(c => c.id === id)
    || id === IMAGE_PRESET.id || cleanImageEngines(stored.imageEngines, customEngines).some(c => c.id === id);
}

export function engineOrigin(engine) {
  return new URL(engine.url.replace("%s", "x")).origin;
}

// 申请与查询 host 权限用的模式：只给精确 origin（<origin>/*）；含 * 的模式等于宽泛权限、网址解析不了，都返回 null。
// 设置页（options/ui.js）与弹窗（popup/idle.js）共用
export function originPattern(engine) {
  try {
    const origin = engineOrigin(engine);
    return origin.includes("*") ? null : origin + "/*";
  } catch {
    return null;
  }
}
