import { test } from "node:test";
import assert from "node:assert/strict";
import { safeError, safeArgs } from "../src/lib/safe-error.js";

test("safeError：只留错误名和消息，不带堆栈", () => {
  const err = new TypeError("No tab with id: 123.");
  assert.equal(safeError(err), "TypeError: No tab with id: 123.");
  assert.ok(!safeError(err).includes("at "));
  assert.equal(safeError(new Error("")), "Error");
});

test("safeError：引号里的内容换成 …（含未闭合的引号）", () => {
  assert.equal(safeError(new Error('Invalid url: "https://a.example/search?q=secret".')), 'Error: Invalid url: "…".');
  assert.equal(safeError(new Error("Cannot read properties of undefined (reading 'url')")),
    "Error: Cannot read properties of undefined (reading '…')");
  assert.equal(safeError(new Error("bad `secret` and “秘密” and ‘x’")), "Error: bad `…` and “…” and ‘…’");
  assert.equal(safeError(new Error('Invalid url: "https://a.example/q=sec')), 'Error: Invalid url: "…');
  assert.equal(safeError(new Error("Invalid url: 'secret")), "Error: Invalid url: '…");
  // 单词里的撇号不是引号
  assert.equal(safeError(new Error("Can't create the tab")), "Error: Can't create the tab");
});

test("safeError：网址样的文字换成 …", () => {
  const cases = [
    ["Failed to load https://www.google.com/search?q=secret now", "Failed to load … now"],
    ["Bad chrome-extension://abc/go.html?u=x", "Bad …"],
    ["Image data:image/png;base64,AAAA here", "Image … here"],
    ["Blob blob:https://a.example/123 gone", "Blob … gone"],
    ["Host www.example.com/path?q=1 refused", "Host … refused"],
    ["Host secret-site.com refused", "Host … refused"],
    ["Local localhost:8765/guide?x=1 down", "Local … down"],
    ["IP 10.0.0.1:8080/x down", "IP … down"],
    ["Path /search?q=secret failed", "Path … failed"],
    ["Query q=secret%20word failed", "Query … failed"],
  ];
  for (const [msg, want] of cases) assert.equal(safeError(new Error(msg)), "Error: " + want, msg);
});

test("safeError：错误名不合规时用 Error；没有 message 的对象、字符串和其他值", () => {
  assert.equal(safeError({ name: "has space https://x.example", message: "boom" }), "Error: boom");
  assert.equal(safeError({ message: 'Invalid url: "x"' }), 'Error: Invalid url: "…"');
  assert.equal(safeError({}), "Error");
  assert.equal(safeError(null), "Error");
  assert.equal(safeError(undefined), "Error");
  assert.equal(safeError("thrown https://a.example/q?x"), "Error: thrown …");
  assert.equal(safeError(42), "Error: 42");
  assert.equal(safeError({ name: "DOMException", message: "The operation was aborted." }),
    "DOMException: The operation was aborted.");
});

test("safeError：消息过长时截断", () => {
  const s = safeError(new Error("x".repeat(1000)));
  assert.ok(s.length <= "Error: ".length + 201, String(s.length));
  assert.ok(s.endsWith("…"));
});

test("safeError：取 message 抛错时不外抛", () => {
  const evil = { get message() { throw new Error("no"); }, name: "Weird" };
  assert.equal(safeError(evil), "Weird");
});

test("safeArgs：对象和函数换成 safeError 的结果，原始值原样保留", () => {
  const err = new Error('Invalid url: "secret"');
  assert.deepEqual(safeArgs(["failed", 12, err, true, undefined]),
    ["failed", 12, 'Error: Invalid url: "…"', true, undefined]);
  assert.deepEqual(safeArgs([{ message: "https://a.example/x" }]), ["Error: …"]);
});
