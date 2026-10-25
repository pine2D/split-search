import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, spec, fail, codedError, errorKey } from "../src/lib/errors.js";

test("ERROR_CODES 恰好是约定的 31 个且只读", () => {
  assert.deepEqual([...ERROR_CODES], [
    "bad_url", "tpl_no_placeholder", "tpl_bad_scheme", "tpl_no_host", "tpl_wildcard_host", "tpl_ipv6",
    "tpl_reserved_param", "marker_format", "unknown_engine", "not_left", "template_mismatch",
    "config_too_large", "name_required", "name_too_long", "id_format", "id_taken", "engine_gone",
    "default_left_url", "only_preset_hide", "pair_uses_hide", "only_custom_delete", "pair_uses_delete",
    "pair_missing", "quota_rate", "quota_bytes", "catalog_already_added", "id_exhausted",
    "not_results_page", "window_unsupported", "split_failed", "message_rejected",
  ]);
  assert.ok(Object.isFrozen(ERROR_CODES));
});

test("spec / fail / codedError 的形状，参数一律转成字符串", () => {
  assert.deepEqual(spec("id_taken", 5), { code: "id_taken", args: ["5"] });
  assert.deepEqual(spec("bad_url"), { code: "bad_url", args: [] });
  assert.deepEqual(fail("not_left", "Wiki"), { ok: false, error: { code: "not_left", args: ["Wiki"] } });
  const e = codedError("config_too_large", "order");
  assert.ok(e instanceof Error);
  assert.equal(e.message, "config_too_large");
  assert.equal(e.code, "config_too_large");
  assert.deepEqual(e.args, ["order"]);
});

test("errorKey：错误码映射到 err_<code> 加参数", () => {
  assert.deepEqual(errorKey(codedError("config_too_large", "order")), ["err_config_too_large", "order"]);
  assert.deepEqual(errorKey(spec("id_taken", 5)), ["err_id_taken", "5"]);
  assert.deepEqual(errorKey(spec("bad_url")), ["err_bad_url"]);
});

test("errorKey：storage.sync 配额常量映射到 err_quota_*", () => {
  for (const m of ["QUOTA_BYTES quota exceeded", "QUOTA_BYTES_PER_ITEM quota exceeded"]) {
    assert.deepEqual(errorKey(new Error(m)), ["err_quota_bytes"], m);
  }
  for (const m of ["MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded", "MAX_WRITE_OPERATIONS_PER_HOUR quota exceeded"]) {
    assert.deepEqual(errorKey(new Error(m)), ["err_quota_rate"], m);
  }
  assert.deepEqual(errorKey("QUOTA_BYTES quota exceeded"), ["err_quota_bytes"]);
});

test("errorKey：认不出的错误返回 null", () => {
  assert.equal(errorKey(new Error("x")), null);
  assert.equal(errorKey("boom"), null);
  assert.equal(errorKey(null), null);
  assert.equal(errorKey(undefined), null);
  assert.equal(errorKey({ code: "nope", args: [] }), null);
});
