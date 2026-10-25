import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// 静态守门：src 里打印到控制台的错误一律先经 lib/safe-error.js（不带堆栈，引号内容和网址样文字换成 …），
// 不把 Chrome 的错误对象或它的 message 原样交给 console。
const SRC = new URL("../src/", import.meta.url).pathname;
function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsFiles(p);
    return p.endsWith(".js") ? [p] : [];
  });
}

test("每个 log 小工具都经 safeArgs，直接的 console 调用不带原始错误", () => {
  const problems = [];
  for (const file of jsFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    const rel = file.slice(SRC.length);
    for (const m of text.matchAll(/const log = \(\.\.\.args\) => console\.\w+\(([^;]*)\);/g)) {
      if (!m[1].includes("...safeArgs(args)")) problems.push(`${rel}: log 没经 safeArgs`);
    }
    for (const m of text.matchAll(/console\.(?:error|warn|info|log)\(([^;]*)\);/g)) {
      if (m[1].includes("safeArgs(args)")) continue;
      const bare = m[1].replace(/safeError\([^)]*\)/g, "");
      if (/\b(?:err|e|error)\b|\.message\b|\.stack\b/.test(bare)) problems.push(`${rel}: ${m[0]}`);
    }
    for (const m of text.matchAll(/\blog\(([^;]*)\);/g)) {
      if (/\.message\b|\.stack\b/.test(m[1])) problems.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(problems, []);
});
