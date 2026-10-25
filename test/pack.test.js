import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import {
  extensionId, parsePublicKey, transformManifest, checkManifest, checkLocales, msgRefs,
  checkReferenced, referencedFiles, checkFileSet, dirtyPaths, parseArgs,
} from "../scripts/pack-lib.mjs";

const src = p => new URL("../src/" + p, import.meta.url);
const manifest = JSON.parse(readFileSync(src("manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const clone = o => structuredClone(o);

const rsaPub = () => generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;
const derB64 = k => k.export({ type: "spki", format: "der" }).toString("base64");

test("扩展 ID：开发公钥算出 CLAUDE.md 记的开发 ID（与 gen-key.sh 同算法）", () => {
  assert.equal(extensionId(manifest.key), "alngkkgnobglnfbhcplhpaflcgfiajnj");
  assert.match(extensionId(derB64(rsaPub())), /^[a-p]{32}$/);
});

test("parsePublicKey：接受 PEM 与纯 base64，结果一致", () => {
  const k = rsaPub();
  const b64 = derB64(k);
  const pem = k.export({ type: "spki", format: "pem" });
  assert.deepEqual(parsePublicKey(pem), { ok: true, key: b64 });
  assert.deepEqual(parsePublicKey(b64 + "\n"), { ok: true, key: b64 });
  // 折行的 base64 也行
  assert.deepEqual(parsePublicKey(b64.replace(/(.{64})/g, "$1\n")), { ok: true, key: b64 });
  assert.deepEqual(parsePublicKey(manifest.key), { ok: true, key: manifest.key });
});

test("parsePublicKey：拒绝空文件、非 base64、不是公钥的 DER、非 RSA 公钥", () => {
  assert.equal(parsePublicKey("").ok, false);
  assert.equal(parsePublicKey("   \n").ok, false);
  assert.match(parsePublicKey("not base64!").error, /base64/);
  assert.match(parsePublicKey("QUJD").error, /DER/); // "ABC"
  assert.match(parsePublicKey(Buffer.alloc(300, 7).toString("base64")).error, /DER/);
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey;
  assert.match(parsePublicKey(derB64(ec)).error, /RSA/);
  const priv = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "der" });
  assert.equal(parsePublicKey(priv.toString("base64")).ok, false);
});

test("transformManifest：默认去掉 key，不改原对象", () => {
  const before = clone(manifest);
  const out = transformManifest(manifest);
  assert.equal("key" in out, false);
  assert.deepEqual(manifest, before);
  const { key, ...rest } = manifest;
  assert.deepEqual(out, rest);
});

test("transformManifest：storeKey 换掉 key 并保持字段顺序；源码没有 key 时追加", () => {
  const out = transformManifest(manifest, { storeKey: "STORE" });
  assert.equal(out.key, "STORE");
  assert.deepEqual(Object.keys(out), Object.keys(manifest));
  const { key, ...noKey } = manifest;
  const out2 = transformManifest(noKey, { storeKey: "STORE" });
  assert.equal(out2.key, "STORE");
});

test("checkManifest：当前 manifest 与 package.json 通过", () => {
  assert.deepEqual(checkManifest(manifest, pkg), []);
});

test("checkManifest：版本不一致、权限多出、加了 host_permissions、WAR 变化都报错", () => {
  assert.match(checkManifest(manifest, { version: "9.9.9" })[0], /version/);
  const m = clone(manifest);
  m.permissions.push("tabs");
  m.host_permissions = ["<all_urls>"];
  m.optional_host_permissions = ["<all_urls>"];
  m.web_accessible_resources[0].use_dynamic_url = false;
  m.incognito = "spanning";
  const errs = checkManifest(m, pkg).join("\n");
  for (const s of ["permissions", "host_permissions", "optional_host_permissions", "web_accessible_resources", "incognito"]) {
    assert.match(errs, new RegExp(`manifest\\.?${s}|${s}`), s);
  }
  assert.equal(checkManifest(m, pkg).length, 5);
});

const readLocales = () => Object.fromEntries(["en", "es", "zh_CN", "zh_TW"]
  .map(l => [l, readFileSync(src(`_locales/${l}/messages.json`), "utf8")]));

test("checkLocales：当前 4 种语言通过（manifest 引用的 key 都在、简介不超 132 字符）", () => {
  assert.deepEqual(msgRefs(manifest).sort(), ["cmd_cycle_right", "ext_action_title", "ext_description"]);
  assert.deepEqual(checkLocales(manifest, readLocales()), []);
});

test("checkLocales：解析失败、缺 key、简介超长、缺默认语言、名称超长", () => {
  const msg = o => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { message: v }])));
  const ok = { ext_description: "短简介", ext_action_title: "t", cmd_cycle_right: "c" };
  const errs = checkLocales(manifest, {
    en: msg(ok),
    es: "{ nope",
    zh_CN: msg({ ext_description: "x", cmd_cycle_right: "c" }),
    zh_TW: msg({ ...ok, ext_description: "字".repeat(133) }),
  });
  assert.equal(errs.length, 3);
  assert.match(errs[0], /es.*解析失败/);
  assert.match(errs[1], /zh_CN.*ext_action_title/);
  assert.match(errs[2], /zh_TW.*133.*132/);
  // 132 个字符（按 Unicode 字符计，含 emoji）刚好不超
  assert.deepEqual(checkLocales(manifest, { en: msg({ ...ok, ext_description: "😀".repeat(132) }) }), []);
  assert.match(checkLocales(manifest, { es: msg(ok) })[0], /默认语言/);
  const named = { ...manifest, name: "__MSG_ext_name__" };
  assert.match(checkLocales(named, { en: msg({ ...ok, ext_name: "n".repeat(76) }) })[0], /name.*76/);
});

test("checkReferenced：manifest 引用的图标、SW、设置页、go.html 都要存在", () => {
  const all = referencedFiles(manifest);
  for (const p of ["icons/icon-16.png", "icons/icon-128.png", "background.js", "options/options.html", "go.html"]) {
    assert.ok(all.includes(p), p);
  }
  assert.deepEqual(checkReferenced(manifest, all), []);
  const errs = checkReferenced(manifest, all.filter(p => p !== "icons/icon-48.png"));
  assert.deepEqual(errs, ["manifest 引用的文件不存在：icons/icon-48.png"]);
});

test("checkFileSet：运行时文件通过，点文件、测试、垃圾文件和其他文件拒绝", () => {
  const good = ["manifest.json", "_locales/en/messages.json", "_locales/zh_CN/messages.json", "icons/icon-16.png",
    "background.js", "go.html", "options/options.css", "lib/engines.js"];
  assert.deepEqual(checkFileSet(good), []);
  const bad = [".DS_Store", "icons/.DS_Store", ".eslintrc", "lib/.cache/x.js", "lib/trigger.test.js", "test/a.js",
    "options/x.spec.mjs", "Thumbs.db", "notes.md", "data.json", "_locales/en/other.json", "lib/engines.js.map", "README"];
  const errs = checkFileSet(bad);
  assert.equal(errs.length, bad.length);
  assert.match(errs[0], /src\/\.DS_Store：系统生成的垃圾文件/);
  assert.match(errs[2], /点文件/);
  assert.match(errs[4], /测试文件/);
});

test("checkFileSet：当前 src/ 全部是运行时文件", async () => {
  const { readdirSync } = await import("node:fs");
  const { relative, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(src(""));
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => relative(root, join(e.parentPath, e.name)));
  assert.ok(files.includes("manifest.json"));
  assert.deepEqual(checkFileSet(files), []);
  assert.deepEqual(checkReferenced(manifest, files), []);
});

test("dirtyPaths：解析 git status --porcelain", () => {
  assert.deepEqual(dirtyPaths(""), []);
  assert.deepEqual(dirtyPaths(" M src/go.js\n?? src/.DS_Store\n"), ["src/go.js", "src/.DS_Store"]);
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs([]), { storeKey: null, allowDirty: false, smoke: false, help: false });
  assert.deepEqual(parseArgs(["--store-key", "k.pem", "--allow-dirty", "--smoke"]),
    { storeKey: "k.pem", allowDirty: true, smoke: true, help: false });
  assert.equal(parseArgs(["-h"]).help, true);
  assert.throws(() => parseArgs(["--store-key"]), /公钥文件/);
  assert.throws(() => parseArgs(["--store-key", "--smoke"]), /公钥文件/);
  assert.throws(() => parseArgs(["--nope"]), /未知参数/);
});
