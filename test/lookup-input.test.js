import { test } from "node:test";
import assert from "node:assert/strict";
import { SELECTION_MAX, SELECTION_PRECUT, normalizeSelection, lookupInput } from "../src/lib/lookup-input.js";
import { MENU_TEXT, MENU_IMAGE } from "../src/lib/menu-spec.js";
import { expandTemplate } from "../src/lib/trigger.js";
import { IMAGE_PRESET } from "../src/lib/image-engines.js";

test("常量", () => {
  assert.equal(SELECTION_MAX, 500);
  assert.equal(SELECTION_PRECUT, 10000);
  assert.equal(MENU_TEXT, "ss-lookup-text");
  assert.equal(MENU_IMAGE, "ss-lookup-image");
});
test("normalizeSelection：合并各种空白", () => assert.equal(normalizeSelection("  a \n\tb  c 　"), "a b c"));
test("normalizeSelection：EM SPACE、连续 NBSP 也合并", () => assert.equal(normalizeSelection("a  b c"), "a b c"));
test("normalizeSelection：几 MB 的输入先粗截再处理", () => {
  assert.ok(normalizeSelection("ab ".repeat(2_000_000)).length <= SELECTION_MAX);
  assert.equal([...normalizeSelection("x".repeat(5_000_000))].length, SELECTION_MAX);
});
test("normalizeSelection：粗截在空白之前，开头大段空白后的文字不会被截掉一半以上", () => {
  // 粗截按码点取前 SELECTION_PRECUT 个，之后才去空白：前面 9998 个空白 + "ab" 恰好留下 "ab"
  assert.equal(normalizeSelection(" ".repeat(SELECTION_PRECUT - 2) + "abcdef"), "ab");
});
test("normalizeSelection：按码点截断，不切断代理对", () => {
  const s = normalizeSelection("😀".repeat(600));
  assert.equal([...s].length, 500);
  assert.ok(!/[\uD800-\uDBFF]$/.test(s));
});
test("normalizeSelection：粗截处不留孤立的代理项", () => {
  const s = normalizeSelection("😀".repeat(SELECTION_PRECUT + 5), SELECTION_PRECUT);
  assert.equal([...s].length, SELECTION_PRECUT);
  assert.ok(!/[\uD800-\uDBFF]$/.test(s));
});
test("normalizeSelection：截断处是空格时不留尾空格", () => assert.equal(normalizeSelection("a ".repeat(400), 6), "a a a"));
test("normalizeSelection：非字符串按空串处理", () => {
  assert.equal(normalizeSelection(undefined), "");
  assert.equal(normalizeSelection(42), "");
});
test("lookupInput：文字", () => {
  assert.deepEqual(lookupInput("ss-lookup-text", { selectionText: " hi\nthere " }), { ok: true, input: "text", query: "hi there" });
  assert.equal(lookupInput("ss-lookup-text", { selectionText: "x", editable: true }).reason, "editable");
  assert.equal(lookupInput("ss-lookup-text", { selectionText: " \n " }).reason, "empty");
  assert.equal(lookupInput("ss-lookup-text", {}).reason, "empty");
  assert.equal(lookupInput("other", { selectionText: "x" }).reason, "unknown_item");
});
test("lookupInput：文字的 editable 只认 true", () => {
  assert.equal(lookupInput(MENU_TEXT, { selectionText: "x", editable: false }).ok, true);
  assert.equal(lookupInput(MENU_TEXT, { selectionText: "••••", editable: true }).reason, "editable");
});
test("lookupInput：图片", () => {
  assert.equal(lookupInput("ss-lookup-image", { mediaType: "image", srcUrl: "data:image/png;base64,AA" }).reason, "bad_src");
  assert.equal(lookupInput("ss-lookup-image", { mediaType: "image", srcUrl: "blob:https://a.com/1" }).reason, "bad_src");
  assert.equal(lookupInput("ss-lookup-image", { mediaType: "video", srcUrl: "https://a.com/v.mp4" }).reason, "not_image");
  assert.equal(lookupInput(MENU_IMAGE, { mediaType: "image", srcUrl: "not a url" }).reason, "bad_src");
  assert.equal(lookupInput(MENU_IMAGE, { mediaType: "image" }).reason, "bad_src");
  assert.equal(lookupInput(MENU_IMAGE, { srcUrl: "https://a.com/i.png" }).reason, "not_image");
  assert.deepEqual(lookupInput(MENU_IMAGE, { mediaType: "image", srcUrl: "http://a.com/i.png" }),
    { ok: true, input: "image", query: "http://a.com/i.png" });
});
test("lookupInput 不读 pageUrl / frameUrl", () => {
  const info = new Proxy({ selectionText: "x" }, { get(t, k) { if (k === "pageUrl" || k === "frameUrl") throw new Error(String(k)); return t[k]; } });
  assert.equal(lookupInput("ss-lookup-text", info).ok, true);
  const img = new Proxy({ mediaType: "image", srcUrl: "https://a.com/i.png" }, { get(t, k) { if (k === "pageUrl" || k === "frameUrl") throw new Error(String(k)); return t[k]; } });
  assert.equal(lookupInput(MENU_IMAGE, img).ok, true);
});
test("图片网址往返：url= 解码后逐字等于 srcUrl", () => {
  const src = "https://img.example.com/a%20b.png?x=1&y=2#f";
  const r = lookupInput("ss-lookup-image", { mediaType: "image", srcUrl: src });
  assert.equal(r.query, src);
  assert.equal(new URL(expandTemplate(IMAGE_PRESET.url, r.query)).searchParams.get("url"), src);
});
