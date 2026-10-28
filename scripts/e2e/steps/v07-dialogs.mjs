// v0.7 自动步骤 B22：设置页对话框点外部（遮罩）关闭，与表单改过时的保存确认（#discard-dialog，src/options/dialogs.js）。
// 点击一律是 CDP Input.dispatchMouseEvent 可信事件（左键、clickCount 1；页内 .click() 的 detail 为 0，dialogs.js 不认）；
// 遮罩点取视口 (8, 8)，点之前核对它在对话框矩形以外。按键用 Input.dispatchKeyEvent。customEngines 由 guarded 写回。
import { guarded, openOptions, showTab, readKeys, sleep } from "./optpage.mjs";
import { summarize } from "./util.mjs";
import { sub, verdict } from "./v03-lib.mjs";

const J = JSON.stringify;
export const BACKDROP = { x: 8, y: 8 };

// 纯函数：点 p 是否落在矩形 r（getBoundingClientRect 的 left/right/top/bottom）以外，判定与 dialogs.js 的 outside 相同
export const pointOutside = (r, p) => p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom;

const rectOf = (page, id) => page.ev(`(() => { const r = document.getElementById(${J(id)}).getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`);
const centerOf = (page, id) => page.ev(`(() => { const el = document.getElementById(${J(id)}); if (!el || !el.checkVisibility()) return null;
  el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

const mouse = (ctx, page, type, { x, y }, buttons) => ctx.browser.client.send("Input.dispatchMouseEvent",
  { type, x, y, button: "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 }, page.sid);

async function clickAt(ctx, page, pt) {
  await mouse(ctx, page, "mousePressed", pt, 1);
  await mouse(ctx, page, "mouseReleased", pt, 0);
}

// 点某个元素的中心（先滚进视口）；元素看不见就抛错
export async function clickEl(ctx, page, id) {
  const at = await centerOf(page, id);
  if (!at) throw new Error(`#${id} 看不见，点不了`);
  await clickAt(ctx, page, at);
}

// 点对话框 dialogId 的遮罩：先确认 (8, 8) 在它的矩形以外
export async function clickBackdrop(ctx, page, dialogId) {
  const r = await rectOf(page, dialogId);
  if (!pointOutside(r, BACKDROP)) throw new Error(`遮罩点 ${J(BACKDROP)} 落在 #${dialogId} 的矩形 ${J(r)} 里`);
  await clickAt(ctx, page, BACKDROP);
}

// 在元素里按下、移到遮罩点松开（选文字时拖出对话框）
async function dragOut(ctx, page, fromId, dialogId) {
  const at = await centerOf(page, fromId);
  if (!at) throw new Error(`#${fromId} 看不见`);
  if (!pointOutside(await rectOf(page, dialogId), BACKDROP)) throw new Error(`遮罩点落在 #${dialogId} 里`);
  await mouse(ctx, page, "mousePressed", at, 1);
  for (const k of [0.33, 0.66, 1]) {
    await mouse(ctx, page, "mouseMoved", { x: at.x + (BACKDROP.x - at.x) * k, y: at.y + (BACKDROP.y - at.y) * k }, 1);
    await sleep(30);
  }
  await mouse(ctx, page, "mouseReleased", BACKDROP, 0);
}

export async function pressEsc(ctx, page) {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await ctx.browser.client.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, page.sid);
  }
}

const isOpen = id => `document.getElementById(${J(id)}).open`;
const until = (page, expr, what, ms = 5000) => page.until(`return ${expr};`, ms).catch(async () => {
  throw new Error(`没有等到：${what}（当前 ${J(await state(page).catch(() => null))}）`);
});
const STATE = `return { engine: document.getElementById("engine-dialog").open, discard: document.getElementById("discard-dialog").open,
  name: document.getElementById("dlg-name").value, focus: document.activeElement?.id || document.activeElement?.tagName || "",
  url: (() => { const e = document.querySelector('#engine-dialog .field-error[data-for="url"]'); return e && !e.hidden ? e.textContent : ""; })() };`;
const state = page => page.run(STATE);
// 在名称框里输入（先聚焦，像用户一样；派发 input 事件）
const setField = (page, id, value) => page.run(`const el = document.getElementById(${J(id)}); el.focus(); el.value = ${J(value)};
  el.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
// 等存储里 ec 的名称变成 want（最多 5 秒），返回最后一次读到的
async function ecName(ctx, want) {
  const end = Date.now() + 5000;
  for (;;) {
    const name = (await readKeys(ctx.ext, ["customEngines"])).customEngines?.find(e => e.id === "ec")?.name;
    if (name === want || Date.now() > end) return name;
    await sleep(100);
  }
}
const syncDigest = ctx =>ctx.ext.eval(`chrome.storage.sync.get(null).then(v => JSON.stringify(v))`);

// 打开（opener 的可信点击）→ 点遮罩 → 关掉、没弹确认框
async function closesOnBackdrop(ctx, page, { tab, opener, dialog }) {
  await showTab(page, tab);
  await clickEl(ctx, page, opener);
  await until(page, isOpen(dialog), `#${opener} 打开 #${dialog}`);
  await clickBackdrop(ctx, page, dialog);
  await until(page, `!${isOpen(dialog)}`, `点外部后 #${dialog} 关掉`);
  if (await page.run(`return ${isOpen("discard-dialog")};`)) throw new Error(`#${dialog} 没改过，点外部不该弹 #discard-dialog`);
  return `#${opener} → #${dialog} → 点外部关掉`;
}

const openEditEc = async (ctx, page) => {
  await clickEl(ctx, page, "edit-ec");
  await until(page, isOpen("engine-dialog"), "#edit-ec 打开 #engine-dialog");
};
const NEW_NAME = "模拟引擎 C 改名";

async function confirmFlow(ctx, page, items) {
  const step = async (name, fn) => {
    const r = await sub(name, fn);
    items.push(r);
    if (r.status === "fail") {
      await page.run(`for (const id of ["discard-dialog", "engine-dialog"]) { const d = document.getElementById(id); if (d.open) d.close(); } return true;`).catch(() => {});
    }
  };
  await showTab(page, "engines");

  await step("(c) 改了名称后点外部：#discard-dialog 打开、焦点在 #discard-save", async () => {
    await openEditEc(ctx, page);
    await setField(page, "dlg-name", NEW_NAME);
    await clickBackdrop(ctx, page, "engine-dialog");
    await until(page, isOpen("discard-dialog"), "#discard-dialog 打开");
    const s = await state(page);
    const p = [];
    if (!s.engine) p.push("#engine-dialog 应还开着");
    if (s.focus !== "discard-save") p.push(`焦点应在 #discard-save，实际 ${s.focus}`);
    return verdict(p, `确认框打开，焦点 ${s.focus}`);
  });

  await step("(d) “继续编辑”：确认框关、表单仍开、修改还在、焦点回到名称框", async () => {
    await clickEl(ctx, page, "discard-keep");
    await until(page, `!${isOpen("discard-dialog")}`, "#discard-dialog 关掉");
    const s = await state(page);
    const p = [];
    if (!s.engine) p.push("#engine-dialog 应还开着");
    if (s.name !== NEW_NAME) p.push(`名称应仍是“${NEW_NAME}”，实际“${s.name}”`);
    if (s.focus !== "dlg-name") p.push(`焦点应回到 #dlg-name，实际 ${s.focus}`);
    return verdict(p, `表单开着，名称“${s.name}”，焦点 ${s.focus}`);
  });

  await step("(d′) 确认框上按 Esc：只关确认框，表单仍开、修改还在、焦点回到名称框", async () => {
    await clickBackdrop(ctx, page, "engine-dialog");
    await until(page, isOpen("discard-dialog"), "#discard-dialog 打开");
    await pressEsc(ctx, page);
    await until(page, `!${isOpen("discard-dialog")}`, "Esc 后 #discard-dialog 关掉");
    await sleep(200); // close 事件异步派发，等它跑完再读焦点
    const s = await state(page);
    const p = [];
    if (!s.engine) p.push("#engine-dialog 应还开着");
    if (s.name !== NEW_NAME) p.push(`名称应仍是“${NEW_NAME}”，实际“${s.name}”`);
    if (s.focus !== "dlg-name") p.push(`焦点应回到 #dlg-name，实际 ${s.focus}`);
    return verdict(p, `Esc 只关确认框，名称“${s.name}”，焦点 ${s.focus}`);
  });

  await step("(e) 确认框的遮罩等同“继续编辑”；再点外部 →“不保存”：两个都关，存储不变", async () => {
    const before = await syncDigest(ctx);
    const p = [];
    await clickBackdrop(ctx, page, "engine-dialog");
    await until(page, isOpen("discard-dialog"), "#discard-dialog 打开");
    await clickBackdrop(ctx, page, "discard-dialog");
    await until(page, `!${isOpen("discard-dialog")}`, "点确认框外部后它关掉");
    await sleep(200);
    const kept = await state(page);
    if (!kept.engine || kept.name !== NEW_NAME) p.push(`点确认框外部应回到表单、修改还在，实际 ${J(kept)}`);
    if (kept.focus !== "dlg-name") p.push(`点确认框外部后焦点应回到 #dlg-name，实际 ${kept.focus}`);
    await clickBackdrop(ctx, page, "engine-dialog");
    await until(page, isOpen("discard-dialog"), "#discard-dialog 再次打开");
    await clickEl(ctx, page, "discard-drop");
    await until(page, `!${isOpen("discard-dialog")} && !${isOpen("engine-dialog")}`, "两个对话框都关掉");
    await sleep(300);
    if (await syncDigest(ctx) !== before) p.push("“不保存”后 storage.sync 变了");
    // 焦点同“取消”：对话框原生归还给打开它的 #edit-ec
    const dropped = await state(page);
    if (dropped.focus !== "edit-ec") p.push(`“不保存”后焦点应同“取消”回到 #edit-ec，实际 ${dropped.focus}`);
    return verdict(p, `确认框外部回到表单、焦点 ${kept.focus}；“不保存”后两个都关，storage.sync 不变，焦点 ${dropped.focus}`);
  });

  await step("(f) 再改 →“保存”：两个都关，存储写入新名称", async () => {
    await openEditEc(ctx, page);
    await setField(page, "dlg-name", NEW_NAME);
    await clickBackdrop(ctx, page, "engine-dialog");
    await until(page, isOpen("discard-dialog"), "#discard-dialog 打开");
    await clickEl(ctx, page, "discard-save");
    await until(page, `!${isOpen("discard-dialog")} && !${isOpen("engine-dialog")}`, "保存后两个对话框都关掉");
    const name = await ecName(ctx, NEW_NAME);
    return verdict(name === NEW_NAME ? [] : [`customEngines 里 ec 的名称应为“${NEW_NAME}”，实际 ${J(name)}`], `ec 改名为“${name}”`);
  });

  await step("(g) 网址改成非法值 →“保存”：确认框关、表单留着并显示网址的字段错误", async () => {
    await openEditEc(ctx, page);
    await setField(page, "dlg-url", "not a url");
    await clickBackdrop(ctx, page, "engine-dialog");
    await until(page, isOpen("discard-dialog"), "#discard-dialog 打开");
    await clickEl(ctx, page, "discard-save");
    const s = await until(page, `(() => { const s = (() => { ${STATE} })(); return !s.discard && s.engine && s.url && s; })()`, "表单显示网址错误");
    await clickEl(ctx, page, "dlg-cancel");
    await until(page, `!${isOpen("engine-dialog")}`, "“取消”关掉表单");
    return { status: "pass", detail: `网址错误“${s.url}”` };
  });

  await step("(h) 在名称框里按下、移到遮罩点松开：不关闭、不弹确认", async () => {
    await openEditEc(ctx, page);
    await dragOut(ctx, page, "dlg-name", "engine-dialog");
    await sleep(300);
    const s = await state(page);
    const p = [];
    if (!s.engine) p.push("#engine-dialog 不该关掉");
    if (s.discard) p.push("不该弹 #discard-dialog");
    return verdict(p, "表单开着，没有确认框");
  });

  await step("(i) 改过后按 Esc、点“取消”：表单直接关、不弹确认", async () => {
    const p = [];
    await setField(page, "dlg-name", NEW_NAME + "2");
    await pressEsc(ctx, page);
    await sleep(300);
    let s = await state(page);
    if (s.engine || s.discard) p.push(`Esc 后应直接关掉、不弹确认，实际 engine ${s.engine}、discard ${s.discard}`);
    await openEditEc(ctx, page);
    await setField(page, "dlg-name", NEW_NAME + "3");
    await clickEl(ctx, page, "dlg-cancel");
    await sleep(300);
    s = await state(page);
    if (s.engine || s.discard) p.push(`“取消”后应直接关掉、不弹确认，实际 engine ${s.engine}、discard ${s.discard}`);
    if (page.dialogs.length) p.push(`弹了 JS 对话框：${page.dialogs.join("；")}`);
    return verdict(p, "Esc、“取消”都直接关掉");
  });

  await step("(j) 保存进行中（storage.sync.set 被扣住）点外部：不关、不弹确认；放行后只写一次", async () => {
    const p = [];
    await openEditEc(ctx, page);
    await setField(page, "dlg-name", NEW_NAME + "慢");
    await page.run(HOLD_SETS);
    try {
      await clickEl(ctx, page, "dlg-save");
      await until(page, `document.getElementById("dlg-save").disabled && window.__e2eSets === 1`, "保存按钮禁用、set 被扣住");
      await clickBackdrop(ctx, page, "engine-dialog");
      await sleep(300);
      const s = await state(page);
      if (!s.engine) p.push("保存进行中点外部不该关掉 #engine-dialog");
      if (s.discard) p.push("保存进行中点外部不该弹 #discard-dialog");
      await page.run(`return window.__e2eRelease();`);
      await until(page, `!${isOpen("engine-dialog")} && !${isOpen("discard-dialog")}`, "放行后两个对话框都关掉");
      const sets = await page.run(`return window.__e2eSets;`);
      if (sets !== 1) p.push(`storage.sync.set 应只调用 1 次，实际 ${sets}`);
      const name = await ecName(ctx, NEW_NAME + "慢");
      if (name !== NEW_NAME + "慢") p.push(`ec 的名称应为“${NEW_NAME}慢”，实际 ${J(name)}`);
      return verdict(p, `保存中点外部不关不问，set ${sets} 次，ec 改名为“${name}”`);
    } finally {
      await page.run(`window.__e2eRelease?.(); window.__e2eRestore?.(); return true;`).catch(() => {});
    }
  });
}

// 在设置页里扣住 chrome.storage.sync.set：调用计数，结果等 __e2eRelease() 才放行；__e2eRestore() 换回原来的函数
const HOLD_SETS = `const area = chrome.storage.sync, orig = area.set, held = [];
  window.__e2eSets = 0;
  area.set = function (...args) { window.__e2eSets++; return new Promise((res, rej) => held.push(() => orig.apply(area, args).then(res, rej))); };
  if (area.set === orig) throw new Error("chrome.storage.sync.set 换不掉");
  window.__e2eRelease = () => { const fs = held.splice(0); fs.forEach(f => f()); return fs.length; };
  window.__e2eRestore = () => { area.set = orig; delete window.__e2eRelease; delete window.__e2eRestore; };
  return true;`;

const B22 = {
  id: "B22", title: "设置页对话框点外部：引擎库关闭、表单没改关闭、改过先问（继续编辑 / Esc / 不保存 / 保存）、拖出不算、Esc 与取消不问、保存中不问（自动判定）",
  kind: "auto", needs: [], timeoutMs: 120000,
  run: ctx => guarded(ctx, ["customEngines"], async () => {
    const page = await openOptions(ctx.browser, { tab: "engines" });
    try {
      await ctx.browser.client.send("Target.activateTarget", { targetId: page.targetId }).catch(() => {});
      const items = [];
      items.push(await sub("(a) 两个引擎库点外部关闭", async () => verdict([], [
        await closesOnBackdrop(ctx, page, { tab: "engines", opener: "catalog-open", dialog: "catalog-dialog" }),
        await closesOnBackdrop(ctx, page, { tab: "lookup", opener: "image-catalog-open", dialog: "image-catalog-dialog" }),
      ].join("；"))));
      items.push(await sub("(b) 三个表单没改过时点外部关闭、不弹确认", async () => {
        const done = [await closesOnBackdrop(ctx, page, { tab: "lookup", opener: "image-add-open", dialog: "image-dialog" }),
          await closesOnBackdrop(ctx, page, { tab: "pair", opener: "rule-add", dialog: "rule-dialog" })];
        await showTab(page, "engines");
        await openEditEc(ctx, page);
        await clickBackdrop(ctx, page, "engine-dialog");
        await until(page, `!${isOpen("engine-dialog")}`, "点外部后 #engine-dialog 关掉");
        if (await page.run(`return ${isOpen("discard-dialog")};`)) throw new Error("#engine-dialog 没改过，点外部不该弹确认");
        return verdict([], [...done, "#edit-ec → #engine-dialog → 点外部关掉"].join("；"));
      }));
      await confirmFlow(ctx, page, items);
      return summarize(items);
    } finally { await page.close(); }
  }),
};

export const V07_DIALOG_STEPS = [B22];
