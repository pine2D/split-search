// 设置页自动步骤（一）：B2（工具栏图标出现弹窗）B3 B6 B7 B8 B10 B11
import { EXT_ID } from "../config.mjs";
import { pageTargets, siteX, nonce } from "./util.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import {
  withOptions, fillDialog, dialogState, closeDialog,
  readKeys, BAIDU, hasEngine, addCustom, guarded, keySel,
} from "./optpage.mjs";
import { msg } from "../i18n.mjs";

// 有 action.default_popup 时，Extensions.triggerAction（只接受 tab 目标）会出现 type "page"、网址为 popup.html 的目标（Task 8 实测）
const popupTargets = async browser => (await pageTargets(browser)).filter(t => t.url.startsWith(POPUP_URL));

const OPTIONS_PREFIX = `chrome-extension://${EXT_ID}/options/`;

// 弹窗里的“打开设置”：openOptionsPage 在已有设置页时只把它切到前台、不新开。所以先让设置页标签都退到后台
// （在它所在的窗口里新开一个 site-x 标签），再点按钮：出现新的设置页目标，或某个设置页标签回到前台，都算打开了。
// 返回 { problems, how }（how："new" 新开了设置页 | "activated" 已有的设置页回到前台）。made 收集新开的 site-x 标签 id，由 B2 收尾关掉
async function openOptionsFromPopup(ctx, page, made) {
  const J = JSON.stringify;
  const blank = siteX(ctx.port, `/b2-open-options?n=${nonce()}`);
  made.push(...await ctx.ext.eval(`(async () => {
    const made = [];
    for (const t of await chrome.tabs.query({ active: true })) {
      if (t.url?.startsWith(${J(OPTIONS_PREFIX)})) made.push((await chrome.tabs.create({ windowId: t.windowId, url: ${J(blank)}, active: true })).id);
    }
    return made;
  })()`));
  const optionTargets = async () => (await pageTargets(ctx.browser)).filter(t => t.url.startsWith(OPTIONS_PREFIX));
  const before = new Set((await optionTargets()).map(t => t.targetId));
  const activeOptions = `chrome.tabs.query({ active: true }).then(ts => ts.some(t => t.url?.startsWith(${J(OPTIONS_PREFIX)})))`;
  if (await ctx.ext.eval(activeOptions)) return { problems: ["没能先把设置页标签切到后台，无法判断“打开设置”是否生效"] };
  if (!(await page.ev(`(() => { const b = document.getElementById("open-options"); if (!b) return false; b.click(); return true; })()`))) {
    return { problems: ["弹窗里找不到“打开设置”按钮"] };
  }
  const how = await ctx.browser.waitFor(async () => {
    if ((await optionTargets()).some(t => !before.has(t.targetId))) return "new";
    return (await ctx.ext.eval(activeOptions)) && "activated";
  }, { timeoutMs: 10000, intervalMs: 200 }).catch(() => null);
  return { how, problems: how ? [] : ["点弹窗的“打开设置”后 10 秒内既没有新的设置页，也没有设置页回到前台"] };
}

const B2 = {
  id: "B2", title: "点工具栏图标出现弹窗，弹窗里的“打开设置”能打开设置页", kind: "auto", needs: [],
  async run(ctx) {
    const { browser } = ctx;
    // triggerAction 只接受 tab 目标：取一个非扩展页的 tab（没有就新建 about:blank）
    const tabs = async () => (await browser.client.send("Target.getTargets", { filter: [{ type: "tab" }] })).targetInfos;
    const notExt = list => list.find(t => !t.url.startsWith(`chrome-extension://${EXT_ID}/`));
    let host = notExt(await tabs());
    let blankTarget = null; // 本步新开的 about:blank，结束时关掉
    if (!host) {
      ({ targetId: blankTarget } = await browser.client.send("Target.createTarget", { url: "about:blank" }));
      host = await browser.waitFor(async () => notExt(await tabs()), { timeoutMs: 5000 });
    }
    try {
      return await popupFlow(ctx, host);
    } finally {
      if (blankTarget) await browser.client.send("Target.closeTarget", { targetId: blankTarget }).catch(() => {});
    }
  },
};

// B2 主体：触发图标动作 → 弹窗渲染 → 点“打开设置”
async function popupFlow(ctx, host) {
  const { browser } = ctx;
  for (const t of await popupTargets(browser)) await browser.client.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  await browser.waitFor(async () => (await popupTargets(browser)).length === 0, { timeoutMs: 5000 });
  const manifest = await ctx.ext.eval("chrome.runtime.getManifest().action?.default_popup ?? null");
  if (manifest !== "popup/popup.html") return { status: "fail", detail: `manifest 的 action.default_popup 应为 popup/popup.html，实际 ${manifest}` };
  await browser.client.send("Extensions.triggerAction", { id: EXT_ID, targetId: host.targetId });
  const t = await browser.waitFor(async () => (await popupTargets(browser))[0], { timeoutMs: 10000 }).catch(() => null);
  if (!t) return { status: "fail", detail: "触发扩展图标动作后 10 秒内没有出现弹窗页" };
  const page = await popupPage(ctx, { targetId: t.targetId });
  const made = [];
  try {
    const s = await page.read().catch(e => ({ err: e.message }));
    if (s.err) return { status: "fail", detail: `出现了弹窗页 ${t.url}，但 10 秒内没有渲染完（${s.err}）` };
    const { problems: p, how } = await openOptionsFromPopup(ctx, page, made);
    if (p.length) return { status: "fail", detail: `弹窗已渲染，但${p.join("；")}` };
    return { status: "pass", detail: `触发图标动作后出现弹窗页 ${t.url}，已渲染（${s.ours ? `本扩展的一对：${s.left} ｜ ${s.right}` : `说明文字“${s.notOursText}”`}）；点“打开设置”后${how === "new" ? "新开了设置页" : "已有的设置页回到前台"}` };
  } finally {
    await page.close();
    // 不留现场：关掉为了把设置页切到后台而新开的 site-x 标签（设置页随之回到前台）
    if (made.length) await ctx.ext.eval(`chrome.tabs.remove(${JSON.stringify(made)}).then(() => true, () => false)`).catch(() => {});
  }
}

const B3 = {
  id: "B3", title: "无痕模式不可用（not_allowed）", kind: "auto", needs: [],
  async run({ ext }) {
    const [allowed, mode] = await ext.eval(`(async () => [await chrome.extension.isAllowedIncognitoAccess(), chrome.runtime.getManifest().incognito])()`);
    const problems = [];
    if (allowed !== false) problems.push(`isAllowedIncognitoAccess() 应为 false，实际 ${allowed}`);
    if (mode !== "not_allowed") problems.push(`manifest.incognito 应为 not_allowed，实际 ${mode}`);
    if (problems.length) return { status: "fail", detail: problems.join("；") };
    return { status: "pass", detail: "isAllowedIncognitoAccess() = false；manifest.incognito = not_allowed" };
  },
};

const B6 = {
  id: "B6", title: "新增引擎 id 含大写：提示格式错误且对话框不关", kind: "auto", needs: [],
  async run({ browser, ext }) {
    return withOptions(browser, async page => {
      await page.run(`document.getElementById("add-engine").click(); return true;`);
      await fillDialog(page, { id: "Baidu", name: "百度", url: BAIDU.url });
      await page.until(`return !!document.querySelector('#engine-dialog .field-error[data-for="id"]:not([hidden])')`);
      const st = await dialogState(page);
      const stored = (await hasEngine(ext, "Baidu")) || (await hasEngine(ext, "baidu"));
      await closeDialog(page);
      const problems = [];
      if (st.id !== msg("err_id_format")) problems.push(`id 旁应提示“${msg("err_id_format")}”，实际 ${JSON.stringify(st.id)}`);
      if (!st.open) problems.push("对话框被关闭了");
      if (stored) problems.push("引擎被错误地保存了");
      if (problems.length) return { status: "fail", detail: problems.join("；") };
      return { status: "pass", detail: `id 旁提示“${st.id}”，对话框仍打开，未保存` };
    });
  },
};

const B7 = {
  id: "B7", title: "新增百度：id 按网址自动生成、列表末尾出现且授权按钮高亮；删除要点两次", kind: "auto", needs: [],
  async run({ browser, ext }) {
    try {
      return await withOptions(browser, async page => {
        await page.run(`document.getElementById("add-engine").click(); return true;`);
        // 只填名称和网址：中文名生成不出 id，回退到网址 host 的第一段（去掉 www.）→ baidu
        await page.run(`
          const set = (n, v) => { const el = document.getElementById("dlg-" + n); el.value = v; el.dispatchEvent(new Event("input")); };
          set("name", ${JSON.stringify(BAIDU.name)}); set("url", ${JSON.stringify(BAIDU.url)}); return true;`);
        const auto = await page.run(`return { id: document.getElementById("dlg-id").value, advancedOpen: document.getElementById("dlg-advanced").open,
          order: [...document.querySelectorAll("#engine-form input")].map(i => i.id) }`);
        await fillDialog(page, {});
        await page.until(`return !document.getElementById("engine-dialog").open && !!row("baidu")`);
        const r = await page.run(`
          const last = ids().at(-1), rw = row("baidu"), b = rw.querySelector(${keySel("engine_grant")});
          const notice = [...document.querySelectorAll("#notices .notice-text")].map(n => n.textContent).find(t => t.includes(${JSON.stringify(msg("notice_needs_grant"))}));
          return { last, hasAuth: !!b, attention: !!b && b.classList.contains("btn-attention"), name: rw.querySelector(".engine-name").textContent, notice: notice || "" };`);
        const problems = [];
        if (auto.id !== "baidu") problems.push(`id 应自动生成为 baidu，实际 ${JSON.stringify(auto.id)}`);
        if (auto.advancedOpen) problems.push("“高级”应默认收起");
        if (auto.order.join() !== "dlg-name,dlg-url,dlg-id") problems.push(`字段顺序应为 名称、网址、id，实际 ${auto.order.join(",")}`);
        if (r.last !== "baidu") problems.push(`列表末尾应是 baidu，实际 ${r.last}`);
        if (r.name !== "百度") problems.push(`名称应为百度，实际 ${r.name}`);
        if (!r.hasAuth) problems.push("没有“授权”按钮");
        else if (!r.attention) problems.push("授权按钮没有高亮（btn-attention）");
        if (!r.notice) problems.push("没有“尚未授权”的提示");
        // 顺带验证两步删除：点一次只变成“确认删除？”、不删；再点一次才删
        const once = await page.run(`row("baidu").querySelector(${keySel("engine_delete")}).click(); await sleep(300);
          return { still: !!row("baidu"), text: row("baidu")?.querySelector("#remove-baidu")?.textContent ?? "" };`);
        if (!once.still) problems.push("只点一次“删除”就删掉了");
        if (once.text !== msg("engine_delete_confirm")) problems.push(`点一次后按钮应为“${msg("engine_delete_confirm")}”，实际“${once.text}”`);
        await page.run(`document.getElementById("remove-baidu").click(); return true;`);
        await page.until(`return !row("baidu")`);
        if (page.dialogs.length) problems.push(`不该弹 JS 对话框，实际弹了 ${page.dialogs.length} 个`);
        if (problems.length) return { status: "fail", detail: problems.join("；") };
        return { status: "pass", detail: "id 按网址自动生成 baidu（“高级”收起，字段顺序 名称、网址、id）；百度出现在列表末尾，授权按钮高亮，右下角有未授权提示；删除点一次变成“确认删除？”，再点才删，没有弹框" };
      });
    } finally { /* 清理由 guarded 统一恢复 */ }
  },
};

const B8 = {
  id: "B8", title: "其他组合：百度｜Google 触发网址与复制", kind: "auto", needs: [],
  async run({ browser, ext }) {
    const want = "https://www.baidu.com/s?wd=%s&_ss=baidu,google";
    await addCustom(ext, BAIDU);
    try {
      return await withOptions(browser, async page => {
        await page.until(`return !!row("baidu")`);
        const url = await page.run(`
          const set = (id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change")); };
          set("gen-left", "baidu"); set("gen-right", "google");
          await sleep(100);
          return document.querySelector(".gen-output .url-box")?.textContent ?? "";`);
        if (url !== want) return { status: "fail", detail: `触发网址应为 ${want}，实际 ${url || "(空)"}` };
        await page.ev(`document.querySelector(".gen-output .url-line button").click(); true`, { userGesture: true });
        const copiedText = msg("common_copied");
        const copied = await page.until(`return document.querySelector(".gen-output .url-line button").textContent === ${JSON.stringify(copiedText)}`, 3000).catch(() => false);
        if (copied) return { status: "pass", detail: `网址 ${url}；点“复制”后按钮变为“${copiedText}”` };
        const failPrefix = msg("notice_copy_failed", "\0").split("\0")[0]; // 提示里错误详情之前的部分
        const err = await page.run(`return [...document.querySelectorAll("#notices .notice-text")].map(n => n.textContent).find(t => t.startsWith(${JSON.stringify(failPrefix)})) || ""`);
        return { status: "fail", detail: `网址正确，但按钮没有变为“${copiedText}”；${err ? "页面提示：" + err : "也没有出现复制失败提示"}` };
      });
    } finally { /* 清理由 guarded 统一恢复 */ }
  },
};

const B10 = {
  id: "B10", title: "默认组合引用的引擎不能隐藏/删除", kind: "auto", needs: [],
  async run({ browser, ext }) {
    const probe = ids => `
      const out = {};
      for (const id of ${JSON.stringify(ids)}) {
        const rw = row(id), b = rw && (rw.querySelector(${keySel("engine_hide")}) || rw.querySelector(${keySel("engine_delete")}));
        out[id] = !rw ? "无此行" : !b ? "无按钮" : b.disabled ? "禁用" : "可用";
      }
      return out;`;
    return withOptions(browser, async page => {
      try {
        const cur = await page.run(probe(["ea", "eb", "ec", "ddg"]));
        const problems = [];
        for (const id of ["ea", "eb"]) if (cur[id] !== "禁用") problems.push(`${id} 的隐藏/删除应禁用，实际 ${cur[id]}`);
        for (const id of ["ec", "ddg"]) if (cur[id] !== "可用") problems.push(`${id} 的隐藏/删除应可用，实际 ${cur[id]}`);
        // 再把默认组合切到 Google ｜ Bing，验证预置引擎的“隐藏”同样被禁用
        await page.run(`
          const set = (id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change")); };
          set("pair-left", "google"); set("pair-right", "bing"); return true;`);
        await page.until(`return document.getElementById("pair-left").value === "google" && row("google")?.querySelector(${keySel("engine_hide")})?.disabled === true`);
        const gb = await page.run(probe(["google", "bing", "ddg", "ea"]));
        for (const id of ["google", "bing"]) if (gb[id] !== "禁用") problems.push(`默认组合为 Google ｜ Bing 时 ${id} 的隐藏应禁用，实际 ${gb[id]}`);
        for (const id of ["ddg", "ea"]) if (gb[id] !== "可用") problems.push(`默认组合为 Google ｜ Bing 时 ${id} 应可用，实际 ${gb[id]}`);
        if (problems.length) return { status: "fail", detail: problems.join("；") };
        return { status: "pass", detail: `当前默认组合 ea｜eb：ea、eb 禁用，ec、ddg 可用；切到 Google｜Bing 后：google、bing 的“隐藏”禁用，ddg、ea 可用（已还原默认组合）` };
      } finally { /* 默认组合由 guarded 恢复 */ }
    });
  },
};

const B11 = {
  id: "B11", title: "默认左侧改成非左侧模板被拒绝", kind: "auto", needs: [],
  async run({ browser, ext, port }) {
    const bad = `http://engine-a.localhost:${port}/wiki/%s`;
    const before = (await readKeys(ext, ["customEngines"])).customEngines;
    return withOptions(browser, async page => {
      await page.run(`row("ea").querySelector(${keySel("engine_edit")}).click(); return true;`);
      await fillDialog(page, { url: bad });
      await page.until(`return !!document.querySelector('#engine-dialog .field-error[data-for="url"]:not([hidden])')`);
      const st = await dialogState(page);
      await closeDialog(page);
      const after = (await readKeys(ext, ["customEngines"])).customEngines;
      const problems = [];
      if (st.url !== msg("err_default_left_url")) problems.push(`url 旁应说明原因（${msg("err_default_left_url").slice(0, 30)}…），实际 ${JSON.stringify(st.url)}`);
      if (!st.open) problems.push("对话框被关闭了");
      if (JSON.stringify(before) !== JSON.stringify(after)) problems.push("存储被修改了");
      if (problems.length) return { status: "fail", detail: problems.join("；") };
      return { status: "pass", detail: `左侧 ea 改为 ${bad} 被拒绝：${st.url.slice(0, 60)}…；对话框仍打开，存储未变` };
    });
  },
};

// 每个步骤涉及的存储键：无论成败都恢复成步骤前的值
const wrap = (step, keys) => ({ ...step, run: ctx => guarded(ctx, keys, () => step.run(ctx)) });
export const B_STEPS_1 = [B2, B3, wrap(B6, ["customEngines", "order"]), wrap(B7, ["customEngines", "order"]),
  wrap(B8, ["customEngines", "order"]), wrap(B10, ["defaultPair"]), wrap(B11, ["customEngines"])];
