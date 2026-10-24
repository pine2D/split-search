// run.mjs 的收尾（finally）：恢复 storage、恢复网站搜索、收尾清单、关浏览器、写报告；第二次 Ctrl+C 时同步写出部分报告。
// rt：run.mjs 的运行时状态（browser、col、closing、browserDead、restartFailed、restarting、started、notes）；
// s：收尾要用的运行记录（display（display.mjs 的 prepareDisplay 结果）、args、steps、startedAt、chromeVersion、storage、snapshotTaken、results、partial、signalName、aborted、
//    cleanupConfirmed、seTouched、seFailed、seVerified）。依赖全部经 d 注入，便于单测。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderReport, reportBaseName } from "./report.mjs";

const noop = () => {};

// T5/T10 重启浏览器期间被中断：有上限地等重启结束（新浏览器会登记到 rt.browser，用它恢复后关掉）
export async function waitRestarting(rt, ms = 30000) {
  if (!rt.restarting) return;
  let t;
  await Promise.race([rt.restarting, new Promise(r => { t = setTimeout(r, ms); })]);
  clearTimeout(t);
}

const browserGone = rt => rt.browserDead || !rt.browser;
const goneWhy = rt => (rt.browserDead ? (rt.restartFailed ? "浏览器重启失败" : "浏览器已退出") : "浏览器不可用（重启期间运行被中断）");

// 收尾前先确认扩展可用：T8(b) 停用期间被中断时，步骤的 finally 可能没赶在收尾前重新启用（运行器只等 SETTLE_MS，
// 中断时也不跑步骤后的恢复检查）。只在开始过 restores 步骤（B4、T8）时检查；不可用就经 chrome://extensions 详情页启用，
// 否则恢复 storage 会失败，下次启动还会把停用误报成“未安装”。d: { enableExt(browser) → bool, extAlive, log, warn }
export async function reenableStep(rt, s, d) {
  const { log = noop, warn = noop } = d;
  if (!d.enableExt || browserGone(rt) || !rt.started.some(st => st.restores)) return;
  if (await d.extAlive(rt.browser).catch(() => false)) return;
  const ok = await d.enableExt(rt.browser).catch(() => false);
  rt.notes.push(ok ? "收尾时扩展不可用（多半是 T8(b) 停用期间运行被中断），已经经 chrome://extensions 详情页重新启用"
    : "收尾时扩展不可用，经 chrome://extensions 详情页重新启用也没成功；下次启动会再尝试启用");
  (ok ? log : warn)(rt.notes.at(-1));
}

// d: { ext: { restoreStorage, SNAPSHOT_FILE }, extAlive, log, warn }
export async function restoreStorageStep(rt, s, d) {
  const { log = noop, warn = noop } = d;
  if (!s.snapshotTaken) return;
  const file = d.ext.SNAPSHOT_FILE;
  if (browserGone(rt)) {
    rt.notes.push(`${goneWhy(rt)}，无法恢复 storage；快照保留在 ${file}，下次启动会自动恢复`);
    warn(rt.notes.at(-1));
    return;
  }
  try {
    const r = await d.ext.restoreStorage(rt.browser, file);
    Object.assign(s.storage, { after: r.digest, equal: r.equal });
    log(`storage 已恢复（摘要 ${r.digest}，与运行前${r.equal ? "一致" : "不一致"}）`);
  } catch (e) {
    const dead = !(await d.extAlive(rt.browser).catch(() => false)) ? "（扩展当前不可用，可能处于停用状态）" : "";
    rt.notes.push(`恢复 storage 失败${dead}：${e.message}；快照保留在 ${file}，下次启动会自动恢复`);
    warn(rt.notes.at(-1));
  }
}

// 网站搜索：有快照（启动恢复失败或步骤里改过）就恢复并读回核对（保留快照，正常关闭后才删）；
// 浏览器不在了则保留快照，下次启动先恢复。restore 只在当前默认是 sse2e 条目时才改回默认（不撤销用户自己设的 gb 等）。
// d: { se: { restore, SE_SNAPSHOT_FILE }, exists, log, warn }
export async function restoreSettingsStep(rt, s, d) {
  const { log = noop, warn = noop } = d;
  const file = d.se.SE_SNAPSHOT_FILE;
  if (!d.exists(file)) return;
  if (browserGone(rt)) {
    s.seFailed = true;
    rt.notes.push(`浏览器不可用，无法恢复网站搜索；快照保留在 ${file}，下次启动会自动恢复`);
    warn(rt.notes.at(-1));
    return;
  }
  s.seTouched = true;
  try {
    const r = await d.se.restore(rt.browser, { keepFile: true });
    s.seVerified = true;
    const def = r.defaultChanged ? `默认引擎改回 ${r.defaultKeyword}` : `默认引擎保持 ${r.defaultKeyword}（不是脚本设的，不动）`;
    log(`网站搜索已恢复：${def}，删除 ${r.removed.join(", ") || "（无）"}`);
    if (r.warning) { warn(r.warning); rt.notes.push(r.warning); }
  } catch (e) {
    s.seFailed = true;
    rt.notes.push(`恢复网站搜索失败：${e.message}；快照保留在 ${file}，下次启动会自动恢复`);
    warn(rt.notes.at(-1));
  }
}

// 恢复清单：引导式运行里只要开始过带 cleanup 的步骤，无论正常结束、中断、出错还是浏览器退出，都打印并写进报告。
// d: { cleanupItems, cleanupNote, cleanupText, log, warn }
export function cleanupStep(rt, s, d) {
  const { log = noop, warn = noop } = d;
  const guided = s.args && !s.args.autoOnly;
  const results = s.results ?? s.partial;
  const items = guided ? d.cleanupItems(rt.started, results) : [];
  const keep = guided ? d.cleanupNote(rt.started) : null;
  if (keep) { log(`\n收尾：${keep}`); rt.notes.push(keep); }
  if (items.length) {
    const text = d.cleanupText(items);
    if (s.cleanupConfirmed) log(`\n收尾：已由用户确认恢复这些设置：\n${text}`);
    else {
      log(`\n收尾：请在测试浏览器里恢复这些设置（只影响测试配置，下次运行 npm run e2e 时也可以再做）：\n${text}`);
      rt.notes.push(`需要恢复的测试浏览器设置：\n${text}`);
    }
  }
  // 中断时可能正处在 B4/T8 撤销授权或停用扩展的中途
  if ((s.signalName || s.aborted?.()) && rt.started.some(st => st.restores)) {
    const msg = "若中断时扩展处于停用状态或授权被撤销，下次请先运行 npm run e2e（引导式），它会带你重新启用扩展并恢复授权。";
    warn(msg);
    rt.notes.push(msg);
  }
}

// 先关浏览器再写报告：网站搜索快照删不删取决于浏览器是否正常退出（Browser.close 后自行退出且退出码 0），结果要写进报告。
// d: { se: { dropSnapshot, SE_SNAPSHOT_FILE }, warn }
export async function closeStep(rt, s, d) {
  const { warn = noop } = d;
  await rt.col?.stop().catch(() => {});
  rt.closing = true;
  const closed = await rt.browser?.close({ graceful: !!s.seTouched }).catch(() => ({ graceful: false }));
  // 真实输入：手势中止后鼠标左键仍按着（光标一直没回到测试窗口），浏览器关掉后再处理（见 gesture.releaseAfterClose）
  const held = await d.afterClose?.().catch(e => `出错：${e.message}`);
  if (held && held !== "none") {
    const nested = s.display?.mode && s.display.mode !== "host";
    rt.notes.push(held === "released" ? `真实输入：之前卡住的鼠标左键已在浏览器关闭后、指针停在${nested ? "嵌套显示的根窗口上" : "桌面"}时松开`
      : nested ? `真实输入：嵌套显示 ${s.display.display ?? ""} 里鼠标左键可能仍按着（${held}）。这只在嵌套显示里，随服务器停止，不影响你的桌面，不需要你操作`
        : `真实输入：鼠标左键可能仍按着（${held}）。请把光标移到桌面空白处（不在任何 Linux 窗口上）后运行 xdotool mouseup 1`);
    warn(rt.notes.at(-1));
  }
  if (!s.seVerified) return closed;
  if (closed?.graceful) {
    try { d.se.dropSnapshot(); }
    catch (e) {
      rt.notes.push(`删除已核对的网站搜索快照失败：${e.message}；下次启动会再核对一遍`);
      warn(rt.notes.at(-1));
    }
  } else {
    rt.notes.push(`测试浏览器没有正常退出，网站搜索的恢复可能没写进磁盘；快照保留在 ${d.se.SE_SNAPSHOT_FILE}，下次启动会再核对一遍`);
    warn(rt.notes.at(-1));
  }
  return closed;
}

// 没跑完的步骤补成 skip（partial：运行器已写出的结果）
export function fillResults(steps, partial = [], detail = "未执行（运行提前结束）") {
  const done = new Set(partial.map(r => r.id));
  return [...partial, ...steps.filter(st => !done.has(st.id)).map(st => ({ id: st.id, title: st.title, kind: st.kind, status: "skip", detail, durationMs: 0 }))];
}

export function writeReport(data, { outDir, log = noop }) {
  const { md, json } = renderReport({ ...data, finishedAt: new Date() });
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, reportBaseName(data.startedAt));
  writeFileSync(`${base}.md`, md);
  writeFileSync(`${base}.json`, JSON.stringify(json, null, 2));
  const sum = json.summary;
  log(`\n汇总：共 ${sum.total} 步，通过 ${sum.pass}，失败 ${sum.fail}，跳过 ${sum.skip}，预期降级 ${sum.degrade}；[split-search] 控制台错误 ${data.consoleErrors.length} 条`);
  log(`报告：${base}.md`);
  return base;
}

// 退出码（不含信号中断）：有失败（步骤失败、运行出错、恢复失败、浏览器中途退出、xauto 被停掉、存储没恢复）→ 1；
// 其余（通过、跳过、预期降级）→ 0
export function exitCodeOf(s, rt, fatal) {
  const failed = fatal || s.seFailed || rt.browserDead || rt.stopReason || !s.storage?.equal || s.results.some(r => r.status === "fail");
  return failed ? 1 : 0;
}

const reportData = (rt, s, results) => ({
  startedAt: s.startedAt, args: s.args, results, consoleErrors: rt.col?.errors ?? rt.orphanErrors ?? [],
  chromeVersion: s.chromeVersion, storage: s.storage, notes: rt.notes, display: s.display ? displayInfo(s.display) : null,
});
// 报告只要描述字段，不带 stop 等函数
const displayInfo = ({ mode, display, size, reason }) => ({ mode, display, size, ...(reason ? { reason } : {}) });

// 第二次 Ctrl+C：同步停掉嵌套显示服务器（process.kill + 删 pid 文件，见 display.mjs 的 stopSync）。返回是否发了信号
export function stopDisplaySync(s) {
  try { return !!s.display?.stopSync?.(); } catch { return false; }
}

// 第二次 Ctrl+C：来不及恢复，同步写出部分报告后由调用方立即退出（writeFileSync 全程同步）
export function writePartialReportSync(rt, s, d) {
  if (s.reportWritten || (!s.snapshotTaken && !s.partial?.length)) return null;
  rt.notes.push(`再次收到 ${s.signalName ?? "中断"}，强制退出：收尾没有做完（没恢复完的 storage / 网站搜索快照保留，下次启动自动恢复），报告不完整`);
  const results = fillResults(s.steps ?? [], s.results ?? s.partial ?? [], "未执行（强制退出）");
  const base = writeReport(reportData(rt, s, results), d);
  s.reportWritten = true;
  return base;
}

// d：上面各步的依赖合在一起，另加 outDir
export async function teardown(rt, s, d) {
  await waitRestarting(rt, d.restartWaitMs);
  await reenableStep(rt, s, d);
  await restoreStorageStep(rt, s, d);
  await restoreSettingsStep(rt, s, d);
  cleanupStep(rt, s, d);
  await closeStep(rt, s, d);
  // 嵌套显示服务器在浏览器关掉（含 afterClose 松开鼠标键）之后才停
  if (d.stopDisplay) {
    try { await d.stopDisplay(); }
    catch (e) { rt.notes.push(`停止嵌套显示服务器失败：${e.message}`); (d.warn ?? noop)(rt.notes.at(-1)); }
  }
  if (s.snapshotTaken || s.results) {
    const results = s.results ?? fillResults(s.steps ?? [], s.partial ?? []);
    s.results = results;
    if (s.signalName) rt.notes.push(`运行被 ${s.signalName} 中断，报告不完整`);
    if (rt.browserDead && !rt.restartFailed && !s.signalName) rt.notes.push("测试浏览器在运行中途退出");
    writeReport(reportData(rt, s, results), d);
    s.reportWritten = true;
  }
}
