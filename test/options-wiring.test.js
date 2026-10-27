import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

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

test("src/options/ 里只有 tabs.js 注册 hashchange", () => {
  const dir = new URL("../src/options/", import.meta.url);
  const hits = readdirSync(dir).filter(f => f.endsWith(".js") && readFileSync(new URL(f, dir), "utf8").includes('"hashchange"'));
  assert.deepEqual(hits, ["tabs.js"]);
});
const opt = name => readFileSync(new URL(`../src/options/${name}`, import.meta.url), "utf8");
// 每处 remove("loading") 与它前一处（第一处则从 async function render 起）之间要有 routeOnce(：
// 失败分支段里是 routeOnce("hidden")，成功分支段里是 routeOnce(mode)，互不顶替
test("options.js：每处去掉 loading 之前有 routeOnce(", () => {
  const s = opt("options.js");
  const start = s.indexOf("async function render");
  assert.ok(start >= 0, "找不到 async function render");
  const marks = [...s.matchAll(/remove\("loading"\)/g)].map(m => m.index).filter(i => i > start);
  assert.ok(marks.length >= 2, `render 里 remove("loading") 应至少 2 处（实际 ${marks.length}）`);
  marks.forEach((at, i) => {
    const seg = s.slice(i === 0 ? start : marks[i - 1], at);
    assert.ok(seg.includes("routeOnce("), `第 ${i + 1} 处 remove("loading") 之前没有 routeOnce(`);
  });
});
const fnBody = (s, sig) => { const i = s.indexOf(sig); assert.ok(i >= 0, sig); return s.slice(i, s.indexOf("\n}\n", i)); };
test("revealSetup、revealGuideSteps 的函数体都先 showTab(\"add\")", () => {
  const rs = fnBody(opt("setup.js"), "export function revealSetup(");
  const a = rs.indexOf('showTab("add")'), b = rs.indexOf("scrollIntoView(");
  assert.ok(a >= 0 && b >= 0 && a < b, "revealSetup 应在 scrollIntoView 之前 showTab(\"add\")");
  assert.match(fnBody(opt("guide.js"), "export function revealGuideSteps("), /^export function revealGuideSteps\([^)]*\)\s*\{\s*showTab\("add"\);/);
});
