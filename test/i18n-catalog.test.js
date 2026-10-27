import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES } from "../src/lib/errors.js";
import { validateTemplate } from "../src/lib/engines.js";

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
const KEY_RE = /(?<!\b(?:fail|spec|codedError)\()["'`]((?:ext|go|options|engine|guide|notice|err|common|lang|catalog|popup|menu|setup|script)_[a-z0-9_]+)["'`]/g;
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

test("任何 description 都不含 [needs-translation]", () => {
  const hits = [];
  for (const l of langs) {
    for (const [k, v] of Object.entries(catalogs[l])) {
      if (v.description.includes("[needs-translation]")) hits.push(`${l}/${k}`);
    }
  }
  assert.deepEqual(hits, [], `这些条目还没翻译：\n${hits.join("\n")}`);
});

test("每种语言的网址示例值都能放左侧", () => {
  for (const l of langs) {
    const url = catalogs[l].options_dlg_url_placeholder.message;
    const r = validateTemplate(url);
    assert.ok(r.ok && r.canBeLeft, `${l} 的 options_dlg_url_placeholder 不能放左侧：${url}`);
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

// WCAG 2.5.3（label in name）：带引擎名的无障碍名称必须逐字包含按钮上看得见的文字
test("带引擎名的 aria 文案包含可见文字，且有 $NAME$ 占位符", () => {
  const pairs = [["catalog_add_aria", "catalog_add"], ["catalog_added_aria", "catalog_added"], ["engine_edit_label", "engine_edit"]];
  for (const l of langs) {
    for (const [aria, visible] of pairs) {
      const a = catalogs[l][aria];
      assert.ok(a, `${l}/${aria} 缺失`);
      assert.ok(a.message.includes(catalogs[l][visible].message), `${l}/${aria} 应包含 “${catalogs[l][visible].message}”`);
      assert.ok(a.message.includes("$NAME$") && a.placeholders?.NAME?.content === "$1", `${l}/${aria} 的 NAME 占位符`);
    }
    // 五个“编辑”按钮的无障碍名称各带引擎名，开头就是看得见的“编辑”
    assert.ok(catalogs[l].engine_edit_label.message.startsWith(catalogs[l].engine_edit.message), `${l}/engine_edit_label 应以可见文字开头`);
  }
});

// 同一页上有好几个“复制”：无障碍名称带上复制的对象，开头逐字是按钮上看得见的文字（WCAG 2.5.3）
test("复制按钮的 aria 文案以可见文字开头", () => {
  const pairs = [["guide_copy_default_aria", "common_copy"], ["guide_copy_gen_aria", "common_copy"],
    ["guide_copy_settings_aria", "guide_copy_settings_url"]];
  for (const l of langs) {
    const names = new Set();
    for (const [aria, visible] of pairs) {
      const a = catalogs[l][aria]?.message;
      assert.ok(a, `${l}/${aria} 缺失`);
      assert.ok(a.startsWith(catalogs[l][visible].message), `${l}/${aria} 应以 “${catalogs[l][visible].message}” 开头`);
      assert.notEqual(a, catalogs[l][visible].message, `${l}/${aria} 要比可见文字多出复制的对象`);
      names.add(a);
    }
    assert.equal(names.size, pairs.length, `${l}：三个复制按钮的无障碍名称应各不相同`);
  }
});

// 三个入口页的静态 lang 与 default_locale 一致（en）；运行时由 chrome/i18n.js 的 setLocale 改写
test("设置页、弹窗、go.html 的静态 lang 都是 en", () => {
  assert.equal(manifest.default_locale, "en");
  for (const page of ["options/options.html", "popup/popup.html", "go.html"]) {
    const m = /<html\b[^>]*\blang="([^"]*)"/.exec(readFileSync(join(SRC, page), "utf8"));
    assert.ok(m, `${page} 的 <html> 没有 lang`);
    assert.equal(m[1], "en", page);
  }
});

test("跨 tab 引用的区名一致（设计稿 4、5.5）", () => {
  for (const l of langs) {
    const m = k => catalogs[l][k].message;
    for (const k of ["engine_in_pair_hide", "engine_in_pair_delete"]) assert.ok(m(k).includes(m("options_tab_pair")), `${l} ${k}`);
    assert.ok(m("notice_template_changed").includes(m("options_tab_add")), `${l} notice_template_changed`);
    for (const k of ["options_pair_changed_setup", "notice_pair_saved_setup"]) assert.ok(m(k).includes(m("setup_title")), `${l} ${k}`);
    assert.ok(m("notice_pair_saved").includes(m("options_pair_title")), `${l} notice_pair_saved`);
    assert.ok(catalogs[l].notice_pair_saved.description.includes("options_pair_title"), `${l} notice_pair_saved description 要点明引用 options_pair_title`);
  }
});
