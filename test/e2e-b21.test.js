import { test } from "node:test";
import assert from "node:assert/strict";
import { tabStateProblems } from "../scripts/e2e/steps/b21.mjs";

const KEYS = ["add", "pair", "engines", "lookup"];
const ok = sel => ({
  tabs: KEYS.map(k => ({ id: `tabbtn-${k}`, selected: String(k === sel), tabindex: k === sel ? "0" : "-1", controls: `panel-${k}` })),
  panels: KEYS.map(k => ({ id: `panel-${k}`, labelledby: `tabname-${k}`, hidden: k !== sel, visible: k === sel })),
});
test("tabStateProblems：正确时为空", () => assert.deepEqual(tabStateProblems(ok("engines"), "engines"), []));
test("tabStateProblems：逐条报出", () => {
  const two = ok("pair"); two.tabs[0].selected = "true";
  assert.ok(tabStateProblems(two, "pair").length > 0);                                    // 两个选中
  const idx = ok("pair"); idx.tabs[2].tabindex = "0";
  assert.ok(tabStateProblems(idx, "pair").length > 0);                                    // 未选中的 tabindex 0
  const lab = ok("pair"); lab.panels[1].labelledby = "tabbtn-pair";
  assert.ok(tabStateProblems(lab, "pair").length > 0);                                    // 面板名指向按钮（设计稿 3.2，#19）
  const vis = ok("pair"); vis.panels[3].visible = true;
  assert.ok(tabStateProblems(vis, "pair").length > 0);                                    // 隐藏面板 checkVisibility 为 true
  assert.ok(tabStateProblems({ ...ok("add"), tabs: ok("add").tabs.slice(0, 3) }, "add").length > 0); // 不是 4 个
  assert.ok(tabStateProblems(ok("add"), "pair").length > 0);                              // 选中的不是期望的
});

// 动态导入（同 e2e-i18n.test.js）：b21-width.mjs 还不存在时只让这几条失败，同文件里 Task 1 的 tabStateProblems 用例照常跑
const widthProblems = async m => (await import("../scripts/e2e/steps/b21-width.mjs")).widthProblems(m);
const good = { maxWidths: [{ sel: ".hint", value: "none" }], ratios: [{ sel: ".hint", ratio: 0.93 }], urlLineDiff: 1,
  lookupSelects: [{ w: 638, inner: 638.5 }], genDiffs: [0.5, 0], scrollWidth: 1280, innerWidth: 1280,
  tablist: { sh: 44, ch: 44 }, rows: [{ id: "ea", mainTop: 100, sideTop: 100.5 }] };
test("widthProblems：全部合格为空", async () => assert.deepEqual(await widthProblems(good), []));
test("widthProblems：每类越界各报一条", async () => {
  const bad = [
    { maxWidths: [{ sel: ".hint", value: "446px" }] }, { ratios: [{ sel: ".hint", ratio: 0.89 }] }, { urlLineDiff: 2.5 },
    { lookupSelects: [{ w: 316, inner: 638 }] }, { genDiffs: [1.5, 0] }, { scrollWidth: 1281 },
    { tablist: { sh: 45, ch: 44 } }, { rows: [{ id: "eu", mainTop: 100, sideTop: 124 }] },
  ];
  for (const patch of bad) assert.equal((await widthProblems({ ...good, ...patch })).length, 1, JSON.stringify(patch));
});
test("widthProblems：urlLineDiff 为 null（没量到）报一条，rows 为空不报", async () => {
  assert.equal((await widthProblems({ ...good, urlLineDiff: null })).length, 1);
  assert.deepEqual(await widthProblems({ ...good, rows: [] }), []);
});
