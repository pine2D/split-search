import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, ID_PATTERN, validateTemplate, isIdTaken } from "../src/lib/engines.js";
import { CATALOG, uniqueId } from "../src/lib/engine-catalog.js";
import { IMAGE_PRESET, IMAGE_CATALOG } from "../src/lib/image-engines.js";

for (const e of [IMAGE_PRESET, ...IMAGE_CATALOG]) test(`${e.id} 模板合法`, () => {
  assert.equal(validateTemplate(e.url).ok, true);
  assert.ok(ID_PATTERN.test(e.id));
  assert.ok(!PRESETS.some(p => p.id === e.id) && !CATALOG.some(c => c.id === e.id));
});

test("文字引擎库 id 不与以图搜图冲突", () => {
  for (const c of CATALOG) assert.ok(c.id !== IMAGE_PRESET.id && !IMAGE_CATALOG.some(i => i.id === c.id));
});

test("uniqueId 两个方向互相查重", () => {
  const textTaken = { customEngines: [{ id: "bing-img", name: "x", url: "https://x.com/?q=%s" }] };
  assert.equal(uniqueId("bing-img", id => isIdTaken(id, textTaken)), "bing-img-2");
  const imageTaken = { imageEngines: [{ id: "youtube", name: "y", url: "https://y.com/?u=%s" }] };
  assert.equal(uniqueId("youtube", id => isIdTaken(id, imageTaken)), "youtube-2");
});
