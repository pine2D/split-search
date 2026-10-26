import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { icon, ICON_PATHS, ICON_STROKE } from "../src/ui/icons.js";

class El {
  constructor(ns, tag) { this.ns = ns; this.tag = tag; this.attrs = new Map(); this.children = []; }
  setAttribute(k, v) { this.attrs.set(k, v); }
  append(...c) { this.children.push(...c); }
}
globalThis.document = { createElementNS: (ns, tag) => new El(ns, tag) };

test("icon：SVG 命名空间、统一 viewBox 与线宽、currentColor、aria-hidden", () => {
  for (const name of Object.keys(ICON_PATHS)) {
    const svg = icon(name);
    assert.equal(svg.ns, "http://www.w3.org/2000/svg");
    assert.equal(svg.tag, "svg");
    assert.equal(svg.attrs.get("viewBox"), "0 0 16 16");
    assert.equal(svg.attrs.get("stroke-width"), ICON_STROKE);
    assert.equal(svg.attrs.get("stroke"), "currentColor");
    assert.equal(svg.attrs.get("fill"), "none");
    assert.equal(svg.attrs.get("aria-hidden"), "true");
    assert.equal(svg.attrs.get("class"), "icon");
    assert.equal(svg.children.length, 1);
    assert.equal(svg.children[0].tag, "path");
    assert.equal(svg.children[0].attrs.get("d"), ICON_PATHS[name]);
  }
});

test("icon：尺寸与附加 class；未知名字抛错", () => {
  const svg = icon("x", { size: 14, cls: "notice-icon" });
  assert.equal(svg.attrs.get("width"), "14");
  assert.equal(svg.attrs.get("height"), "14");
  assert.equal(svg.attrs.get("class"), "icon notice-icon");
  assert.throws(() => icon("nope"), /unknown icon/);
});

// 界面代码里不用 Unicode 字符充当图标（注释除外；文案里描述 Chrome 界面的 ⋮ 不在代码里）
const GLYPHS = /[●○◯◉↑↓←→↔⇄×✓✔✗✕✖▲▼◀▶▸▾☰★☆]/u;
const UI_DIRS = ["options", "popup", "ui", "styles"].map((d) => new URL(`../src/${d}/`, import.meta.url).pathname);
const UI_FILES = ["go.js", "go.html", "go.css"].map((f) => new URL(`../src/${f}`, import.meta.url).pathname);
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

test("界面代码里没有用 Unicode 字符充当图标", () => {
  const files = [...UI_DIRS.flatMap(walk), ...UI_FILES].filter((f) => /\.(js|html|css)$/.test(f));
  assert.ok(files.length > 10);
  for (const f of files) {
    const lines = stripComments(readFileSync(f, "utf8")).split("\n");
    lines.forEach((line, i) => assert.doesNotMatch(line, GLYPHS, `${f}:${i + 1} 用了字符图标：${line.trim()}`));
  }
});
