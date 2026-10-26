import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { topRules } from "../scripts/e2e/steps/b14.mjs";

// 设置页、弹窗、go.html 的颜色变量只定义在 src/styles/tokens.css 一处：三个界面都引用这一份，
// 用到的每个 var(--x) 在 tokens.css 的浅色、深色段里都有定义（或是界面自己 :root 里与配色无关的常量）
const SRC = new URL("../src/", import.meta.url);
const TOKENS = new URL("styles/tokens.css", SRC).href;
const read = (url) => readFileSync(new URL(url), "utf8");
const UIS = [
  { name: "设置页", html: "options/options.html", css: "options/options.css" },
  { name: "弹窗", html: "popup/popup.html", css: "popup/popup.css" },
  { name: "go.html", html: "go.html", css: "go.css" },
].map((u) => ({ ...u, html: new URL(u.html, SRC).href, css: new URL(u.css, SRC).href }));

const DARK = /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/;
const isRoot = (p) => p.split(",").some((x) => x.trim() === ":root");
const props = (body) => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);?/g)].map(([, k, v]) => [k, v.trim()]));
const looksLikeColor = (v) => /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|lab|lch|color)a?\(/i.test(v);

// { light, dark }：顶层 :root 与 @media (prefers-color-scheme: dark) 里 :root 的 --变量
function sections(css) {
  const light = {}, dark = {};
  for (const r of topRules(css)) {
    if (isRoot(r.prelude)) Object.assign(light, props(r.body));
    else if (DARK.test(r.prelude)) for (const inner of topRules(r.body)) if (isRoot(inner.prelude)) Object.assign(dark, props(inner.body));
  }
  return { light, dark };
}
const used = (css) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]));
// 页面引用的样式表（<link rel="stylesheet">）与样式表里的 @import，都解析成绝对网址
const links = (html, base) => [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map((m) => new URL(m[1], base).href);
const imports = (css, base) => [...css.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)].map((m) => new URL(m[1], base).href);

test("tokens.css：浅色、深色两段定义同一组变量，且都有取值", () => {
  const t = sections(read(TOKENS));
  const light = Object.keys(t.light).sort(), dark = Object.keys(t.dark).sort();
  assert.ok(light.length > 10, "浅色段变量太少，可能没解析到");
  assert.deepEqual(dark, light, "深色段与浅色段的变量不一致");
  for (const k of ["--pane-left-bg", "--pane-left-border", "--pane-right-bg", "--pane-right-border", "--focus", "--selection"]) {
    assert.ok(k in t.light, `缺少 ${k}`);
  }
  for (const k of used(read(TOKENS))) assert.ok(k in t.light, `tokens.css 自己用到的 ${k} 没定义`);
});

for (const ui of UIS) {
  test(`${ui.name}：引用同一份 styles/tokens.css，用到的变量都有定义`, () => {
    const html = read(ui.html), css = read(ui.css);
    const sheets = links(html, ui.html);
    assert.ok(sheets.includes(ui.css), `${ui.name} 没有用 <link> 引用自己的样式表`);
    const viaLink = sheets.includes(TOKENS) && sheets.indexOf(TOKENS) < sheets.indexOf(ui.css);
    const viaImport = imports(css, ui.css).includes(TOKENS);
    assert.ok(viaLink || viaImport, `${ui.name} 没有引用 styles/tokens.css（<link> 要排在自己的样式表前面）`);
    assert.doesNotMatch(html, /<style\b/, `${ui.name} 不应再有内联 <style>`);

    assert.doesNotMatch(css, /prefers-color-scheme/, `${ui.name} 的样式表不应自己写深色段`);
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b/i, `${ui.name} 的样式表里不应写十六进制颜色`);
    const local = sections(css).light;
    for (const [k, v] of Object.entries(local)) assert.ok(!looksLikeColor(v), `${ui.name} 自己定义了颜色变量 ${k}: ${v}`);

    const t = sections(read(TOKENS));
    for (const k of used(css)) {
      if (k in local) continue;
      assert.ok(k in t.light, `${ui.name} 用到的 ${k} 不在 tokens.css 浅色段`);
      assert.ok(k in t.dark, `${ui.name} 用到的 ${k} 不在 tokens.css 深色段`);
    }
  });
}
