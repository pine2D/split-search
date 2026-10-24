import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, mergeConfig } from "../src/lib/engines.js";
import { extractOriginalUrl } from "../src/lib/trigger.js";
import { RULE_ID, TRIGGER_REGEX, leftHosts, buildRedirectRule } from "../src/lib/rules.js";
const kagi = PRESETS.find(e => e.id === "kagi"), google = PRESETS.find(e => e.id === "google");
const wiki = { id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" };

test("规则结构", () => {
  const r = buildRedirectRule("abcdefghijklmnopabcdefghijklmnop", ["kagi.com"]);
  assert.deepEqual(r.action, { type: "redirect", redirect: { regexSubstitution: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/go.html?u=\\0" } });
  assert.deepEqual(r.condition.resourceTypes, ["main_frame"]);
  assert.deepEqual(r.condition.requestDomains, ["kagi.com"]);
  assert.equal(r.condition.isUrlFilterCaseSensitive, true);
  assert.equal(r.id, 1);
  assert.equal(RULE_ID, 1);
  assert.equal(r.priority, 1);
  assert.equal(buildRedirectRule("x", []), null);
});
test("TRIGGER_REGEX 应命中与不应命中（用 JS RegExp 模拟，正则只用 RE2 兼容语法）", () => {
  const re = new RegExp(TRIGGER_REGEX);
  for (const u of ["https://kagi.com/search?q=a&_ss=kagi,google", "https://kagi.com/search?_ss=kagi%2Cgoogle&q=a", "https://www.google.com/search?q=a+b&_ss=google,kagi&hl=en", "https://kagi.com/search?q=a&_ss=kagi"]) assert.ok(re.test(u), u);
  for (const u of ["https://kagi.com/search?q=a", "https://kagi.com/search?q=a&_SS=kagi,google", "https://kagi.com/search?q=a&x_ss=kagi,google", "https://kagi.com/search?q=a#&_ss=kagi,google"]) assert.ok(!re.test(u), u);
});
test("用 \\0 替换后能被 extractOriginalUrl 还原", () => {
  const u = "https://kagi.com/search?q=a+b&_ss=kagi,google";
  const out = u.replace(new RegExp(TRIGGER_REGEX), "chrome-extension://id/go.html?u=$&");
  assert.equal(extractOriginalUrl(new URL(out).search), u);
});
test("leftHosts 排除只能作右侧的引擎并去重", () => {
  assert.deepEqual(leftHosts([kagi, google, wiki, { ...kagi, id: "k2" }]), ["kagi.com", "www.google.com"]);
});
test("leftHosts 跳过无效模板且不抛错", () => {
  const bad = [{ id: "a", url: "not a url %s" }, { id: "b", url: "https://*/?q=%s" }, { id: "c", url: "https://[::1]/?q=%s" }, { id: "d", url: undefined }];
  assert.deepEqual(leftHosts([...bad, kagi]), ["kagi.com"]);
});
test("leftHosts 不含已隐藏的左侧引擎", () => {
  const { engines } = mergeConfig({ presetOverrides: { bing: { hidden: true } } });
  assert.ok(!leftHosts(engines).includes("www.bing.com"));
  assert.ok(leftHosts(engines).includes("kagi.com"));
});
test("requestDomains 是副本，之后修改 hosts 不影响规则", () => {
  const hosts = ["kagi.com"];
  const r = buildRedirectRule("x", hosts);
  hosts.push("evil.com");
  assert.deepEqual(r.condition.requestDomains, ["kagi.com"]);
});
