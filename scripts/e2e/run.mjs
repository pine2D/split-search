// CLI 入口：解析参数 → 前置检查 → 启动 → 确认扩展 → 快照并配置模拟引擎 → 执行步骤 → 恢复 → 写报告
// 退出码：0 全部通过、跳过或预期降级；1 有失败（含恢复失败、浏览器中途退出）；2 前置条件缺失；130/143 被 SIGINT/SIGTERM 中断
import { existsSync } from "node:fs";
import { parseArgs } from "./args.mjs";
import { checkProfileLock, launch } from "./browser.mjs";
import { startServer } from "./server.mjs";
import { PROFILE_DIR, CHROME_BIN, EXT_ID } from "./config.mjs";
import { join } from "node:path";
import * as ext from "./ext.mjs";
import * as se from "./settings-se.mjs";
import { collectConsole } from "./console.mjs";
import { STEPS, selectSteps } from "./steps/index.mjs";
import { runSteps } from "./runner.mjs";
import { makeRestart } from "./restart.mjs";
import { redact } from "./report.mjs";
import { teardown, writePartialReportSync, exitCodeOf, stopDisplaySync } from "./teardown.mjs";
import { prepareDisplay, describeDisplay } from "./display.mjs";
import xinput from "./xinput.mjs";
import { releaseHeldSync, releaseAfterClose } from "./gesture.mjs";
import { openGuide, installGuide, ensureGrants, cleanupPrompt, cleanupItems, cleanupNote, cleanupText } from "./steps/setup.mjs";
import { makeAfterStep } from "./steps/recover.mjs";
import { extAlive } from "./steps/guided.mjs";
import { L } from "./steps/labels.mjs";
import { fixWindow } from "./steps/xauto-lib.mjs";

const DISPLAY_PID_FILE = join(ext.OUT_DIR, "display.pid");
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
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) {
    if (e.code === "HELP") { log(e.message); return 0; }
    warn(e.message);
    return 2;
  }
  // 先查配置锁再清理遗留的显示服务器：配置被占用时可能是另一次运行，它的服务器不能动
  const lock = checkProfileLock(PROFILE_DIR);
  if (lock.locked) {
    warn(`前置条件缺失：测试配置正被另一个 Chrome 占用（pid ${lock.pid}）。\n请关闭使用 ${PROFILE_DIR} 的 Chrome 后重试。`);
    return 2;
  }
  // 嵌套显示（display.mjs）：必须早于 launch() 和 xinput.available()，它们都按 process.env.DISPLAY 连接。
  // 嵌套模式下浏览器有窗口（xvfb 本身不可见），所以不再无头；退回 host 时保持原来的无头规则
  const disp = await prepareDisplay(args, { pidFile: DISPLAY_PID_FILE, log });
  args.headless = args.headless && disp.mode === "host";
  log(`显示：${describeDisplay(disp)}`);
  let steps, xa = { ok: false, reason: "未检查" };
  try {
    xa = await xinput.available({ headless: args.headless, noXinput: args.noXinput });
    steps = selectSteps(STEPS, { ...args, xinput: xa.ok });
  } catch (e) { warn(e.message); await disp.stop(); return 2; }
  if (!steps.length) {
    warn("没有可执行的步骤：检查 --only 与 --auto-only 的组合（--auto-only 只保留自动步骤，以及 xinput 可用时的 xauto 步骤）。");
    await disp.stop();
    return 2;
  }

  // ---- 中断处理：第一次中断走完恢复流程，第二次立即退出 ----
  const abort = new AbortController();
  let signalName = null, server = null;
  const startedAt = new Date();
  const notes = [...disp.notes];
  // 运行时状态（重启会替换 browser/col）。orphanErrors：重启后收集器没能启用时，保留重启前的错误；
  // stopReason：浏览器不可用时设置，运行器据此跳过剩余步骤
  const rt = { browser: null, col: null, closing: false, browserDead: false, restartFailed: false, stopReason: null, orphanErrors: null, notes, ctx: null, started: [] };
  // 收尾记录（teardown.mjs）。partial：运行器边跑边写的结果；网站搜索：Chrome 要正常退出才保证改动写进磁盘
  // （实测 SIGTERM 会丢最后几秒），所以恢复只做到“读回核对”并保留快照，正常关闭浏览器之后才删
  const s = { display: disp, args, steps, startedAt, chromeVersion: null, storage: null, snapshotTaken: false, results: null, partial: [],
    signalName: null, aborted: () => abort.signal.aborted, cleanupConfirmed: false, seTouched: false, seFailed: false, seVerified: false };
  const reportDeps = { outDir: ext.OUT_DIR, log, warn };
  const onSignal = sig => {
    if (signalName) {
      warn(`\n再次收到 ${sig}，立即退出。若已做快照，它保留在 ${ext.SNAPSHOT_FILE}（网站搜索：${se.SE_SNAPSHOT_FILE}），下次启动会自动恢复。`);
      if (releaseHeldSync() === "stuck") {
        warn(disp.mode !== "host" ? `真实输入的鼠标左键可能仍按着：只在嵌套显示 ${disp.display} 里，它随嵌套显示服务器一起停止，不影响你的桌面。`
          : "真实输入的鼠标左键可能仍按着（测试浏览器也会随之退出）：请把光标移到桌面空白处（不在任何 Linux 窗口上），再运行 xdotool mouseup 1。");
      }
      try { writePartialReportSync(rt, s, reportDeps); } catch (e) { warn(`写部分报告失败：${e.message}`); }
      if (stopDisplaySync(s)) warn(`已停止嵌套显示服务器 ${disp.display}`);
      process.exit(sig === "SIGINT" ? 130 : 143);
    }
    signalName = s.signalName = sig;
    warn(`\n收到 ${sig}：停止步骤，恢复 storage 与网站搜索并写出部分报告（再按一次 Ctrl+C 强制退出）…`);
    abort.abort(`收到 ${sig}`);
    server?.guide.cancel();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let fatal = null;
  try {
    try { server = await startServer({ port: args.port }); }
    catch (e) { warn(`前置条件缺失：${e.message}`); return 2; }
    log(`模拟服务与向导页：http://127.0.0.1:${args.port}/guide`);
    const nestedHint = disp.mode === "xephyr" ? "，请不要把光标停在 Xephyr 窗口上" : "";
    log(!xa.ok ? `真实输入（xinput）：不可用（${xa.reason}），xauto 步骤改用人工协助版本`
      : disp.mode !== "host" ? `真实输入（xinput）：可用，xauto 步骤在嵌套显示 ${disp.display} 里用真实鼠标/键盘自动执行，不影响你的桌面${nestedHint}`
        : "真实输入（xinput）：可用，xauto 步骤用真实鼠标/键盘自动执行——测试期间请把光标停在测试浏览器窗口里、不要动鼠标键盘");

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
    s.chromeVersion = (await browser.client.send("Browser.getVersion")).product;
    log(`已启动 ${s.chromeVersion}${args.headless ? "（无头）" : ""}`);
    try { rt.col = await collectConsole(browser); }
    catch (e) { notes.push(`控制台收集未启用：${e.message}`); }
    // 网站搜索的遗留快照与扩展无关，启动后立刻恢复（早于安装引导等可能提前退出的环节）
    if (existsSync(se.SE_SNAPSHOT_FILE)) {
      s.seTouched = true;
      const r = await se.restore(browser, { keepFile: true });
      log("发现上次遗留的网站搜索快照，已先恢复（默认引擎改回运行前、删除 sse2e 条目）");
      notes.push("启动时发现上次遗留的网站搜索快照，已先恢复");
      if (r.warning) { warn(r.warning); notes.push(r.warning); }
    }
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
    s.snapshotTaken = true;
    s.storage = { before: snap.digest, after: null, equal: false };
    log(`storage 快照已保存（${Object.keys(snap.data).length} 个键，摘要 ${snap.digest}）`);
    await ext.configureMocks(browser, args.port);
    log("已写入模拟引擎与默认组合 ea | eb");

    // 真实输入：读一次 X 根窗口 id（判断光标是否在任何 X 窗口上），窗口固定为 normal 1600×1000（xauto 步骤每次也会再核对）
    let gx = null;
    if (xa.ok && steps.some(st => st.kind === "xauto")) {
      // nested：嵌套显示（Xephyr/Xvfb）下手势层自己移动指针、用慢节奏拖拽、焦点走 getwindowfocus（gesture.mjs）；
      // 值为 false（host）或模式名 "xephyr"/"xvfb"（真值），文案按模式区分
      gx = { xi: xinput, root: await xinput.rootWindow(), profileDir: PROFILE_DIR, stop: null, nested: disp.mode !== "host" && disp.mode };
      const page = (await browser.targets()).find(t => t.type === "page");
      if (page) await fixWindow({ browser }, page.targetId).catch(e => notes.push(`固定窗口尺寸失败：${e.message}`));
    }
    const col = rt.col;
    const ctx = rt.ctx = {
      browser, guide: server.guide, ext: ext.bindExt(browser, { port: args.port }), port: args.port,
      timeoutMs: args.timeoutMs, abortSignal: abort.signal, log, consoleErrors: col?.errors ?? [], consoleCollector: col ?? undefined,
      stopReason: () => rt.stopReason, install, gx,
      // 网站搜索（sse2e 专用条目）：ensure 前自动快照，结束时在 finally 里恢复
      se: se.bindSettings(() => rt.browser),
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
    s.results = await runSteps(steps, ctx, { timeoutMs: args.timeoutMs, results: s.partial });
    if (install?.b1 && !steps.some(s => s.id === "B1")) notes.push(`B1（未选入本次运行）：${install.b1.status}——${install.b1.detail}`);
    // 收尾提示：只有 T8(d) 在 assist 回退路径里改过的“站点访问”要用户改回；其余搜索设置留在测试配置里复用
    if (!args.autoOnly && !abort.signal.aborted && !rt.stopReason) {
      const r = await cleanupPrompt({ ...ctx, browser: rt.browser }, rt.started, s.results).catch(e => ({ note: `收尾提示出错：${e.message}` }));
      if (r?.note) notes.push(r.note);
      s.cleanupConfirmed = !!r?.confirmed;
    }
  } catch (e) {
    fatal = e;
    warn(`运行出错：${e.message}`);
    notes.push(`运行出错：${e.message}`);
  } finally {
    await teardown(rt, s, {
      ext, extAlive, se, exists: existsSync, cleanupItems, cleanupNote, cleanupText, ...reportDeps,
      afterClose: async () => (rt.ctx?.gx ? releaseAfterClose(xinput, rt.ctx.gx.root) : "none"),
      stopDisplay: disp.stop,
    }).catch(e => warn(`收尾出错：${e?.stack || e}`));
    await disp.stop().catch(() => {}); // 幂等：teardown 中途出错时兜底
    await server?.close().catch(() => {});
  }

  if (signalName) return signalName === "SIGINT" ? 130 : 143;
  return exitCodeOf(s, rt, fatal);
}

main().then(code => process.exit(code ?? 1), e => { warn(`未预期的错误：${e?.stack || e}`); process.exit(1); });
