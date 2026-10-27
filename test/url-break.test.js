import { test } from "node:test";
import assert from "node:assert/strict";
import { urlBreakParts } from "../src/lib/url-break.js";

const cases = {
  "chrome://settings/searchEngines": ["chrome://settings/", "searchEngines"],
  "https://www.google.com/search?q=%s&_ss=google,bing": ["https://www.google.com/", "search?", "q=", "%s&", "_ss=", "google,", "bing"],
  "https://x.test/wiki/%s": ["https://x.test/", "wiki/", "%s"],
  "https://kagi.com/search?q=%s&_ss=kagi%2Cbing": ["https://kagi.com/", "search?", "q=", "%s&", "_ss=", "kagi%2Cbing"],
  "a//b": ["a//", "b"],
  "abc": ["abc"],
  "a/": ["a/"],
};
test("在 / ? & = , 之后切段，连续分隔符算一处，开头的 scheme:// 不单独成段", () => {
  for (const [url, want] of Object.entries(cases)) assert.deepEqual(urlBreakParts(url), want, url);
});
test("各段拼回原串", () => { for (const url of Object.keys(cases)) assert.equal(urlBreakParts(url).join(""), url); });
test("空串与非字符串返回 []", () => { for (const v of ["", null, undefined, 42]) assert.deepEqual(urlBreakParts(v), []); });
