// T8 优雅降级（auto）：模拟引擎 ea | eb，每项做完先恢复再做下一项。
// (a) 无痕：CDP Target.createBrowserContext 建 off-the-record 上下文，在里面打开触发网址：普通左侧搜索、导航记录里没有 go.html；
// (b) 停用：经 chrome://extensions 详情页的开关停用（ext-webui.mjs），触发网址是普通搜索；finally 里一定重新启用。
//     停用期间只读 CDP 目标、不新开扩展页（停用时新开的扩展页要等满 10 秒才知道不可用），整段可被中断：
//     中断后立刻进 finally 重新启用，停用窗口不超过 ~10 秒，落在运行器的收尾期限（SETTLE_MS 15 秒）以内；
//     万一仍没赶上（第二次 Ctrl+C、浏览器卡住），收尾（teardown.mjs）和下次启动（ext.ensureExtensionUp）还会经详情页再启用；
// (c)(e) 撤销左/右侧授权：脚本撤销、脚本触发；恢复时重新申请（之前授权过，Chrome 直接批准、不弹框）；
// (d) 站点访问“点击时”：读详情页结构，本扩展只有逐站开关、没有“点击时”下拉 → 记“不适用”。
// (a)(b)(d) 的自动版本遇到测试设施问题（kind "infra"）时，引导式运行回退到 t8-manual.mjs 的人工版本，--auto-only 判跳过。
import { GRANT_ORIGINS, HOSTS } from "../config.mjs";
import { splitPairs, trigger, engineA, nonce, resetTabs, openTab, waitState, pageTargets, summarize, sleep, GO_PREFIX } from "./util.mjs";
import { extAlive, extTargets, contains, requestGrant, abortable, GRANT_TIMEOUT_MS } from "./guided.mjs";
import { openDetails, withDetails, onClickVerdict, ensureEnabled, waitAlive, infra } from "../ext-webui.mjs";
import { SETTLE_MS, sub, expectPlain, incognitoManual, disabledManual, onClickManual } from "./t8-manual.mjs";

const origin = (ctx, h) => `http://${h}:${ctx.port}/*`;
const stopped = ctx => !!(ctx.signal?.aborted || ctx.abortSignal?.aborted);

// 自动版本做不了（测试设施问题）时：引导式运行改由人工完成，--auto-only 判跳过
export async function autoOr(ctx, auto, manual) {
  try { return await auto(); }
  catch (e) {
    if (e?.kind !== "infra") throw e;
    if (ctx.autoOnly || ctx.signal?.aborted) return { status: "skip", detail: `自动版本做不了：${e.message}（测试设施问题，--auto-only 不回退到人工）` };
    const r = await manual();
    return { ...r, detail: `${r.detail}（自动版本做不了：${e.message}，改由人工完成）` };
  }
}

// 纯逻辑：无痕上下文里那个标签的判定。o: { url（触发网址）, ctxId, target: { url, browserContextId } | null,
// history: string[] | null（主框架导航记录）, right: string[]（右侧引擎页面）, splits（普通窗口里的分屏数）}
export function otrVerdict({ url, ctxId, target, history, right = [], splits = 0 }) {
  const problems = [];
  if (!target) problems.push("无痕窗口里的触发标签不见了");
  else {
    if (target.browserContextId !== ctxId) problems.push("触发标签不在新建的无痕上下文里");
    if (target.url.startsWith(GO_PREFIX)) problems.push("被重定向到了 go.html");
    else if (target.url !== url) problems.push(`网址变了：${target.url}`);
  }
  if (!history) problems.push("读不到无痕标签的导航记录");
  else {
    if (history.some(u => u.startsWith(GO_PREFIX))) problems.push(`导航记录里有 go.html：${history.join(" → ")}`);
    if (history.at(-1) !== url) problems.push(`导航记录最后一条应是触发网址，实际 ${history.at(-1) ?? "（空）"}`);
  }
  if (right.length) problems.push(`出现了右侧引擎页面：${right.join("、")}`);
  if (splits) problems.push(`不应分屏，实际 ${splits} 个分屏`);
  return problems.length ? { status: "fail", detail: problems.join("；") }
    : { status: "pass", detail: `无痕（CDP off-the-record 上下文）里是普通左侧搜索，未分屏，导航记录 ${history.length} 条、没有 go.html：${url}` };
}

// 纯逻辑：前提核对。扩展详情页的“在无痕模式下启用”（incognitoAccess）必须没打开，否则测的不是用户默认看到的行为。
// 返回 { fail?, note }；读不到（详情页打不开）不判失败，只在说明里注明
export function incognitoPrecondition(access) {
  if (access?.error) return { note: `（未能读取详情页的“在无痕模式下启用”：${access.error}）` };
  if (!access || typeof access.isActive !== "boolean") return { note: "（详情页没有给出“在无痕模式下启用”的状态）" };
  if (access.isActive) return { fail: "前提不成立：测试配置里打开了扩展的“在无痕模式下启用”，与 manifest 的 incognito: not_allowed 不符，这一项测的不是用户看到的行为" };
  return { note: `（详情页确认“在无痕模式下启用”未打开${access.isEnabled ? "" : "，也打不开：manifest incognito: not_allowed"}）` };
}

async function incognitoAuto(ctx) {
  const { client } = ctx.browser;
  const pre = incognitoPrecondition(await withDetails(ctx.browser, p => p.incognito()).catch(e => ({ error: e.message })));
  if (pre.fail) return { status: "fail", detail: pre.fail };
  await resetTabs(ctx);
  let ctxId;
  try { ({ browserContextId: ctxId } = await client.send("Target.createBrowserContext", {})); }
  catch (e) { throw infra(`建不了无痕（off-the-record）浏览器上下文：${e.message}`); }
  try {
    const url = trigger(ctx.port, `t8a+${nonce()}`);
    const { targetId } = await client.send("Target.createTarget", { url, browserContextId: ctxId, newWindow: true, background: true });
    await sleep(SETTLE_MS);
    const pages = await pageTargets(ctx.browser);
    const t = pages.find(x => x.targetId === targetId);
    let history = null;
    if (t) {
      const sid = await ctx.browser.attach(targetId);
      try { history = (await client.send("Page.getNavigationHistory", {}, sid)).entries.map(e => e.url); }
      catch { history = null; }
      finally { await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {}); }
    }
    const right = pages.filter(x => x.url.startsWith(`http://${HOSTS.b}:${ctx.port}/`)).map(x => x.url);
    const splits = splitPairs(await ctx.ext.state()).length;
    const v = otrVerdict({ url, ctxId, target: t && { url: t.url, browserContextId: t.browserContextId }, history, right, splits });
    return { ...v, detail: `${v.detail}${pre.note}` };
  } finally {
    await client.send("Target.disposeBrowserContext", { browserContextId: ctxId }).catch(() => {});
  }
}

// 停用期间的检查：扩展的页面和 SW 目标随停用消失（只读 CDP 目标），触发网址是普通搜索（只凭 CDP 判）
async function disabledChecks(ctx) {
  const left = () => extTargets(ctx.browser);
  const gone = await ctx.browser.waitFor(async () => (await left()).length === 0, { timeoutMs: 3000, intervalMs: 200 }).then(() => true, () => false);
  if (!gone) return { status: "fail", detail: `详情页读回已停用，但扩展的页面/Service Worker 仍在：${(await left()).map(t => `${t.type} ${t.url}`).join("、")}` };
  return expectPlain(ctx, `t8b+${nonce()}`, { useExt: false });
}

// deps 可注入，便于单测
export async function disabledAuto(ctx, { open = openDetails, check = disabledChecks, enable = ensureEnabled,
  alive = () => extAlive(ctx.browser), reset = resetTabs } = {}) {
  await reset(ctx);
  const page = await open(ctx.browser);
  let r, how;
  try {
    await page.setEnabled(false);
    ctx.log?.("  T8(b)：扩展已停用（经详情页开关），检查期间被中断也会立即重新启用");
    r = await abortable(ctx, check(ctx));
  } catch (e) {
    if (!stopped(ctx)) throw e;
    r = { status: "skip", detail: "停用期间运行被中断" };
  } finally {
    how = await page.setEnabled(true).catch(e => `详情页开关失败：${e.message}`);
    await page.close();
    ctx.log?.(`  T8(b)：重新启用扩展：${how}`);
  }
  const via = { toggle: "详情页开关", management: "chrome.management.setEnabled 兜底", unchanged: "已是启用" }[how];
  // 中断：不再等扩展页能执行脚本（收尾要在期限内结束），重新启用没成功时收尾和下次启动还会再试
  if (stopped(ctx)) return { ...r, detail: `${r.detail}；${via ? `已重新启用（${via}）` : `重新启用没成功（${how}），收尾时会再经详情页启用`}` };
  let ok = await waitAlive(alive);
  if (!ok) ok = (await enable(ctx.browser)) && (await waitAlive(alive));
  if (!ok) return { status: "fail", detail: `${r.detail}；但扩展没有重新启用（${how}），后续步骤会失败` };
  return { ...r, detail: `经扩展详情页开关停用（读回 DISABLED）后：${r.detail}；已重新启用（${via ?? how}）` };
}

async function onClickAuto(ctx) {
  const v = onClickVerdict(await withDetails(ctx.browser, p => p.siteAccess()));
  if (!v.applicable) return { status: "skip", detail: v.detail };
  if (ctx.autoOnly) return { status: "skip", detail: `${v.detail}；--auto-only 不改站点访问，留给引导式运行人工验证` };
  return onClickManual(ctx);
}

// (e) 先只撤销右侧 eb：仍分屏；(c) 再撤销左侧 ea：不分屏；最后一次申请恢复两者
async function revoke(ctx) {
  const [A, B] = [origin(ctx, HOSTS.a), origin(ctx, HOSTS.b)];
  const items = [];
  try {
    await resetTabs(ctx);
    await ctx.ext.eval(`chrome.permissions.remove({ origins: [${JSON.stringify(B)}] })`);
    items.push(await sub("(e) 只撤销右侧 engine-b", async () => {
      const q = `t8e+${nonce()}`;
      await openTab(ctx, trigger(ctx.port, q));
      const p = await waitState(ctx, st => splitPairs(st).find(([l]) => l.url === engineA(ctx.port, q)), `左侧 ${engineA(ctx.port, q)} 的分屏`);
      return { status: "pass", detail: `仍然分屏：左 ${p[0].url}，右侧标签 ${p[1].id}（未授权，网址读不到）` };
    }));
    await resetTabs(ctx);
    await ctx.ext.eval(`chrome.permissions.remove({ origins: [${JSON.stringify(A)}] })`);
    items.push(await sub("(c) 撤销左侧 engine-a", () => expectPlain(ctx, `t8c+${nonce()}`)));
  } finally {
    if (!ctx.signal?.aborted) {
      const ok = await requestGrant(ctx, [A, B], { title: "T8 恢复授权", why: "(c)(e) 做完了，需要恢复两个模拟引擎的授权。" }).catch(() => false);
      items.push({ name: "恢复模拟引擎授权", status: ok ? "pass" : "fail", detail: ok ? "已恢复（重新申请，Chrome 直接批准）" : "没有恢复（被拒绝或超时），后续步骤会失败" });
    }
  }
  return items;
}

export const T8 = {
  id: "T8", title: "优雅降级：无痕、停用扩展、撤销授权、站点访问“点击时”（自动）", kind: "auto", needs: [], timeoutFactor: 16,
  restores: true, timeoutExtraMs: 2 * GRANT_TIMEOUT_MS, cleanup: ["access"],
  async run(ctx) {
    const items = [
      await sub("(a) 无痕窗口", () => autoOr(ctx, () => incognitoAuto(ctx), () => incognitoManual(ctx))),
      await sub("(b) 停用扩展", () => autoOr(ctx, () => disabledAuto(ctx), () => disabledManual(ctx))),
    ];
    // 被中断后不再撤销授权、不再开详情页：运行器已在收尾，后面这些只会和恢复 storage 并发
    if (!stopped(ctx)) items.push(...await revoke(ctx));
    if (!stopped(ctx)) items.push(await sub("(d) 站点访问“点击时”", () => autoOr(ctx, () => onClickAuto(ctx), () => onClickManual(ctx))));
    if (stopped(ctx)) return summarize(items);
    // 收尾核对：后面的步骤依赖扩展启用且授权齐全。授权不全时先申请一次再判
    const alive = await extAlive(ctx.browser);
    const has = async () => (await contains(ctx.browser, GRANT_ORIGINS(ctx.port)).catch(() => false)) === true;
    let full = alive && await has();
    if (alive && !full && !ctx.signal?.aborted) {
      await requestGrant(ctx, GRANT_ORIGINS(ctx.port), { title: "T8 恢复授权", why: "T8 各项做完后一次性授权不完整。" }).catch(() => false);
      full = await has();
    }
    if (!full) items.push({ name: "收尾核对", status: "fail", detail: alive ? "一次性授权不完整" : "扩展不可用（未启用？）" });
    // 顺序与清单一致：(a)(b)(c)(d)(e)
    const order = n => "abcde".indexOf(n[1]) + (n.startsWith("(") ? 0 : 10);
    return summarize(items.sort((x, y) => order(x.name) - order(y.name)));
  },
};
