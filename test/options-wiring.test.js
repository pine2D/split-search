import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 静态守门：设置页每次去掉 loading（页面显示出来）之后都要调 revealSetup()。
// 读配置失败提前 return 的分支也要调：卡片没渲染、是隐藏的，revealSetup 只清掉 #setup 的待办；
// 漏了的话待办一直留着，之后某次渲染成功时会突然滚到卡片、抢走焦点。
const SRC = readFileSync(new URL("../src/options/options.js", import.meta.url), "utf8");

test("options.js：每处 body 去掉 loading 后紧接着 revealSetup()（含读配置失败的分支）", () => {
  const lines = SRC.split("\n");
  const at = lines.flatMap((l, i) => (l.includes(`document.body.classList.remove("loading")`) ? [i] : []));
  assert.ok(at.length >= 2, `render 的成功和失败两个分支都应去掉 loading，实际 ${at.length} 处`);
  for (const i of at) assert.match(lines[i + 1] ?? "", /^\s*revealSetup\(\);/, `第 ${i + 1} 行之后应是 revealSetup()`);
});
