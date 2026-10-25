// 商店图第二版：assets/templates-v2/（2026-10-25，目前只有 en）。
// 某语言在 v2 有 i18n/<l>.json 时，它的商店图改用 v2 里 asset-out 相同的模板，README 图和其他语言仍用主模板（assets/templates/）。
// 只在没传 --templates 时生效；v2 模板的文案、i18n/<l>.css、截图（../raw/<l>/）都按 v2 自己的目录找。
import { existsSync } from "node:fs";
import { join } from "node:path";

// base、overlay 都是 readTemplates() 的结果；返回该语言实际要渲染的模板，顺序沿用 base，overlay 里 base 没有的输出排在后面
export function overlayTemplates(base, overlay, locale) {
  if (!overlay || !existsSync(join(overlay.dir, "i18n", `${locale}.json`))) return base;
  const byOut = new Map(overlay.list.map(t => [t.out, t]));
  const outs = new Set(base.map(t => t.out));
  return [...base.map(t => byOut.get(t.out) ?? t), ...overlay.list.filter(t => !outs.has(t.out))];
}

// --only：名字在任一语言的模板里出现即可；返回过滤后的 { 语言: 模板[] }
export function filterOnly(lists, only) {
  if (!only) return lists;
  const names = new Set(Object.values(lists).flat().map(t => t.name));
  const miss = only.filter(n => !names.has(n));
  if (miss.length) throw new Error(`没有这些模板：${miss.join("，")}`);
  return Object.fromEntries(Object.entries(lists).map(([l, ts]) => [l, ts.filter(t => only.includes(t.name))]));
}
