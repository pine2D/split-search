// go.js 在顶层直接执行 start()，没法导入测试；这里静态检查它的判定接线，守着 PiP 不在分屏 API 上崩溃。
// 判定本身在 lib/split-decision.js 的 decideFor 里测（PiP → other-window）。v0.4 改这处调用（加 role）时这条必须保留。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/go.js", import.meta.url), "utf8");

test("go.js：判定经 decideFor（窗口类型走 splitWindowType），不直接调 decideSplit", () => {
  assert.match(src, /import \{[^}]*\bdecideFor\b[^}]*\} from "\.\/lib\/split-decision\.js"/);
  assert.match(src, /\bdecideFor\(ctx, narrowEnabled\)/);
  assert.doesNotMatch(src, /\bdecideSplit\b/);
  assert.doesNotMatch(src, /windowType:\s*ctx\.win\.type/);
});

test("go.js：读窗口时带 populate（标签数用来区分 PiP 与窗口管理器置顶的普通窗口）", () => {
  assert.match(src, /chrome\.windows\.get\(tab\.windowId, \{ populate: true \}\)/);
});
