// T8 优雅降级：(a) 无痕窗口 judge；(b) 停用扩展 assist；(c)(e) 撤销左/右侧授权（脚本撤销、脚本触发、用户点允许恢复）；
// (d) 站点访问“点击时” judge + 脚本验证。模拟引擎 ea | eb；每项做完先恢复再做下一项。
import { EXT_ID, GRANT_ORIGINS, HOSTS } from "../config.mjs";
import { splitPairs, trigger, engineA, nonce, resetTabs, openTab, waitState, pageTargets, summarize, sleep, GO_PREFIX } from "./util.mjs";
import { assist, judge, focusGuide, extAlive, contains, requestGrant, GRANT_TIMEOUT_MS } from "./guided.mjs";
import { L } from "./labels.mjs";

const SETTLE_MS = 4000; // 触发后等这么久仍没有跳转/分屏，才判定为“降级为普通搜索”
const DETAILS = `chrome://extensions/?id=${EXT_ID}`;
const origin = (ctx, h) => `http://${h}:${ctx.port}/*`;
const sub = async (name, fn) => {
  try { return { name, ...(await fn()) }; } catch (e) { return { name, status: "fail", detail: `异常：${e.message}` }; }
};

// 用 CDP 新开触发网址，等 SETTLE_MS 后只凭 CDP 判断：网址原样保留（带 _ss、没进 go.html），且没有右侧模拟引擎的页面
async function expectPlain(ctx, q, { useExt = true } = {}) {
  const url = trigger(ctx.port, q);
  const { targetId } = await openTab(ctx, url);
  await sleep(SETTLE_MS);
  const pages = await pageTargets(ctx.browser);
  const t = pages.find(x => x.targetId === targetId);
  const problems = [];
  if (!t) problems.push("触发的标签不见了");
  else if (t.url.startsWith(GO_PREFIX)) problems.push("被重定向到了 go.html");
  else if (t.url !== url) problems.push(`网址变了：${t.url}`);
  const right = pages.filter(x => x.url.startsWith(`http://${HOSTS.b}:${ctx.port}/`));
  if (right.length) problems.push(`出现了右侧引擎页面：${right.map(x => x.url).join("、")}`);
  if (useExt) {
    const n = splitPairs(await ctx.ext.state()).length;
    if (n) problems.push(`不应分屏，实际 ${n} 个分屏`);
  }
  return problems.length ? { status: "fail", detail: problems.join("；") } : { status: "pass", detail: `普通左侧搜索，未分屏：${url}` };
}

// 脚本看不到无痕窗口（扩展不在那里运行），只能由用户判断；没人作答就按 judge 的超时判失败
export const INCOGNITO_TEXT = "这一项只能你来判断，脚本不会自动继续：看完后必须回到这里点“通过”或“不通过”（做不了点“跳过”）。\n"
  + "1. 按 Ctrl+Shift+N 打开无痕窗口；\n2. 在无痕窗口的地址栏输入“gb 无痕测试”回车（gb 是 T1 添加的网站搜索）；\n"
  + "3. 看结果：应是一次普通的 Google 搜索，不分屏、不出错误页。无痕窗口里扩展不运行，Google 收到 `_ss` 是正常的"
  + "（地址栏里能看到 _ss=google,bing，这就是预期的降级，不算失败）；Google 弹出人机验证页也不算失败；\n"
  + "4. 关掉无痕窗口，回到这里：是普通搜索点“通过”，分屏了或出了错误页点“不通过”。";
const incognito = ctx => sub("(a) 无痕窗口", () => judge(ctx, {
  title: "T8(a) 无痕窗口（看完请点“通过”或“不通过”）", copyText: "gb 无痕测试", timeoutMs: ctx.timeoutMs * 2,
  instruction: INCOGNITO_TEXT,
  passDetail: "用户判断：通过（无痕窗口里是普通 Google 搜索，带 _ss，属预期降级）",
  failDetail: "用户判断：不通过（无痕窗口里分屏了或出了错误页）",
}));

const disabled = ctx => sub("(b) 停用扩展", async () => {
  await resetTabs(ctx);
  await focusGuide(ctx);
  const off = await assist(ctx, {
    title: "T8(b) 停用扩展", what: "扩展已停用", copyText: "chrome://extensions", hint: null,
    instruction: "新开一个标签打开 chrome://extensions，把 Split Search 卡片右下角的开关关掉（停用，英文界面同一位置的开关）。\n脚本检测到停用后会自己打开一个测试网址，然后请你重新启用。",
    probe: async () => !(await extAlive(ctx.browser)) && !(await extAlive(ctx.browser)), // 连续两次不可用才算，避免偶发失败误判
  });
  if (off.status !== "pass") return off;
  const r = await expectPlain(ctx, `t8b+${nonce()}`, { useExt: false });
  await focusGuide(ctx);
  const on = await assist(ctx, {
    title: "T8(b) 重新启用", what: "扩展已重新启用", copyText: "chrome://extensions", hint: null, timeoutMs: ctx.timeoutMs * 2,
    instruction: "测试网址已经打开过了。请回到 chrome://extensions，把 Split Search 的开关重新打开（启用）。后面的步骤都依赖它。",
    probe: () => extAlive(ctx.browser),
  });
  if (on.status !== "pass") return { status: "fail", detail: `${r.detail}；但扩展没有重新启用（${on.detail}），后续步骤会失败` };
  return r;
});

// (e) 先只撤销右侧 eb：仍分屏；(c) 再撤销左侧 ea：不分屏；最后一次申请恢复两者（用户点允许）
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
      items.push({ name: "恢复模拟引擎授权", status: ok ? "pass" : "fail", detail: ok ? "已恢复" : "没有恢复（被拒绝或超时），后续步骤会失败" });
    }
  }
  return items;
}

const onClick = ctx => sub("(d) 站点访问“点击时”", async () => {
  await resetTabs(ctx);
  await focusGuide(ctx);
  const has = await judge(ctx, {
    title: "T8(d) 站点访问“点击时（On click）”", copyText: DETAILS, timeoutMs: ctx.timeoutMs * 2, buttons: ["pass", "skip"],
    instruction: `1. 新开一个标签打开下面的扩展详情页；\n2. 看${L.siteAccess}里有没有${L.onClick}这个选项；\n`
      + `3. 有：选${L.onClick}，然后回来点“通过”，脚本会自己触发一次；没有：点“跳过”（记为不适用）。`,
    passDetail: "有“点击时”选项，已选中", skipDetail: "扩展详情页没有“点击时”选项，不适用",
  });
  if (has.status !== "pass") return has;
  const r = await expectPlain(ctx, `t8d+${nonce()}`);
  await focusGuide(ctx);
  const origins = GRANT_ORIGINS(ctx.port);
  const back = await assist(ctx, {
    title: "T8(d) 改回站点访问", what: "授权恢复", copyText: DETAILS, hint: null, timeoutMs: ctx.timeoutMs * 2,
    instruction: `测试网址已经触发过了。请在扩展详情页把${L.siteAccess}改回你原来的选项——通常是${L.onSpecific}`
      + "（列着 engine-a/b/c、site-x 这几个 localhost 和 google、bing、kagi、duckduckgo、perplexity）。\n"
      + `不要选${L.onAll}：那会授予 https://*/*，之后撤销单个网站的授权就不起作用了。\n`
      + `脚本检测到授权恢复后自动继续；改回后仍没反应，点“跳过”，脚本会弹出授权框请你点${L.allow}。`,
    probe: () => contains(ctx.browser, origins),
  });
  if (back.status !== "pass" && !ctx.signal?.aborted) {
    const ok = await requestGrant(ctx, origins, { title: "T8 恢复授权", why: "改回站点访问后授权仍不完整。" }).catch(() => false);
    if (!ok) return { status: "fail", detail: `${r.detail}；但授权没有恢复，后续步骤会失败` };
  }
  const wide = await noWildcard(ctx);
  if (wide.status !== "pass") return { status: "fail", detail: `${r.detail}；${wide.detail}` };
  return { ...r, detail: `${has.detail}；${r.detail}` };
});

// 授权里不能留着通配（“在所有网站上”会授予 https://*/* 或 http://*/*）；有就请用户改回“在特定网站上”
const WILD = ["https://*/*", "http://*/*", "<all_urls>", "*://*/*"];
const wildcards = async ctx => ((await ctx.ext.eval("chrome.permissions.getAll()"))?.origins ?? []).filter(o => WILD.includes(o));
async function noWildcard(ctx) {
  if (!(await wildcards(ctx)).length) return { status: "pass", detail: "授权里没有通配" };
  await focusGuide(ctx);
  const r = await assist(ctx, {
    title: "T8(d) 去掉“在所有网站上”", what: "授权里不再有 https://*/* 等通配", copyText: DETAILS, hint: null,
    instruction: `扩展现在拥有${L.onAll}的授权（https://*/*）。请在扩展详情页把${L.siteAccess}改成${L.onSpecific}。\n`
      + "改好后脚本自动继续（如果改完缺了某些网站的授权，稍后脚本会弹框请你允许）。",
    probe: async () => !(await wildcards(ctx)).length,
  });
  return r.status === "pass" ? r : { status: "fail", detail: `授权里仍有通配：${(await wildcards(ctx).catch(() => [])).join("、")}` };
}

export const T8 = {
  id: "T8", title: "优雅降级：无痕、停用扩展、撤销授权、站点访问“点击时”", kind: "assist", needs: [], timeoutFactor: 16,
  restores: true, timeoutExtraMs: 2 * GRANT_TIMEOUT_MS, cleanup: ["access"],
  async run(ctx) {
    const items = [await incognito(ctx), await disabled(ctx)];
    items.push(...await revoke(ctx));
    items.push(await onClick(ctx));
    // 收尾核对：后面的步骤依赖扩展启用且授权齐全。授权不全时先按 noWildcard 的说明弹框请用户允许一次再判
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
