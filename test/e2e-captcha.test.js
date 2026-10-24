import { test } from "node:test";
import assert from "node:assert/strict";
import { googleLeft, sorryContinue, isSorry, sorryNote } from "../scripts/e2e/steps/captcha.mjs";
import { gbPair, fmt } from "../scripts/e2e/steps/assisted.mjs";

// 网址形状取自首次验收的浏览历史与 HTTP 缓存（diag-google-dnr.md §2.1–2.3），令牌换成假的
const SORRY_T5 = "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dt5&q=EgQoAgAAGJ_ppckGIjD0fake";
const SORRY_ZH = "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3D%25E6%2596%25B0%25E6%25A0%2587%25E7%25AD%25BE%25E9%25A1%25B5%25E6%25B5%258B%25E8%25AF%2595%26sei%3D_T_baFAKE&q=EgQfake";
const SORRY_SS = "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dt5%26_ss%3Dgoogle%2Cbing&q=EgQfake";
const ABUSE = "https://www.google.com/search?q=t5&google_abuse=GOOGLE_ABUSE_EXEMPTION%3DID%3Dfake:TM%3D1792753264:C%3DR:IP%3D2001:db8::1-:S%3Dfake%3B+path%3D/";

test("googleLeft: 结果页 search；验证页 continue 是期望的搜索为 sorry；其余为 null", () => {
  assert.equal(googleLeft("https://www.google.com/search?q=t5", "t5"), "search");
  assert.equal(googleLeft(SORRY_T5, "t5"), "sorry");
  assert.equal(googleLeft(SORRY_T5, "别的"), null, "关键词不同不算");
  assert.equal(googleLeft(SORRY_ZH, "新标签页测试"), "sorry", "continue 里带 sei、关键词双重编码");
  assert.equal(googleLeft(SORRY_SS, "t5"), null, "continue 里还带 _ss：Google 收到了触发网址，DNR 没生效");
  assert.equal(googleLeft("https://www.google.com/search?q=t5&_ss=google,bing", "t5"), null);
  assert.equal(googleLeft(ABUSE, "t5"), "search", "验证通过后带 google_abuse 的结果页");
  assert.equal(googleLeft("https://www.google.com/search?q=t5&sei=abc", "t5"), "search");
  assert.equal(googleLeft("https://ipv4.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dt5", "t5"), "sorry");
  assert.equal(googleLeft("https://www.google.com/sorry/index?q=x", "t5"), null, "没有 continue");
  assert.equal(googleLeft("https://evil.example/sorry/index?continue=https://www.google.com/search%3Fq%3Dt5", "t5"), null);
  assert.equal(googleLeft("https://www.google.com/sorry/index?continue=https://evil.example/search%3Fq%3Dt5", "t5"), null);
  assert.equal(googleLeft(undefined, "t5"), null);
});

test("sorryContinue / isSorry", () => {
  assert.equal(sorryContinue(SORRY_T5), "https://www.google.com/search?q=t5");
  assert.equal(sorryContinue("https://www.google.com/search?q=t5"), null);
  assert.equal(isSorry(SORRY_T5), true);
  assert.equal(isSorry("chrome://newtab/"), false);
});

test("gbPair: 左侧停在验证页也算分屏已建成，说明里写明被验证挡住", () => {
  const tab = (id, index, url) => ({ id, index, windowId: 1, splitViewId: 5, url });
  const st = { tabs: [tab(1, 0, SORRY_T5), tab(2, 1, "https://www.bing.com/search?q=t5")] };
  const p = gbPair(st, "t5");
  assert.ok(p);
  assert.match(fmt(p), /分屏已建成，左侧被 Google 人机验证挡住/);
  assert.equal(sorryNote([{ url: "https://www.google.com/search?q=t5" }, { url: "https://www.bing.com/" }]), "");
  assert.equal(gbPair({ tabs: [tab(1, 0, SORRY_SS), tab(2, 1, "https://www.bing.com/search?q=t5")] }, "t5"), undefined);
});
