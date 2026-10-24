import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parsePak, findIds } from "../scripts/i18n/chrome-terms.mjs";

function buildPak(version) {
  const a = Buffer.from("Split view");
  const b = Buffer.from("拆分视图");
  const head = Buffer.alloc(12);
  head.writeUInt32LE(version, 0);
  head.writeUInt8(1, 4);
  head.writeUInt16LE(2, 8);
  head.writeUInt16LE(1, 10);
  const dataStart = 12 + 3 * 6 + 1 * 4;
  const entries = Buffer.alloc(18);
  entries.writeUInt16LE(10, 0); entries.writeUInt32LE(dataStart, 2);
  entries.writeUInt16LE(11, 6); entries.writeUInt32LE(dataStart + a.length, 8);
  entries.writeUInt16LE(0, 12); entries.writeUInt32LE(dataStart + a.length + b.length, 14);
  const alias = Buffer.alloc(4);
  alias.writeUInt16LE(12, 0); alias.writeUInt16LE(0, 2);
  return Buffer.concat([head, entries, alias, a, b]);
}

test("parsePak 读出 v5 资源和别名", () => {
  const pak = parsePak(buildPak(5));
  assert.equal(pak.get(10).toString("utf8"), "Split view");
  assert.equal(pak.get(11).toString("utf8"), "拆分视图");
  assert.equal(pak.get(12).toString("utf8"), pak.get(10).toString("utf8"));
});

test("版本不是 5 时抛错", () => {
  assert.throws(() => parsePak(buildPak(4)), /pak/);
});

test("本机 Chrome 155 的 zh-CN 把 Split view 译作拆分视图", (t) => {
  const dir = "/opt/google/chrome/locales";
  if (!existsSync(`${dir}/en-US.pak`) || !existsSync(`${dir}/zh-CN.pak`)) return t.skip("无本机 Chrome");
  const en = parsePak(readFileSync(`${dir}/en-US.pak`));
  const zh = parsePak(readFileSync(`${dir}/zh-CN.pak`));
  const ids = findIds(en, /^Split view$/);
  assert.ok(ids.length > 0);
  assert.ok(ids.some((id) => zh.get(id)?.toString("utf8") === "拆分视图"));
});
