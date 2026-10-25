import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { overlayTemplates, filterOnly } from "../scripts/store/template-sets.mjs";
import { readTemplates } from "../scripts/store/render-assets.mjs";

// 商店图第二版：assets/templates-v2/（目前只有 en），渲染时按 asset-out 替换主模板里的商店图
const V2 = new URL("../assets/templates-v2/", import.meta.url);
const MAIN = new URL("../assets/templates/", import.meta.url);
const files = readdirSync(V2).filter(f => f.endsWith(".html") && !f.startsWith("_"));
const html = Object.fromEntries(files.map(f => [f, readFileSync(new URL(f, V2), "utf8")]));

test("v2 每种语言的文案键与模板里用到的 data-t 完全一致", () => {
  const used = new Set(Object.values(html).flatMap(h => [...h.matchAll(/data-t="([^"]+)"/g)].map(m => m[1])));
  const langs = readdirSync(new URL("i18n/", V2)).filter(f => f.endsWith(".json"));
  assert.ok(langs.includes("en.json"));
  for (const f of langs) {
    const strings = JSON.parse(readFileSync(new URL(`i18n/${f}`, V2), "utf8"));
    assert.deepEqual(Object.keys(strings).sort(), [...used].sort(), `${f} 的键与模板用到的不一致`);
    for (const [k, v] of Object.entries(strings)) assert.ok(typeof v === "string" && v.trim(), `${f} 的 ${k} 为空`);
  }
});

test("v2 模板用到的截图在 assets/raw/en/ 都有，脚本和样式都能找到", () => {
  for (const [f, h] of Object.entries(html)) {
    for (const [, img] of h.matchAll(/src="\.\.\/raw\/([^"/]+\.png)"/g)) assert.ok(existsSync(new URL(`../raw/en/${img}`, V2)), `${f} 用到的 ${img} 没有英文版`);
    for (const [, img] of h.matchAll(/src="\.\.\/raw\/(en\/[^"]+\.png)"/g)) assert.ok(existsSync(new URL(`../raw/${img}`, V2)), `${f} 用到的 ${img} 不存在`);
    for (const [, ref] of h.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) assert.ok(existsSync(new URL(ref, V2)), `${f} 引用的 ${ref} 不存在`);
  }
});

test("v2 只替换商店图：en 的商店图全部来自 v2，README 图和其他语言不变", () => {
  const base = readTemplates(fileURLToPath(MAIN)), v2 = { dir: fileURLToPath(V2), list: readTemplates(fileURLToPath(V2)) };
  assert.ok(v2.list.every(t => t.out.startsWith("store/")), "v2 只放商店图");
  const en = overlayTemplates(base, v2, "en");
  assert.deepEqual(en.map(t => t.out).sort(), base.map(t => t.out).sort(), "输出集合不变");
  for (const t of en) assert.equal(t.file.startsWith(v2.dir), t.out.startsWith("store/"), `${t.out} 用错了模板`);
  for (const l of ["zh_CN", "zh_TW", "es"]) assert.deepEqual(overlayTemplates(base, v2, l), base);
  assert.deepEqual(overlayTemplates(base, null, "en"), base);
  const only = filterOnly({ en, es: base }, ["store-5-privacy", "store-5-fallback"]);
  assert.deepEqual(only.en.map(t => t.name), ["store-5-privacy"]);
  assert.deepEqual(only.es.map(t => t.name), ["store-5-fallback"]);
  assert.throws(() => filterOnly({ en }, ["nope"]), /没有这些模板/);
});
