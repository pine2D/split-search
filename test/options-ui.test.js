import { test } from "node:test";
import assert from "node:assert/strict";
import { originPattern } from "../src/options/ui.js";

test("originPattern：精确 origin + /*", () => {
  assert.equal(originPattern({ url: "https://kagi.com/search?q=%s" }), "https://kagi.com/*");
  assert.equal(originPattern({ url: "http://127.0.0.1:8080/?q=%s" }), "http://127.0.0.1:8080/*");
});
test("originPattern：含 * 或无法解析时不生成（不会申请宽泛权限）", () => {
  assert.equal(originPattern({ url: "https://*/?q=%s" }), null);
  assert.equal(originPattern({ url: "https://*.example.com/?q=%s" }), null);
  assert.equal(originPattern({ url: "not a url" }), null);
});
