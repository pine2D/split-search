// xauto T12：Chrome 自动发现的 Kagi 条目追加 _ss=kagi,bing 并设为默认（settings-kagi.mjs，经 CDP 操作 chrome://settings），
// 然后用真实键盘在新开窗口的地址栏输入：(a) 直接输入关键词（默认引擎）；(b) 快捷字词模式（“kagi.com 关键词”）。都应 Kagi ｜ Bing 分屏。
// 地址栏下拉框里有没有 Kagi 的联想只截图记录（回车前截，嵌套显示上截整屏，host 模式只截测试窗口），不判通过/失败。
// 需要已登录的 Kagi：--auto-only 只探测一次，没登录就跳过；引导式运行按原来的方式请用户登录。
// 找不到自动发现的 Kagi 条目：--auto-only 跳过；引导式运行回退到人工版本（assisted-2.mjs 的 T12，会教用户先在 kagi.com 搜索一次）。
import { join } from "node:path";
import { OUT_DIR } from "../ext.mjs";
import { resetTabs, splitPairs, waitState, siteX, nonce, summarize } from "./util.mjs";
import { omnibox } from "../gesture-ui.mjs";
import { xauto, withAttempts, settingsRetry, assertAscii } from "./xauto-lib.mjs";
import { query } from "./xauto.mjs";
import { isSearch, BING, fmt } from "./assisted.mjs";
import { ASSISTED_2 } from "./assisted-2.mjs";
import { kagiGate } from "./setup.mjs";
import { KAGI_SS } from "../settings-kagi.mjs";

const fallback = ASSISTED_2.find(s => s.id === "T12");
export const T12_WORDS = ["xkagi", "xkagikw"];

// Kagi ｜ Bing 分屏：左 kagi.com/search、右 Bing，两侧 q 都是 text（左侧去掉了 _ss）
export const kagiBingPair = (st, text) => splitPairs(st).find(([l, r]) => isSearch(l.url, "kagi.com", text) && isSearch(r.url, BING, text));

// 回车前截地址栏下拉框（仅供参考）：嵌套显示截整屏（下拉框可能是单独的弹出窗口），host 模式只截测试窗口
async function suggestShot(ctx, wid, tag) {
  await new Promise(r => setTimeout(r, 1500)); // 等联想返回
  const file = join(OUT_DIR, `t12-suggest-${tag}.png`);
  return ctx.gx.xi.capturePng(ctx.gx.nested ? "root" : wid, file).catch(() => null);
}

async function item(ctx, { tag, word, typed }) {
  return withAttempts(ctx, async () => {
    await resetTabs(ctx);
    const { text } = query(word);
    let shot = null;
    await omnibox(ctx, { text: assertAscii(typed(text)), url: siteX(ctx.port, `/omni?n=${nonce()}`),
      beforeEnter: async ({ wid }) => { shot = await suggestShot(ctx, wid, tag); } });
    const p = await waitState(ctx, st => kagiBingPair(st, text), `Kagi ｜ Bing 分屏（${text}）`, { timeoutMs: 30000 });
    return { status: "pass", detail: `${fmt(p)}${shot ? `；地址栏联想截图（仅供参考）：${shot}` : "；联想截图没保存成功"}` };
  });
}

export const T12 = xauto({
  id: "T12", title: "自动发现的 Kagi 条目追加 _ss 并设为默认：直接输入与快捷字词模式都 Kagi ｜ Bing 分屏（真实键盘）",
  timeoutMs: 15 * 60 * 1000, // 引导式运行里可能要等用户登录 Kagi（ensureKagi 最多等 3 倍单步超时）
  async run(ctx) {
    const gate = await kagiGate(ctx);
    if (gate) return gate;
    let prep;
    try { prep = await settingsRetry(ctx, () => ctx.se.useKagi()); }
    catch (e) {
      if (e.kind !== "missing") throw e;
      if (ctx.autoOnly) return { status: "skip", detail: `${e.message}；--auto-only 不回退到人工` };
      const r = await fallback.run(ctx);
      return { ...r, detail: `${r.detail}（自动版本做不了：${e.message}，改由人工完成）` };
    }
    const kw = assertAscii(prep.keyword);
    const res = summarize([
      { name: "(a) 直接输入（默认引擎）", ...await item(ctx, { tag: "default", word: "xkagi", typed: t => t }) },
      { name: `(b) 快捷字词模式（${kw}）`, ...await item(ctx, { tag: "keyword", word: "xkagikw", typed: t => `${kw} ${t}` }) },
    ]);
    const how = `Kagi 条目 ${kw}：${prep.edited ? `已追加 _ss=${KAGI_SS}` : `网址已带 _ss=${KAGI_SS}`}，${prep.madeDefault ? "已设为默认" : "本来就是默认"}（运行结束恢复运行前的默认引擎；_ss 保留）`;
    const [head, ...rest] = res.detail.split("\n");
    return { ...res, detail: [head, how, ...rest].join("\n") };
  },
}, fallback);

export const XAUTO_T12 = [T12];
