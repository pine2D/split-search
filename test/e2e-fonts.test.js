import { test } from "node:test";
import assert from "node:assert/strict";
import { slowFontRoots, fontconfigXml, prepareFontconfig } from "../scripts/e2e/fonts.mjs";

const MOUNTS = [
  "/dev/sdc / ext4 rw,relatime 0 0",
  "drivers /usr/lib/wsl/drivers 9p ro,nosuid,nodev,noatime,aname=drivers;fmask=222;dmask=222 0 0",
  "C:\\134 /mnt/c 9p rw,noatime,aname=drvfs;path=C:\\;uid=1000 0 0",
  "D:\\134 /mnt/d 9p rw,noatime,aname=drvfs;path=D:\\ 0 0",
  "C:\\134 /mnt/c 9p rw,noatime,aname=drvfs;path=C:\\ 0 0",
  "tmpfs /tmp tmpfs rw 0 0",
  "E: /mnt/my\\040disk drvfs rw 0 0",
  "none /mnt/wslg/distro none ro 0 0",
].join("\n");

test("slowFontRoots: 只取 9p/drvfs 挂载点，去重、解八进制转义", () => {
  assert.deepEqual(slowFontRoots(MOUNTS), ["/usr/lib/wsl/drivers", "/mnt/c", "/mnt/d", "/mnt/my disk"]);
});
test("slowFontRoots: 没有 9P 挂载、空输入、根目录是 9p 时都不排除", () => {
  assert.deepEqual(slowFontRoots("/dev/sda1 / ext4 rw 0 0\ntmpfs /run tmpfs rw 0 0"), []);
  assert.deepEqual(slowFontRoots(""), []);
  assert.deepEqual(slowFontRoots(undefined), []);
  assert.deepEqual(slowFontRoots("root / 9p rw 0 0"), []);
});

test("fontconfigXml: 先 include 原配置，再 rejectfont 每个挂载点下的文件", () => {
  const x = fontconfigXml(["/mnt/c", "/mnt/d"]);
  assert.match(x, /<include ignore_missing="yes">\/etc\/fonts\/fonts\.conf<\/include>/);
  assert.ok(x.indexOf("<include") < x.indexOf("<rejectfont>"));
  assert.match(x, /<glob>\/mnt\/c\/\*<\/glob>/);
  assert.match(x, /<glob>\/mnt\/d\/\*<\/glob>/);
  assert.ok(x.startsWith('<?xml version="1.0"?>'));
});
test("fontconfigXml: 自定义 base；XML 特殊字符与 glob 通配符被转义", () => {
  const x = fontconfigXml(["/mnt/a&b", "/mnt/x*[1]"], "/home/u/my<fonts>.conf");
  assert.match(x, /<include ignore_missing="yes">\/home\/u\/my&lt;fonts&gt;\.conf<\/include>/);
  assert.match(x, /<glob>\/mnt\/a&amp;b\/\*<\/glob>/);
  assert.match(x, /<glob>\/mnt\/x\\\*\\\[1\\\]\/\*<\/glob>/);
});

test("prepareFontconfig: 有 9P 挂载时写配置并返回 FONTCONFIG_FILE", () => {
  const writes = [];
  const r = prepareFontconfig({ dir: "/cache/e2e", env: {}, readMounts: () => MOUNTS, write: (f, t) => writes.push([f, t]) });
  assert.deepEqual(r, { FONTCONFIG_FILE: "/cache/e2e/fonts.conf" });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "/cache/e2e/fonts.conf");
  assert.match(writes[0][1], /\/etc\/fonts\/fonts\.conf/);
  assert.match(writes[0][1], /<glob>\/mnt\/c\/\*<\/glob>/);
});
test("prepareFontconfig: 用户已有 FONTCONFIG_FILE 时 include 它；指向我们自己的文件时退回系统配置", () => {
  let text = "";
  prepareFontconfig({ dir: "/c", env: { FONTCONFIG_FILE: "/u/fonts.conf" }, readMounts: () => MOUNTS, write: (f, t) => { text = t; } });
  assert.match(text, /<include ignore_missing="yes">\/u\/fonts\.conf<\/include>/);
  prepareFontconfig({ dir: "/c", env: { FONTCONFIG_FILE: "/c/fonts.conf" }, readMounts: () => MOUNTS, write: (f, t) => { text = t; } });
  assert.match(text, /<include ignore_missing="yes">\/etc\/fonts\/fonts\.conf<\/include>/);
});
test("prepareFontconfig: 没有 9P 挂载或读写失败时返回 null（按原配置启动）", () => {
  let wrote = false;
  const write = () => { wrote = true; };
  assert.equal(prepareFontconfig({ dir: "/c", env: {}, readMounts: () => "tmpfs /tmp tmpfs rw 0 0", write }), null);
  assert.equal(wrote, false);
  assert.equal(prepareFontconfig({ dir: "/c", env: {}, readMounts: () => { throw new Error("EACCES"); }, write }), null);
  assert.equal(prepareFontconfig({ dir: "/c", env: {}, readMounts: () => MOUNTS, write: () => { throw new Error("EROFS"); } }), null);
});
