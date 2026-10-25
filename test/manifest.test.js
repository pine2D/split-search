import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

test("manifest 基本信息", () => {
  assert.equal(m.name, "Split Search");
  assert.equal(m.version, "0.3.0");
  assert.equal(m.default_locale, "en");
  assert.equal(m.description, "__MSG_ext_description__");
  assert.equal(m.action.default_title, "__MSG_ext_action_title__");
});
test("manifest commands：只有 cycle-right，不绑定默认快捷键，不声明 _execute_action", () => {
  assert.deepEqual(Object.keys(m.commands), ["cycle-right"]);
  assert.deepEqual(m.commands["cycle-right"], { description: "__MSG_cmd_cycle_right__" });
  assert.equal(m.commands["cycle-right"].suggested_key, undefined);
  assert.equal(m.commands._execute_action, undefined);
});
test("manifest 工具栏弹窗：action.default_popup 指向 popup/popup.html", () => {
  assert.equal(m.action.default_popup, "popup/popup.html");
  assert.ok(existsSync(new URL("../src/" + m.action.default_popup, import.meta.url)), m.action.default_popup);
});
test("manifest 引用的文件都存在", () => {
  for (const path of [m.background.service_worker, m.options_ui.page, m.action.default_popup, "go.html", "go.js"]) {
    assert.ok(existsSync(new URL("../src/" + path, import.meta.url)), path);
  }
});

test("manifest 图标存在且是尺寸相符的 PNG", () => {
  assert.deepEqual(Object.keys(m.icons), ["16", "32", "48", "128"]);
  assert.deepEqual(Object.keys(m.action.default_icon), ["16", "32"]);
  for (const [size, path] of [...Object.entries(m.icons), ...Object.entries(m.action.default_icon)]) {
    const url = new URL("../src/" + path, import.meta.url);
    assert.ok(existsSync(url), path);
    const buf = readFileSync(url);
    assert.ok(buf.subarray(0, 8).equals(PNG_SIG), `${path} 不是 PNG`);
    assert.equal(buf.toString("latin1", 12, 16), "IHDR", path);
    assert.equal(buf.readUInt32BE(16), Number(size), `${path} 宽度`);
    assert.equal(buf.readUInt32BE(20), Number(size), `${path} 高度`);
  }
});

test("src/icons 与选定图标 c6 源文件逐字节相同", () => {
  // 16/32/48 是按像素对齐的 icon-16.svg / icon-32.svg / icon-48.svg 导出的；从 icon.svg 重导会失去对齐，这里拦住源和成品漂移
  for (const size of [16, 32, 48, 128]) {
    const name = `icon-${size}.png`;
    const built = readFileSync(new URL("../src/icons/" + name, import.meta.url));
    const source = readFileSync(new URL("../assets/icon-proposals/v3-colors/c6-pine-fog/" + name, import.meta.url));
    assert.ok(built.equals(source), `src/icons/${name} 与 c6-pine-fog/${name} 不一致`);
  }
});
