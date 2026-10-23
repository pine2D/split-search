import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const m = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));

test("manifest 满足硬约束", () => {
  assert.equal(m.manifest_version, 3);
  assert.equal(m.minimum_chrome_version, "155");
  assert.equal(m.incognito, "not_allowed");
  assert.deepEqual(m.permissions, ["declarativeNetRequest", "storage"]);
  assert.equal(m.host_permissions, undefined);
  assert.deepEqual(m.optional_host_permissions, ["https://*/*", "http://*/*"]);
  assert.deepEqual(m.web_accessible_resources, [{ resources: ["go.html"], matches: ["<all_urls>"], use_dynamic_url: true }]);
  assert.equal(m.background.service_worker, "background.js");
  assert.equal(m.background.type, "module");
  assert.equal(m.options_ui.page, "options/options.html");
  assert.equal(m.options_ui.open_in_tab, true);
  assert.match(m.key, /^[A-Za-z0-9+/=]{300,}$/);
  assert.equal(m.omnibox, undefined);
  assert.equal(m.chrome_settings_overrides, undefined);
});
