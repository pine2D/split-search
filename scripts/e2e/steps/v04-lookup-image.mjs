// v0.4 步骤 T22（spec 3.14“⑧ 以图搜图”）：page-u 文章页的 http 图片上真实右键点本扩展的菜单项，右侧是模拟以图搜图引擎 ei
// （engine-i.localhost，没有授权：扩展读不到它的网址，一律从 CDP 读）。data: 图片上没有本扩展的菜单项，用项数对比判定。
// 图片上右键前先清掉页面选区：留着选区时选区项和图片项同时命中，Chrome 会把本扩展两项收进子菜单，行号就不对了（S11）。
// Lens、Bing 真实引擎只做人工抽查，不进自动判定。xauto；回退是 assist：向导请用户自己右键，脚本照 (a) 的断言判定。
import { mockImageEngine } from "../config.mjs";
import { expandTemplate } from "../../../src/lib/trigger.js";
import { summarize, waitTarget, evalIn, sleep } from "./util.mjs";
import { guarded } from "./optpage.mjs";
import { verdict, readRecords, checkPairRecords } from "./v03-lib.mjs";
import { assist, focusGuide } from "./guided.mjs";
import { withAttempts, xauto } from "./xauto-lib.mjs";
import { contextMenuCount } from "../gesture-ui.mjs";
import { elementCenter } from "../screen.mjs";
import { msg } from "../i18n.mjs";
import { articleScene, selectIn, clearSelection, cssCenter, screenPoint, pickOurs, pickNote, waitLookup, lookupPair, pageUntouched, item, mock, imgSrc, settleMenu, MENU_SETTLE_MS } from "./v04-lookup-lib.mjs";

const J = JSON.stringify;
const IMAGE_KEYS = ["imageEngines", "imageEngine"];

// 右侧应打开的网址：模拟以图搜图引擎展开 http 图片的网址
const imageRight = port => expandTemplate(mockImageEngine(port).url, imgSrc(port));

// 查询一侧（扩展读不到网址）：CDP 里网址是 right 的页面目标唯一，url 参数与 #got 回显都等于图片网址；返回问题列表
async function imageSideProblems(ctx, right) {
  const src = imgSrc(ctx.port);
  const p = [];
  const t = await waitTarget(ctx, x => x.url === right, right).catch(e => { p.push(e.message); return null; });
  if (!t) return p;
  const got = await ctx.browser.waitFor(async () => (await evalIn(ctx, t.targetId, `document.getElementById("got")?.textContent ?? null`)) ?? undefined,
    { timeoutMs: 5000, intervalMs: 200 }).catch(() => null);
  if (new URL(right).searchParams.get("url") !== src) p.push(`右侧网址的 url 参数应为 ${src}，实际 ${new URL(right).searchParams.get("url")}`);
  if (got !== src) p.push(`engine-i 页面回显应为 ${src}，实际 ${J(got)}`);
  return p;
}

const imageRecords = async (ctx, p, l) => checkPairRecords(await readRecords(ctx, [p.id, l.id]), p, l,
  { mode: "split", splitViewId: p.splitViewId, roles: ["page", "lookup"], input: "image", engines: ["", "ei"], query: imgSrc(ctx.port) });

// 等网页与查询一侧组成分屏，且 CDP 里出现 right（查询一侧没有授权，扩展读不到网址，状态里只看加载完成）
async function waitImagePair(ctx, P, right, okSide = () => true) {
  await waitTarget(ctx, t => t.url === right, right, { timeoutMs: 20000 });
  return waitLookup(ctx, P.id, okSide, `${P.id} 与以图搜图结果 ${right} 组成分屏`);
}

// (a) http 图片：新建查询对。返回 { result, items（当次菜单行数）}
async function httpImage(ctx) {
  const right = imageRight(ctx.port);
  const scene = await articleScene(ctx);
  const { P, mark } = scene;
  await clearSelection(ctx, P.targetId);
  const at = await elementCenter(ctx.browser, P.targetId, "#http-img");
  const items = await pickOurs(ctx, "image", at, scene.wid);
  const [p, l] = await waitImagePair(ctx, P, right);
  const pr = [...await imageSideProblems(ctx, right), ...await pageUntouched(ctx, P, mark), ...await imageRecords(ctx, p, l)];
  return { items, result: verdict(pr, `${pickNote("image", items)}；分屏 ${p.id}｜${l.id}，右侧 ${right}，回显图片网址，网页网址与标记不变`) };
}

// (b) 同一页先查词再查图：复用同一个查询标签，记录 input 变 image；图片上的菜单项数与 (a) 相同（清掉选区后没有子菜单）
async function textThenImage(ctx, aItems) {
  const { port } = ctx;
  const right = imageRight(port);
  const scene = await articleScene(ctx);
  const { P, mark, wid } = scene;
  const s = await selectIn(ctx, P.targetId, { in: "#p1", word: "quick" });
  const n1 = await pickOurs(ctx, "text", await screenPoint(ctx, P.targetId, wid, s, { split: false }), wid);
  const textUrl = expandTemplate(mock(port, "eb").url, "quick");
  const [, l0] = await waitLookup(ctx, P.id, t => t.url === textUrl, `${P.id} 与 ${textUrl} 组成分屏`);
  await clearSelection(ctx, P.targetId);
  const at = await screenPoint(ctx, P.targetId, wid, await cssCenter(ctx, P.targetId, "#http-img"), { split: true });
  const count = await contextMenuCount(ctx, { at, wid });
  const pr = [];
  if (aItems !== null && count !== aItems) pr.push(`清掉选区后图片上的菜单应与 (a) 一样是 ${aItems} 项，实际 ${count} 项`);
  if (pr.length) return verdict(pr, "");
  const n2 = await pickOurs(ctx, "image", at, wid);
  const [p, l] = await waitImagePair(ctx, P, right, t => t.id === l0.id);
  const st = await ctx.ext.state();
  if (st.tabs.some(t => t.url === textUrl)) pr.push(`查词的结果 ${textUrl} 还留在某个标签上`);
  pr.push(...await imageSideProblems(ctx, right), ...await pageUntouched(ctx, P, mark), ...await imageRecords(ctx, p, l));
  return verdict(pr, `查词 ${pickNote("text", n1)}，查询标签 ${l0.id}；图片上 contextMenuCount ${count} 项（与 (a) 相同），查图${pickNote("image", n2)}；`
    + `查询标签 ${l.id} 换成 ${right}，记录 input 变 image，网页网址与标记不变`);
}

// 数 sel 这张图上的菜单项数（先清掉选区）
async function countAt(ctx, scene, sel) {
  await clearSelection(ctx, scene.P.targetId);
  return contextMenuCount(ctx, { at: await elementCenter(ctx.browser, scene.P.targetId, sel), wid: scene.wid });
}

// 数 #http-img、#data-img 上的菜单项数
async function counts(ctx, scene) {
  const out = {};
  for (const sel of ["#http-img", "#data-img"]) out[sel] = await countAt(ctx, scene, sel);
  return out;
}

// (c) data: 图片没有本扩展的菜单项：用基线做差（不假设 Chrome 自带项在两种图片上相同）。
// 先数两张图的项数，扩展页 removeAll 后各数一次，再改一次 imageEngine 又改回触发 rebuildMenus，等 #http-img 的项数回到原值。
// 每次尝试开头先等 #http-img 的项数稳定（等于 (a) 的行数，(a) 没数到时连续两次相同）：上一次尝试可能刚在 finally 里触发重建
async function dataImage(ctx, aItems) {
  const scene = await articleScene(ctx);
  await settleMenu(() => countAt(ctx, scene, "#http-img"), aItems);
  const withMenus = await counts(ctx, scene);
  await ctx.ext.eval("chrome.contextMenus.removeAll().then(() => true)");
  let base;
  try { base = await counts(ctx, scene); }
  finally {
    await ctx.ext.eval(`chrome.storage.sync.set({ imageEngine: "lens" }).then(() => chrome.storage.sync.set({ imageEngine: "ei" })).then(() => true)`);
  }
  const back = await settleMenu(() => countAt(ctx, scene, "#http-img"), withMenus["#http-img"]);
  const pr = [];
  if (back !== withMenus["#http-img"]) pr.push(`改回 imageEngine 后 #http-img 的菜单没回到 ${withMenus["#http-img"]} 项（${back} 项），本扩展菜单项没重建出来`);
  if (withMenus["#http-img"] !== base["#http-img"] + 1) pr.push(`#http-img 有本扩展菜单时应比基线多 1 项：${withMenus["#http-img"]} 对 ${base["#http-img"]}`);
  if (withMenus["#data-img"] !== base["#data-img"]) pr.push(`#data-img 应与基线相同（没有本扩展的菜单项）：${withMenus["#data-img"]} 对 ${base["#data-img"]}`);
  const note = `#http-img ${withMenus["#http-img"]} 项（removeAll 后 ${base["#http-img"]} 项），#data-img ${withMenus["#data-img"]} 项（removeAll 后 ${base["#data-img"]} 项），重建后 #http-img ${back} 项`;
  return verdict(pr.map(x => `${x}（${note}）`), note);
}

// 以图搜图引擎设成模拟引擎 ei（写回由 guarded 负责）
const useMockImage = ctx => ctx.ext.eval(`chrome.storage.sync.set({ imageEngines: ${J([mockImageEngine(ctx.port)])}, imageEngine: "ei" }).then(() => true)`);

const T22_MANUAL = {
  id: "T22", title: "⑧ 以图搜图：图片上右键，网页留在左侧不动，右侧是以图搜图结果（人工右键）", kind: "assist", needs: [], timeoutFactor: 3,
  run: ctx => guarded(ctx, IMAGE_KEYS, async () => {
    await useMockImage(ctx);
    const right = imageRight(ctx.port);
    let scene;
    const prepare = async () => { scene = await articleScene(ctx, { xinput: false }); await clearSelection(ctx, scene.P.targetId); await focusGuide(ctx); };
    await prepare();
    const title = msg("menu_lookup_image", mockImageEngine(ctx.port).name);
    return assist(ctx, {
      title: "T22 以图搜图", what: "网页与模拟以图搜图引擎的结果组成分屏",
      instruction: `切到标签“page-u article”，先在空白处点一下（不要留着选中的文字），在第一张图片上右键，点“${title}”（本扩展的菜单项）。\n`
        + "期望：网页留在左边不动，右边是模拟以图搜图引擎，页面显示图片网址。\n做错了或现场乱了，点“重试”。",
      onRetry: prepare,
      probe: async () => (await ctx.browser.targets()).some(t => t.url === right) && lookupPair(await ctx.ext.state(), scene.P.id, () => true),
      verdict: async ([p, l]) => verdict([...await imageSideProblems(ctx, right), ...await pageUntouched(ctx, scene.P, scene.mark), ...await imageRecords(ctx, p, l)],
        `分屏 ${p.id}｜${l.id}，右侧 ${right}，回显图片网址，网页网址与标记不变；(b)(c) 只在自动版本里测`),
    });
  }),
};

export const T22 = xauto({
  id: "T22", title: "⑧ 以图搜图：http 图片上右键，网页留在左侧不动；先查词再查图复用查询标签；data: 图片没有菜单项（真实鼠标）",
  run: ctx => guarded(ctx, IMAGE_KEYS, async () => {
    await useMockImage(ctx);
    await sleep(MENU_SETTLE_MS); // 写 storage 后让菜单重建完再右键；(a) 的 expectItems 拦住撞上空档的情况
    let aItems = null;
    const a = await item("(a) http 图片右键：右侧网址的 url 参数与 engine-i 回显都是图片网址，网页标记不变", () => withAttempts(ctx, async () => {
      const r = await httpImage(ctx);
      aItems = r.items;
      return r.result;
    }));
    const b = await item("(b) 同一页先查词再查图：复用同一个查询标签，记录 input 变 image", () => withAttempts(ctx, () => textThenImage(ctx, aItems)));
    const c = await item("(c) data: 图片：本扩展菜单项不出现（与 removeAll 后的基线同项数），http 图片多 1 项", () => withAttempts(ctx, () => dataImage(ctx, aItems)));
    return summarize([a, b, c]);
  }),
}, T22_MANUAL);
