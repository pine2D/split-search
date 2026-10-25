// B14 深色模式（auto）：经 CDP Emulation.setEmulatedMedia 把设置页、向导页和工具栏弹窗页切到 prefers-color-scheme: dark，
// 断言 body 的背景色、文字色变成样式表里深色 :root 定义的值，再切到 light 断言回到浅色值，最后清除模拟。
// 期望值从页面实际加载的样式表源码里读（schemeTokens），不写死颜色；深色截图存到 .e2e/ 供报告引用。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR } from "../ext.mjs";
import { pageTargets, sleep } from "./util.mjs";
import { openOptions } from "./optpage.mjs";
import { activate, focusGuide, guideUrl } from "./guided.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";

const stripComments = css => String(css).replace(/\/\*[\s\S]*?\*\//g, "");

// 从 start（"{" 的位置）开始配对花括号，返回块内文字与结束位置
function block(css, start) {
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return { body: css.slice(start + 1, i), end: i + 1 };
  }
  throw new Error("样式表花括号不配对");
}

// 顶层规则：[{ prelude, body }]，@media 规则的 body 是未展开的块内文字
export function topRules(css) {
  const s = stripComments(css), out = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf("{", i);
    if (open < 0) break;
    const { body, end } = block(s, open);
    out.push({ prelude: s.slice(i, open).trim(), body });
    i = end;
  }
  return out;
}

const decls = body => Object.fromEntries(body.split(";").map(d => d.trim()).filter(Boolean).map(d => {
  const k = d.indexOf(":");
  return [d.slice(0, k).trim(), d.slice(k + 1).trim()];
}));
const isRoot = p => p.split(",").some(x => x.trim() === ":root");
const isBody = p => p.split(",").some(x => x.trim() === "body");
const DARK_MEDIA = /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/;
const varName = v => /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(String(v ?? "").trim())?.[1] ?? null;

// 期望值：body 的 background(-color) / color 引用的变量，及其在浅色 :root 与深色 @media 里 :root 的取值。
// 返回 { bgVar, fgVar, light: { bg, fg }, dark: { bg, fg } }；样式表不是“变量 + 深色覆盖”的写法就抛错（说明哪里不符）
export function schemeTokens(css) {
  const light = {}, dark = {}, body = {};
  for (const r of topRules(css)) {
    if (isRoot(r.prelude)) Object.assign(light, decls(r.body));
    else if (isBody(r.prelude)) Object.assign(body, decls(r.body));
    else if (DARK_MEDIA.test(r.prelude)) {
      for (const inner of topRules(r.body)) if (isRoot(inner.prelude)) Object.assign(dark, decls(inner.body));
    }
  }
  const bgVar = varName(body["background-color"] ?? body.background), fgVar = varName(body.color);
  if (!bgVar || !fgVar) throw new Error("body 的背景色或文字色没有用 var(--…) 引用颜色变量");
  for (const v of [bgVar, fgVar]) {
    if (!(v in light)) throw new Error(`浅色 :root 里没有定义 ${v}`);
    if (!(v in dark)) throw new Error(`@media (prefers-color-scheme: dark) 的 :root 里没有覆盖 ${v}`);
  }
  const t = { bgVar, fgVar, light: { bg: light[bgVar], fg: light[fgVar] }, dark: { bg: dark[bgVar], fg: dark[fgVar] } };
  if (t.light.bg === t.dark.bg || t.light.fg === t.dark.fg) throw new Error(`深色与浅色的 ${bgVar}/${fgVar} 取值相同`);
  return t;
}

// 页面里：读全部样式表源码（同源，fetch 原文），并把期望的颜色值经探针元素换算成计算后的 rgb(...)
const CSS_EXPR = `(async () => (await Promise.all([...document.styleSheets].filter(s => s.href)
  .map(s => fetch(s.href).then(r => r.text())))).join("\\n"))()`;
const computed = (tok, scheme) => `(() => {
  const norm = v => { const p = document.createElement("span"); p.style.color = v; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const cs = getComputedStyle(document.body);
  return { bg: cs.backgroundColor, fg: cs.color, wantBg: norm(${JSON.stringify(tok[scheme].bg)}), wantFg: norm(${JSON.stringify(tok[scheme].fg)}),
    matches: matchMedia("(prefers-color-scheme: dark)").matches };
})()`;

// 一个页面在某个配色下的判定（纯逻辑）：c = computed() 的结果
export function schemeVerdict(name, scheme, c) {
  const problems = [];
  if (c.matches !== (scheme === "dark")) problems.push(`prefers-color-scheme: dark 的 matchMedia 是 ${c.matches}`);
  if (c.bg !== c.wantBg) problems.push(`背景色 ${c.bg}，应为 ${c.wantBg}`);
  if (c.fg !== c.wantFg) problems.push(`文字色 ${c.fg}，应为 ${c.wantFg}`);
  return problems.length ? `${name}（${scheme}）：${problems.join("，")}` : null;
}

const media = scheme => ({ media: "", features: scheme ? [{ name: "prefers-color-scheme", value: scheme }] : [] });

async function checkPage(ctx, { name, targetId, sid, file }) {
  const { client, evaluate } = ctx.browser;
  const ev = expr => evaluate(sid, expr, { timeoutMs: 10000 });
  const tok = schemeTokens(await ev(CSS_EXPR));
  const problems = [];
  let shot = null;
  try {
    for (const scheme of ["dark", "light"]) {
      await client.send("Emulation.setEmulatedMedia", media(scheme), sid);
      await sleep(300); // 让样式重新计算、过渡（如果有）走完
      const bad = schemeVerdict(name, scheme, await ev(computed(tok, scheme)));
      if (bad) problems.push(bad);
      if (scheme === "dark") {
        await activate(ctx, targetId);
        const { data } = await client.send("Page.captureScreenshot", { format: "png" }, sid, { timeoutMs: 10000 })
          .catch(e => ({ data: null, err: e.message }));
        if (data) { mkdirSync(OUT_DIR, { recursive: true }); writeFileSync(file, Buffer.from(data, "base64")); shot = file; }
      }
    }
  } finally {
    await client.send("Emulation.setEmulatedMedia", media(null), sid).catch(() => {});
  }
  return { problems, shot, tokens: `${tok.bgVar} ${tok.light.bg}→${tok.dark.bg}，${tok.fgVar} ${tok.light.fg}→${tok.dark.fg}` };
}

export const B14 = {
  id: "B14", title: "深色模式：设置页、向导页与弹窗配色跟随（CDP 模拟，自动判定）", kind: "auto", needs: [],
  async run(ctx) {
    const page = await openOptions(ctx.browser);
    let gsid = null, gTarget = null, made = false, popup = null;
    try {
      gTarget = (await pageTargets(ctx.browser)).find(t => t.url.startsWith(guideUrl(ctx.port)))?.targetId;
      if (!gTarget) { // --auto-only 不打开向导页：自己开一个，用完关掉
        gTarget = (await ctx.browser.client.send("Target.createTarget", { url: guideUrl(ctx.port) })).targetId;
        made = true;
      }
      gsid = await ctx.browser.attach(gTarget);
      await ctx.browser.waitFor(() => ctx.browser.evaluate(gsid, `document.readyState === "complete"`, { timeoutMs: 3000 }), { timeoutMs: 10000 });
      const opt = await checkPage(ctx, { name: "设置页", targetId: page.targetId, sid: page.sid, file: join(OUT_DIR, "b14-options-dark.png") });
      const gd = await checkPage(ctx, { name: "向导页", targetId: gTarget, sid: gsid, file: join(OUT_DIR, "b14-guide-dark.png") });
      // 工具栏弹窗：直接打开 popup.html（没有 tabId，显示说明文字），等它渲染完再比较
      popup = await popupPage(ctx, { url: POPUP_URL });
      await popup.read();
      const pp = await checkPage(ctx, { name: "弹窗", targetId: popup.targetId, sid: popup.sid, file: join(OUT_DIR, "b14-popup-dark.png") });
      const problems = [...opt.problems, ...gd.problems, ...pp.problems];
      const shots = [opt.shot, gd.shot, pp.shot].filter(Boolean);
      const tail = `设置页 ${opt.tokens}；向导页 ${gd.tokens}；弹窗 ${pp.tokens}${shots.length ? `；深色截图：${shots.join("、")}` : "；截图没有保存成功"}`;
      return problems.length ? { status: "fail", detail: `${problems.join("；")}\n${tail}` }
        : { status: "pass", detail: `设置页、向导页与弹窗在深色/浅色下 body 背景色与文字色都等于样式表里的变量值。${tail}` };
    } finally {
      if (gsid) await ctx.browser.client.send("Target.detachFromTarget", { sessionId: gsid }).catch(() => {});
      if (made) await ctx.browser.client.send("Target.closeTarget", { targetId: gTarget }).catch(() => {});
      await popup?.close();
      await page.close();
      if (!made) await focusGuide(ctx).catch(() => {});
    }
  },
};
