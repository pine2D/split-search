import { test } from "node:test";
import assert from "node:assert/strict";
import { MENU_TEXT, MENU_IMAGE, PAGE_PATTERNS, menuSafeName, menuItems } from "../src/lib/menu-spec.js";

test("常量", () => {
  assert.equal(MENU_TEXT, "ss-lookup-text");
  assert.equal(MENU_IMAGE, "ss-lookup-image");
  assert.deepEqual([...PAGE_PATTERNS], ["https://*/*", "http://*/*"]);
});

test("menuSafeName：& 写成 &&，%s 拆开，其余不动", () => {
  assert.equal(menuSafeName("A&B %s $1 100%"), "A&&B % s $1 100%");
  assert.equal(menuSafeName("&&%s%s"), "&&&&% s% s");
  assert.equal(menuSafeName("Bing"), "Bing");
});

test("menuItems：两项的 id、contexts 与过滤网址", () => {
  const t = (k, n) => `${k}|${n}`;
  const [text, image] = menuItems({ textEngine: { name: "Bing" }, imageEngine: { name: "Google Lens" } }, t);
  assert.deepEqual(text, { id: "ss-lookup-text", title: "menu_lookup_text|Bing", contexts: ["selection"],
    documentUrlPatterns: ["https://*/*", "http://*/*"] });
  assert.deepEqual(image, { id: "ss-lookup-image", title: "menu_lookup_image|Google Lens", contexts: ["image"],
    documentUrlPatterns: ["https://*/*", "http://*/*"], targetUrlPatterns: ["https://*/*", "http://*/*"] });
});

test("menuItems：引擎名先经 menuSafeName 再交给 t()", () => {
  const t = (k, n) => `${k}|${n}`;
  const [text, image] = menuItems({ textEngine: { name: "A&B %s" }, imageEngine: { name: "C&D" } }, t);
  assert.equal(text.title, "menu_lookup_text|A&&B % s");
  assert.equal(image.title, "menu_lookup_image|C&&D");
});
