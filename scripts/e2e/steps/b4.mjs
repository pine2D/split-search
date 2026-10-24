// B4 设置页横幅授权（auto）：撤销 Google、Bing 授权后，设置页出现横幅；脚本在设置页里给 chrome.permissions.request
// 包一层记录调用，用 CDP Input.dispatchMouseEvent（可信事件，带用户激活）点横幅按钮。
// 判定：恰好一次申请、同时含 www.google.com 与 www.bing.com（对应“一个权限框同时列出两个网站”），之后两者授权生效、横幅消失。
// 测试配置里这两个网站之前授权过，permissions.remove 只是暂时撤销，Chrome 再次申请时直接批准、不弹框（perm-dialog spike）。
// 设置页开在单独的新窗口里：授权框挂在浏览器窗口上，只关标签它还留着，关掉窗口才随之消失（perm-dialog spike 第 4 条）。
// 万一弹出了原生授权框：引导式运行请用户点“允许”（原来的 assist 做法）；--auto-only 不点原生对话框，关掉设置页窗口、判跳过。
import { guarded, openOptions } from "./optpage.mjs";
import { assist, activate, contains, AUTO_GRANT_MS, GRANT_TIMEOUT_MS } from "./guided.mjs";
import { L } from "./labels.mjs";

export const GB_ORIGINS = ["https://www.google.com/*", "https://www.bing.com/*"];

// 页面里：记录 chrome.permissions.request 的调用（只记 origins），原样转给 Chrome
const RECORD = `(() => {
  if (!globalThis.__e2eReq) {
    globalThis.__e2eReq = [];
    const orig = chrome.permissions.request.bind(chrome.permissions);
    chrome.permissions.request = (p, ...rest) => { globalThis.__e2eReq.push(p?.origins ?? []); return orig(p, ...rest); };
  }
  return chrome.permissions.request !== undefined && Array.isArray(globalThis.__e2eReq);
})()`;
const BUTTON_CENTER = `(() => { const b = document.querySelector("#banner button"); if (!b) return null;
  b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`;

// 纯逻辑：横幅点击产生的申请记录 → 问题列表（空 = 符合“一次申请同时含两个网站”）
export function requestProblems(calls, want = GB_ORIGINS) {
  if (!Array.isArray(calls)) return ["没有记录到 chrome.permissions.request 的调用（记录器没装上）"];
  if (calls.length !== 1) return [`点一次横幅应申请 1 次，实际 ${calls.length} 次${calls.length ? `：${calls.map(c => c.join("+")).join("；")}` : ""}`];
  const missing = want.filter(o => !calls[0].includes(o));
  return missing.length ? [`申请里缺少 ${missing.join("、")}（实际 ${calls[0].join("、")}）`] : [];
}

// CDP 可信点击（不经 X，headless 也可用）
async function trustedClick(browser, sid, { x, y }) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await browser.client.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 }, sid);
  }
}

const waitGranted = (ctx, ms) => ctx.browser.waitFor(async () => (await contains(ctx.browser, GB_ORIGINS)) === true, { timeoutMs: ms, intervalMs: 300 })
  .then(() => true, () => false);

export const B4 = {
  id: "B4", title: "设置页横幅授权：一次申请 Google 和 Bing（CDP 点击横幅，自动判定）", kind: "auto", needs: [], timeoutFactor: 2,
  restores: true, timeoutExtraMs: GRANT_TIMEOUT_MS,
  async run(ctx) {
    return guarded(ctx, ["defaultPair"], async () => {
      await ctx.ext.eval(`chrome.storage.sync.set({ defaultPair: ["google", "bing"] }).then(() => true)`);
      await ctx.ext.eval(`chrome.permissions.remove({ origins: ${JSON.stringify(GB_ORIGINS)} })`);
      const page = await openOptions(ctx.browser, { newWindow: true });
      let closed = false;
      try {
        const label = await page.until(`return document.querySelector("#banner button")?.textContent`, 8000).catch(() => null);
        if (!label) return { status: "fail", detail: "撤销 Google、Bing 授权后，设置页没有出现授权横幅" };
        const problems = [];
        if (!label.includes("Google") || !label.includes("Bing")) problems.push(`横幅按钮应同时提到 Google 和 Bing，实际“${label}”`);
        if (!(await page.ev(RECORD))) return { status: "fail", detail: "装不上 chrome.permissions.request 的记录器" };
        await activate(ctx, page.targetId); // 万一弹框，它挂在设置页所在的标签上
        const at = await page.ev(BUTTON_CENTER);
        if (!at || !(at.w > 0 && at.h > 0)) return { status: "fail", detail: "横幅按钮不可见，点不到" };
        await trustedClick(ctx.browser, page.sid, at);
        let how = "Chrome 直接批准（之前授权过，不弹框）";
        if (!(await waitGranted(ctx, AUTO_GRANT_MS))) {
          if (ctx.autoOnly) {
            await page.close(); closed = true; // 关掉设置页（它独占的窗口随之关闭），原生授权框也跟着关闭
            return { status: "skip", detail: `点了横幅“${label}”，${AUTO_GRANT_MS / 1000} 秒内没有批准，多半弹出了原生授权框（测试配置里没有这两个网站的已授予记录）；--auto-only 不点原生对话框，已关掉设置页窗口、授权框随之关闭（之后的恢复检查会再申请）` };
          }
          const r = await assist(ctx, {
            title: "B4 横幅授权", what: "Google 和 Bing 都已授权", hint: null, afterShow: () => activate(ctx, page.targetId),
            instruction: `脚本点了设置页横幅“${label}”，Chrome 在单独的“Split Search 设置”窗口里弹出了授权框（约 2 秒后切到那个窗口）。\n`
              + `请确认权限框里同时列出 www.google.com 和 www.bing.com，点${L.allow}，再回到向导页。`,
            probe: () => contains(ctx.browser, GB_ORIGINS),
          });
          if (r.status !== "pass") return r;
          how = "用户在授权框里点了允许";
        }
        problems.push(...requestProblems(await page.ev("globalThis.__e2eReq ?? null")));
        const gone = await page.until(`return document.getElementById("banner").children.length === 0`, 5000).then(() => true, () => false);
        if (!gone) problems.push("授权后横幅没有消失");
        return problems.length ? { status: "fail", detail: problems.join("；") }
          : { status: "pass", detail: `横幅“${label}”一次申请了 www.google.com 与 www.bing.com（${how}），授权生效后横幅消失` };
      } finally {
        // 没完成时的授权恢复由 run.mjs 的步骤后检查（restores: true，recover.mjs）负责，不受本步超时限制
        if (!closed) await page.close();
      }
    });
  },
};
