import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeys, xdoCombo, keyEvents, TEST_KEYS, COMMAND, canReenter, guardBefore } from "../scripts/e2e/ext-shortcuts.mjs";
import { fillToLimit, itemBytes, ITEM_LIMIT, catalogProblems } from "../scripts/e2e/steps/v03-options.mjs";
import { CYCLE_EXCLUDE, T19_PRESSES, T19_WORDS, t19Plan, manualSnapshot } from "../scripts/e2e/steps/xauto-t19.mjs";
import { T18_QUERY, encodeQ } from "../scripts/e2e/steps/v03-popup.mjs";
import { queryOf } from "../scripts/e2e/steps/v03-lib.mjs";
import { expectPair } from "../scripts/e2e/steps/util.mjs";
import { expandTemplate } from "../src/lib/trigger.js";
import { restoreShortcutStep } from "../scripts/e2e/teardown.mjs";
import { STEPS, selectSteps } from "../scripts/e2e/steps/index.mjs";
import { mockBaseline } from "../scripts/e2e/ext.mjs";
import { mergeConfig } from "../src/lib/engines.js";
import { nextRightEngine } from "../src/lib/cycle.js";
import { CATALOG, CATEGORIES } from "../src/lib/engine-catalog.js";

test("parseKeys: Chrome 写法的组合键 → 修饰键位掩码与主键", () => {
  const p = parseKeys("Alt+Shift+Period");
  assert.deepEqual(p.mods, ["Alt", "Shift"]);
  assert.equal(p.modifiers, 1 | 8);
  assert.equal(p.key.vk, 190);
  assert.equal(p.key.code, "Period");
  assert.equal(parseKeys("Ctrl+Shift+Y").key.code, "KeyY");
  assert.equal(parseKeys("Alt+7").key.vk, 55);
  assert.equal(parseKeys("Ctrl+Up").key.key, "ArrowUp");
  assert.equal(parseKeys("Alt+F5").key.vk, 116);
});

test("parseKeys: 没有修饰键、只有 Shift、重复修饰键、不支持的主键都抛错", () => {
  for (const bad of ["Period", "Shift+K", "Alt+Alt+K", "Alt+F13", "Alt+", "", "Hyper+K"]) {
    assert.throws(() => parseKeys(bad), /快捷键/, bad);
  }
});

test("xdoCombo / keyEvents: 测试用组合键能交给 xdotool 与 CDP", () => {
  assert.equal(xdoCombo(TEST_KEYS), "alt+shift+period");
  assert.equal(xdoCombo("Ctrl+Shift+PageDown"), "ctrl+shift+Next");
  assert.match(xdoCombo(TEST_KEYS), /^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$/); // xinput.key 的 COMBO_RE
  const [down, up] = keyEvents(TEST_KEYS);
  assert.deepEqual([down.type, up.type], ["rawKeyDown", "keyUp"]);
  assert.equal(down.windowsVirtualKeyCode, 190);
  assert.equal(down.modifiers, 9);
  assert.equal(COMMAND, "cycle-right");
});

test("fillToLimit: 结果不超过上限，再加一项就超过；不改原数组", () => {
  const base = [{ id: "ea", name: "A", url: "http://a.test/s?q=%s" }];
  const extra = { id: "github", name: "GitHub", url: "https://github.com/search?q=%s&type=repositories" };
  const arr = fillToLimit(base, extra);
  assert.equal(base.length, 1);
  assert.deepEqual(arr[0], base[0]);
  assert.ok(itemBytes("customEngines", arr) <= ITEM_LIMIT);
  assert.ok(itemBytes("customEngines", [...arr, extra]) > ITEM_LIMIT);
  assert.equal(new Set(arr.map(e => e.id)).size, arr.length);
  assert.ok(arr.every(e => /^[a-z0-9-]{1,20}$/.test(e.id)));
  assert.ok(arr.every(e => e.name.length <= 40));
});

test("catalogProblems: 与引擎库数据一致时无问题；缺分类、标题不对、按钮已添加、原样 key 都报出", () => {
  const text = k => `T:${k}`;
  const cats = CATEGORIES.filter(c => CATALOG.some(e => e.category === c.id));
  const good = {
    open: true, raw: [],
    headings: cats.map(c => ({ key: c.key, text: text(c.key) })),
    lists: cats.map(c => CATALOG.filter(e => e.category === c.id).map(e => ({ name: e.name, key: "catalog_add", text: text("catalog_add"), disabled: false }))),
  };
  assert.deepEqual(catalogProblems(good, { text }), []);
  const bad = structuredClone(good);
  bad.headings.pop();
  bad.headings[0].text = "x";
  bad.lists[0][0].disabled = true;
  bad.raw.push({ key: "catalog_title", text: "catalog_title" });
  const p = catalogProblems(bad, { text }).join("；");
  assert.match(p, /分类标题应为/);
  assert.match(p, /显示“x”/);
  assert.match(p, /禁用/);
  assert.match(p, /key 样的文字/);
});

test("T19：基线引擎按 CYCLE_EXCLUDE 轮换，依次换成 T19_PRESSES（跳过 ec 与预置引擎）", () => {
  const { engines } = mergeConfig(mockBaseline(8765));
  let right = "eb";
  for (const want of T19_PRESSES) {
    right = nextRightEngine(engines, right, CYCLE_EXCLUDE).id;
    assert.equal(right, want);
  }
  assert.ok(CYCLE_EXCLUDE.includes("ec") && CYCLE_EXCLUDE.includes("google"));
  assert.ok(T19_WORDS.every(w => /^[\x20-\x7e]+$/.test(w)));
});

test("T18 的特殊字符关键词：触发网址里的写法能还原成原文", () => {
  assert.equal(queryOf(encodeQ(T18_QUERY)), T18_QUERY);
  assert.equal(encodeQ("a b"), "a+b");
  assert.match(encodeQ(T18_QUERY), /%26.*%23.*%2B/);
  // 期望的右侧不二次编码：等于 go.html 用 expandTemplate 展开的结果
  assert.equal(expectPair(8765, encodeQ(T18_QUERY))[1], expandTemplate("http://engine-b.localhost:8765/search?q=%s", T18_QUERY));
  assert.equal(expectPair(8765, "a+b")[1], "http://engine-b.localhost:8765/search?q=a%20b");
});

test("步骤注册：B16、B17 是 auto，T19 是 xauto 且回退到同编号的 judge", () => {
  const byId = id => STEPS.find(s => s.id === id);
  assert.equal(byId("B16").kind, "auto");
  assert.equal(byId("B17").kind, "auto");
  const t19 = byId("T19");
  assert.equal(t19.kind, "xauto");
  assert.equal(t19.fallback.id, "T19");
  assert.equal(t19.fallback.kind, "judge");
});

const mkRt = (o = {}) => ({ browser: {}, browserDead: false, restartFailed: false, notes: [], ...o });
const FILE = "/x/shortcut-snapshot.json";

test("restoreShortcutStep: 没有快照不动；有快照改回；浏览器不在或失败时保留快照并记备注", async () => {
  await restoreShortcutStep(mkRt(), {}, { shortcut: { SHORTCUT_FILE: FILE, restore: () => assert.fail("不该调用") }, exists: () => false });
  const logs = [];
  await restoreShortcutStep(mkRt(), {}, { shortcut: { SHORTCUT_FILE: FILE, restore: async () => ({ command: "cycle-right", before: "" }) },
    exists: () => true, log: m => logs.push(m) });
  assert.match(logs[0], /快捷键已改回.*cycle-right：未绑定/);
  const gone = mkRt({ browserDead: true });
  await restoreShortcutStep(gone, {}, { shortcut: { SHORTCUT_FILE: FILE, restore: () => assert.fail("不该调用") }, exists: () => true });
  assert.match(gone.notes[0], /无法改回快捷键.*快照保留/);
  const failed = mkRt();
  await restoreShortcutStep(failed, {}, { shortcut: { SHORTCUT_FILE: FILE, restore: async () => { throw new Error("boom"); } }, exists: () => true });
  assert.match(failed.notes[0], /改回快捷键失败：boom.*快照保留/);
});

test("canReenter / guardBefore：录不回去的原有绑定（媒体键等）不清除、不改写", () => {
  assert.equal(canReenter("Ctrl+Shift+Y"), true);
  assert.equal(canReenter("MediaNextTrack"), false);
  assert.equal(canReenter("Shift+K"), false);
  assert.doesNotThrow(() => guardBefore(COMMAND, "", TEST_KEYS));
  assert.doesNotThrow(() => guardBefore(COMMAND, "Ctrl+Shift+Y", ""));
  assert.doesNotThrow(() => guardBefore(COMMAND, "MediaNextTrack", "MediaNextTrack"));
  assert.throws(() => guardBefore(COMMAND, "MediaNextTrack", ""), e => e.kind === "unrestorable" && /MediaNextTrack/.test(e.message));
  assert.throws(() => guardBefore(COMMAND, "MediaPlayPause", TEST_KEYS), e => e.kind === "unrestorable");
});

test("t19Plan：绑定成功 → auto；录不回去 → 两种模式都跳过；快捷键页认不出 → auto-only 跳过、引导式走人工；其他错误抛出", () => {
  const infra = Object.assign(new Error("认不出"), { kind: "infra" });
  const keep = Object.assign(new Error("录不回去"), { kind: "unrestorable" });
  const boom = new Error("boom");
  assert.deepEqual(t19Plan({ bindError: null, autoOnly: true }), { action: "auto" });
  for (const autoOnly of [true, false]) assert.deepEqual(t19Plan({ bindError: keep, autoOnly }), { action: "skip", detail: "录不回去" });
  assert.equal(t19Plan({ bindError: infra, autoOnly: true }).action, "skip");
  assert.match(t19Plan({ bindError: infra, autoOnly: true }).detail, /--auto-only 不回退到人工/);
  assert.deepEqual(t19Plan({ bindError: infra, autoOnly: false }), { action: "manual", detail: "认不出" });
  assert.deepEqual(t19Plan({ bindError: boom, autoOnly: false }), { action: "throw", error: boom });
});

test("manualSnapshot：运行前未绑定 → 记快照（before 为空）；已有绑定 → 返回跳过原因、不记快照", async () => {
  const saved = [];
  const ctx = shortcut => ({ ext: { eval: async () => [{ name: COMMAND, shortcut }, { name: "_execute_action", shortcut: "" }] } });
  assert.equal(await manualSnapshot(ctx(""), { save: (c, b) => saved.push([c, b]) }), null);
  assert.deepEqual(saved, [[COMMAND, ""]]);
  assert.match(await manualSnapshot(ctx("Alt+Shift+K"), { save: () => assert.fail("不该记快照") }), /已绑定“Alt\+Shift\+K”.*跳过/);
});

test("selectSteps：xinput 不可用时 T19 换成人工 judge 版本；--auto-only 下不选它", () => {
  assert.deepEqual(selectSteps(STEPS, { only: ["T19"], xinput: false }).map(s => s.kind), ["judge"]);
  assert.deepEqual(selectSteps(STEPS, { only: ["T19"], xinput: true }).map(s => s.kind), ["xauto"]);
  assert.deepEqual(selectSteps(STEPS, { only: ["T19"], xinput: false, autoOnly: true }), []);
});
