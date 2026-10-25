// v0.4 步骤 T21（spec 3.14“② 边读边查”）：在 page-u 文章页选中文字，真实右键点本扩展的菜单项，
// 网页留在左侧不动，查询一侧用查词引擎（缺省 = 默认组合右侧 eb）。xauto；回退是 assist：向导请用户自己右键，脚本照同样的断言判定。
// 菜单按行定位、悬停确认高亮后点击，不向菜单发送任何按键（F20）；行号取 S11 的实测值，detail 写当次菜单的实际行数。
// T22（⑧ 以图搜图）在 v04-lookup-image.mjs。
import { expandTemplate } from "../../../src/lib/trigger.js";
import { SELECTION_MAX } from "../../../src/lib/lookup-input.js";
import { summarize, evalIn, sleep } from "./util.mjs";
import { guarded } from "./optpage.mjs";
import { verdict, readRecords, checkPairRecords } from "./v03-lib.mjs";
import { assist, focusGuide } from "./guided.mjs";
import { withAttempts, xauto } from "./xauto-lib.mjs";
import { contextMenuCount } from "../gesture-ui.mjs";
import { msg } from "../i18n.mjs";
import { articleScene, selectIn, screenPoint, pickOurs, pickNote, waitLookup, lookupPair, pageUntouched, item, mock, settleMenu, MENU_SETTLE_MS } from "./v04-lookup-lib.mjs";
import { T22 } from "./v04-lookup-image.mjs";

const J = JSON.stringify;
const LOOKUP_KEYS = ["lookupEngine"];

// 选中 spec 指定的文字并在上面右键点本扩展的文字项；返回 { items（菜单行数）, sel（选区文字）}
async function lookupText(ctx, scene, spec, { split }) {
  const s = await selectIn(ctx, scene.P.targetId, spec);
  const at = await screenPoint(ctx, scene.P.targetId, scene.wid, s, { split });
  return { items: await pickOurs(ctx, "text", at, scene.wid), sel: s.sel };
}

// 分屏里在 spec 指定的文字上数菜单行数，不点任何项
async function countText(ctx, scene, spec) {
  const s = await selectIn(ctx, scene.P.targetId, spec);
  return contextMenuCount(ctx, { at: await screenPoint(ctx, scene.P.targetId, scene.wid, s, { split: true }), wid: scene.wid });
}

// 每次尝试都从没有 lookupEngine 开始（上一次尝试可能停在 (c) 写的 "ec"）；删了键就等一会儿，让菜单重建完再右键
async function resetLookupEngine(ctx) {
  if (!(await ctx.ext.eval(`chrome.storage.sync.get("lookupEngine").then(r => "lookupEngine" in r)`))) return;
  await ctx.ext.eval(`chrome.storage.sync.remove("lookupEngine").then(() => true)`);
  await sleep(MENU_SETTLE_MS);
}

// 查询对的记录：网页一侧 page（engine ""），查询一侧 lookup
const pairRecords = async (ctx, p, l, engine, query, input = "text") => checkPairRecords(await readRecords(ctx, [p.id, l.id]), p, l,
  { mode: "split", splitViewId: p.splitViewId, roles: ["page", "lookup"], input, engines: ["", engine], query });

// 复用：查询标签 id 不变、新网址只在它上面
const reuseProblems = (st, l, L0, url) => {
  const p = [];
  if (l.id !== L0) p.push(`查询标签应复用 ${L0}，实际是 ${l.id}`);
  const n = st.tabs.filter(t => t.url === url).length;
  if (n !== 1) p.push(`${url} 应只在查询标签上打开，实际 ${n} 个标签`);
  return p;
};

async function runT21(ctx) {
  const { port } = ctx;
  const eb = mock(port, "eb"), ec = mock(port, "ec");
  await resetLookupEngine(ctx);
  const scene = await articleScene(ctx);
  const { P, mark } = scene;
  const items = [];
  let L0 = null, rows = null;
  const done = () => summarize(items);

  // (a) 新建查询对
  items.push(await item("(a) #p1 选中 quick 右键：网页留在左侧不动，右侧是查词引擎 eb 的搜索，记录 page↔lookup", async () => {
    const m = await lookupText(ctx, scene, { in: "#p1", word: "quick" }, { split: false });
    const right = expandTemplate(eb.url, "quick");
    const [p, l] = await waitLookup(ctx, P.id, t => t.url === right, `${P.id} 与 ${right} 组成分屏`);
    L0 = l.id;
    rows = m.items;
    const pr = [...await pageUntouched(ctx, P, mark), ...await pairRecords(ctx, p, l, "eb", "quick")];
    if (l.index !== p.index + 1) pr.push(`查询一侧应紧挨在网页右边（网页 ${p.index}、查询 ${l.index}）`);
    return verdict(pr, `${pickNote("text", m.items)}；分屏 ${p.id}｜${l.id}，右侧 ${right}，网页网址与标记不变`);
  }));
  if (items[0].status !== "pass") return done();

  // 在分屏里再查一次：查询标签就地换成 url，返回问题与菜单行数
  const again = async (spec, engine, query, url) => {
    const m = await lookupText(ctx, scene, spec, { split: true });
    const [p, l] = await waitLookup(ctx, P.id, t => t.url === url, `查询一侧换成 ${url}`);
    const pr = [...reuseProblems(await ctx.ext.state(), l, L0, url), ...await pageUntouched(ctx, P, mark), ...await pairRecords(ctx, p, l, engine, query)];
    return { pr, m };
  };

  items.push(await item("(b) #p2 选中 views 再右键：复用同一个查询标签，网页标记仍在", async () => {
    const url = expandTemplate(eb.url, "views");
    const { pr, m } = await again({ in: "#p2", word: "views" }, "eb", "views", url);
    return verdict(pr, `${pickNote("text", m.items)}；查询标签 ${L0} 换成 ${url}`);
  }));

  // 改 lookupEngine，等本扩展的菜单重建回 (a) 的行数再右键；返回问题列表
  const setLookup = async (expr, word) => {
    await ctx.ext.eval(expr);
    const n = await settleMenu(() => countText(ctx, scene, { in: "#p1", word }), rows);
    return n === rows ? [] : [`改 lookupEngine 后本扩展的菜单没重建回 ${rows} 项（最后数到 ${n} 项）`];
  };

  // 每次尝试开头 resetLookupEngine 删键，T21 外层的 guarded 写回运行前的值
  items.push(await item("(c) lookupEngine 设为 ec 再查 → C 的 /wiki/<词>；删掉键再查 → 回到默认组合右侧 eb", async () => {
    const w1 = await setLookup(`chrome.storage.sync.set({ lookupEngine: "ec" }).then(() => true)`, "brown");
    if (w1.length) return verdict(w1, "");
    const urlC = expandTemplate(ec.url, "brown");
    const c = await again({ in: "#p1", word: "brown" }, "ec", "brown", urlC);
    const w2 = await setLookup(`chrome.storage.sync.remove("lookupEngine").then(() => true)`, "fox");
    if (w2.length) return verdict([...c.pr, ...w2], "");
    const urlB = expandTemplate(eb.url, "fox");
    const b = await again({ in: "#p1", word: "fox" }, "eb", "fox", urlB);
    return verdict([...c.pr, ...b.pr], `${pickNote("text", c.m.items)}，查询一侧 ${urlC}；删掉键后${pickNote("text", b.m.items)}，查询一侧 ${urlB}`);
  }));

  items.push(await item(`(d) 跨两段、含换行、超过 ${SELECTION_MAX} 码点的选区：查询网址里的文字没有换行、不超过 ${SELECTION_MAX} 码点`, async () => {
    const filler = " lorem ipsum dolor sit amet".repeat(12);
    await evalIn(ctx, P.targetId, `["p1", "p2"].forEach(id => document.getElementById(id).firstChild.appendData(${J(filler)})), true`);
    const s = await selectIn(ctx, P.targetId, { from: "#p1", to: "#p2" });
    if (!/\n/.test(s.sel) || [...s.sel].length <= SELECTION_MAX) return { status: "fail", detail: `选区前提不成立：${[...s.sel].length} 码点，${/\n/.test(s.sel) ? "" : "没有"}换行` };
    const at = await screenPoint(ctx, P.targetId, scene.wid, s, { split: true });
    const n = await pickOurs(ctx, "text", at, scene.wid);
    const prefix = new URL(expandTemplate(eb.url, "x")).origin + "/search?";
    const [p, l] = await waitLookup(ctx, P.id, t => t.url?.startsWith(prefix) && !t.url.endsWith("q=fox"), "查询一侧换成长选区的搜索");
    const q = new URL(l.url).searchParams.get("q") ?? "";
    const pr = [...reuseProblems(await ctx.ext.state(), l, L0, l.url), ...await pageUntouched(ctx, P, mark)];
    if (/[\n\r\t]/.test(q)) pr.push(`查询文字里有换行或制表符：${J(q.slice(0, 80))}`);
    if ([...q].length > SELECTION_MAX) pr.push(`查询文字 ${[...q].length} 码点，超过 ${SELECTION_MAX}`);
    if (!q.startsWith("The quick brown fox jumps over the lazy dog")) pr.push(`查询文字应从第一段开头开始，实际 ${J(q.slice(0, 60))}`);
    pr.push(...await pairRecords(ctx, p, l, "eb", q));
    return verdict(pr, `${pickNote("text", n)}；选区 ${[...s.sel].length} 码点含换行，查询文字 ${[...q].length} 码点、没有换行`);
  }));
  return done();
}

// 回退：向导请用户在 page-u 上选中文字、右键点本扩展的菜单项，脚本照 (a) 的断言判定
const T21_MANUAL = {
  id: "T21", title: "② 边读边查：选中文字右键查词，网页留在左侧不动（人工右键）", kind: "assist", needs: [], timeoutFactor: 3,
  async run(ctx) {
    const eb = mock(ctx.port, "eb");
    let scene;
    const prepare = async () => { scene = await articleScene(ctx, { xinput: false }); await focusGuide(ctx); };
    await prepare();
    const prefix = new URL(expandTemplate(eb.url, "x")).origin + "/search?";
    const title = msg("menu_lookup_text", eb.name).replace("%s", "…");
    return assist(ctx, {
      title: "T21 边读边查", what: "网页与模拟引擎 B 的搜索组成分屏",
      instruction: `切到标签“page-u article”，在第一段里选中一个英文词，右键，点“${title}”（本扩展的菜单项）。\n期望：网页留在左边不动，右边是模拟引擎 B 搜索这个词。\n做错了或现场乱了，点“重试”。`,
      onRetry: prepare,
      probe: async () => lookupPair(await ctx.ext.state(), scene.P.id, t => t.url?.startsWith(prefix)),
      verdict: async ([p, l]) => {
        const q = new URL(l.url).searchParams.get("q") ?? "";
        return verdict([...await pageUntouched(ctx, scene.P, scene.mark), ...await pairRecords(ctx, p, l, "eb", q)],
          `分屏 ${p.id}｜${l.id}，右侧 ${l.url}，网页网址与标记不变；(b)–(d) 只在自动版本里测`);
      },
    });
  },
};

const T21 = xauto({
  id: "T21", title: "② 边读边查：选中文字右键查词，网页留在左侧不动；复用查询标签、查词引擎设置、长选区规范化（真实鼠标）",
  run: ctx => guarded(ctx, LOOKUP_KEYS, () => withAttempts(ctx, () => runT21(ctx))),
}, T21_MANUAL);

export const V04_LOOKUP_STEPS = [T21, T22];
