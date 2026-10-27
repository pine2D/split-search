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
  lookupSelects: [{ w: 638, inner: 638.5 }, { w: 638, inner: 638 }], genDiffs: [0.5, 0], scrollWidth: 1280, innerWidth: 1280,
  tablist: { sh: 44, ch: 44 }, rows: [{ id: "ea", mainTop: 100, sideTop: 100.5 }],
  head: { h1Lines: 1, h1: [20, 55.2], lang: [22.3, 53] } };
test("widthProblems：全部合格为空", async () => assert.deepEqual(await widthProblems(good), []));
test("widthProblems：每类越界各报一条", async () => {
  const bad = [
    { maxWidths: [{ sel: ".hint", value: "446px" }] }, { ratios: [{ sel: ".hint", ratio: 0.89 }] }, { urlLineDiff: 2.5 },
    { lookupSelects: [{ w: 316, inner: 638 }, { w: 638, inner: 638 }] }, { genDiffs: [1.5, 0] }, { scrollWidth: 1281 },
    { tablist: { sh: 45, ch: 44 } }, { rows: [{ id: "eu", mainTop: 100, sideTop: 124 }] },
    { head: { h1Lines: 2, h1: [20, 90.4], lang: [39.9, 70.6] } },   // 600 档 h1 折成两行（与语言框仍同行）
    { head: { h1Lines: 1, h1: [20, 55.2], lang: [108, 138.7] } },   // 语言框掉到下一行
  ];
  for (const patch of bad) assert.equal((await widthProblems({ ...good, ...patch })).length, 1, JSON.stringify(patch));
});
test("widthProblems：urlLineDiff 为 null（没量到）报一条；rows 为 null（1280 档）不报", async () => {
  assert.equal((await widthProblems({ ...good, urlLineDiff: null })).length, 1);
  assert.deepEqual(await widthProblems({ ...good, rows: null }), []);
});
test("widthProblems：空读数各报一条（说明、折行块、下拉框不是 2 个、600 档引擎行）", async () => {
  for (const patch of [{ maxWidths: [] }, { ratios: [] }, { lookupSelects: [] }, { lookupSelects: [good.lookupSelects[0]] }, { rows: [] }])
    assert.equal((await widthProblems({ ...good, ...patch })).length, 1, JSON.stringify(patch));
});
test("widthProblems：head 为 null（1280 档不量页头）不报，没量到 h1 报一条", async () => {
  assert.deepEqual(await widthProblems({ ...good, head: null }), []);
  assert.equal((await widthProblems({ ...good, head: { h1Lines: 0, h1: null, lang: [22.3, 53] } })).length, 1);
});

// B19 弹窗“完成设置”复用已开的设置页：hash 按点之前选中的 tab 精确判定（不再放行 #tab-add、#setup 或原值任一）
const b19 = () => import("../scripts/e2e/steps/b19-popup.mjs");
test("wantHash：新开页是 #setup；本来在 ① 不动 hash；从别的 tab 切过来是 #tab-add", async () => {
  const { wantHash } = await b19();
  assert.equal(wantHash(null), "#setup");
  assert.equal(wantHash({ tab: "tabbtn-add", hash: "" }), "");
  assert.equal(wantHash({ tab: "tabbtn-add", hash: "#setup" }), "#setup");
  assert.equal(wantHash({ tab: "tabbtn-pair", hash: "" }), "#tab-add");
  assert.equal(wantHash({ tab: "tabbtn-engines", hash: "#tab-engines" }), "#tab-add");
});
test("cardProblems：hash 与期望不同各报一条", async () => {
  const { cardProblems } = await b19();
  const f = { mode: "steps", hidden: false, focus: "setup-title", tab: "tabbtn-add", hash: "#tab-add" };
  assert.deepEqual(cardProblems(f, "steps", { tab: "tabbtn-pair", hash: "" }), []);
  assert.equal(cardProblems(f, "steps", { tab: "tabbtn-add", hash: "" }).length, 1);  // 本来在 ①，hash 不该被改
  assert.equal(cardProblems(f, "steps").length, 1);                                    // 新开页应保持 #setup
  assert.equal(cardProblems({ ...f, hash: "#setup" }, "steps", { tab: "tabbtn-pair", hash: "#setup" }).length, 1);
});
