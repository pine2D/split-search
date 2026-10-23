// CLI 入口：解析参数 → 前置检查 → 启动 → 确认扩展 → 快照并配置模拟引擎 → 执行步骤 → 恢复 → 写报告
// 退出码：0 全部通过或跳过；1 有失败（含恢复失败、浏览器中途退出）；2 前置条件缺失；130/143 被 SIGINT/SIGTERM 中断
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./args.mjs";
import { checkProfileLock, launch } from "./browser.mjs";
import { startServer } from "./server.mjs";
import { PROFILE_DIR, CHROME_BIN, EXT_ID } from "./config.mjs";
import * as ext from "./ext.mjs";
import { collectConsole } from "./console.mjs";
import { STEPS, selectSteps } from "./steps/index.mjs";
import { runSteps } from "./runner.mjs";
import { renderReport, reportBaseName } from "./report.mjs";

const log = m => console.log(m);
const warn = m => console.error(m);

// Task 8 会把未安装分支换成安装引导，这里只给出说明
function preconditionMessage(ens, args) {
  if (ens.reason === "wrong-id") {
    return `前置条件缺失：测试配置里的 Split Search 扩展 ID 是 ${ens.ids.join(", ")}，不是 ${EXT_ID}。\n` +
      `manifest 的 key 可能被改过（key 不得修改）。请先检查 src/manifest.json。`;
  }
  if (args.autoOnly) {
    return `前置条件缺失：测试配置（${PROFILE_DIR}）里没有可用的 Split Search 扩展${ens.hint ? `（${ens.hint}）` : ""}。\n` +
      "--auto-only 需要先完成一次完整的引导式运行（npm run e2e），装好扩展并授权。";
  }
  return [
    `前置条件缺失：测试配置里还没有安装 Split Search 扩展（ID ${EXT_ID}）${ens.hint ? `，${ens.hint}` : ""}。`,
    "一次性准备（之后不用再做）：",
    `  1. 打开测试浏览器：${CHROME_BIN} --user-data-dir=${PROFILE_DIR} --disable-sync --no-first-run chrome://extensions`,
    "  2. 打开右上角“开发者模式”，点“加载已解压的扩展程序”，选择目录：",
    `     ${ext.SRC_DIR}`,
    `  3. 确认扩展 ID 为 ${EXT_ID}，关闭这个浏览器，然后重新运行 npm run e2e`,
  ].join("\n");
}

async function main() {
  let args, steps;
  try {
    args = parseArgs(process.argv.slice(2));
    steps = selectSteps(STEPS, args);
  } catch (e) {
    if (e.code === "HELP") { log(e.message); return 0; }
    warn(e.message);
    return 2;
  }
  if (!steps.length) { warn("没有可执行的步骤：检查 --only 与 --auto-only 的组合（--auto-only 只保留自动步骤）。"); return 2; }

  const lock = checkProfileLock(PROFILE_DIR);
  if (lock.locked) {
    warn(`前置条件缺失：测试配置正被另一个 Chrome 占用（pid ${lock.pid}）。\n请关闭使用 ${PROFILE_DIR} 的 Chrome 后重试。`);
    return 2;
  }

  // ---- 中断处理：第一次中断走完恢复流程，第二次立即退出 ----
  const abort = new AbortController();
  let signalName = null, browserDead = false, closing = false, server = null;
  const onSignal = sig => {
    if (signalName) {
      warn(`\n再次收到 ${sig}，立即退出。若已做快照，它保留在 ${ext.SNAPSHOT_FILE}，下次启动会自动恢复。`);
      process.exit(sig === "SIGINT" ? 130 : 143);
    }
    signalName = sig;
    warn(`\n收到 ${sig}：停止步骤，恢复 storage 并写出部分报告（再按一次 Ctrl+C 强制退出）…`);
    abort.abort(`收到 ${sig}`);
    server?.guide.cancel();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const startedAt = new Date();
  const notes = [];
  let browser = null, col = null, results = null, storage = null, snapshotTaken = false, chromeVersion = null, fatal = null;
  try {
    try { server = await startServer({ port: args.port }); }
    catch (e) { warn(`前置条件缺失：${e.message}`); return 2; }
    log(`模拟服务与向导页：http://127.0.0.1:${args.port}/guide`);

    try { browser = await launch({ headless: args.headless }); }
    catch (e) { warn(`前置条件缺失：启动 Chrome 失败：${e.message}`); return 2; }
    browser.proc.once("exit", () => {
      if (closing) return;
      browserDead = true;
      if (!abort.signal.aborted) { warn("测试浏览器已退出，停止运行。"); abort.abort("测试浏览器已退出"); }
    });
    chromeVersion = (await browser.client.send("Browser.getVersion")).product;
    log(`已启动 ${chromeVersion}${args.headless ? "（无头）" : ""}`);
    try { col = await collectConsole(browser); }
    catch (e) { notes.push(`控制台收集未启用：${e.message}`); }

    const ens = await ext.ensureExtension(browser, { autoOnly: args.autoOnly });
    if (!ens.ok) { warn(preconditionMessage(ens, args)); return 2; }
    if (abort.signal.aborted) return signalName ? (signalName === "SIGINT" ? 130 : 143) : 1;

    await ext.reloadExtension(browser);
    log("扩展已重新加载（使用磁盘上的最新代码）");
    if (await ext.restorePendingSnapshot(browser, ext.SNAPSHOT_FILE)) {
      log("发现上次遗留的 storage 快照，已先恢复");
      notes.push("启动时发现上次遗留的 storage 快照，已先恢复");
    }
    const snap = await ext.snapshotStorage(browser, ext.SNAPSHOT_FILE);
    snapshotTaken = true;
    storage = { before: snap.digest, after: null, equal: false };
    log(`storage 快照已保存（${Object.keys(snap.data).length} 个键，摘要 ${snap.digest}）`);
    await ext.configureMocks(browser, args.port);
    log("已写入模拟引擎与默认组合 ea | eb");

    const ctx = {
      browser, guide: server.guide, ext: ext.bindExt(browser, { port: args.port }), port: args.port,
      timeoutMs: args.timeoutMs, abortSignal: abort.signal, log, consoleErrors: col?.errors ?? [],
    };
    results = await runSteps(steps, ctx, { timeoutMs: args.timeoutMs });
  } catch (e) {
    fatal = e;
    warn(`运行出错：${e.message}`);
    notes.push(`运行出错：${e.message}`);
  } finally {
    if (snapshotTaken) {
      if (browserDead) {
        notes.push(`浏览器已退出，无法恢复 storage；快照保留在 ${ext.SNAPSHOT_FILE}，下次启动会自动恢复`);
        warn(notes.at(-1));
      } else {
        try {
          const r = await ext.restoreStorage(browser, ext.SNAPSHOT_FILE);
          Object.assign(storage, { after: r.digest, equal: r.equal });
          log(`storage 已恢复（摘要 ${r.digest}，与运行前${r.equal ? "一致" : "不一致"}）`);
        } catch (e) {
          notes.push(`恢复 storage 失败：${e.message}；快照保留在 ${ext.SNAPSHOT_FILE}，下次启动会自动恢复`);
          warn(notes.at(-1));
        }
      }
    }
    if (snapshotTaken || results) {
      if (!results) results = steps.map(s => ({ id: s.id, title: s.title, kind: s.kind, status: "skip", detail: "未执行（运行提前结束）", durationMs: 0 }));
      if (signalName) notes.push(`运行被 ${signalName} 中断，报告不完整`);
      if (browserDead && !signalName) notes.push("测试浏览器在运行中途退出");
      writeReport({ startedAt, args, results, consoleErrors: col?.errors ?? [], chromeVersion, storage, notes });
    }
    await col?.stop().catch(() => {});
    closing = true;
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }

  if (signalName) return signalName === "SIGINT" ? 130 : 143;
  const failed = fatal || browserDead || !storage?.equal || results.some(r => r.status === "fail");
  return failed ? 1 : 0;
}

function writeReport(data) {
  const { md, json } = renderReport({ ...data, finishedAt: new Date() });
  mkdirSync(ext.OUT_DIR, { recursive: true });
  const base = join(ext.OUT_DIR, reportBaseName(data.startedAt));
  writeFileSync(`${base}.md`, md);
  writeFileSync(`${base}.json`, JSON.stringify(json, null, 2));
  const s = json.summary;
  log(`\n汇总：共 ${s.total} 步，通过 ${s.pass}，失败 ${s.fail}，跳过 ${s.skip}；[split-search] 控制台错误 ${data.consoleErrors.length} 条`);
  log(`报告：${base}.md`);
}

main().then(code => process.exit(code ?? 1), e => { warn(`未预期的错误：${e?.stack || e}`); process.exit(1); });
