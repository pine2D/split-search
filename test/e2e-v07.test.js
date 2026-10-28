import { test } from "node:test";
import assert from "node:assert/strict";
import { extraTrigger, expectExtraLeft, wordLogProblems, makeToken, STRIP_RULE, WORD } from "../scripts/e2e/steps/v07-strip.mjs";
import { pointOutside, BACKDROP } from "../scripts/e2e/steps/v07-dialogs.mjs";
import { catalogProblems } from "../scripts/e2e/steps/v07-options.mjs";
import { DISCARD_BUTTONS } from "../scripts/e2e/steps/v07-i18n.mjs";
import { STEPS } from "../scripts/e2e/steps/index.mjs";
import { ruleRight, cleanRules } from "../src/lib/right-rules.js";
import { replaceQuery, stripMarker, parseTrigger } from "../src/lib/trigger.js";
import { validateTemplate } from "../src/lib/engines.js";
import { TRIGGER_REGEX } from "../src/lib/rules.js";
import { mockEngines } from "../scripts/e2e/config.mjs";

test("extraTrigger：空格编成 +，额外参数排在 q 后面、_ss 最后", () => {
  assert.equal(extraTrigger(8765, "vd tok1", "src=e2e"), "http://engine-a.localhost:8765/search?q=vd+tok1&src=e2e&_ss=ea,eb");
  assert.equal(extraTrigger(8765, "a&b", "src=e2e", "ea,ec"), "http://engine-a.localhost:8765/search?q=a%26b&src=e2e&_ss=ea,ec");
});

test("extraTrigger 的网址能被 DNR 规则认出，parseTrigger 读出 vd tok1", () => {
  const url = extraTrigger(8765, "vd tok1", "src=e2e");
  assert.ok(new RegExp(TRIGGER_REGEX).test(url));
  const r = parseTrigger(url, mockEngines(8765));
  assert.equal(r.ok, true);
  assert.equal(r.query, "vd tok1");
});

test("expectExtraLeft 与 go.js 去词后的左侧逐字相同：只换 q、src 保留、_ss 去掉", () => {
  const url = extraTrigger(8765, "vd tok1", "src=e2e");
  const ea = mockEngines(8765)[0];
  const got = stripMarker(replaceQuery(url, validateTemplate(ea.url).leftParam, "tok1"));
  assert.equal(got, expectExtraLeft(8765, "tok1", "src=e2e"));
  assert.equal(got, "http://engine-a.localhost:8765/search?q=tok1&src=e2e");
});

test("STRIP_RULE 经 ruleRight：vd tok1 去成 tok1、右侧 ec；只有 vd 时不去；没有 strip 时照旧", () => {
  const engines = mockEngines(8765);
  const cfg = rules => ({ engines, defaultPair: ["ea", "eb"], rightRules: cleanRules(rules, { engines, hidden: [], defaultPair: ["ea", "eb"], isEngineId: id => /^[a-z0-9-]{1,20}$/.test(id) }) });
  const pick = (rules, query) => ruleRight(cfg(rules), { leftId: "ea", rightId: "eb", query });
  assert.equal(pick([STRIP_RULE], `${WORD} tok1`).query, "tok1");
  assert.equal(pick([STRIP_RULE], `${WORD} tok1`).engine.id, "ec");
  assert.equal(pick([STRIP_RULE], WORD).query, WORD);
  const { strip, ...plain } = STRIP_RULE;
  assert.equal(pick([plain], `${WORD} tok1`).query, `${WORD} tok1`);
});

test("wordLogProblems：整词出现才报，token 里夹着不算", () => {
  assert.equal(wordLogProblems([{ text: "[split-search] vd hit" }], "vd").length, 1);
  assert.equal(wordLogProblems([{ text: "[split-search] VD" }], "vd").length, 1);
  assert.deepEqual(wordLogProblems([{ text: "[split-search] tabvdc" }, { text: "ok" }], "vd"), []);
  assert.deepEqual(wordLogProblems(undefined, "vd"), []);
});

test("makeToken：跳过含规则词的候选", () => {
  const seq = ["tvdx", "tabc"];
  assert.equal(makeToken(() => seq.shift()), "tabc");
});

test("pointOutside：遮罩点在对话框矩形外才算，边上算里面", () => {
  const r = { left: 100, right: 500, top: 50, bottom: 400 };
  assert.equal(pointOutside(r, BACKDROP), true);
  assert.equal(pointOutside(r, { x: 100, y: 50 }), false);
  assert.equal(pointOutside(r, { x: 300, y: 401 }), true);
  assert.equal(pointOutside({ left: 0, right: 800, top: 0, bottom: 600 }, BACKDROP), false);
});

test("catalogProblems：空分类与百度都报", () => {
  const ok = { sections: [{ title: "翻译", rows: 2 }], names: ["Google Translate 添加"], entries: ["gtranslate"] };
  assert.deepEqual(catalogProblems(ok), []);
  assert.equal(catalogProblems({ ...ok, sections: [...ok.sections, { title: "中文", rows: 0 }] }).length, 1);
  assert.equal(catalogProblems({ ...ok, names: ["百度 添加"] }).length, 1);
  assert.equal(catalogProblems({ ...ok, entries: ["baidu"] }).length, 1);
  assert.equal(catalogProblems({ sections: [], names: [], entries: [] }).length, 1);
});

test("保存确认的三个按钮都查一行", () => {
  assert.deepEqual(DISCARD_BUTTONS, ["#discard-keep", "#discard-drop", "#discard-save"]);
});

test("T26、B22、B23 已注册为 auto 步骤", () => {
  for (const id of ["T26", "B22", "B23"]) {
    const s = STEPS.find(x => x.id === id);
    assert.ok(s, id);
    assert.equal(s.kind, "auto");
  }
});
