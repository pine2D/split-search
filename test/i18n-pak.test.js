import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parsePak, findIds, TERMS } from "../scripts/i18n/chrome-terms.mjs";

function buildPak(version) {
  const a = Buffer.from("Split view");
  const b = Buffer.from("拆分视图");
  const head = Buffer.alloc(12);
  head.writeUInt32LE(version, 0);
  head.writeUInt8(1, 4);
  head.writeUInt16LE(2, 8);
  head.writeUInt16LE(1, 10);
  const dataStart = 12 + 3 * 6 + 1 * 4;
  const entries = Buffer.alloc(18);
  entries.writeUInt16LE(10, 0); entries.writeUInt32LE(dataStart, 2);
  entries.writeUInt16LE(11, 6); entries.writeUInt32LE(dataStart + a.length, 8);
  entries.writeUInt16LE(0, 12); entries.writeUInt32LE(dataStart + a.length + b.length, 14);
  const alias = Buffer.alloc(4);
  alias.writeUInt16LE(12, 0); alias.writeUInt16LE(0, 2);
  return Buffer.concat([head, entries, alias, a, b]);
}

test("parsePak 读出 v5 资源和别名", () => {
  const pak = parsePak(buildPak(5));
  assert.equal(pak.get(10).toString("utf8"), "Split view");
  assert.equal(pak.get(11).toString("utf8"), "拆分视图");
  assert.equal(pak.get(12).toString("utf8"), pak.get(10).toString("utf8"));
});

test("版本不是 5 时抛错", () => {
  assert.throws(() => parsePak(buildPak(4)), /pak/);
});

test("本机 Chrome 155 的 zh-CN 把 Split view 译作拆分视图", (t) => {
  const dir = "/opt/google/chrome/locales";
  if (!existsSync(`${dir}/en-US.pak`) || !existsSync(`${dir}/zh-CN.pak`)) return t.skip("无本机 Chrome");
  const en = parsePak(readFileSync(`${dir}/en-US.pak`));
  const zh = parsePak(readFileSync(`${dir}/zh-CN.pak`));
  const ids = findIds(en, /^Split view$/);
  assert.ok(ids.length > 0);
  assert.ok(ids.some((id) => zh.get(id)?.toString("utf8") === "拆分视图"));
});

// Chrome 快捷键页（chrome://extensions/shortcuts）的页名，以术语表为准
const SHORTCUTS_PAGE = { en: "Keyboard shortcuts", zh_CN: "键盘快捷键", zh_TW: "鍵盤快速鍵", es: "Accesos directos" };

test("术语表含键盘快捷键；本机 Chrome 的快捷键页标题与术语表一致", (t) => {
  const term = TERMS.find(x => x.id === "keyboard-shortcuts");
  assert.ok(term && term.en.test("Keyboard shortcuts") && term.en.test("Keyboard shortcut"));
  const dir = "/opt/google/chrome/locales";
  if (!["en-US", "zh-CN", "zh-TW", "es"].every(l => existsSync(`${dir}/${l}.pak`))) return t.skip("无本机 Chrome");
  const [en, zhCN, zhTW, es] = ["en-US", "zh-CN", "zh-TW", "es"].map(l => parsePak(readFileSync(`${dir}/${l}.pak`)));
  const ids = findIds(en, /^Keyboard shortcuts$/);
  assert.ok(ids.length > 0);
  const want = [[zhCN, SHORTCUTS_PAGE.zh_CN], [zhTW, SHORTCUTS_PAGE.zh_TW], [es, SHORTCUTS_PAGE.es]];
  for (const [pak, text] of want) assert.ok(ids.some(id => pak.get(id)?.toString("utf8") === text), text);
});

test("设置页快捷键说明里的 Chrome 页名与术语表一致（4 种语言）", () => {
  for (const [locale, page] of Object.entries(SHORTCUTS_PAGE)) {
    const url = new URL(`../src/_locales/${locale}/messages.json`, import.meta.url);
    const hint = JSON.parse(readFileSync(url, "utf8")).options_shortcut_hint.message;
    assert.ok(hint.includes(page), `${locale}: ${hint}`);
  }
});

// 图片右键菜单项照 Chrome 原生项“Search image with $1”的措辞（spec 3.13）：各语言去掉引擎名后的核心字样
const SEARCH_IMAGE = { en: "Search image with", zh_CN: "搜索图片", zh_TW: "搜尋圖片", es: "Buscar imagen con" };

test("术语表含“使用 X 搜索图片”和标签页；本机 Chrome 的原文与术语表一致", (t) => {
  const image = TERMS.find(x => x.id === "search-image-with");
  assert.ok(image && image.en.test("Search &image with $1") && image.en.test("Search image with $1"));
  const tab = TERMS.find(x => x.id === "open-image-new-tab");
  assert.ok(tab && tab.en.test("Open &image in new tab"));
  const dir = "/opt/google/chrome/locales";
  if (!["en-US", "zh-CN", "zh-TW", "es"].every(l => existsSync(`${dir}/${l}.pak`))) return t.skip("无本机 Chrome");
  const [en, zhCN, zhTW, es] = ["en-US", "zh-CN", "zh-TW", "es"].map(l => parsePak(readFileSync(`${dir}/${l}.pak`)));
  const ids = findIds(en, image.en);
  assert.ok(ids.length > 0);
  for (const [pak, text] of [[zhCN, SEARCH_IMAGE.zh_CN], [zhTW, SEARCH_IMAGE.zh_TW], [es, SEARCH_IMAGE.es]]) {
    assert.ok(ids.some(id => pak.get(id)?.toString("utf8").includes(text)), text);
  }
});

test("图片右键菜单项的措辞与 Chrome 原生项一致（4 种语言）", () => {
  for (const [locale, words] of Object.entries(SEARCH_IMAGE)) {
    const url = new URL(`../src/_locales/${locale}/messages.json`, import.meta.url);
    const title = JSON.parse(readFileSync(url, "utf8")).menu_lookup_image.message;
    assert.ok(title.includes(words), `${locale}: ${title}`);
  }
});
