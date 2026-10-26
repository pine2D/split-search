// 新增引擎时按名称自动生成 id。纯逻辑，不得引用 chrome。
// 去重沿用引擎库添加的 uniqueId（base、base-2……base-99）；文字引擎与以图搜图引擎共用一个 id 命名空间，
// taken 由调用方按两类引擎一起判断。
import { uniqueId } from "./engine-catalog.js";

const MAX = 20;
const FALLBACK = "engine";

// 小写；带变音符的拉丁字母先去掉变音符；其余非 [a-z0-9-] 的字符转 -，连续的合并，去掉首尾 -，截到 20
export function slugId(text) {
  return String(text ?? "")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX)
    .replace(/-+$/, "");
}

// 网址 host 的第一段（去掉开头的 www.）；网址解析不了、或是国际化域名的 punycode（xn--）时为空串
function hostSlug(url) {
  let host;
  try { host = new URL(String(url ?? "").replace("%s", "x")).hostname; } catch { return ""; }
  const first = host.replace(/^www\./, "").split(".")[0] ?? "";
  return first.startsWith("xn--") ? "" : slugId(first);
}

// 名称 → 网址 host 的第一段 → engine；再按 taken 去重。-2 到 -99 都被占用时返回基础 id，保存时由校验报“已被占用”
export function suggestId(name, url, taken) {
  const base = slugId(name) || hostSlug(url) || FALLBACK;
  try {
    return uniqueId(base, taken);
  } catch (err) {
    if (err?.code === "id_exhausted") return base;
    throw err;
  }
}

// 设置页用：mergeConfig 的结果里已配置、已隐藏的文字引擎和以图搜图引擎（含 lens）的 id 都算占用
export function takenIn(cfg) {
  const ids = new Set([...cfg.engines, ...(cfg.hidden ?? []), ...(cfg.imageEngines ?? [])].map(e => e.id));
  return (id) => ids.has(id);
}
