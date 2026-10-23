import { test } from "node:test";
import assert from "node:assert/strict";
import { originPattern, errorText } from "../src/options/ui.js";

test("originPattern：精确 origin + /*", () => {
  assert.equal(originPattern({ url: "https://kagi.com/search?q=%s" }), "https://kagi.com/*");
  assert.equal(originPattern({ url: "http://127.0.0.1:8080/?q=%s" }), "http://127.0.0.1:8080/*");
});
test("originPattern：含 * 或无法解析时不生成（不会申请宽泛权限）", () => {
  assert.equal(originPattern({ url: "https://*/?q=%s" }), null);
  assert.equal(originPattern({ url: "https://*.example.com/?q=%s" }), null);
  assert.equal(originPattern({ url: "not a url" }), null);
});
test("errorText：storage.sync 配额错误翻译成中文", () => {
  for (const m of ["QUOTA_BYTES quota exceeded", "QUOTA_BYTES_PER_ITEM quota exceeded"]) {
    assert.match(errorText(new Error(m)), /同步存储空间已满/);
  }
  for (const m of ["MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded", "MAX_WRITE_OPERATIONS_PER_HOUR quota exceeded"]) {
    assert.match(errorText(new Error(m)), /保存过于频繁，请稍后再试/);
  }
  assert.equal(errorText(new Error("配置过大，无法保存：order")), "配置过大，无法保存：order");
  assert.equal(errorText("boom"), "boom");
});
