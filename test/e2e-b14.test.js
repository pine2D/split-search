import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schemeTokens, schemeVerdict, topRules, GO_ERROR_URL } from "../scripts/e2e/steps/b14.mjs";
import { extractOriginalUrl, parseTrigger } from "../src/lib/trigger.js";
import { mergeConfig } from "../src/lib/engines.js";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("schemeTokens: 从真实样式表读出 body 引用的变量与浅色/深色取值", () => {
  // 页面按层叠顺序拼接的样式表源码：先是共享变量表，再是界面自己的样式表
  const want = { bgVar: "--bg", fgVar: "--text", light: { bg: "#f5f6f8", fg: "#1c1f25" }, dark: { bg: "#141619", fg: "#e5e7eb" } };
  for (const own of ["src/options/options.css", "src/popup/popup.css"]) {
    assert.deepEqual(schemeTokens(`${read("src/styles/tokens.css")}\n${read(own)}`), want, own);
  }
  assert.deepEqual(schemeTokens(`${read("src/styles/tokens.css")}\n${read("src/go.css")}`), want, "go.css");
  const g = schemeTokens(read("scripts/e2e/guide/guide.css"));
  assert.equal(g.fgVar, "--fg");
  assert.notEqual(g.light.bg, g.dark.bg);
});

test("schemeTokens: 注释、background-color、var() 带回退值；别的 @media 不算深色", () => {
  const css = `/* :root { --bg: red } */ :root { --b: #fff; --f: #000 }
    @media (max-width: 600px) { :root { --b: #111 } }
    @media (prefers-color-scheme: dark) { :root { --b: #000; --f: #eee } .x { color: red } }
    body { background-color: var(--b, white); color: var( --f ) }`;
  assert.deepEqual(schemeTokens(css), { bgVar: "--b", fgVar: "--f", light: { bg: "#fff", fg: "#000" }, dark: { bg: "#000", fg: "#eee" } });
});

test("schemeTokens: 不是“变量 + 深色覆盖”的写法时说明原因", () => {
  assert.throws(() => schemeTokens(":root{--b:#fff} body{background:#fff;color:var(--b)}"), /var\(--…\)/);
  assert.throws(() => schemeTokens(":root{--b:#fff;--f:#000} body{background:var(--b);color:var(--f)}"), /没有覆盖 --b/);
  assert.throws(() => schemeTokens("body{background:var(--b);color:var(--f)} @media (prefers-color-scheme: dark){:root{--b:#000;--f:#fff}}"), /浅色 :root 里没有定义 --b/);
  assert.throws(() => schemeTokens(":root{--b:#000;--f:#000} body{background:var(--b);color:var(--f)} @media (prefers-color-scheme: dark){:root{--b:#000;--f:#fff}}"), /取值相同/);
  assert.throws(() => topRules("a { b: c"), /不配对/);
});

test("schemeTokens: @import 语句不吞掉后面的 :root（被 @import 的源码由页面按顺序拼在前面）", () => {
  const css = `:root { --b: #fff; --f: #000 } @media (prefers-color-scheme: dark) { :root { --b: #000; --f: #eee } }
    @import url("../styles/tokens.css"); @charset "utf-8"; :root { --r: 4px } body { background: var(--b); color: var(--f) }`;
  assert.deepEqual(topRules(css).map(r => r.prelude), [":root", "@media (prefers-color-scheme: dark)", ":root", "body"]);
  assert.deepEqual(schemeTokens(css).dark, { bg: "#000", fg: "#eee" });
});

test("schemeVerdict: 颜色与 matchMedia 都对才通过，否则逐项说明", () => {
  const ok = { bg: "rgb(0, 0, 0)", fg: "rgb(1, 1, 1)", wantBg: "rgb(0, 0, 0)", wantFg: "rgb(1, 1, 1)", matches: true };
  assert.equal(schemeVerdict("设置页", "dark", ok), null);
  assert.match(schemeVerdict("设置页", "light", ok), /设置页（light）：prefers-color-scheme/);
  const bad = schemeVerdict("向导页", "dark", { ...ok, bg: "rgb(9, 9, 9)" });
  assert.match(bad, /背景色 rgb\(9, 9, 9\)，应为 rgb\(0, 0, 0\)/);
  assert.doesNotMatch(bad, /文字色/);
});

test("GO_ERROR_URL：go.html 读到的原始网址是 _ss 格式不对的触发网址（显示出错页，不分屏）", () => {
  const original = extractOriginalUrl(new URL(GO_ERROR_URL).search);
  assert.equal(original, "https://www.google.com/search?q=x&_ss=google");
  const r = parseTrigger(original, mergeConfig({}).engines);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "marker_format");
});
