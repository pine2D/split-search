import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeConfig } from "../src/lib/engines.js";
import {
  KEEP, addRule, editRule, moveRule, removeRule, dropRulesFor, countRulesFor, engineChoices, targetLabel, moveNotice, removeNotice,
} from "../src/options/rule-edits.js";

const ec = { id: "ec", name: "Engine C", url: "https://c.example/search?q=%s" };
const ed = { id: "ed", name: "Engine D", url: "https://d.example/?q=%s" };
const raw = { customEngines: [ec, ed], defaultPair: ["google", "bing"] };
const form = (x) => ({ when: "words", words: "wiki, 百科", script: "han", engine: "ec", ...x });
const withRules = (rightRules, extra = {}) => ({ ...raw, rightRules, ...extra });
const words = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const codeOf = (r, field) => r.errors?.[field]?.code;

test("addRule：存规范化后的词", () => {
  const r = addRule(raw, form({ words: "ＷＩＫＩ，百科" }));
  assert.equal(r.ok, true);
  assert.equal(r.id, "r1");
  assert.deepEqual(r.patch.rightRules, [{ id: "r1", when: "words", words: ["wiki", "百科"], engine: "ec" }]);
});

test("addRule：新 id 取最大号 + 1，加在末尾", () => {
  const r = addRule(withRules([{ id: "r3", when: "words", words: ["a"], engine: "ec" }]), form({ words: "b" }));
  assert.equal(r.id, "r4");
  assert.deepEqual(r.patch.rightRules.map(x => x.id), ["r3", "r4"]);
});

test("addRule：keep 存 keep: true，没有 engine 键", () => {
  const r = addRule(raw, form({ engine: KEEP }));
  assert.deepEqual(r.patch.rightRules, [{ id: "r1", when: "words", words: ["wiki", "百科"], keep: true }]);
  assert.ok(!Object.hasOwn(r.patch.rightRules[0], "engine"));
});

test("addRule：script 只存 script，不存 words；不认识的文字 → rule_script", () => {
  const r = addRule(raw, form({ when: "script", script: "kana" }));
  assert.deepEqual(r.patch.rightRules, [{ id: "r1", when: "script", script: "kana", engine: "ec" }]);
  const bad = addRule(raw, form({ when: "script", script: "latin" }));
  assert.equal(bad.ok, false);
  assert.equal(codeOf(bad, "script"), "rule_script");
  assert.equal(bad.patch, undefined);
});

test("addRule：引擎留空、是默认左侧、已隐藏 → rule_engine（RF4）", () => {
  assert.equal(codeOf(addRule(raw, form({ engine: "" })), "engine"), "rule_engine");
  assert.equal(codeOf(addRule(raw, form({ engine: "google" })), "engine"), "rule_engine");
  const hidden = { ...raw, presetOverrides: { ddg: { hidden: true } } };
  assert.equal(codeOf(addRule(hidden, form({ engine: "ddg" })), "engine"), "rule_engine");
  assert.equal(codeOf(addRule(raw, form({ engine: "zz" })), "engine"), "rule_engine");
  // 默认右侧本身可以选（行文字写“与默认组合的右侧相同”）
  assert.equal(addRule(raw, form({ engine: "bing" })).ok, true);
});

test("addRule：另一页把默认左侧换成了所选引擎 → 按最新存储报 rule_engine（RF4）", () => {
  const changed = { ...raw, defaultPair: ["ec", "bing"] };
  assert.equal(codeOf(addRule(changed, form({ engine: "ec" })), "engine"), "rule_engine");
});

test("addRule：词的错误落在 errors.words", () => {
  assert.equal(codeOf(addRule(raw, form({ words: " , ， " })), "words"), "rule_no_words");
  const long = addRule(raw, form({ words: "a".repeat(33) }));
  assert.equal(codeOf(long, "words"), "rule_word_long");
  assert.deepEqual(long.errors.words.args, ["a".repeat(12)]);
});

test("addRule：词和引擎同时出错时都报", () => {
  const r = addRule(raw, form({ words: "", engine: "" }));
  assert.equal(codeOf(r, "words"), "rule_no_words");
  assert.equal(codeOf(r, "engine"), "rule_engine");
});

test("addRule：已有 20 条 → errors.form rule_too_many", () => {
  const rules = Array.from({ length: 20 }, (_, i) => ({ id: `r${i + 1}`, when: "words", words: [`w${i}`], engine: "ec" }));
  const r = addRule(withRules(rules), form());
  assert.equal(r.ok, false);
  assert.equal(codeOf(r, "form"), "rule_too_many");
  assert.equal(r.patch, undefined);
});

test("addRule：合计 61 词 → errors.words rule_words_total", () => {
  const rules = [
    { id: "r1", when: "words", words: words("a", 30), engine: "ec" },
    { id: "r2", when: "words", words: words("b", 30), engine: "ed" },
  ];
  const r = addRule(withRules(rules), form({ words: "c" }));
  assert.equal(codeOf(r, "words"), "rule_words_total");
  assert.equal(r.patch, undefined);
  // 文字规则不带词，不受合计限制
  assert.equal(addRule(withRules(rules), form({ when: "script" })).ok, true);
});

test("addRule：序列化超过 8000 字节 → errors.words rule_too_large，不返回 patch", () => {
  // 4 字节的 emoji，每词 32 个：合计 60 个词、分成 6 条才超 8000 字节（2 条约 7975 字节，余量太小）
  const emojiWord = (k) => Array.from({ length: 32 }, (_, i) => String.fromCodePoint(0x1f600 + ((k + i) % 64))).join("");
  const group = (g) => Array.from({ length: 10 }, (_, k) => emojiWord(g * 10 + k));
  const rules = [0, 1, 2, 3, 4].map(g => ({ id: `r${g + 1}`, when: "words", words: group(g), engine: "ec" }));
  const base = withRules(rules);
  assert.equal(mergeConfig(base).rightRules.reduce((n, r) => n + r.words.length, 0), 50, "夹具：50 个词都留下");
  const expected = [...rules, { id: "r6", when: "words", words: group(5), engine: "ec" }];
  const bytes = new TextEncoder().encode(JSON.stringify(expected)).length + "rightRules".length;
  assert.ok(bytes > 8000, `夹具：写回的规则应超过 8000 字节，实际 ${bytes}`);
  assert.ok(new TextEncoder().encode(JSON.stringify(rules)).length + 10 <= 8000, "夹具：原有规则本身不超");
  const r = addRule(base, form({ words: group(5).join(",") }));
  assert.equal(r.ok, false);
  assert.equal(codeOf(r, "words"), "rule_too_large");
  assert.equal(r.patch, undefined);
});

test("editRule：保存不改 id 和位置", () => {
  const rules = [
    { id: "r1", when: "words", words: ["a"], engine: "ec" },
    { id: "r2", when: "words", words: ["b"], engine: "ec" },
    { id: "r3", when: "script", script: "han", engine: "ed" },
  ];
  const r = editRule(withRules(rules), "r2", form({ words: "x, y", engine: KEEP }));
  assert.equal(r.ok, true);
  assert.equal(r.id, "r2");
  assert.deepEqual(r.patch.rightRules, [rules[0], { id: "r2", when: "words", words: ["x", "y"], keep: true }, rules[2]]);
});

test("editRule：合计词数不算原来那条", () => {
  const rules = [
    { id: "r1", when: "words", words: words("a", 30), engine: "ec" },
    { id: "r2", when: "words", words: words("b", 30), engine: "ed" },
  ];
  assert.equal(editRule(withRules(rules), "r2", form({ words: words("c", 30).join(",") })).ok, true);
  assert.equal(codeOf(editRule(withRules(rules), "r2", form({ words: words("c", 31).join(",") })), "words"), "rule_too_many_words");
});

test("editRule：已有 20 条时编辑照常（条数只在新增时查）", () => {
  const rules = Array.from({ length: 20 }, (_, i) => ({ id: `r${i + 1}`, when: "words", words: [`w${i}`], engine: "ec" }));
  assert.equal(editRule(withRules(rules), "r5", form()).ok, true);
});

test("editRule：原引擎已隐藏、照原样保存 → ok；改选别的隐藏引擎仍拒绝", () => {
  const hiddenRaw = withRules([{ id: "r1", when: "words", words: ["a"], engine: "ddg" }],
    { presetOverrides: { ddg: { hidden: true }, kagi: { hidden: true } } });
  const r = editRule(hiddenRaw, "r1", form({ words: "a, b", engine: "ddg" }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch.rightRules, [{ id: "r1", when: "words", words: ["a", "b"], engine: "ddg" }]);
  assert.equal(codeOf(editRule(hiddenRaw, "r1", form({ engine: "kagi" })), "engine"), "rule_engine");
});

test("editRule：原引擎是默认左侧或已删除、照原样保存 → rule_engine", () => {
  const left = withRules([{ id: "r1", when: "words", words: ["a"], engine: "google" }]);
  assert.equal(codeOf(editRule(left, "r1", form({ engine: "google" })), "engine"), "rule_engine");
  const missing = withRules([{ id: "r1", when: "words", words: ["a"], engine: "zz" }]);
  assert.equal(codeOf(editRule(missing, "r1", form({ engine: "zz" })), "engine"), "rule_engine");
  assert.equal(editRule(missing, "r1", form({ engine: "ec" })).ok, true);
});

test("editRule：id 不存在 → errors.form rule_gone，不悄悄复活（RF3）", () => {
  const r = editRule(withRules([{ id: "r1", when: "words", words: ["a"], engine: "ec" }]), "r2", form());
  assert.equal(r.ok, false);
  assert.equal(codeOf(r, "form"), "rule_gone");
  assert.equal(r.patch, undefined);
  assert.equal(codeOf(editRule(raw, "r1", form()), "form"), "rule_gone");
});

test("moveRule：上移、到头、找不到", () => {
  const r1 = { id: "r1", when: "words", words: ["a"], engine: "ec" };
  const r2 = { id: "r2", when: "words", words: ["b"], engine: "ed" };
  const src = withRules([r1, r2]);
  const up = moveRule(src, "r2", -1);
  assert.deepEqual(up, { ok: true, patch: { rightRules: [r2, r1] }, position: 1 });
  assert.deepEqual(moveRule(src, "r1", 1).position, 2);
  assert.deepEqual(moveRule(src, "r1", -1), { ok: true, patch: null });
  assert.deepEqual(moveRule(src, "r2", 1), { ok: true, patch: null });
  assert.deepEqual(moveRule(src, "r9", -1), { ok: true, patch: null }); // RF3
});

test("removeRule：删一条、删最后一条、找不到", () => {
  const r1 = { id: "r1", when: "words", words: ["a"], engine: "ec" };
  const r2 = { id: "r2", when: "words", words: ["b"], engine: "ed" };
  assert.deepEqual(removeRule(withRules([r1, r2]), "r1"), { ok: true, patch: { rightRules: [r2] } });
  assert.deepEqual(removeRule(withRules([r1]), "r1"), { ok: true, patch: null, remove: ["rightRules"] });
  assert.deepEqual(removeRule(withRules([r1]), "r2"), { ok: true, patch: null }); // RF3
  assert.deepEqual(removeRule(raw, "r1"), { ok: true, patch: null });
});

test("写入以清洗结果为底：读时被丢掉的规则不写回，也移不动", () => {
  const src = withRules([
    { id: "r1", when: "words", words: words("a", 30), engine: "ec" },
    { id: "r2", when: "words", words: words("b", 30), engine: "ed" },
    { id: "r3", when: "words", words: words("c", 10), engine: "ec" },
  ]);
  const r = moveRule(src, "r2", -1);
  assert.deepEqual(r.patch.rightRules.map(x => x.id), ["r2", "r1"]);
  for (const rule of r.patch.rightRules) assert.ok(!Object.hasOwn(rule, "off"), "写回的规则不带 off");
  assert.equal(r.patch.rightRules.reduce((n, x) => n + x.words.length, 0), 60);
  assert.deepEqual(moveRule(src, "r3", -1), { ok: true, patch: null });
});

test("dropRulesFor / countRulesFor：跳过 keep", () => {
  const rules = [
    { id: "r1", when: "words", words: ["a"], engine: "ed" },
    { id: "r2", when: "words", words: ["b"], keep: true },
    { id: "r3", when: "script", script: "han", engine: "ed" },
    { id: "r4", when: "words", words: ["c"], engine: "ec" },
  ];
  const src = withRules(rules);
  const d = dropRulesFor(src, "ed");
  assert.equal(d.dropped, 2);
  assert.deepEqual(d.rules.map(r => r.id), ["r2", "r4"]);
  for (const rule of d.rules) assert.ok(!Object.hasOwn(rule, "off"));
  assert.equal(countRulesFor(src, "ed"), 2);
  assert.equal(countRulesFor(mergeConfig(src), "ed"), 2);
  assert.equal(countRulesFor(src, "ec"), 1);
  assert.equal(countRulesFor({ rightRules: undefined }, "ed"), 0);
  assert.equal(countRulesFor({}, "ed"), 0);
  assert.deepEqual(dropRulesFor(raw, "ed"), { rules: [], dropped: 0 });
});

test("engineChoices：选项与选中值", () => {
  const src = withRules([
    { id: "r1", when: "words", words: ["a"], engine: "ec" },
    { id: "r2", when: "words", words: ["b"], keep: true },
    { id: "r3", when: "words", words: ["c"], engine: "ddg" },
    { id: "r4", when: "words", words: ["d"], engine: "google" },
    { id: "r5", when: "words", words: ["e"], engine: "zz" },
  ], { presetOverrides: { ddg: { hidden: true } } });
  const cfg = mergeConfig(src);
  const rule = (id) => cfg.rightRules.find(r => r.id === id);

  const add = engineChoices(cfg, null);
  const values = add.options.map(o => o.value);
  assert.deepEqual(values.slice(0, 2), ["", KEEP]);
  assert.deepEqual(add.options[0].label, { key: "options_rules_engine_pick", args: [] });
  assert.deepEqual(add.options[1].label, { key: "options_rules_engine_keep", args: [] });
  for (const id of ["bing", "ec", "ed"]) assert.ok(values.includes(id), id);
  for (const id of ["google", "ddg"]) assert.ok(!values.includes(id), id);
  assert.deepEqual(add.options.find(o => o.value === "ec").label, { text: "Engine C" });
  assert.equal(add.selected, "");

  assert.equal(engineChoices(cfg, rule("r1")).selected, "ec");
  assert.equal(engineChoices(cfg, rule("r2")).selected, KEEP);

  const hidden = engineChoices(cfg, rule("r3"));
  assert.deepEqual(hidden.options.at(-1), { value: "ddg", label: { key: "options_rules_engine_hidden", args: ["DuckDuckGo"] } });
  assert.equal(hidden.selected, "ddg");

  for (const id of ["r4", "r5"]) {
    const c = engineChoices(cfg, rule(id));
    assert.ok(!c.options.some(o => o.value === rule(id).engine), id);
    assert.equal(c.selected, "", id);
  }
});

test("targetLabel：keep、默认右侧、其他、已隐藏、已删除", () => {
  const src = withRules([
    { id: "r1", when: "words", words: ["a"], keep: true },
    { id: "r2", when: "words", words: ["b"], engine: "bing" },
    { id: "r3", when: "words", words: ["c"], engine: "ec" },
    { id: "r4", when: "words", words: ["d"], engine: "ddg" },
    { id: "r5", when: "words", words: ["e"], engine: "zz" },
  ], { presetOverrides: { ddg: { hidden: true } } });
  const cfg = mergeConfig(src);
  const rule = (id) => cfg.rightRules.find(r => r.id === id);
  assert.deepEqual(targetLabel(cfg, rule("r1")), { key: "options_rules_target_keep", engineName: "Bing" });
  assert.deepEqual(targetLabel(cfg, rule("r2")), { key: "options_rules_target_default", engineName: "Bing" });
  assert.deepEqual(targetLabel(cfg, rule("r3")), { key: "options_rules_target", engineName: ec.name });
  assert.deepEqual(targetLabel(cfg, rule("r4")), { key: "options_rules_target", engineName: "DuckDuckGo" });
  assert.equal(targetLabel(cfg, rule("r5")).engineName, null);
});

test("moveNotice / removeNotice：真的写了才提示（RF3）", () => {
  assert.deepEqual(moveNotice({ ok: true, patch: { rightRules: [] }, position: 1 }), ["notice_rule_moved", 1]);
  assert.equal(moveNotice({ ok: true, patch: null }), null);
  assert.deepEqual(removeNotice({ ok: true, patch: { rightRules: [] } }), ["notice_rule_deleted"]);
  assert.deepEqual(removeNotice({ ok: true, patch: null, remove: ["rightRules"] }), ["notice_rule_deleted"]);
  assert.equal(removeNotice({ ok: true, patch: null }), null);
});

test("addRule writes strip only for checked words rules", () => {
  assert.equal(addRule(raw, form({ strip: true })).patch.rightRules.at(-1).strip, true);
  assert.equal("strip" in addRule(raw, form({ strip: false })).patch.rightRules.at(-1), false);
  assert.equal("strip" in addRule(raw, form({ when: "script", strip: true })).patch.rightRules.at(-1), false);
});
test("editRule can clear strip", () => {
  const r0 = withRules([{ id: "r1", when: "words", words: ["vd"], engine: "ec", strip: true }]);
  assert.equal("strip" in editRule(r0, "r1", form({ words: "vd", strip: false })).patch.rightRules[0], false);
});
