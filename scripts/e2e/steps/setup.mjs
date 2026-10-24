// 引导式运行的准备与收尾：打开向导页、安装引导（记 B1）、一次性授权、Kagi 登录检查、
// 恢复测试浏览器设置的收尾提示。chrome://settings 一律只给说明，由用户手动改。
import { EXT_ID, GRANT_ORIGINS } from "../config.mjs";
import { SRC_DIR } from "../ext.mjs";
import { evalIn } from "./util.mjs";
import { userWait, guideUrl, extTargets, extAlive, contains, requestGrant, focusGuide } from "./guided.mjs";
import { L } from "./labels.mjs";

const OPT_URL = `chrome-extension://${EXT_ID}/options/options.html`;

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
    "2. 打开它卡片右下角的开关（启用；英文界面同一位置的开关）。", "启用后脚本自动继续。"]
  : ["测试浏览器里还没有安装 Split Search，需要做一次（之后的运行不用再做）：",
    `1. 切到已打开的 chrome://extensions 标签，打开右上角的${L.devMode}；`,
    `2. 点${L.loadUnpacked}，选择下面这个目录（可复制）：`, `   ${SRC_DIR}`,
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
  // 授权框 5 分钟没人点（或运行被中断）不抛出，按“授权未完成”提示并写进备注
  const ok = await requestGrant(ctx, origins, { title: "准备：一次性授权", why: "需要授权模拟引擎和五个预置引擎的网站（授权保存在测试配置里，只需一次）。" })
    .catch(() => false);
  return { ok, requested: true, detail: ok ? "已授权" : "授权未完成（被拒绝或超时），相关步骤会失败" };
}

// ---- Kagi 登录（只在 needs 含 "kagi" 的步骤前检查）----
// 实测（审阅时用 curl 核对）：未登录时 kagi.com/ 照常 200，/settings 会经 /signin → /oauth2 跳到
// account.kagi.com/loginname…，/search 会 302 到 /turnstile。所以探测 /settings：只有最终停在
// kagi.com 的 /settings 才算已登录，其余（account.kagi.com、/signin、/turnstile、别的）都算未登录
export const KAGI_PROBE = "https://kagi.com/settings";
export function kagiLoggedIn(href) {
  try { const u = new URL(href); return u.hostname === "kagi.com" && u.pathname.startsWith("/settings"); }
  catch { return false; }
}

// 开一个后台标签打开 /settings，等它加载完（新目标先是 about:blank，跳过），返回最终网址后关掉。
// 只在开始时和用户点“我已完成”之后各做一次：未登录时这条跳转链会重写 Kagi 的会话 cookie（OAuth state），
// 用户登录期间反复探测可能让登录失败
export async function probeKagi(ctx) {
  const { client } = ctx.browser;
  const { targetId } = await client.send("Target.createTarget", { url: KAGI_PROBE, background: true });
  try {
    return await ctx.browser.waitFor(async () => {
      const h = await evalIn(ctx, targetId, `document.readyState === "complete" ? location.href : ""`);
      return h && h !== "about:blank" ? h : "";
    }, { timeoutMs: 30000, intervalMs: 500 });
  } finally { await client.send("Target.closeTarget", { targetId }).catch(() => {}); }
}

// 登录等待期间的检查：不发起任何导航，只看现有页面的网址（Target.getTargets）。
// 优先看给用户打开的登录标签，用户换了标签登录也认。目标网址可能是尚未提交的导航网址，
// 所以看起来已登录时再读一次页面里的 location.href（已提交的网址）确认
async function kagiTabLoggedIn(ctx, loginTargetId) {
  const pages = (await ctx.browser.client.send("Target.getTargets")).targetInfos.filter(t => t.type === "page");
  const hits = pages.filter(t => kagiLoggedIn(t.url)).sort((a, b) => (b.targetId === loginTargetId) - (a.targetId === loginTargetId));
  for (const t of hits) {
    const h = await evalIn(ctx, t.targetId, `document.readyState === "complete" ? location.href : ""`).catch(() => "");
    if (kagiLoggedIn(h)) return h;
  }
  return false;
}

const KAGI_TEXT = "这一步要用到已登录的 Kagi。请切到刚打开的 Kagi 登录页登录（只登录 Kagi，不要登录 Chrome 账号）。\n"
  + "登录信息只保存在测试配置里，下次运行不用再登。登录后页面回到 Kagi 设置页时脚本自动继续；"
  + "如果登录后停在了别的页面，回到这里点“我已完成”，脚本再检查一次。";

// deps 可注入，便于单测：probe（开后台标签探测，最终网址）、tabLoggedIn（只看现有标签）、wait（userWait）
export async function ensureKagi(ctx, { probe = probeKagi, tabLoggedIn = kagiTabLoggedIn, wait = userWait } = {}) {
  let first;
  try { first = await probe(ctx); }
  catch (e) { return { status: "fail", detail: `打不开 ${KAGI_PROBE}：${e.message}` }; }
  if (kagiLoggedIn(first)) return null;
  const { client } = ctx.browser;
  const { targetId } = await client.send("Target.createTarget", { url: KAGI_PROBE }).catch(() => ({}));
  const limit = (ctx.timeoutMs ?? 120000) * 3;
  const end = Date.now() + limit;
  let note = "";
  try {
    for (;;) {
      const r = await wait(ctx, {
        title: "准备：登录 Kagi", what: "Kagi 登录完成", hint: null, buttons: ["done", "skip"], intervalMs: 1000,
        instruction: note + KAGI_TEXT, timeoutMs: Math.max(1000, end - Date.now()),
        probe: () => tabLoggedIn(ctx, targetId),
      });
      if (r.kind === "met") { ctx.guide.setResult?.("Kagi 登录", "pass", "已登录"); return null; }
      if (r.kind === "timeout") return { status: "fail", detail: `Kagi 未登录：${Math.round(limit / 1000)} 秒内未等到登录完成` };
      if (r.answer !== "done") return { status: "skip", detail: "Kagi 未登录：用户点了“跳过”" };
      // 用户说做完了：探测一次（这时开后台标签不会打断登录）
      const href = await probe(ctx).catch(e => `（打不开：${e.message}）`);
      if (kagiLoggedIn(href)) { ctx.guide.setResult?.("Kagi 登录", "pass", "已登录（用户确认后复查）"); return null; }
      if (Date.now() >= end) return { status: "fail", detail: `Kagi 未登录：用户点了“我已完成”，但复查时 ${KAGI_PROBE} 最终停在 ${href}` };
      note = `⚠ 复查仍未登录：${KAGI_PROBE} 最终停在 ${href}。请在登录页完成登录后再点“我已完成”。\n\n`;
    }
  } finally {
    if (targetId) await client.send("Target.closeTarget", { targetId }).catch(() => {});
    await focusGuide(ctx).catch(() => {});
  }
}

// 自动步骤（T9、xauto 的 T12）用：已登录返回 null；否则返回跳过/失败的结果。
// --auto-only 只探测一次、不等人，没登录就跳过；引导式运行按 ensureKagi 请用户登录
export async function kagiGate(ctx, { probe = probeKagi, ensure = ensureKagi } = {}) {
  if (!ctx.autoOnly) return ensure(ctx);
  const href = await probe(ctx).catch(e => `（打不开：${e.message}）`);
  return kagiLoggedIn(href) ? null
    : { status: "skip", detail: `Kagi 未登录（${KAGI_PROBE} 最终停在 ${href}）；--auto-only 不等登录，请先在引导式运行（npm run e2e）里登录 Kagi` };
}

// 把 needs 含 "kagi" 的步骤包一层：先确认 Kagi 已登录
export function withNeeds(step) {
  if (!step.needs?.includes("kagi")) return step;
  // 登录可能要等用户几分钟（ensureKagi 最多等 3 倍单步超时），步骤上限相应放宽
  return { ...step, timeoutFactor: (step.timeoutFactor ?? 1) + 3, async run(ctx) { return (await ensureKagi(ctx)) ?? step.run(ctx); } };
}

// ---- 收尾：恢复测试浏览器的搜索设置（只在测试配置里，但保持整洁）----
// 测试期间加的网站搜索（gb/bg/dg/px/kg）、默认引擎、Kagi 条目的 _ss 只在隔离的测试配置里，保留即可，下次运行会复用；
// 唯一要用户改回的是 T8(d) 在 assist 回退路径里改过的“站点访问”（没做到 (d) 或 (d) 跳过就不提）
const FIXTURE_TAGS = new Set(["default", "gb", "t14", "t12"]);
export const FIXTURES_NOTE = "测试期间加的网站搜索和默认引擎只在测试配置里，保留即可，下次运行会复用。";
const ACCESS = `如果 T8 里把扩展的${L.siteAccess}改成了${L.onClick}，确认已改回${L.onSpecific}`;
// 只有 T8 正常结束（有“共 N 项”汇总首行）且 (d) 行是跳过或没有时才不提示；缺结果、中断/超时/异常、(d) 通过或失败都提示
const dSkipped = r => {
  const d = r?.detail ?? "";
  if (!/^共 \d+ 项/.test(d)) return false;
  const line = d.split("\n").find(l => l.startsWith("(d)"));
  return !line || /^\(d\)[^\n]*?：跳过——/.test(line);
};
export function cleanupItems(steps, results = null) {
  if (!steps.some(s => s.cleanup?.includes("access"))) return [];
  const t8 = results?.find(r => r.id === "T8");
  return dSkipped(t8) ? [] : [ACCESS];
}
export const cleanupNote = steps => (steps.some(s => s.cleanup?.some(k => FIXTURE_TAGS.has(k))) ? FIXTURES_NOTE : null);

export const cleanupText = items => items.map((t, i) => `${i + 1}. ${t}`).join("\n");

// 交互式确认（只在正常结束时）。返回 { confirmed, note } 或 null（没有要恢复的项）。
// 清单本身由 run.mjs 在 finally 里打印并写进报告备注（用户已确认时改写成“已由用户确认恢复”）
export async function cleanupPrompt(ctx, steps, results = null) {
  const items = cleanupItems(steps, results);
  if (!items.length) return null;
  const text = cleanupText(items);
  await focusGuide(ctx).catch(() => {});
  const r = await userWait(ctx, {
    title: "收尾：恢复测试浏览器的站点访问设置", what: "用户确认已恢复", hint: null, buttons: ["done", "skip"],
    instruction: `这项改动只在测试配置里，但请恢复原样，免得影响下次运行：\n${text}\n\n做完点“我已完成”。`,
    copyText: "chrome://extensions", timeoutMs: (ctx.timeoutMs ?? 120000) * 3,
  });
  const confirmed = r.kind === "answer" && r.answer === "done";
  return { confirmed, note: confirmed ? "收尾：用户已确认恢复站点访问设置" : `收尾：用户未确认恢复站点访问设置（${items.length} 项，见终端）` };
}

export const B1 = {
  id: "B1", title: "首次加载：自动打开设置页，扩展 ID 正确", kind: "assist", needs: [], noDiag: true,
  async run(ctx) {
    if (ctx.install?.b1) return ctx.install.b1;
    return { status: "skip", detail: "本次运行前扩展已安装，B1 只在首次“加载已解压”时验证（删掉测试配置里的扩展后重跑可复测）" };
  },
};
