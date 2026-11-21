// B4 “开始使用”卡第 1 步授权（auto）：清掉 setupDone、撤销 Google、Bing 授权后，设置页的 #setup 先显示工具栏试用方法和左侧授权按钮；
// 脚本在设置页里给 chrome.permissions.request 包一层记录调用，用 CDP Input.dispatchMouseEvent（可信事件，带用户激活）点第 1 步的授权按钮。
// 判定：恰好一次申请、仅含 www.google.com，之后示例按钮可用，Bing 仍未授权。
// setupDone 由 keepSetupDone（b19.mjs）写回步骤前的值。
// 测试配置里这两个网站之前授权过，permissions.remove 只是暂时撤销，Chrome 再次申请时直接批准、不弹框（perm-dialog spike）。
// 设置页开在单独的新窗口里：授权框挂在浏览器窗口上，只关标签它还留着，关掉窗口才随之消失（perm-dialog spike 第 4 条）。
// 万一弹出了原生授权框：引导式运行请用户点“允许”（原来的 assist 做法）；--auto-only 不点原生对话框，关掉设置页窗口、判跳过。
import { guarded, openOptions } from "./optpage.mjs";
import { assist, activate, contains, AUTO_GRANT_MS, GRANT_TIMEOUT_MS } from "./guided.mjs";
import { L } from "./labels.mjs";
import { keepSetupDone, setDone } from "./b19.mjs";
import { msg } from "../i18n.mjs";

export const GB_ORIGINS = ["https://www.google.com/*", "https://www.bing.com/*"];

// 页面里：记录 chrome.permissions.request 的调用（只记 origins），原样转给 Chrome。B16(b) 也用它断言“添加不申请权限”
export const RECORD = `(() => {
  if (!globalThis.__e2eReq) {
    globalThis.__e2eReq = [];
    const orig = chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.request = (p, ...rest) => { globalThis.__e2eReq.push(p?.origins ?? []); return orig(p, ...rest); };
  }
  return chrome.permissions.request !== undefined && Array.isArray(globalThis.__e2eReq);
})()`;
const BUTTON_CENTER = `(() => { const b = document.getElementById("setup-grant"); if (!b) return null;
  b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`;

// 纯逻辑：只允许一次请求且只申请默认左侧 origin。
export function requestProblems(calls) {
  if (!Array.isArray(calls)) return ["没有记录到 chrome.permissions.request 的调用（记录器没装上）"];
  if (calls.length !== 1) return [`点一次授权按钮应申请 1 次，实际 ${calls.length} 次${calls.length ? `：${calls.map(c => c.join("+")).join("；")}` : ""}`];
  const origins = calls[0];
  return origins?.length === 1 && origins[0] === GB_ORIGINS[0] ? [] : [`应只申请 ${GB_ORIGINS[0]}，实际 ${JSON.stringify(origins)}`];
}

// CDP 可信点击（不经 X，headless 也可用）
export async function trustedClick(browser, sid, { x, y }) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await browser.client.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 }, sid);
  }
}

const waitGranted = (ctx, ms) => ctx.browser.waitFor(async () => (await contains(ctx.browser, [GB_ORIGINS[0]])) === true, { timeoutMs: ms, intervalMs: 300 })
  .then(() => true, () => false);

export const B4 = {
  id: "B4", title: "“开始使用”卡第 1 步授权：只申请左侧 Google（CDP 点击，自动判定）", kind: "auto", needs: [], timeoutFactor: 2,
  restores: true, timeoutExtraMs: GRANT_TIMEOUT_MS,
  async run(ctx) {
    return keepSetupDone(ctx, () => guarded(ctx, ["defaultPair"], async () => {
      await ctx.ext.eval(`chrome.storage.sync.set({ defaultPair: ["google", "bing"] }).then(() => true)`);
      await setDone(ctx, null);
      await ctx.ext.eval(`chrome.permissions.remove({ origins: ${JSON.stringify(GB_ORIGINS)} })`);
      const page = await openOptions(ctx.browser, { newWindow: true });
      let closed = false;
      try {
        const label = await page.until(`const s = document.getElementById("setup");
          return !s.hidden && s.dataset.mode === "steps" && s.querySelector('[data-step="try"]')?.dataset.state === "needs-grant"
            && document.getElementById("setup-grant")?.textContent`, 8000).catch(() => null);
        if (!label) return { status: "fail", detail: "清掉 setupDone、撤销 Google、Bing 授权后，设置页的“开始使用”卡没有显示第 1 步的授权按钮" };
        const problems = [];
        const toolbarHint = await page.ev(`document.querySelector('#setup [data-i18n="setup_toolbar_hint"]')?.textContent`);
        if (toolbarHint !== msg("setup_toolbar_hint", "Google")) problems.push("授权前应该先说明怎样从普通 Google 结果页试用");
        if (!(await page.ev(`document.querySelector("#tabbtn-add[aria-selected=true]") !== null`))) problems.push("全新状态（卡片显示）打开设置页时应默认选中“添加到 Chrome”tab（#tabbtn-add）");
        if (label !== msg("setup_grant_left", "Google")) problems.push(`授权按钮应只提到 Google，实际“${label}”`);
        // 引擎列表：只有默认左侧（Google）是警示样式，没授权的右侧（Bing）是中性样式
        const rows = await page.until(`const r = id => { const p = document.querySelector('.engine-row[data-id="' + id + '"] .perm');
          return p && { cls: p.className, text: p.textContent.trim() }; };
          const g = r("google"), b = r("bing"); return g && b ? { g, b } : false`, 5000).catch(() => null);
        if (!rows) problems.push("引擎列表里找不到 Google、Bing 的授权状态行");
        else {
          if (!rows.g.cls.includes("perm-missing") || rows.g.text !== msg("engine_not_granted_required")) problems.push(`默认左侧应是 perm-missing“${msg("engine_not_granted_required")}”，实际 ${rows.g.cls}“${rows.g.text}”`);
          if (!rows.b.cls.includes("perm-optional") || rows.b.text !== msg("engine_not_granted_optional")) problems.push(`没授权的右侧应是 perm-optional“${msg("engine_not_granted_optional")}”，实际 ${rows.b.cls}“${rows.b.text}”`);
        }
        if (!(await page.ev(RECORD))) return { status: "fail", detail: "装不上 chrome.permissions.request 的记录器" };
        await activate(ctx, page.targetId); // 万一弹框，它挂在设置页所在的标签上
        const at = await page.ev(BUTTON_CENTER);
        if (!at || !(at.w > 0 && at.h > 0)) return { status: "fail", detail: "第 1 步的授权按钮不可见，点不到" };
        await trustedClick(ctx.browser, page.sid, at);
        let how = "Chrome 直接批准（之前授权过，不弹框）";
        if (!(await waitGranted(ctx, AUTO_GRANT_MS))) {
          if (ctx.autoOnly) {
            await page.close(); closed = true; // 关掉设置页（它独占的窗口随之关闭），原生授权框也跟着关闭
            return { status: "skip", detail: `点了第 1 步的授权按钮“${label}”，${AUTO_GRANT_MS / 1000} 秒内没有批准，多半弹出了原生授权框（测试配置里没有 Google 的已授予记录）；--auto-only 不点原生对话框，已关掉设置页窗口、授权框随之关闭（之后的恢复检查会再申请）` };
          }
          const r = await assist(ctx, {
            title: "B4 第 1 步授权", what: "只授权 Google", hint: null, afterShow: () => activate(ctx, page.targetId),
            instruction: `脚本点了设置页“开始使用”卡第 1 步的授权按钮“${label}”，Chrome 在单独的“Split Search 设置”窗口里弹出了授权框（约 2 秒后切到那个窗口）。\n`
              + `请确认权限框里只列出 www.google.com，点${L.allow}，再回到向导页。`,
            probe: () => contains(ctx.browser, [GB_ORIGINS[0]]),
          });
          if (r.status !== "pass") return r;
          how = "用户在授权框里点了允许";
        }
        problems.push(...requestProblems(await page.ev("globalThis.__e2eReq ?? null")));
        const done = await page.until(`return document.querySelector('#setup [data-step="try"]')?.dataset.state === "ready"
          && !document.getElementById("setup-grant") && document.activeElement?.id === "setup-try"`, 5000).then(() => true, () => false);
        if (!done) problems.push("授权后焦点没有落到可用的示例按钮");
        if (await contains(ctx.browser, [GB_ORIGINS[1]])) problems.push("右侧 Bing 不应获得授权");
        return problems.length ? { status: "fail", detail: problems.join("；") }
          : { status: "pass", detail: `第 1 步“${label}”只申请了 www.google.com（${how}），焦点落到示例按钮，Bing 仍未授权` };
      } finally {
        // 没完成时的授权恢复由 run.mjs 的步骤后检查（restores: true，recover.mjs）负责，不受本步超时限制
        if (!closed) await page.close();
      }
    }));
  },
};
