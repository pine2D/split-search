#!/usr/bin/env node
// 发布打包：检查 src/ → 复制到临时目录并改写 manifest（默认去掉 key，或换成商店公钥）→ dist/split-search-<版本>.zip。
// 不改动 src/。用法见 pack-lib.mjs 的 USAGE（npm run pack -- --help）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  USAGE, parseArgs, parsePublicKey, extensionId, transformManifest,
  checkManifest, checkLocales, checkReferenced, checkFileSet, dirtyPaths,
} from "./pack-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

const die = msg => { console.error(`打包中止：${msg}`); process.exit(1); };

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p).split("\\").join("/"));
  }
  return out.sort();
}

const git = args => spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });

// 包内文件的时间戳统一用最近一次改动 src/ 的提交时间，同一份源码打出的 ZIP 逐字节相同
function sourceEpoch() {
  const r = git(["log", "-1", "--format=%ct", "--", "src"]);
  const t = Number(r.stdout.trim());
  return r.status === 0 && t > 0 ? t : Math.floor(Date.now() / 1000);
}

function readJson(path, what) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { die(`${what} 读取失败：${e.message}`); }
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(USAGE); process.exit(2); }
  if (opts.help) { console.log(USAGE); return; }

  const pkg = readJson(join(ROOT, "package.json"), "package.json");
  const manifest = readJson(join(SRC, "manifest.json"), "src/manifest.json");
  const files = listFiles(SRC);

  // 商店公钥：npm run 把 cwd 设成仓库根，相对路径按用户执行命令的目录（INIT_CWD）解析
  let storeKey = null;
  if (opts.storeKey) {
    let text;
    try { text = readFileSync(resolve(process.env.INIT_CWD || process.cwd(), opts.storeKey), "utf8"); } catch (e) { die(`读不到公钥文件 ${opts.storeKey}：${e.message}`); }
    const r = parsePublicKey(text);
    if (!r.ok) die(`${opts.storeKey}：${r.error}`);
    if (r.key === manifest.key) die("--store-key 给的是源码里的开发公钥，应使用 CWS 后台“软件包 → 公钥”里的商店公钥");
    storeKey = r.key;
  }

  // 检查
  const locales = {};
  for (const p of files) {
    const m = /^_locales\/([^/]+)\/messages\.json$/.exec(p);
    if (m) locales[m[1]] = readFileSync(join(SRC, p), "utf8");
  }
  const errors = [
    ...checkManifest(manifest, pkg),
    ...checkLocales(manifest, locales),
    ...checkReferenced(manifest, files),
    ...checkFileSet(files),
  ];
  if (errors.length) die(`发布前检查没过：\n  - ${errors.join("\n  - ")}`);

  const st = git(["status", "--porcelain", "--untracked-files=all", "--", "src"]);
  if (st.status !== 0) die(`git status 失败：${(st.stderr || st.error?.message || "").trim()}`);
  const dirty = dirtyPaths(st.stdout);
  if (dirty.length) {
    const list = dirty.slice(0, 10).join("、") + (dirty.length > 10 ? ` 等 ${dirty.length} 个` : "");
    if (!opts.allowDirty) die(`src/ 有未提交的改动（${list}）。先提交，或加 --allow-dirty 只警告`);
    console.warn(`警告：src/ 有未提交的改动（${list}），包里是工作区里的版本`);
  }

  // 复制到临时目录，改写 manifest
  const stage = mkdtempSync(join(tmpdir(), "split-search-pack-"));
  const zipPath = join(DIST, `split-search-${manifest.version}.zip`);
  try {
    cpSync(SRC, stage, { recursive: true });
    const out = transformManifest(manifest, { storeKey });
    writeFileSync(join(stage, "manifest.json"), JSON.stringify(out, null, 2) + "\n");
    const epoch = sourceEpoch();
    for (const p of files) utimesSync(join(stage, p), epoch, epoch);

    mkdirSync(DIST, { recursive: true });
    rmSync(zipPath, { force: true }); // zip 对已有文件是追加，必须先删
    // -X 不写额外属性、-D 不写目录条目；文件按排好的顺序逐个传入，不经 shell
    const z = spawnSync("/usr/bin/zip", ["-X", "-D", "-q", "-9", zipPath, ...files],
      { cwd: stage, encoding: "utf8", env: { ...process.env, TZ: "UTC" } });
    if (z.status !== 0) die(`zip 失败：${(z.stderr || z.error?.message || `退出码 ${z.status}`).trim()}`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  const buf = readFileSync(zipPath);
  const sha = createHash("sha256").update(buf).digest("hex");
  const expectId = storeKey ? extensionId(storeKey) : null;
  console.log(`已生成 ${relative(ROOT, zipPath)}`);
  console.log(`  版本    ${manifest.version}（${files.length} 个文件）`);
  console.log(`  大小    ${statSync(zipPath).size} 字节（${(buf.length / 1024).toFixed(1)} KiB）`);
  console.log(`  sha256  ${sha}`);
  console.log(storeKey ? `  key     商店公钥，扩展 ID ${expectId}`
    : "  key     未写入（首次上传用；商店分配 ID。以后的版本用 --store-key 带上商店公钥）");

  if (opts.smoke) {
    console.log("\n安装冒烟（一次性 Chrome 配置，无头）：");
    const { smoke } = await import("./pack-smoke.mjs");
    const { results } = await smoke(zipPath, { expectId });
    const failed = results.filter(r => !r.ok);
    if (failed.length) { console.error(`\n冒烟失败 ${failed.length} 项`); process.exit(1); }
    console.log(`\n冒烟通过（${results.length} 项）`);
  }
}

main().catch(e => die(e.stack || e.message));
