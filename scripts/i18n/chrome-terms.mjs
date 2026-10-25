#!/usr/bin/env node
// 从 Chrome 的 locale .pak 取出各语言界面原文，以 en-US 原文为锚对齐资源 id。
// 用法：node scripts/i18n/chrome-terms.mjs [--chrome-dir /opt/google/chrome] > terms.md
import { readFileSync } from "node:fs";

/** 解析 .pak v5：返回 Map<资源 id, 值 Buffer>。别名指向资源下标。 */
export function parsePak(buf) {
  const version = buf.readUInt32LE(0);
  if (version !== 5) throw new Error(`不支持的 pak 版本 ${version}（只支持 5）`);
  const count = buf.readUInt16LE(8);
  const aliasCount = buf.readUInt16LE(10);
  const entry = (i) => ({ id: buf.readUInt16LE(12 + i * 6), off: buf.readUInt32LE(12 + i * 6 + 2) });
  const map = new Map();
  const valueOf = (i) => buf.subarray(entry(i).off, entry(i + 1).off);
  for (let i = 0; i < count; i++) map.set(entry(i).id, valueOf(i));
  const aliasBase = 12 + (count + 1) * 6;
  for (let i = 0; i < aliasCount; i++) {
    const id = buf.readUInt16LE(aliasBase + i * 4);
    const idx = buf.readUInt16LE(aliasBase + i * 4 + 2);
    map.set(id, valueOf(idx));
  }
  return map;
}

/** 返回文本（UTF-8）匹配 re 的所有资源 id，升序。 */
export function findIds(pak, re) {
  const ids = [];
  for (const [id, v] of pak) if (re.test(v.toString("utf8"))) ids.push(id);
  return ids.sort((a, b) => a - b);
}

export const TERMS = [
  { id: "split-view", en: /^Split view$/, note: "分屏" },
  { id: "split-add-tab", en: /^Add tab to new split view$/, note: "标签右键“新分屏”" },
  { id: "split-new-current", en: /^New split view with current tab$/, note: "标签右键“新分屏”" },
  { id: "split-open-link", en: /^Open link in split view$/, note: "链接右键" },
  { id: "site-search", en: /^Site search$/, note: "网站搜索" },
  { id: "add-site-search", en: /^Add site search$/, note: "添加网站搜索对话框" },
  { id: "make-default", en: /^Make default$/, note: "⋮ 菜单“设为默认”" },
  { id: "search-engines", en: /^Search engines$/, note: "搜索引擎页标题" },
  { id: "manage-search-engines", en: /^Manage search engines and site search$/, note: "设置页入口" },
  { id: "shortcut", en: /^Shortcut$/, note: "快捷字词" },
  { id: "address-bar", en: /address bar/i, note: "地址栏（句中用法，人工确认）" },
  { id: "tab-strip", en: /tab strip|tabstrip/i, note: "标签栏（句中用法，人工确认）" },
  { id: "developer-mode", en: /^Developer mode$/, note: "开发者模式" },
  { id: "load-unpacked", en: /^Load unpacked$/, note: "加载已解压" },
  { id: "reload", en: /^Reload$/, note: "重新加载" },
  { id: "site-access", en: /^Site access$/, note: "网站访问权限" },
  { id: "search-for", en: /^&Search \$1 for “\$2”$/, note: "右键“在 X 中搜索”" },
  { id: "keyboard-shortcuts", en: /^Keyboard shortcuts?$/, note: "键盘快捷键（chrome://extensions/shortcuts 页）" },
];

const LOCALES = ["en-US", "zh-CN", "zh-TW", "es", "es-419"];

/** 去掉 (&X) 和 & 加速键标记，换行压成空格，竖线转义。 */
function clean(buf) {
  return buf.toString("utf8").replace(/\(&.\)/g, "").replace(/&(?=\S)/g, "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
}

function main() {
  const i = process.argv.indexOf("--chrome-dir");
  const dir = i > 0 ? process.argv[i + 1] : "/opt/google/chrome";
  const paks = Object.fromEntries(LOCALES.map((l) => [l, parsePak(readFileSync(`${dir}/locales/${l}.pak`))]));
  const out = [`| 术语 | id | ${LOCALES.join(" | ")} |`, `|---|---|${LOCALES.map(() => "---").join("|")}|`];
  for (const term of TERMS) {
    const ids = findIds(paks["en-US"], term.en);
    if (!ids.length) { out.push(`| ${term.note} | （未命中） |${LOCALES.map(() => " |").join("")}`); continue; }
    for (const id of ids) {
      const cells = LOCALES.map((l) => { const v = paks[l].get(id); return v ? clean(v) : ""; });
      out.push(`| ${term.note} | ${id} | ${cells.join(" | ")} |`);
    }
  }
  console.log(out.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
