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
import { makeRestart } from "./restart.mjs";
import { renderReport, reportBaseName, redact } from "./report.mjs";
import { openGuide, installGuide, ensureGrants, cleanupPrompt, cleanupItems, cleanupText } from "./steps/setup.mjs";
import { makeAfterStep } from "./steps/recover.mjs";
import { extAlive } from "./steps/guided.mjs";
import { L } from "./steps/labels.mjs";

// 终端输出一律脱敏（网址里的 token/session 等参数值）
const log = m => console.log(redact(m));
const warn = m => console.error(redact(m));

// 引导式运行在未安装时进入安装引导（setup.mjs）；这里是 --auto-only 或引导失败时的说明
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
    `  2. 打开右上角${L.devMode}，点${L.loadUnpacked}，选择目录：`,
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
  let signalName = null, server = null;
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
  // 运行时状态（重启会替换 browser/col）。orphanErrors：重启后收集器没能启用时，保留重启前的错误；
  // stopReason：浏览器不可用时设置，运行器据此跳过剩余步骤
  const rt = { browser: null, col: null, closing: false, browserDead: false, restartFailed: false, stopReason: null, orphanErrors: null, notes, ctx: null, started: [] };
  let results = null, storage = null, snapshotTaken = false, chromeVersion = null, fatal = null, cleanupConfirmed = false;
  try {
    try { server = await startServer({ port: args.port }); }
    catch (e) { warn(`前置条件缺失：${e.message}`); return 2; }
    log(`模拟服务与向导页：http://127.0.0.1:${args.port}/guide`);

    // 只认当前这一个浏览器进程的退出：重启时旧进程的退出不算“中途退出”
    const watchExit = b => b.proc.once("exit", () => {
      if (rt.closing || b !== rt.browser) return;
      rt.browserDead = true;
      if (!abort.signal.aborted) { warn("测试浏览器已退出，停止运行。"); abort.abort("测试浏览器已退出"); }
    });
    try { rt.browser = await launch({ headless: args.headless }); }
    catch (e) { warn(`前置条件缺失：启动 Chrome 失败：${e.message}`); return 2; }
    const browser = rt.browser; // 初始浏览器（步骤开始前的准备都用它）
    watchExit(browser);
    chromeVersion = (await browser.client.send("Browser.getVersion")).product;
    log(`已启动 ${chromeVersion}${args.headless ? "（无头）" : ""}`);
    try { rt.col = await collectConsole(browser); }
    catch (e) { notes.push(`控制台收集未启用：${e.message}`); }
    // 引导式运行：打开向导页（准备、assist、judge 步骤的说明都显示在这里）
    const setupCtx = { browser, guide: server.guide, port: args.port, timeoutMs: args.timeoutMs, abortSignal: abort.signal, log };
    if (!args.autoOnly) await openGuide(browser, args.port);

    let ens = await ext.ensureExtension(browser, { autoOnly: args.autoOnly });
    // 已登记但设置页一时打不开：多半是冷启动慢，稍等再试一次，别直接进入“启用扩展”引导
    if (!ens.ok && ens.hint) { await new Promise(r => setTimeout(r, 3000)); ens = await ext.ensureExtension(browser, { autoOnly: args.autoOnly }); }
    let install = null;
    if (!ens.ok && ens.reason === "not-installed" && !args.autoOnly) {
      log("扩展未安装：请按向导页的说明加载（一次性）");
      install = await installGuide(setupCtx, ens);
      if (!install.ok) {
        warn(`前置条件缺失：${install.detail}\n也可以手动安装：\n${preconditionMessage(ens, args)}`);
        if (!abort.signal.aborted) return 2;
      }
      else log(`扩展已就绪；B1：${install.b1.detail}`);
    } else if (!ens.ok) { warn(preconditionMessage(ens, args)); return 2; }
    if (abort.signal.aborted) return signalName ? (signalName === "SIGINT" ? 130 : 143) : 1;

    await ext.reloadExtension(browser);
    log("扩展已重新加载（使用磁盘上的最新代码）");
    if (await ext.restorePendingSnapshot(browser, ext.SNAPSHOT_FILE)) {
      log("发现上次遗留的 storage 快照，已先恢复");
      notes.push("启动时发现上次遗留的 storage 快照，已先恢复");
    }
    const grants = await ensureGrants(setupCtx, { autoOnly: args.autoOnly });
    if (!grants.ok) {
      if (args.autoOnly) { warn(`前置条件缺失：${grants.detail}。请先完成一次引导式运行（npm run e2e）。`); return 2; }
      warn(grants.detail);
      notes.push(`一次性授权：${grants.detail}`);
    } else if (grants.requested) log("一次性授权已完成");
    if (abort.signal.aborted) return signalName ? (signalName === "SIGINT" ? 130 : 143) : 1;
    const snap = await ext.snapshotStorage(browser, ext.SNAPSHOT_FILE);
    snapshotTaken = true;
    storage = { before: snap.digest, after: null, equal: false };
    log(`storage 快照已保存（${Object.keys(snap.data).length} 个键，摘要 ${snap.digest}）`);
    await ext.configureMocks(browser, args.port);
    log("已写入模拟引擎与默认组合 ea | eb");

    const col = rt.col;
    const ctx = rt.ctx = {
      browser, guide: server.guide, ext: ext.bindExt(browser, { port: args.port }), port: args.port,
      timeoutMs: args.timeoutMs, abortSignal: abort.signal, log, consoleErrors: col?.errors ?? [], consoleCollector: col ?? undefined,
      stopReason: () => rt.stopReason, install,
      // 记下真正开始过的步骤：收尾清单只列它们让用户改过的设置
      onStepStart: step => { rt.started.push(step); },
      // B4、T8 这类会撤销授权/停用扩展的步骤之后，确认扩展可用、授权齐全（见 recover.mjs）
      afterStep: makeAfterStep(rt, { log, warn }),
    };
    // 步骤内重启浏览器（T5/T10），见 restart.mjs
    ctx.restartBrowser = makeRestart(rt, {
      launch, collectConsole, bindExt: ext.bindExt, watchExit, headless: args.headless, port: args.port, warn, log,
      waitExtension: b => b.waitFor(async () => (await b.evalExt("chrome.runtime.id", { timeoutMs: 3000 })) === EXT_ID,
        { timeoutMs: 30000, intervalMs: 500 }),
    });
    results = await runSteps(steps, ctx, { timeoutMs: args.timeoutMs });
    if (install?.b1 && !steps.some(s => s.id === "B1")) notes.push(`B1（未选入本次运行）：${install.b1.status}——${install.b1.detail}`);
    // 收尾提示：恢复 T1/T2/T11/T12/T14 等步骤让用户改过的搜索设置（只在测试配置里）
    if (!args.autoOnly && !abort.signal.aborted && !rt.stopReason) {
      const r = await cleanupPrompt({ ...ctx, browser: rt.browser }, rt.started).catch(e => ({ note: `收尾提示出错：${e.message}` }));
      if (r?.note) notes.push(r.note);
      cleanupConfirmed = !!r?.confirmed;
    }
  } catch (e) {
    fatal = e;
    warn(`运行出错：${e.message}`);
    notes.push(`运行出错：${e.message}`);
  } finally {
    // T5/T10 重启浏览器期间被中断：有上限地等重启结束（新浏览器会登记到 rt.browser，用它恢复后关掉）
    if (rt.restarting) {
      let t;
      await Promise.race([rt.restarting, new Promise(r => { t = setTimeout(r, 30000); })]);
      clearTimeout(t);
    }
    if (snapshotTaken) {
      if (rt.browserDead || !rt.browser) {
        const why = rt.browserDead ? (rt.restartFailed ? "浏览器重启失败" : "浏览器已退出") : "浏览器不可用（重启期间运行被中断）";
        notes.push(`${why}，无法恢复 storage；快照保留在 ${ext.SNAPSHOT_FILE}，下次启动会自动恢复`);
        warn(notes.at(-1));
      } else {
        try {
          const r = await ext.restoreStorage(rt.browser, ext.SNAPSHOT_FILE);
          Object.assign(storage, { after: r.digest, equal: r.equal });
          log(`storage 已恢复（摘要 ${r.digest}，与运行前${r.equal ? "一致" : "不一致"}）`);
        } catch (e) {
          const dead = !(await extAlive(rt.browser).catch(() => false)) ? "（扩展当前不可用，可能处于停用状态）" : "";
          notes.push(`恢复 storage 失败${dead}：${e.message}；快照保留在 ${ext.SNAPSHOT_FILE}，下次启动会自动恢复`);
          warn(notes.at(-1));
        }
      }
    }
    // 恢复清单：引导式运行里只要开始过带 cleanup 的步骤，无论正常结束、中断、出错还是浏览器退出，都打印并写进报告
    const cleanup = args && !args.autoOnly ? cleanupItems(rt.started) : [];
    if (cleanup.length) {
      const text = cleanupText(cleanup);
      if (cleanupConfirmed) log(`\n收尾：已由用户确认恢复这些设置：\n${text}`);
      else {
        log(`\n收尾：请在测试浏览器里恢复这些设置（只影响测试配置，下次运行 npm run e2e 时也可以再做）：\n${text}`);
        notes.push(`需要恢复的测试浏览器设置：\n${text}`);
      }
    }
    // 中断时可能正处在 B4/T8 撤销授权或停用扩展的中途（不论是否 --auto-only，B4/T8 都不是 auto，只在引导式里开始）
    if ((signalName || abort.signal.aborted) && rt.started.some(st => st.restores)) {
      const msg = "若中断时扩展处于停用状态或授权被撤销，下次请先运行 npm run e2e（引导式），它会带你重新启用扩展并恢复授权。";
      warn(msg);
      notes.push(msg);
    }
    if (snapshotTaken || results) {
      if (!results) results = steps.map(s => ({ id: s.id, title: s.title, kind: s.kind, status: "skip", detail: "未执行（运行提前结束）", durationMs: 0 }));
      if (signalName) notes.push(`运行被 ${signalName} 中断，报告不完整`);
      if (rt.browserDead && !rt.restartFailed && !signalName) notes.push("测试浏览器在运行中途退出");
      writeReport({ startedAt, args, results, consoleErrors: rt.col?.errors ?? rt.orphanErrors ?? [], chromeVersion, storage, notes });
    }
    await rt.col?.stop().catch(() => {});
    rt.closing = true;
    await rt.browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }

  if (signalName) return signalName === "SIGINT" ? 130 : 143;
  const failed = fatal || rt.browserDead || rt.stopReason || !storage?.equal || results.some(r => r.status === "fail");
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
