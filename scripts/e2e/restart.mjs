// 步骤内重启浏览器（T5/T10）：同一配置、带 --restore-last-session 重新启动；storage 随配置保留，不做快照恢复。
// rt 是 run.mjs 的运行时状态（browser、col、closing、browserDead、restartFailed、stopReason、orphanErrors、notes、ctx、restarting），
// 依赖全部注入，便于单测。任何失败都把原因写进 notes 并设置 rt.stopReason（运行器据此跳过剩余步骤），
// 再抛出带原因的错误，让当前步骤以失败结束。
export function makeRestart(rt, { launch, collectConsole, bindExt, waitExtension, watchExit, headless, port, warn = () => {}, log = () => {} }) {
  const fatal = (msg, reason) => {
    rt.notes.push(msg);
    warn(msg);
    rt.stopReason ??= reason;
    return new Error(msg);
  };
  const aborted = () => !!rt.ctx?.abortSignal?.aborted;
  const INTERRUPTED = "重启浏览器期间运行被中断";
  const restart = async ({ restoreSession = true } = {}) => {
    const old = rt.browser;
    rt.browser = null;
    rt.closing = true;
    await rt.col?.stop().catch(() => {});
    await old?.close({ graceful: true }).catch(() => {});
    rt.closing = false;
    // 已中断就不再启动：run.mjs 看到 rt.browser 为 null，按“浏览器不可用、快照保留”收尾
    if (aborted()) throw new Error(INTERRUPTED);

    let b;
    try { b = await launch({ headless, restoreSession }); }
    catch (e) {
      // 没有可用的浏览器：storage 无法恢复（快照保留），这不是“中途退出”
      rt.browserDead = true;
      rt.restartFailed = true;
      throw fatal(`重启浏览器失败：${e.message}`, "测试浏览器重启失败");
    }
    rt.browser = b;
    watchExit(b);
    // 启动期间被中断：新浏览器已登记在 rt.browser 上，run.mjs 用它恢复 storage 后关掉，不会成为占着配置锁的孤儿
    if (aborted()) throw new Error(INTERRUPTED);
    const prev = rt.col;
    try { rt.col = await collectConsole(b, { carry: prev ?? undefined }); }
    catch (e) {
      // B15 会因收集器缺失判失败；重启前收集到的错误仍写进报告
      rt.notes.push(`重启后控制台收集未启用：${e.message}`);
      rt.col = null;
      rt.orphanErrors = prev?.errors ?? rt.orphanErrors;
    }
    // 先把 ctx 指向新浏览器，再等扩展页：等待失败时 ctx 也不会停在已关闭的旧浏览器上
    Object.assign(rt.ctx, {
      browser: b, ext: bindExt(b, { port }),
      consoleErrors: rt.col?.errors ?? rt.ctx.consoleErrors, consoleCollector: rt.col ?? undefined,
    });
    try { await waitExtension(b); }
    catch (e) { throw fatal(`重启后扩展页不可用：${e.message}`, "重启后扩展不可用"); }
    log(`  浏览器已重启${restoreSession ? "（恢复上次会话）" : ""}`);
    const c = rt.ctx;
    return { browser: c.browser, ext: c.ext, consoleErrors: c.consoleErrors, consoleCollector: c.consoleCollector };
  };
  // rt.restarting：进行中的重启（run.mjs 的收尾先有上限地等它结束，再决定能否恢复 storage）
  return opts => {
    const p = restart(opts);
    const tracked = rt.restarting = p.then(() => {}, () => {}).finally(() => { if (rt.restarting === tracked) rt.restarting = null; });
    return p;
  };
}
