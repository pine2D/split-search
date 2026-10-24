import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES } from "../src/lib/errors.js";

const SRC = new URL("../src/", import.meta.url).pathname;
const LOCALES_DIR = join(SRC, "_locales");

// chrome.i18n 文档 Locales 一节的 55 个代码。
const CWS_LOCALES = [
  "ar", "am", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "en_AU", "en_GB", "en_US", "es", "es_419",
  "et", "fa", "fi", "fil", "fr", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "kn", "ko", "lt", "lv",
  "ml", "mr", "ms", "nl", "no", "pl", "pt_BR", "pt_PT", "ro", "ru", "sk", "sl", "sr", "sv", "sw", "ta",
  "te", "th", "tr", "uk", "vi", "zh_CN", "zh_TW",
];

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
const langs = readdirSync(LOCALES_DIR).sort();
const catalogs = Object.fromEntries(
  langs.map((l) => [l, JSON.parse(readFileSync(join(LOCALES_DIR, l, "messages.json"), "utf8"))]),
);
const keysOf = (l) => Object.keys(catalogs[l]).sort();

test("目录恰好 4 种且都在 CWS 列表里", () => {
  assert.equal(CWS_LOCALES.length, 55);
  assert.deepEqual(langs, ["en", "es", "zh_CN", "zh_TW"]);
  for (const l of langs) assert.ok(CWS_LOCALES.includes(l), l);
  assert.ok(existsSync(join(LOCALES_DIR, manifest.default_locale, "messages.json")));
});

test("4 份 key 集合相同、key 只含 [a-z0-9_]、文案非空、每条都有 description", () => {
  const base = keysOf("zh_CN");
  for (const l of langs) {
    assert.deepEqual(keysOf(l), base, `${l} 的 key 集合`);
    for (const [k, v] of Object.entries(catalogs[l])) {
      assert.match(k, /^[a-z0-9_]+$/, `${l}/${k}`);
      assert.equal(typeof v.message, "string", `${l}/${k}`);
      assert.ok(v.message.trim().length > 0, `${l}/${k} 文案为空`);
      assert.ok(typeof v.description === "string" && v.description.trim(), `${l}/${k} 缺 description`);
    }
  }
});

test("占位符一致", () => {
  const names = (l, k) => Object.keys(catalogs[l][k].placeholders ?? {}).map((n) => n.toLowerCase()).sort();
  for (const k of keysOf("zh_CN")) {
    const expected = names("zh_CN", k);
    for (const l of langs) {
      assert.deepEqual(names(l, k), expected, `${l}/${k} 占位符名`);
      const { message, placeholders = {} } = catalogs[l][k];
      for (const [n, p] of Object.entries(placeholders)) {
        assert.match(p.content, /^\$[1-9]$/, `${l}/${k}/${n} content`);
        assert.ok(typeof p.example === "string" && p.example.trim(), `${l}/${k}/${n} 缺 example`);
      }
      const used = new Set([...message.replaceAll("$$", "").matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) => m[1].toLowerCase()));
      assert.deepEqual([...used].sort(), expected, `${l}/${k} 文案用到的占位符与声明不符`);
    }
  }
});

test("manifest 的 __MSG_x__ 都存在；每种语言 ext_description ≤ 132 个字符", () => {
  const refs = [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2);
  for (const l of langs) {
    for (const r of refs) assert.ok(catalogs[l][r], `${l} 缺 ${r}`);
    assert.ok([...catalogs[l].ext_description.message].length <= 132, `${l} ext_description 超长`);
  }
});

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (p !== LOCALES_DIR) out.push(...sourceFiles(p));
    } else if (/\.(js|html)$/.test(name)) out.push(p);
  }
  return out;
}

// 错误码不是 key（如 engine_gone 撞上 engine_ 前缀）：跳过 errors.js 和直接传给 fail/spec/codedError 的字面量。
const KEY_RE = /(?<!\b(?:fail|spec|codedError)\()["'`]((?:ext|go|options|engine|guide|notice|err|common|lang)_[a-z0-9_]+)["'`]/g;
const ATTR_RE = /data-i18n-attr="([^"]*)"/g;
const ERRORS_JS = join(SRC, "lib", "errors.js");

function referencedKeys() {
  const refs = new Set();
  for (const f of sourceFiles(SRC)) {
    const text = readFileSync(f, "utf8");
    if (f !== ERRORS_JS) for (const m of text.matchAll(KEY_RE)) refs.add(m[1]);
    if (f.endsWith(".html")) {
      for (const m of text.matchAll(/data-i18n="([^"]+)"/g)) refs.add(m[1]);
      for (const m of text.matchAll(ATTR_RE)) {
        for (const pair of m[1].split(";")) {
          const key = pair.split(":")[1]?.trim();
          if (key) refs.add(key);
        }
      }
    }
  }
  for (const m of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) refs.add(m[1]);
  return refs;
}

test("引用的 key 都存在", () => {
  const defined = new Set(keysOf("zh_CN"));
  for (const k of referencedKeys()) assert.ok(defined.has(k), `代码引用了不存在的 key：${k}`);
});

test("没有未被引用的 key；err_* 必须对应 ERROR_CODES", () => {
  const refs = referencedKeys();
  for (const k of keysOf("zh_CN")) {
    if (k.startsWith("err_")) assert.ok(ERROR_CODES.includes(k.slice(4)), `err_* 没有对应的错误码：${k}`);
    else assert.ok(refs.has(k), `未被引用的 key：${k}`);
  }
});

test("每个 ERROR_CODES 都有 err_<code>", () => {
  const defined = new Set(keysOf("zh_CN"));
  for (const c of ERROR_CODES) assert.ok(defined.has(`err_${c}`), `缺少 err_${c}`);
});

test("代码里产生的错误码都已登记", () => {
  const found = [];
  for (const f of sourceFiles(SRC)) {
    for (const m of readFileSync(f, "utf8").matchAll(/\b(?:fail|spec|codedError)\("([a-z_]+)"/g)) found.push(m[1]);
  }
  assert.ok(found.length > 0);
  for (const c of found) assert.ok(ERROR_CODES.includes(c), `未登记的错误码：${c}`);
});

test("[needs-translation] 只警告", (t) => {
  for (const l of langs) {
    for (const [k, v] of Object.entries(catalogs[l])) {
      if (v.description.includes("[needs-translation]")) t.diagnostic(`${l}/${k} needs-translation`);
    }
  }
});

// 去掉注释但保留换行，报错时的行号才对得上。
const blank = (m) => m.replace(/[^\n]/g, " ");
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(^|\s)\/\/.*$/gm, (m, lead) => lead + blank(m.slice(lead.length)));
}

test("src 代码里没有汉字（_locales 除外，注释不算）", () => {
  const hits = [];
  for (const f of sourceFiles(SRC)) {
    stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
      if (/[㐀-鿿豈-﫿]/.test(line)) hits.push(`${f.slice(SRC.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `这些行还有汉字：\n${hits.join("\n")}`);
});

test("fetch 只在 src/chrome/i18n.js，且只读包内文件", () => {
  const I18N_JS = join(SRC, "chrome", "i18n.js");
  for (const f of sourceFiles(SRC)) {
    const text = readFileSync(f, "utf8");
    if (f === I18N_JS) {
      assert.ok(/\bfetch\s*\(/.test(text), "i18n.js 里应当有 fetch");
      assert.ok(!/\bfetch\s*\((?!chrome\.runtime\.getURL\()/.test(text), "i18n.js 的 fetch 必须紧跟 chrome.runtime.getURL(");
    } else {
      assert.ok(!/\bfetch\s*\(/.test(text), `${f.slice(SRC.length)} 里出现了 fetch(`);
    }
  }
});
