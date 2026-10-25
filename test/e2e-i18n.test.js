import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { E2E_LOCALE, msg, sel } from "../scripts/e2e/i18n.mjs";

const catalog = JSON.parse(readFileSync(new URL("../src/_locales/zh_CN/messages.json", import.meta.url), "utf8"));

test("E2E_LOCALE 是 zh_CN", () => {
  assert.equal(E2E_LOCALE, "zh_CN");
});

test("msg: 返回 zh_CN 目录里的文案", () => {
  assert.equal(msg("engine_grant"), catalog.engine_grant.message);
});

test("msg: 按具名占位符代入参数", () => {
  assert.ok(msg("err_unknown_engine", "nope").includes("nope"));
  assert.ok(!msg("err_unknown_engine", "nope").includes("$"));
});

test("msg: 缺 key 抛错", () => {
  assert.throws(() => msg("no_such_key"), /no_such_key/);
});

test("sel: 按 data-i18n 选元素", () => {
  assert.equal(sel("engine_grant"), '[data-i18n="engine_grant"]');
});

test("msgIn: 按指定语言的目录取文案并代入参数", async () => {
  const { msgIn } = await import("../scripts/e2e/i18n.mjs");
  const es = JSON.parse(readFileSync(new URL("../src/_locales/es/messages.json", import.meta.url), "utf8"));
  assert.equal(msgIn("es", "options_title"), es.options_title.message);
  assert.ok(msgIn("zh_TW", "err_unknown_engine", "nope").includes("nope"));
  assert.equal(msgIn("zh_CN", "engine_grant"), msg("engine_grant"));
  assert.throws(() => msgIn("es", "no_such_key"), /es.*no_such_key/);
});

test("I18N 步骤：auto，--auto-only 也跑", async () => {
  const { STEPS, selectSteps } = await import("../scripts/e2e/steps/index.mjs");
  const step = STEPS.find(s => s.id === "I18N");
  assert.ok(step, "STEPS 里有 I18N");
  assert.equal(step.kind, "auto");
  assert.ok(selectSteps(STEPS, { autoOnly: true, xinput: false }).some(s => s.id === "I18N"));
});

test("auditProblems: lang、原样 key、横向溢出、按钮/label 溢出逐条报出；都没问题返回空", async () => {
  const { auditProblems } = await import("../scripts/e2e/steps/i18n-audit.mjs");
  const ok = { lang: "zh-TW", scrollWidth: 1200, innerWidth: 1200, raw: [], tight: [] };
  assert.deepEqual(auditProblems("zh_TW", ok), []);
  const bad = auditProblems("zh_TW", { lang: "en", scrollWidth: 1300, innerWidth: 1200,
    raw: [{ key: "options_title", text: "options_title" }], tight: [{ tag: "button", key: "engine_edit", sw: 90, cw: 60 }] });
  assert.equal(bad.length, 4);
  assert.match(bad[0], /zh-TW/);
  assert.ok(bad.some(p => p.includes("options_title")));
  assert.ok(bad.some(p => p.includes("1300")));
  assert.ok(bad.some(p => p.includes("engine_edit")));
});

test("auditProblems: 给了 box 时横向溢出按那个元素报（scrollWidth > clientWidth）", async () => {
  const { auditProblems } = await import("../scripts/e2e/steps/i18n-audit.mjs");
  const out = auditProblems("en", { lang: "en", box: "#catalog-dialog", scrollWidth: 620, innerWidth: 600, raw: [], tight: [] });
  assert.equal(out.length, 1);
  assert.match(out[0], /#catalog-dialog 横向溢出：scrollWidth 620 > clientWidth 600/);
  assert.deepEqual(auditProblems("en", { lang: "en", box: "body", scrollWidth: 340, innerWidth: 340, raw: [], tight: [] }), []);
});

test("i18n.mjs 与 v04-i18n.mjs 不互相 import（共用工具在 i18n-audit.mjs）", () => {
  const src = f => readFileSync(new URL(`../scripts/e2e/steps/${f}`, import.meta.url), "utf8");
  assert.doesNotMatch(src("v04-i18n.mjs"), /from "\.\/i18n\.mjs"/);
  assert.doesNotMatch(src("i18n-audit.mjs"), /from "\.\/(v04-)?i18n\.mjs"/);
});
