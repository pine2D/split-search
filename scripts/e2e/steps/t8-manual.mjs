// T8 的公共工具与人工版本：自动版本（t8.mjs）遇到测试设施问题（详情页打不开、结构认不出、建不了无痕上下文）时，
// 引导式运行回退到这里的 judge/assist 子项；--auto-only 不回退，判跳过。
import { EXT_ID, GRANT_ORIGINS, HOSTS } from "../config.mjs";
import { splitPairs, trigger, nonce, resetTabs, openTab, pageTargets, sleep, GO_PREFIX } from "./util.mjs";
import { assist, judge, focusGuide, extAlive, contains, requestGrant } from "./guided.mjs";
import { L } from "./labels.mjs";

export const SETTLE_MS = 4000; // 触发后等这么久仍没有跳转/分屏，才判定为“降级为普通搜索”
export const DETAILS = `chrome://extensions/?id=${EXT_ID}`;
export const sub = async (name, fn) => {
  try { return { name, ...(await fn()) }; } catch (e) { return { name, status: "fail", detail: `异常：${e.message}` }; }
};

// 用 CDP 新开触发网址，等 SETTLE_MS 后只凭 CDP 判断：网址原样保留（带 _ss、没进 go.html），且没有右侧模拟引擎的页面
export async function expectPlain(ctx, q, { useExt = true } = {}) {
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

// ---- (a) 无痕窗口：用户判断 ----
// 直接粘贴触发网址，不依赖网站搜索 gb（xinput 可用时 T1 走 xauto、只建 sse2e 专用条目，全新测试配置里没有 gb）
export const INCOGNITO_URL = "https://www.google.com/search?q=无痕测试&_ss=google,bing";
export const INCOGNITO_TEXT = "这一项只能你来判断，脚本不会自动继续：看完后必须回到这里点“通过”或“不通过”（做不了点“跳过”）。\n"
  + "1. 按 Ctrl+Shift+N 打开无痕窗口；\n2. 点下面的“复制”，把触发网址粘贴到无痕窗口的地址栏回车（直接用网址，不依赖任何网站搜索）；\n"
  + "3. 看结果：应是一次普通的 Google 搜索，不分屏、不出错误页。无痕窗口里扩展不运行，Google 收到 `_ss` 是正常的"
  + "（地址栏里能看到 _ss=google,bing，这是 G5 规定的正常降级，不算失败）；Google 弹出人机验证页也不算失败；\n"
  + "4. 关掉无痕窗口，回到这里：是普通搜索点“通过”，分屏了或出了错误页点“不通过”。";
export const incognitoManual = ctx => judge(ctx, {
  title: "T8(a) 无痕窗口（看完请点“通过”或“不通过”）", copyText: INCOGNITO_URL, timeoutMs: ctx.timeoutMs * 2,
  instruction: INCOGNITO_TEXT,
  passDetail: "用户判断：通过（无痕窗口里是普通 Google 搜索，带 _ss，属 G5 正常降级）",
  failDetail: "用户判断：不通过（无痕窗口里分屏了或出了错误页）",
});

// ---- (b) 停用扩展：用户操作 chrome://extensions ----
export async function disabledManual(ctx) {
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
}

// ---- (d) 站点访问“点击时”：只在详情页真的有这个选项时才会走到这里（自动版先读了详情页结构）----
export async function onClickManual(ctx) {
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
}

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
