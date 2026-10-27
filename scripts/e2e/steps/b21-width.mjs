// B21 (l) 宽度（从 b21.mjs 拆出；设计稿 2026-10-27-options-tabs-design.md 3.4、5.4 (l)）：
// 四种语言 × 1280 / 600 两档视口（Emulation.setDeviceMetricsOverride，用完 clear），每档把四个 tab 逐一切过去、展开所有折叠区后量：
// 说明文字计算出的 max-width 都是 none；折行的说明块文字右缘 ÷ 父节点内容盒宽度 ≥ 0.9（同一条右边界）；
// 5 步说明里的网址行与触发网址行右缘相差 ≤ 2px；右键查询卡的两个下拉框等于卡片内宽 ±1px；
// “其他组合”生成器两个 label 的左缘与默认组合两个窗格的左缘对齐 ±1px；页面没有横向溢出、tab 栏没有竖向溢出；
// 600 档每个引擎行（含一行“未授权（可选）”）左块与右侧控件组顶边相同（没折行）。
// 状态：setupDone 为 true、默认组合两侧已授权（卡片不显示）；加一个模板在没授权的 engine-u.localhost 上的自定义引擎（模拟引擎 U）。
// customEngines、uiLocale 用 guarded 写回（B21 外层也 guarded 着它们）。
import { mockEngineU } from "../config.mjs";
import { TAB_KEYS } from "../../../src/lib/options-route.js";
import { openOptions, showTab, guarded, addCustom, sleep } from "./optpage.mjs";
import { OPEN_ALL, htmlLang } from "./i18n-audit.mjs";
import { setDone } from "./b19.mjs";

const J = JSON.stringify;
const LOCALES = ["en", "zh_CN", "zh_TW", "es"];
const WIDTHS = [1280, 600];
const TEXT = ".hint, .steps li, .caveats li, .step-body p";

const num = x => typeof x === "number" && Number.isFinite(x);
const list = (xs, f) => xs.slice(0, 4).map(f).join("、") + (xs.length > 4 ? ` 等 ${xs.length} 处` : "");
const r1 = x => (num(x) ? Math.round(x * 10) / 10 : x);

// 纯判定（m 的形状见文件头与 test/e2e-b21.test.js）：每类越界各报一条，列出前几处
export function widthProblems(m) {
  const p = [];
  const wide = m.maxWidths.filter(x => x.value !== "none");
  if (wide.length) p.push(`max-width 应为 none：${list(wide, x => `${x.sel} ${x.value}`)}`);
  const short = m.ratios.filter(x => !(x.ratio >= 0.9));
  if (short.length) p.push(`折行的说明没铺到右边界（右缘 ÷ 父节点内容宽 < 0.9）：${list(short, x => `${x.sel} ${x.ratio.toFixed(3)}`)}`);
  if (!num(m.urlLineDiff)) p.push("没量到 5 步说明或触发网址的网址行（.steps .url-line、.trigger-card .url-line）");
  else if (m.urlLineDiff > 2) p.push(`5 步说明的网址行与触发网址行右缘相差 ${r1(m.urlLineDiff)}px（应 ≤ 2）`);
  const sel = m.lookupSelects.filter(x => !(Math.abs(x.w - x.inner) <= 1));
  if (sel.length) p.push(`右键查询卡的下拉框应等于卡片内宽：${list(sel, x => `${r1(x.w)} / ${r1(x.inner)}px`)}`);
  if (m.genDiffs.some(d => !(d <= 1))) p.push(`“其他组合”两个 label 与默认组合两个窗格的左缘相差 ${m.genDiffs.map(r1).join("、")}px（应 ≤ 1）`);
  if (!(m.scrollWidth <= m.innerWidth)) p.push(`页面横向溢出：scrollWidth ${m.scrollWidth} > innerWidth ${m.innerWidth}`);
  if (!(m.tablist.sh <= m.tablist.ch)) p.push(`tab 栏竖向溢出：scrollHeight ${m.tablist.sh} > clientHeight ${m.tablist.ch}`);
  const folded = m.rows.filter(r => !(Math.abs(r.mainTop - r.sideTop) <= 1));
  if (folded.length) p.push(`引擎行折行（左块与右侧控件组顶边不同）：${list(folded, r => `${r.id} ${r1(r.mainTop)} / ${r1(r.sideTop)}`)}`);
  return p;
}

// 页内量一个 tab（调用前已切到它）。父节点是 display: contents（页头的 .page-title）时往上找有盒子的那个。
// 行数按文字与子元素的行框数：垂直位置差不到半个行高算同一行。折行块的文字右缘在 word-break: break-all 下量（量完即还原）：
// 自然折行时只有两三行的短段落，行尾那个放不下的单词会留下 50–65px 空白（600 档实测 en/es 0.880–0.895，与 pretty 无关），
// 那不是宽度上限；按任意字符折行后，文字右缘只受容器宽度限制，被截宽的块仍然到不了右边界。natural 是自然折行下的比值，只写进读数
const MEASURE = key => `(() => {
  const panel = document.getElementById("panel-" + ${J(key)});
  const vis = el => el.checkVisibility();
  const name = el => el.getAttribute("data-i18n") || el.id || (el.tagName.toLowerCase() + (el.className ? "." + el.className.split(" ").join(".") : ""));
  const boxed = el => { let p = el.parentElement; while (p && getComputedStyle(p).display === "contents") p = p.parentElement; return p; };
  const content = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(), pl = parseFloat(s.paddingLeft);
    return { left: r.left + el.clientLeft + pl, width: el.clientWidth - pl - parseFloat(s.paddingRight) }; };
  const lines = el => {
    const r = document.createRange(); r.selectNodeContents(el);
    const tol = (parseFloat(getComputedStyle(el).lineHeight) || 20) / 2, mids = [];
    let right = -Infinity;
    for (const rc of r.getClientRects()) {
      if (!(rc.width > 0 && rc.height > 0)) continue;
      right = Math.max(right, rc.right);
      const mid = rc.top + Math.min(rc.height, 2 * tol) / 2;
      if (!mids.some(m => Math.abs(m - mid) < tol)) mids.push(mid);
    }
    return { n: mids.length, right };
  };
  const texts = [...panel.querySelectorAll(${J(TEXT)}), ...(${J(key)} === "add" ? document.querySelectorAll(".page-title p") : [])].filter(vis);
  const maxWidths = texts.map(el => ({ sel: name(el), value: getComputedStyle(el).maxWidth }));
  const ratios = [];
  for (const el of texts) {
    if (el.matches(".step-actions > .hint")) continue;
    const l = lines(el);
    if (l.n < 2) continue;
    const c = content(boxed(el)), was = el.style.cssText;
    el.style.wordBreak = "break-all"; el.style.textWrap = "wrap";
    const right = lines(el).right;
    el.style.cssText = was;
    ratios.push({ sel: name(el), ratio: (right - c.left) / c.width, natural: (l.right - c.left) / c.width });
  }
  const right = sel => { const el = [...panel.querySelectorAll(sel)].find(vis); return el ? el.getBoundingClientRect().right : null; };
  const a = right(".steps .url-line"), b = right(".trigger-card .url-line");
  const lookupSelects = [...panel.querySelectorAll(".lookup-card select")].filter(vis)
    .map(s => ({ w: s.getBoundingClientRect().width, inner: content(s.closest(".card")).width }));
  const leftOf = el => (el && vis(el) ? el.getBoundingClientRect().left : null);
  const t = document.querySelector(".tablist");
  return { key: ${J(key)}, maxWidths, ratios, urlLineDiff: a != null && b != null ? Math.abs(a - b) : null, lookupSelects,
    gen: ["gen-left", "gen-right"].map(id => leftOf(document.getElementById(id)?.closest("label"))),
    panes: [".pair-pickers .pane-left", ".pair-pickers .pane-right"].map(s => leftOf(panel.querySelector(s))),
    scrollWidth: document.documentElement.scrollWidth, innerWidth,
    tablist: { sh: t.scrollHeight, ch: t.clientHeight },
    rows: [...panel.querySelectorAll("#engines .engine-row")].filter(vis).map(r => ({ id: r.dataset.id,
      mainTop: r.querySelector(".engine-main").getBoundingClientRect().top, sideTop: r.querySelector(".engine-side").getBoundingClientRect().top })) };
})()`;

// 四个 tab 的读数拼成 widthProblems 的 m。urlLineDiff 取自 ①、lookupSelects 取自 ④，gen 在 ① 量、窗格在 ② 量；rows 只在 600 档填
function combine(byKey, width) {
  const all = Object.values(byKey);
  const g = byKey.add?.gen ?? [], q = byKey.pair?.panes ?? [];
  return {
    maxWidths: all.flatMap(x => x.maxWidths), ratios: all.flatMap(x => x.ratios),
    urlLineDiff: byKey.add?.urlLineDiff ?? null, lookupSelects: byKey.lookup?.lookupSelects ?? [],
    genDiffs: [0, 1].map(i => (num(g[i]) && num(q[i]) ? Math.abs(g[i] - q[i]) : NaN)),
    scrollWidth: Math.max(...all.map(x => x.scrollWidth)), innerWidth: Math.min(...all.map(x => x.innerWidth)),
    tablist: all.reduce((w, x) => (x.tablist.sh - x.tablist.ch > w.sh - w.ch ? x.tablist : w), all[0].tablist),
    rows: width === 600 ? byKey.engines?.rows ?? [] : [],
  };
}

// 一档的数据摘要（写进 detail，也是实施报告里的宽度数据来源）
function brief(m, byKey) {
  const min = k => (m.ratios.length ? Math.min(...m.ratios.map(x => x[k] ?? 1)) : null);
  const sel = m.lookupSelects.map(x => `${r1(x.w)}/${r1(x.inner)}`).join(" ");
  return `说明 ${m.maxWidths.length} 块、折行 ${m.ratios.length} 块最小比 ${min("ratio")?.toFixed(3)}（自然折行 ${min("natural")?.toFixed(3)}），网址行差 ${r1(m.urlLineDiff)}px，`
    + `④ 下拉框 ${sel}px，生成器左缘差 ${m.genDiffs.map(r1).join("/")}px，scrollWidth ${m.scrollWidth}/${m.innerWidth}，`
    + `tab 栏 ${m.tablist.sh}/${m.tablist.ch}` + (m.rows.length ? `，引擎行 ${m.rows.length} 行不折` : "")
    + (byKey.engines?.rows?.length ? "" : "（③ 没量到引擎行）");
}

async function measureAt(ctx, page, width) {
  await ctx.browser.client.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 0, mobile: false }, page.sid);
  await page.until(`return innerWidth === ${width}`, 3000).catch(() => { throw new Error(`视口没有变成 ${width} 宽`); });
  await sleep(150);
  await page.ev(OPEN_ALL);
  const byKey = {};
  for (const key of TAB_KEYS) {
    await showTab(page, key);
    byKey[key] = await page.ev(MEASURE(key));
  }
  return byKey;
}

export async function widthCheck(ctx) {
  return guarded(ctx, ["customEngines", "uiLocale"], async () => {
    await setDone(ctx, true);
    await addCustom(ctx.ext, mockEngineU(ctx.port));
    const p = [], seen = [];
    for (const locale of LOCALES) {
      await ctx.ext.eval(`chrome.storage.sync.set({ uiLocale: ${J(locale)} }).then(() => true)`);
      const page = await openOptions(ctx.browser, { tab: "add" });
      try {
        await page.until(`return document.documentElement.lang === ${J(htmlLang(locale))} && document.getElementById("setup").hidden
          && !!document.querySelector('#engines .engine-row[data-id="eu"] .perm-optional')`, 5000)
          .catch(() => { throw new Error(`${locale}：设置页没有进入要量的状态（lang ${htmlLang(locale)}、卡片不显示、有一行“未授权（可选）”的模拟引擎 U）`); });
        for (const width of WIDTHS) {
          const byKey = await measureAt(ctx, page, width);
          const m = combine(byKey, width);
          p.push(...widthProblems(m).map(x => `${locale} ${width}：${x}`));
          seen.push(`${locale} ${width}：${brief(m, byKey)}`);
        }
      } finally {
        await ctx.browser.client.send("Emulation.clearDeviceMetricsOverride", {}, page.sid).catch(() => {});
        await page.close();
      }
    }
    return p.length ? { status: "fail", detail: `${p.join("；")}。读数：${seen.join("；")}` }
      : { status: "pass", detail: `四种语言 1280、600 两档都量过：${seen.join("；")}` };
  });
}
