// 引导式运行的准备与收尾：打开向导页、安装引导（记 B1）、一次性授权、Kagi 登录检查、
// 恢复测试浏览器设置的收尾提示。chrome://settings 一律只给说明，由用户手动改。
import { EXT_ID, GRANT_ORIGINS } from "../config.mjs";
import { SRC_DIR } from "../ext.mjs";
import { evalIn } from "./util.mjs";
import { userWait, assist, guideUrl, extTargets, extAlive, contains, requestGrant, focusGuide } from "./guided.mjs";

const OPT_URL = `chrome-extension://${EXT_ID}/options/options.html`;
export const KAGI_HOME = "https://kagi.com/";

export async function openGuide(browser, port) {
  await browser.client.send("Target.createTarget", { url: guideUrl(port) });
}

// 安装或重新启用之后要判断的纯逻辑：B1 只在“本次首次加载”时验证
export function b1Verdict({ fresh, optionsOpened, id }) {
  if (!fresh) return { status: "skip", detail: "扩展原本已登记（本次只是重新启用），不是首次加载，B1 不适用" };
  if (id !== EXT_ID) return { status: "fail", detail: `加载后的扩展 ID 是 ${id ?? "（读不到）"}，应为 ${EXT_ID}` };
  if (!optionsOpened) return { status: "fail", detail: "首次加载后 10 秒内没有自动打开设置页" };
  return { status: "pass", detail: `首次加载后自动打开了设置页，扩展 ID 为 ${EXT_ID}` };
}

const installText = ens => (ens.hint
  ? [`测试浏览器里已经登记了 Split Search，但它目前不可用（${ens.hint}）。`,
    "1. 在已打开的 chrome://extensions 标签里找到 Split Search；",
    "2. 打开它右下角的开关（启用）。", "启用后脚本自动继续。"]
  : ["测试浏览器里还没有安装 Split Search，需要做一次（之后的运行不用再做）：",
    "1. 切到已打开的 chrome://extensions 标签，打开右上角的“开发者模式”；",
    "2. 点“加载已解压的扩展程序”，选择下面这个目录（可复制）：", `   ${SRC_DIR}`,
    `3. 加载后扩展 ID 应为 ${EXT_ID}，并会自动打开设置页（这就是 B1 的检查）。`,
    "脚本检测到扩展后自动继续；点“跳过”则结束本次运行。"]).join("\n");

// 未安装（或已登记但不可用）时的引导。返回 { ok, b1?, detail? }
export async function installGuide(ctx, ens) {
  const { browser } = ctx;
  // ensureExtension 试过打开设置页，留下的错误页会被误当成“已出现的扩展页”，先关掉
  for (const t of await extTargets(browser)) {
    if (t.type === "page") await browser.client.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  }
  await browser.client.send("Target.createTarget", { url: "chrome://extensions/" });
  await focusGuide(ctx);
  const fresh = !ens.hint;
  const r = await userWait(ctx, {
    title: fresh ? "准备：安装扩展（一次性）" : "准备：启用扩展", what: "扩展出现", hint: null,
    instruction: installText(ens), copyText: SRC_DIR, timeoutMs: (ctx.timeoutMs ?? 120000) * 5,
    probe: async () => (await extTargets(browser)).some(t => t.type === "service_worker" || t.type === "page"),
  });
  if (r.kind !== "met") return { ok: false, detail: r.kind === "answer" ? "用户跳过了安装引导" : "等待安装超时" };
  // onInstalled(reason=install) 会自动打开设置页：只看目标列表，不自己创建
  const optionsOpened = await browser.waitFor(async () => (await browser.targets()).some(t => t.type === "page" && t.url.startsWith(OPT_URL)),
    { timeoutMs: 10000, intervalMs: 300 }).then(() => true, () => false);
  let id = null;
  try { id = await browser.waitFor(() => browser.evalExt("chrome.runtime.id", { timeoutMs: 3000 }), { timeoutMs: 30000, intervalMs: 500 }); }
  catch { id = null; }
  const b1 = b1Verdict({ fresh, optionsOpened, id });
  return { ok: id === EXT_ID, b1, detail: id === EXT_ID ? "" : `扩展 ID 不对或扩展页打不开（${id ?? "读不到"}）` };
}

// 一次性授权。auto-only 不能弹框，只报缺失。返回 { ok, requested, detail }
export async function ensureGrants(ctx, { autoOnly }) {
  const origins = GRANT_ORIGINS(ctx.port);
  if ((await contains(ctx.browser, origins)) === true) return { ok: true, requested: false, detail: "授权已齐全" };
  if (autoOnly) return { ok: false, requested: false, detail: "测试配置缺少一次性授权（模拟引擎与五个预置引擎的网站）" };
  await focusGuide(ctx);
  const ok = await requestGrant(ctx, origins, { title: "准备：一次性授权", why: "需要授权模拟引擎和五个预置引擎的网站（授权保存在测试配置里，只需一次）。" });
  return { ok, requested: true, detail: ok ? "已授权" : "授权未完成（被拒绝或超时），相关步骤会失败" };
}

// ---- Kagi 登录（只在 needs 含 "kagi" 的步骤前检查）----
export const isSignin = href => { try { return new URL(href).pathname.startsWith("/signin"); } catch { return false; } };
const isKagi = href => { try { return new URL(href).hostname === "kagi.com"; } catch { return false; } };

export async function ensureKagi(ctx) {
  const { client } = ctx.browser;
  const { targetId } = await client.send("Target.createTarget", { url: KAGI_HOME });
  // 新目标先是 about:blank（readyState 也是 complete），只认 kagi.com 上加载完成的页面
  const href = async () => {
    const h = await evalIn(ctx, targetId, `document.readyState === "complete" ? location.href : ""`);
    return isKagi(h) ? h : "";
  };
  try {
    let now;
    try { now = await ctx.browser.waitFor(href, { timeoutMs: 30000, intervalMs: 500 }); }
    catch (e) { return { status: "fail", detail: `打不开 ${KAGI_HOME}：${e.message}` }; }
    if (!isSignin(now)) return null;
    const r = await assist(ctx, {
      title: "准备：登录 Kagi", what: "Kagi 登录完成", hint: null, label: "Kagi 登录",
      instruction: "这一步要用到已登录的 Kagi。请切到刚打开的 kagi.com 标签登录（只登录 kagi.com，不要登录 Chrome 账号）。\n"
        + "登录信息只保存在测试配置里，下次运行不用再登。登录完成后脚本自动继续。",
      timeoutMs: (ctx.timeoutMs ?? 120000) * 3,
      probe: async () => { const h = await href(); return h && !isSignin(h); },
    });
    return r.status === "pass" ? null : { status: r.status, detail: `Kagi 未登录：${r.detail}` };
  } finally {
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
    await focusGuide(ctx).catch(() => {});
  }
}

// 把 needs 含 "kagi" 的步骤包一层：先确认 Kagi 已登录
export function withNeeds(step) {
  if (!step.needs?.includes("kagi")) return step;
  // 登录可能要等用户几分钟（ensureKagi 最多等 3 倍单步超时），步骤上限相应放宽
  return { ...step, timeoutFactor: (step.timeoutFactor ?? 1) + 3, async run(ctx) { return (await ensureKagi(ctx)) ?? step.run(ctx); } };
}

// ---- 收尾：恢复测试浏览器的搜索设置（只在测试配置里，但保持整洁）----
const CLEANUP = {
  default: "把默认搜索引擎改回 Google：chrome://settings/searchEngines →“搜索引擎”里 Google 右侧 ⋮ →“设为默认”（不能删除正在用作默认的条目，所以先做这一步）",
  gb: "删除网站搜索 gb：“网站搜索”里 gb 右侧 ⋮ →“删除”",
  t14: "删除网站搜索 bg、dg、px、kg（T14 添加的）",
  t12: "编辑 Chrome 自动发现的 Kagi 条目，把网址末尾追加的 &_ss=kagi,bing 删掉后保存",
  access: "如果 T8 里把扩展的“网站访问权限”改成了“点击时”，确认已改回",
};
export function cleanupItems(steps) {
  const want = new Set(steps.flatMap(s => s.cleanup ?? []));
  return Object.keys(CLEANUP).filter(k => want.has(k)).map(k => CLEANUP[k]);
}

export async function cleanupPrompt(ctx, steps) {
  const items = cleanupItems(steps);
  if (!items.length) return null;
  const text = items.map((t, i) => `${i + 1}. ${t}`).join("\n");
  ctx.log?.(`\n收尾：请在测试浏览器里恢复这些设置（只影响测试配置）：\n${text}`);
  await focusGuide(ctx).catch(() => {});
  const r = await userWait(ctx, {
    title: "收尾：恢复测试浏览器的搜索设置", what: "用户确认已恢复", hint: null, buttons: ["done", "skip"],
    instruction: `这些改动只在测试配置里，但请恢复原样，免得影响下次运行：\n${text}\n\n做完点“我已完成”。`,
    copyText: "chrome://settings/searchEngines", timeoutMs: (ctx.timeoutMs ?? 120000) * 3,
  });
  return r.kind === "answer" && r.answer === "done" ? "收尾：用户已确认恢复搜索设置" : `收尾：用户未确认恢复搜索设置（${items.length} 项，见终端）`;
}

export const B1 = {
  id: "B1", title: "首次加载：自动打开设置页，扩展 ID 正确", kind: "assist", needs: [],
  async run(ctx) {
    if (ctx.install?.b1) return ctx.install.b1;
    return { status: "skip", detail: "本次运行前扩展已安装，B1 只在首次“加载已解压”时验证（删掉测试配置里的扩展后重跑可复测）" };
  },
};
