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
