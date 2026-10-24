import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LOCALES, SOURCE_LOCALE, localizedOut, parseArgs, resolveLocales } from "../scripts/store/render-assets.mjs";

// 商店 / README 图片模板的文案：assets/templates/i18n/<locale>.json，模板里用 data-t="键" 引用
const DIR = new URL("../assets/templates/", import.meta.url);
const I18N = new URL("i18n/", DIR);
const read = (name) => JSON.parse(readFileSync(new URL(name, I18N), "utf8"));
const source = read(`${SOURCE_LOCALE}.json`);
const sourceKeys = Object.keys(source).sort();
const templates = readdirSync(DIR).filter(f => f.endsWith(".html") && !f.startsWith("_"));
const used = new Map(); // 键 → 用到它的模板
for (const f of templates) {
  for (const [, k] of readFileSync(new URL(f, DIR), "utf8").matchAll(/data-t="([^"]+)"/g)) used.set(k, [...(used.get(k) ?? []), f]);
}

test("每个语言的文案文件与 zh_CN.json 键集合完全相同，值都是非空字符串", () => {
  const files = readdirSync(I18N).filter(f => f.endsWith(".json"));
  assert.ok(files.includes(`${SOURCE_LOCALE}.json`));
  for (const f of files) {
    assert.ok(Object.hasOwn(LOCALES, f.replace(/\.json$/, "")), `${f} 不是已知语言（${Object.keys(LOCALES).join("、")}）`);
    const strings = read(f);
    assert.deepEqual(Object.keys(strings).sort(), sourceKeys, `${f} 的键与 ${SOURCE_LOCALE}.json 不一致`);
    for (const [k, v] of Object.entries(strings)) assert.ok(typeof v === "string" && v.trim(), `${f} 的 ${k} 为空或不是字符串`);
  }
});

test("模板里用到的 data-t 键都在 zh_CN.json 里，zh_CN.json 也没有没人用的键", () => {
  assert.ok(used.size > 0, "模板里没有 data-t");
  for (const [k, fs] of used) assert.ok(Object.hasOwn(source, k), `${fs.join("、")} 用到的 ${k} 不在 ${SOURCE_LOCALE}.json`);
  for (const k of sourceKeys) assert.ok(used.has(k), `${SOURCE_LOCALE}.json 的 ${k} 没有模板在用`);
});

test("输出路径按语言分目录，zh_CN 的 README 图留在 assets/readme/ 根下", () => {
  assert.equal(localizedOut("store/screenshot-1.png", "zh_CN"), "store/zh_CN/screenshot-1.png");
  assert.equal(localizedOut("store/screenshot-1.png", "es"), "store/es/screenshot-1.png");
  assert.equal(localizedOut("readme/hero.png", "zh_CN"), "readme/hero.png");
  assert.equal(localizedOut("readme/hero.png", "zh_TW"), "readme/zh_TW/hero.png");
  assert.deepEqual(resolveLocales("en"), ["en"]);
  assert.ok(resolveLocales("all").includes(SOURCE_LOCALE));
  assert.equal(parseArgs([]).locale, SOURCE_LOCALE);
  assert.equal(parseArgs(["--locale", "all"]).locale, "all");
  assert.throws(() => parseArgs(["--locale", "zh-TW"]), /--locale/);
});
