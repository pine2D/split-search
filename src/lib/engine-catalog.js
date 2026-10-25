// 右侧专用引擎库：设置页一键添加的模板清单。数据写在代码里（已在真机验证，见 spec 附录 A），不来自网络。
// 纯逻辑，不得引用 chrome。
import { ID_PATTERN } from "./engines.js";
import { codedError } from "./errors.js";

export const CATEGORIES = [
  { id: "translate", key: "catalog_cat_translate" },
  { id: "reference", key: "catalog_cat_reference" },
  { id: "video", key: "catalog_cat_video" },
  { id: "dev", key: "catalog_cat_dev" },
  { id: "maps", key: "catalog_cat_maps" },
  { id: "academic", key: "catalog_cat_academic" },
  { id: "shopping", key: "catalog_cat_shopping" },
  { id: "chinese", key: "catalog_cat_chinese" },
  { id: "ai", key: "catalog_cat_ai" },
];

// url 里的 <target> 取 targets[locale]，<lang> 取 LANG[locale]；
// suffix[locale]（可选）原样追加在展开后的网址末尾（Wikipedia 的 zh_TW 要加 variant）。
export const CATALOG = [
  {
    id: "gtranslate", name: "Google Translate", category: "translate",
    url: "https://translate.google.com/?sl=auto&tl=<target>&text=%s&op=translate",
    targets: { en: "en", zh_CN: "zh-CN", zh_TW: "zh-TW", es: "es" },
  },
  {
    id: "btranslate", name: "Bing Translator", category: "translate",
    url: "https://www.bing.com/translator?text=%s&from=auto&to=<target>",
    targets: { en: "en", zh_CN: "zh-Hans", zh_TW: "zh-Hant", es: "es" },
  },
  {
    id: "wikipedia", name: "Wikipedia", category: "reference",
    url: "https://<lang>.wikipedia.org/w/index.php?search=%s&title=Special:Search",
    suffix: { zh_TW: "&variant=zh-tw" },
  },
  { id: "cambridge", name: "Cambridge Dictionary", category: "reference", url: "https://dictionary.cambridge.org/search/english/direct/?q=%s" },
  { id: "youtube", name: "YouTube", category: "video", url: "https://www.youtube.com/results?search_query=%s", leftDiscouraged: true },
  { id: "bilibili", name: "Bilibili", category: "video", url: "https://search.bilibili.com/all?keyword=%s" },
  { id: "github", name: "GitHub", category: "dev", url: "https://github.com/search?q=%s&type=repositories" },
  { id: "mdn", name: "MDN", category: "dev", url: "https://developer.mozilla.org/en-US/search?q=%s" },
  { id: "gmaps", name: "Google Maps", category: "maps", url: "https://www.google.com/maps/search/%s", leftDiscouraged: true },
  { id: "scholar", name: "Google Scholar", category: "academic", url: "https://scholar.google.com/scholar?q=%s" },
  { id: "amazon", name: "Amazon", category: "shopping", url: "https://www.amazon.com/s?k=%s", leftDiscouraged: true },
  { id: "baidu", name: "Baidu", category: "chinese", url: "https://www.baidu.com/s?wd=%s" },
  // AI：只预填输入框、不自动发送（用户 2026-10-25 在自己的浏览器里实测；Gemini 不预填，不收录）。
  // ai: true 的条目添加时默认排除出快捷键轮换。leftDiscouraged：输入框页不是搜索结果页；两者都是 SPA，
  // 站点 Service Worker 可能接管 document 导航，DNR 的 main_frame 规则看不到（同预置的 Perplexity），作左侧会退化为普通打开。
  { id: "chatgpt", name: "ChatGPT", category: "ai", url: "https://chatgpt.com/?q=%s", ai: true, leftDiscouraged: true },
  { id: "claude", name: "Claude", category: "ai", url: "https://claude.ai/new?q=%s", ai: true, leftDiscouraged: true },
];

const LANG = { en: "en", zh_CN: "zh", zh_TW: "zh", es: "es" };

export function catalogUrl(entry, locale) {
  const url = entry.url
    .replaceAll("<target>", entry.targets?.[locale] ?? entry.targets?.en ?? "")
    .replaceAll("<lang>", LANG[locale] ?? "en");
  return url + (entry.suffix?.[locale] ?? "");
}

// base、base-2、base-3……；截断 base 让总长不超过 20。base 不合法（调用方的错）抛普通错误；
// 99 次都冲突抛错误码 id_exhausted（界面显示 err_id_exhausted）。
const MAX_TRIES = 99;
export function uniqueId(base, taken) {
  if (!ID_PATTERN.test(base)) throw new Error("uniqueId: invalid base id");
  if (!taken(base)) return base;
  for (let n = 2; n <= MAX_TRIES; n++) {
    const suffix = "-" + n;
    const id = base.slice(0, 20 - suffix.length) + suffix;
    if (ID_PATTERN.test(id) && !taken(id)) return id;
  }
  throw codedError("id_exhausted", base);
}

export function isAdded(entry, locale, engines) {
  const url = catalogUrl(entry, locale);
  return engines.some(e => e.url === url);
}
