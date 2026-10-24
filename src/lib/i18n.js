// 纯逻辑：语言选择与消息格式化。不引用 chrome。
export const LOCALES = Object.freeze(["en", "zh_CN", "zh_TW", "es"]);
export const DEFAULT_LOCALE = "en";
export const MARK_OPEN = "";
export const MARK_CLOSE = "";

export function normalizeLocalePref(v) {
  return typeof v === "string" && (v === "auto" || LOCALES.includes(v)) ? v : "auto";
}

export function resolveLocale(pref, uiLanguage) {
  if (LOCALES.includes(pref)) return pref;
  const tag = String(uiLanguage ?? "").replace(/-/g, "_");
  if (/^zh_(TW|HK|MO)(_|$)/i.test(tag) || /^zh_Hant/i.test(tag)) return "zh_TW";
  if (/^zh(_|$)/i.test(tag)) return "zh_CN";
  if (/^en(_|$)/i.test(tag)) return "en";
  if (/^es(_|$)/i.test(tag)) return "es";
  return DEFAULT_LOCALE;
}

const TOKEN = /\$\$|\$([A-Za-z_@][A-Za-z0-9_@]*)\$|\$([1-9])/g;
const SIMPLE = /\$\$|\$([1-9])/g;

export function formatMessage(entry, subs) {
  const args = subs ?? [];
  const holders = {};
  for (const [k, v] of Object.entries(entry.placeholders ?? {})) holders[k.toLowerCase()] = v;
  return entry.message.replace(TOKEN, (m, name, n) => {
    if (m === "$$") return "$";
    if (n) return args[Number(n) - 1] ?? "";
    const h = holders[name.toLowerCase()];
    if (!h) return m;
    return String(h.content).replace(SIMPLE, (mm, nn) => (mm === "$$" ? "$" : args[Number(nn) - 1] ?? ""));
  });
}

export function splitMarked(text) {
  const out = [];
  const re = new RegExp(`${MARK_OPEN}(\\d+)${MARK_CLOSE}`, "g");
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(Number(m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
