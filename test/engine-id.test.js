import { test } from "node:test";
import assert from "node:assert/strict";
import { slugId, suggestId } from "../src/lib/engine-id.js";
import { ID_PATTERN } from "../src/lib/engines.js";

const none = () => false;

test("slugId：小写，非 [a-z0-9-] 转 -，连续的合并，去掉首尾 -", () => {
  assert.equal(slugId("Ecosia"), "ecosia");
  assert.equal(slugId("My Search Engine"), "my-search-engine");
  assert.equal(slugId("  A__B..C  "), "a-b-c");
  assert.equal(slugId("--x--"), "x");
  assert.equal(slugId("C++ Docs"), "c-docs");
  assert.equal(slugId("already-ok-1"), "already-ok-1");
});

test("slugId：带变音符的拉丁字母先去掉变音符（Búsqueda → busqueda）", () => {
  assert.equal(slugId("Búsqueda Señal"), "busqueda-senal");
  assert.equal(slugId("Ölçü"), "olcu");
});

test("slugId：截到 20 个字符，截断后结尾的 - 也去掉", () => {
  assert.equal(slugId("abcdefghijklmnopqrstuvwxyz"), "abcdefghijklmnopqrst");
  assert.equal(slugId("abcdefghijklmnopqrs tuv"), "abcdefghijklmnopqrs");
  assert.ok(slugId("x".repeat(50)).length <= 20);
});

test("slugId：全是非 ASCII 或空白时为空串", () => {
  assert.equal(slugId("百度"), "");
  assert.equal(slugId("   "), "");
  assert.equal(slugId(""), "");
  assert.equal(slugId(undefined), "");
});

test("suggestId：按名称生成", () => {
  assert.equal(suggestId("Ecosia", "https://www.ecosia.org/search?q=%s", none), "ecosia");
});

test("suggestId：名称生成不出时回退到网址 host 的第一段（去掉开头的 www.）", () => {
  assert.equal(suggestId("百度", "https://www.baidu.com/s?wd=%s", none), "baidu");
  assert.equal(suggestId("知乎", "https://zhihu.com/search?q=%s", none), "zhihu");
  assert.equal(suggestId("", "http://engine-a.localhost:8765/search?q=%s", none), "engine-a");
  assert.equal(suggestId("搜", "https://www.WWW-Test.example/?q=%s", none), "www-test");
});

test("suggestId：名称和网址都生成不出时回退到 engine", () => {
  assert.equal(suggestId("百度", "", none), "engine");
  assert.equal(suggestId("百度", "not a url %s", none), "engine");
  assert.equal(suggestId("", undefined, none), "engine");
  // 国际化域名的 punycode（xn--…）读不出意思，不拿来当 id
  assert.equal(suggestId("中文", "https://例子.测试/?q=%s", none), "engine");
});

test("suggestId：与已有 id 冲突时加 -2…-99（与引擎库添加相同的去重）", () => {
  const taken = new Set(["bing", "bing-2", "engine"]);
  const isTaken = id => taken.has(id);
  assert.equal(suggestId("Bing", "", isTaken), "bing-3");
  assert.equal(suggestId("", "", isTaken), "engine-2");
  // 长 id 加后缀时先截短，总长不超过 20
  const long = "abcdefghijklmnopqrst";
  const got = suggestId(long, "", id => id === long);
  assert.equal(got, "abcdefghijklmnopqr-2");
  assert.match(got, ID_PATTERN);
});

test("suggestId：-2 到 -99 全被占用时返回基础 id（保存时再报 id 已占用）", () => {
  assert.equal(suggestId("Bing", "", () => true), "bing");
});

test("suggestId：结果总是合法 id", () => {
  for (const name of ["A", "Ünïcödé Ënginé", "🙂 emoji", "a".repeat(30), "-", "日本語"]) {
    assert.match(suggestId(name, "https://www.example.com/?q=%s", none), ID_PATTERN, name);
  }
});

test("takenIn：已配置、已隐藏的文字引擎和以图搜图引擎的 id 都算占用", async () => {
  const { takenIn } = await import("../src/lib/engine-id.js");
  const { mergeConfig } = await import("../src/lib/engines.js");
  const cfg = mergeConfig({ presetOverrides: { ddg: { hidden: true } }, customEngines: [{ id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" }],
    imageEngines: [{ id: "tineye", name: "TinEye", url: "https://tineye.com/search?url=%s" }] });
  const taken = takenIn(cfg);
  for (const id of ["google", "ddg", "baidu", "lens", "tineye"]) assert.equal(taken(id), true, id);
  assert.equal(taken("ecosia"), false);
  assert.equal(suggestId("TinEye", "", taken), "tineye-2");
});
