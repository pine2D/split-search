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

// “开始使用”卡的完成判定（I3）：go.js 写成一对搜索记录后经 chrome/setup-store.js 的 noteSetupPair
// （内部用 lib/setup-state.js 的 countsAsSetup）判定再写 setupDone，跳转之前做
test("go.js：建成一对后经 noteSetupPair 判定再写 setupDone，在跳转之前", () => {
  assert.match(src, /import \{[^}]*\bnoteSetupPair\b[^}]*\} from "\.\/chrome\/setup-store\.js"/);
  const call = src.indexOf("if (outcome.pair) await noteSetupPair([ctx.tab.id, ...outcome.pair]);");
  assert.ok(call > 0, "split() 里应在 outcome.pair 存在时调用 noteSetupPair");
  assert.ok(call > src.indexOf("await ACTIONS[action]("), "应在执行分屏动作之后");
  assert.ok(call < src.indexOf("location.replace(outcome.replaceWith)"), "应在跳转之前");
  assert.ok(call < src.indexOf("await leaveTab(ctx.tab)"), "应在离开当前标签之前");
  assert.doesNotMatch(src, /storage\.local/, "go.js 不直接读写 storage.local");
  const store = readFileSync(new URL("../src/chrome/setup-store.js", import.meta.url), "utf8");
  assert.match(store, /import \{[^}]*\bcountsAsSetup\b[^}]*\} from "\.\.\/lib\/setup-state\.js"/);
  assert.match(store, /if \(!countsAsSetup\(\{ setupDone, tryTabs, tabIds \}\)\) return;\s*try \{\s*await chrome\.storage\.local\.set\(\{ \[DONE_KEY\]: true \}\)/);
});

test("只有 go.js 写 setupDone：补成分屏、右键查询、设置页都不调用 noteSetupPair", () => {
  for (const f of ["chrome/complete-actions.js", "chrome/lookup-actions.js", "background.js", "options/setup.js", "popup/popup.js"]) {
    const s = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(s, /noteSetupPair|storage\.local\.set/, f);
  }
});

// v0.5 关键词规则（设计稿 8.1）：规则只决定右侧，出错退回 _ss 原来的右侧，不落进“只开左侧”
test("go.js：关键词规则经 ruleRight，在展开右侧模板之前；出错退回原右侧，不落进只开左侧", () => {
  assert.match(src, /import \{ ruleRight \} from "\.\/lib\/right-rules\.js"/);
  const at = src.indexOf("ruleRight(");
  assert.ok(at > 0 && at < src.indexOf("expandTemplate(right.url"), "ruleRight 在第一个 expandTemplate(right.url 之前");
  const tryAt = src.lastIndexOf("try {", at), catchAt = src.indexOf("} catch", at);
  assert.ok(tryAt > 0 && catchAt > at, "ruleRight 在 try 里");
  assert.ok(src.lastIndexOf("} catch", at) < tryAt, "ruleRight 与最近的 try 之间没有别的 catch（try 没被拆开）");
  const nextTry = src.indexOf("try {", catchAt);
  assert.ok(nextTry > catchAt, "规则块之后还有展开右侧并分屏的 try");
  const body = src.slice(catchAt, nextTry);
  assert.doesNotMatch(body, /location\.replace/, "这个 catch 里不跳转");
  assert.match(src, /ACTIONS\[action\]\(\{[^}]*\bauto\b[^}]*\}\)/);
  assert.doesNotMatch(src, /\b(?:log|console\.\w+)\([^;]*\b(?:query|pick)\b/);
});
