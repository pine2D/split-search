// B24：联动关闭开关的实际保存、键盘操作、失败回退与四语言窄/宽、浅/深色显示。
import assert from "node:assert/strict";
import { join } from "node:path";
import { guarded, openOptions } from "./optpage.mjs";
import { summarize } from "./util.mjs";
import { sub } from "./v03-lib.mjs";
import { audit, auditProblems, shoot, SHOT_DIR } from "./i18n-audit.mjs";
import { msgIn } from "../i18n.mjs";

const J = JSON.stringify;
const SWITCH = `document.getElementById("close-pair-together")`;
async function keyboard(ctx, page) {
  await page.ev(`${SWITCH}.focus(); true`);
  for (const type of ["keyDown", "keyUp"]) await ctx.browser.client.send("Input.dispatchKeyEvent", {
    type, key: " ", code: "Space", windowsVirtualKeyCode: 32,
  }, page.sid);
}

async function checks(ctx, page) {
  const items = [];
  items.push(await sub("(a) 默认关闭，键盘开启并保存，刷新后保持；再次关闭，焦点仍在开关", async () => {
    assert.equal(await page.ev(`${SWITCH}.checked`), false);
    await keyboard(ctx, page);
    await page.until(`return (await chrome.storage.sync.get("closePairTogether")).closePairTogether === true && ${SWITCH}.checked`);
    await page.reload(); assert.equal(await page.ev(`${SWITCH}.checked`), true);
    await keyboard(ctx, page);
    await page.until(`return (await chrome.storage.sync.get("closePairTogether")).closePairTogether === false && !${SWITCH}.checked && document.activeElement.id === "close-pair-together"`);
    return { status: "pass", detail: "Space 开/关、存储、刷新与重渲染焦点通过" };
  }));
  items.push(await sub("(b) 保存失败：回到关闭状态，并显示错误提示", async () => {
    await page.ev(`globalThis.__realSyncSet = chrome.storage.sync.set; chrome.storage.sync.set = async () => { throw new Error("test write failure"); }; true`);
    try {
      await keyboard(ctx, page);
      await page.until(`return !${SWITCH}.checked && !!document.querySelector("#notices .notice-error")`);
      assert.equal(await page.ev(`chrome.storage.sync.get("closePairTogether").then(s => s.closePairTogether)`), false);
    } finally { await page.ev(`chrome.storage.sync.set = globalThis.__realSyncSet; delete globalThis.__realSyncSet; true`); }
    return { status: "pass", detail: "未把保存失败显示成开启成功" };
  }));
  for (const locale of ["zh_CN", "zh_TW", "en", "es"]) items.push(await sub(`(c-${locale}) 标签、范围与警示文案；360/600/1280 宽，浅色和深色`, async () => {
    await page.ev(`chrome.storage.sync.set({ uiLocale: ${J(locale)} })`);
    await page.until(`return document.documentElement.lang === ${J(locale.replace("_", "-"))} && !document.body.classList.contains("loading")`);
    const label = await page.ev(`document.querySelector('label[for="close-pair-together"]').textContent`);
    assert.equal(label, msgIn(locale, "options_close_pair_label"));
    for (const [id, key] of [["close-pair-hint", "options_close_pair_hint"], ["close-pair-warning", "options_close_pair_warning"]]) {
      assert.equal(await page.ev(`document.getElementById(${J(id)}).textContent`), msgIn(locale, key));
      assert.equal(await page.ev(`document.getElementById(${J(id)}).checkVisibility()`), true);
    }
    assert.equal(await page.ev(`${SWITCH}.getAttribute("aria-describedby")`), "close-pair-hint close-pair-warning");
    for (const theme of ["light", "dark"]) {
      await ctx.browser.client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] }, page.sid);
      for (const width of [360, 600, 1280]) {
        await ctx.browser.client.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sid);
        assert.deepEqual(auditProblems(locale, await page.ev(audit({ scope: "#pair-body ", items: "label, p" }))), []);
        assert.equal(await page.ev(`${SWITCH}.getBoundingClientRect().right <= innerWidth && ${SWITCH}.getBoundingClientRect().width >= 32`), true);
        if (width === 600) await shoot(ctx, page, join(SHOT_DIR, `${locale}-close-pair-${theme}.png`), { full: true });
      }
    }
    return { status: "pass", detail: "可见文案、读屏说明与溢出检查通过，600px 两种主题已截图" };
  }));
  return summarize(items);
}

export const CLOSE_OPTIONS_STEPS = [{
  id: "B24", title: "联动关闭设置：默认、键盘、保存失败、四语言与窄/宽浅/深色", kind: "auto", needs: [], timeoutMs: 90000,
  run: ctx => guarded(ctx, ["closePairTogether", "uiLocale"], async () => {
    await ctx.ext.eval(`chrome.storage.sync.remove("closePairTogether")`);
    const page = await openOptions(ctx.browser, { tab: "pair" });
    try { return await checks(ctx, page); }
    finally { await page.close(); }
  }),
}];
