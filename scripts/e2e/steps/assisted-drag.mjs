// 需要人参与的拖拽步骤：T4 拖到已有标签上；T5-DRAG 拖到本扩展分屏的右侧。
// 两步都依赖脚本自己准备的现场（site-x 标签、初始分屏），所以“重试”一律重新准备并重新记下判定要用的 id：
// 首次验收里用户关掉被 Google 人机验证挡住的那一对再重试，旧 id 已不存在，只重等必然失败（diag-google-dnr.md）。
// deps 可注入，便于单测（run(ctx, deps)；运行器只传 ctx）。
import { openTab, waitState } from "./util.mjs";
import { assist, focusGuide } from "./guided.mjs";
import { prepare, gbPair, fmt, NEED_GB, GB_TRIGGER, RETRY_NOTE } from "./assisted.mjs";

export const DEPS = {
  prepare, openTab, assist, focusGuide,
  state: ctx => ctx.ext.state(),
  waitPair: (ctx, q) => waitState(ctx, st => gbPair(st, q), `Google ｜ Bing 分屏（关键词 ${q}）`, { timeoutMs: 30000 }),
};
const SORRY_OK = "左侧如果显示 Google 人机验证页（google.com/sorry）也没关系，分屏已经建成，照常操作即可。";

const T4 = {
  id: "T4", title: "选中文字拖到已有标签上：该标签变左侧，右侧新开", kind: "assist", needs: [], timeoutFactor: 3, cleanup: ["default", "gb"],
  async run(ctx, d = DEPS) {
    let base = await d.prepare(ctx);
    const q = "拖到已有标签";
    return d.assist(ctx, {
      title: "T4 拖到已有标签", what: `site-x 标签变成 Google ｜ Bing 分屏的左侧（关键词“${q}”）`, sampleText: q, copyText: GB_TRIGGER,
      instruction: `选中下面虚线框里的文字，拖到标题为“site-x /start”的标签上（标签高亮时松手）。\n期望：该标签变成左侧 Google，右侧新开 Bing。\n${NEED_GB}\n`
        + `${SORRY_OK}\n${RETRY_NOTE}`,
      // 重试：重新整理现场，判定改用新开的 site-x 标签
      onRetry: async () => { base = await d.prepare(ctx); },
      probe: async () => gbPair(await d.state(ctx), q),
      verdict: p => (p[0].id === base.tabId ? { status: "pass", detail: `site-x 标签 ${base.tabId} 变成左侧：${fmt(p)}` }
        : { status: "fail", detail: `左侧应是 site-x 标签 ${base.tabId}，实际 ${fmt(p)}` }),
    });
  },
};

const T5_Q = "t5";
const T5_URL = `https://www.google.com/search?q=${T5_Q}&_ss=google,bing`;

const T5_DRAG = {
  id: "T5-DRAG", title: "拖到本扩展分屏的右侧标签：两侧就地刷新，左右不对调", kind: "assist", needs: [], timeoutFactor: 4, cleanup: ["default", "gb"],
  async run(ctx, d = DEPS) {
    const build = async () => { await d.prepare(ctx); await d.openTab(ctx, T5_URL); };
    await build();
    const made = await d.assist(ctx, {
      title: "T5 准备分屏", what: `Google ｜ Bing 分屏（关键词 ${T5_Q}）`,
      instruction: "脚本正在打开一个 Google ｜ Bing 分屏，请稍候（不用操作）。长时间没反应可以点“重试”，脚本会重新整理标签并重新打开。",
      onRetry: build,
      probe: async () => gbPair(await d.state(ctx), T5_Q), verdict: p => ({ status: "pass", detail: fmt(p), pair: p }),
    });
    if (made.status !== "pass") return { status: made.status, detail: `没能建出初始分屏：${made.detail}` };
    let [l, r] = made.pair;
    let count = (await d.state(ctx)).tabs.length, ready = true;
    await d.focusGuide(ctx);
    const q = "拖到右侧标签";
    return d.assist(ctx, {
      title: "T5 拖到分屏右侧", what: `初始分屏就地刷新为“${q}”`, sampleText: q, copyText: GB_TRIGGER,
      instruction: `标签栏上有一个 Google ｜ Bing 分屏（关键词 t5）。选中下面的文字，拖到这个分屏的右侧（Bing）标签上。\n`
        + `期望：两侧就地刷新为新关键词，标签数不增加，左右不对调。\n${NEED_GB}\n${SORRY_OK}\n`
        + "做错了或分屏被关掉了，点“重试”：脚本会重新建一个初始分屏，再按说明操作一次。",
      // 重试：重建初始分屏，重新记下两侧 id 和标签数（旧的那一对可能已被关掉）
      // 重建失败时 ready=false：旧 id 已不可信，不判定，等用户再重试或跳过
      onRetry: async () => {
        ready = false;
        try {
          await build();
          [l, r] = await d.waitPair(ctx, T5_Q);
          count = (await d.state(ctx)).tabs.length;
          ready = true;
        } catch (e) { throw new Error(`重建分屏没成功（${e.message}）`); }
        finally { await d.focusGuide(ctx).catch(() => {}); }
      },
      probe: async () => {
        if (!ready) return null;
        const st = await d.state(ctx);
        const p = gbPair(st, q);
        return p && { p, n: st.tabs.length };
      },
      verdict: ({ p, n }) => {
        const problems = [];
        if (p[0].id !== l.id || p[1].id !== r.id) problems.push(`应仍是标签 ${l.id}｜${r.id}，实际 ${p[0].id}｜${p[1].id}`);
        if (n > count) problems.push(`标签数从 ${count} 增加到 ${n}`);
        return problems.length ? { status: "fail", detail: problems.join("；") } : { status: "pass", detail: `就地刷新：${fmt(p)}` };
      },
    });
  },
};

export const DRAG_STEPS = [T4, T5_DRAG];
