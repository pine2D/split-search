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
