// 预置引擎、模板校验、配置合并。纯逻辑，不得引用 chrome。

export const PRESETS = [
  { id: "kagi", name: "Kagi", url: "https://kagi.com/search?q=%s" },
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=%s" },
  { id: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/search?q=%s" },
];

export const DEFAULT_PAIR = ["kagi", "google"];
export const ID_PATTERN = /^[a-z0-9-]{1,20}$/;

const PLACEHOLDER = "__SS__";

export function validateTemplate(url) {
  if (typeof url !== "string" || !url.includes("%s")) {
    return { ok: false, error: "网址中必须包含小写 %s" };
  }
  let u;
  try {
    u = new URL(url.replace("%s", PLACEHOLDER));
  } catch {
    return { ok: false, error: "网址格式不正确" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "网址必须以 http:// 或 https:// 开头" };
  }
  // 通配域名会让授权变成宽泛的 host 权限；IPv6 字面量会让整条 DNR 规则的 requestDomains 失效
  if (!u.hostname) return { ok: false, error: "网址缺少域名" };
  if (u.hostname.includes("*")) return { ok: false, error: "域名不能包含 *，请填写具体的网站地址" };
  if (u.hostname.startsWith("[")) return { ok: false, error: "不支持 IPv6 地址，请改用域名" };
  // 右侧模板带 _ss 会让右侧标签再次被重定向到 go.html
  if (u.searchParams.has("_ss")) return { ok: false, error: "_ss 是保留参数，网址中不能包含它" };
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

  let pair = DEFAULT_PAIR;
  if (Array.isArray(defaultPair) && defaultPair.length === 2) {
    const l = byId.get(defaultPair[0]);
    const r = byId.get(defaultPair[1]);
    if (l && r && canBeLeft(l)) pair = [defaultPair[0], defaultPair[1]];
  }
  return { engines, hidden, defaultPair: [...pair] };
}

export function isIdTaken(id, stored = {}) {
  const { customEngines = [] } = stored;
  return PRESETS.some(p => p.id === id) || customEngines.some(c => c.id === id);
}

export function engineOrigin(engine) {
  return new URL(engine.url.replace("%s", "x")).origin;
}
