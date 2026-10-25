import { test } from "node:test";
import assert from "node:assert/strict";
import { IMAGE_CATALOG } from "../src/lib/image-engines.js";
import { addImageEngine, addImageFromCatalog, deleteImageEngine, setImageEngine } from "../src/options/image-edits.js";

test("addImageFromCatalog：重复添加被拒，id 与文字引擎查重", () => {
  const raw = { customEngines: [{ id: "bing-img", name: "x", url: "https://x.com/?q=%s" }] };
  const r = addImageFromCatalog(raw, IMAGE_CATALOG[0]);
  assert.equal(r.engine.id, "bing-img-2");
  assert.deepEqual(r.patch, { imageEngines: [r.engine] });
  assert.equal(addImageFromCatalog({ imageEngines: [r.engine] }, IMAGE_CATALOG[0]).error.code, "catalog_already_added");
});
test("addImageEngine：模板校验与 id", () => {
  assert.equal(addImageEngine({}, { name: "X", url: "https://x.com/" }).errors.url.code, "tpl_no_placeholder");
  assert.equal(addImageEngine({}, { name: "X", url: "https://x.com/?u=%s&_ss=a,b" }).errors.url.code, "tpl_reserved_param");
  assert.equal(addImageEngine({}, { name: "", url: "https://x.com/?u=%s" }).errors.name.code, "name_required");
  const first = addImageEngine({}, { name: "X", url: "https://x.com/?u=%s" });
  assert.equal(first.engine.id, "img");
  assert.equal(addImageEngine({ imageEngines: [first.engine] }, { name: "Y", url: "https://y.com/?u=%s" }).engine.id, "img-2");
});
test("deleteImageEngine / setImageEngine", () => {
  assert.equal(deleteImageEngine({}, "lens").error.code, "only_custom_delete");
  assert.equal(deleteImageEngine({}, "ghost").error.code, "only_custom_delete");
  const raw = { imageEngines: [IMAGE_CATALOG[0]], imageEngine: "bing-img" };
  assert.deepEqual(deleteImageEngine(raw, "bing-img"), { ok: true, patch: { imageEngines: [] }, remove: ["imageEngine"] });
  assert.equal(deleteImageEngine({ ...raw, imageEngine: "lens" }, "bing-img").remove, undefined);
  assert.deepEqual(setImageEngine(raw, "lens"), { ok: true, patch: null, remove: ["imageEngine"] });
  assert.deepEqual(setImageEngine(raw, "bing-img"), { ok: true, patch: { imageEngine: "bing-img" } });
  assert.equal(setImageEngine({}, "bing-img").error.code, "engine_gone");
});
