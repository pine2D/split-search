// 设置页自动步骤（一）：B2（工具栏图标出现弹窗）B3 B6 B7 B8 B11（B10 在 options-b2.mjs）
import { EXT_ID } from "../config.mjs";
import { pageTargets, siteX, nonce } from "./util.mjs";
import { POPUP_URL, popupPage } from "./v03-popup.mjs";
import {
  withOptions, fillDialog, dialogState, closeDialog, openEdit, dangerState,
  readKeys, BAIDU, hasEngine, addCustom, guarded, keySel, sleep,
} from "./optpage.mjs";
import { msg } from "../i18n.mjs";

// 有 action.default_popup 时，Extensions.triggerAction（只接受 tab 目标）会出现 type "page"、网址为 popup.html 的目标（Task 8 实测）
const popupTargets = async browser => (await pageTargets(browser)).filter(t => t.url.startsWith(POPUP_URL));

const OPTIONS_PREFIX = `chrome-extension://${EXT_ID}/options/`;

// 弹窗里的“打开设置”：openOptionsPage 在已有设置页时只把它切到前台、不新开。所以先让设置页标签都退到后台
// （在它所在的窗口里新开一个 site-x 标签），再点按钮：出现新的设置页目标，或某个设置页标签回到前台，都算打开了。
// 返回 { problems, how }（how："new" 新开了设置页 | "activated" 已有的设置页回到前台）。made 收集新开的 site-x 标签 id，由 B2 收尾关掉
export async function openOptionsFromPopup(ctx, page, made) {
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
    }, { tab: "engines" });
  },
};

const B7 = {
  id: "B7", title: "新增百度：id 按网址自动生成、列表末尾出现且授权按钮高亮；删除在编辑对话框里、要点两次", kind: "auto", needs: [],
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
          const st = rw.querySelector(".perm");
          return { last, hasAuth: !!b, attention: !!b && b.classList.contains("btn-attention"), name: rw.querySelector(".engine-name").textContent, notice: notice || "",
            perm: st ? st.className : "", permText: st ? st.textContent.trim() : "" };`);
        const problems = [];
        if (auto.id !== "baidu") problems.push(`id 应自动生成为 baidu，实际 ${JSON.stringify(auto.id)}`);
        if (auto.advancedOpen) problems.push("“高级”应默认收起");
        if (auto.order.join() !== "dlg-name,dlg-url,dlg-id") problems.push(`字段顺序应为 名称、网址、id，实际 ${auto.order.join(",")}`);
        if (r.last !== "baidu") problems.push(`列表末尾应是 baidu，实际 ${r.last}`);
        if (r.name !== "百度") problems.push(`名称应为百度，实际 ${r.name}`);
        if (!r.hasAuth) problems.push("没有“授权”按钮");
        else if (!r.attention) problems.push("授权按钮没有高亮（btn-attention）");
        // 百度不是默认组合左侧：状态是中性的“未授权（可选）”，只有授权按钮高亮（attention 与 perm-optional 同时出现）
        if (!r.perm.split(" ").includes("perm-optional") || r.permText !== msg("engine_not_granted_optional"))
          problems.push(`状态应是 perm-optional“${msg("engine_not_granted_optional")}”，实际 ${r.perm}“${r.permText}”`);
        if (!r.notice) problems.push("没有“尚未授权”的提示");
        const del = await deleteViaDialog(browser, page, problems);
        if (page.dialogs.length) problems.push(`不该弹 JS 对话框，实际弹了 ${page.dialogs.length} 个`);
        if (problems.length) return { status: "fail", detail: problems.join("；") };
        return { status: "pass", detail: `id 按网址自动生成 baidu（“高级”收起，字段顺序 名称、网址、id）；百度出现在列表末尾，状态是中性的“未授权（可选）”、授权按钮高亮，右下角有未授权提示；${del}；没有弹框` };
      }, { tab: "engines" });
    } finally { /* 清理由 guarded 统一恢复 */ }
  },
};

// 删除在编辑对话框里：行上没有“删除”；新增模式下危险区全藏；点一次只变成“确认删除？”（Esc 先撤确认、再按才关对话框），
// 再点才删，对话框关闭、焦点交给相邻一行（baidu 在末尾，即前一行）的“编辑”。返回通过时的说明，问题追加到 problems
async function deleteViaDialog(browser, page, problems) {
  const J = JSON.stringify;
  const pre = await page.run(`const a = ids(); return { prev: a[a.indexOf("baidu") - 1] ?? null, inline: !!row("baidu").querySelector(${keySel("engine_delete")}) };`);
  if (pre.inline) problems.push("引擎行上不该再有“删除”按钮");
  await openEdit(page, "baidu");
  const edit = await dangerState(page);
  if (!edit.del || edit.hide || edit.btn?.ariaDisabled) problems.push(`百度的编辑对话框应只显示可用的“删除”，实际 ${J(edit)}`);
  await closeDialog(page);
  await page.run(`document.getElementById("add-engine").click(); return true;`);
  await page.until(`return document.getElementById("engine-dialog").open`);
  const add = await dangerState(page);
  if (add.danger || add.hide || add.del || add.reason) problems.push(`先编辑过自定义引擎再打开“新增引擎”，危险区应全部不可见，实际 ${J(add)}`);
  await closeDialog(page);
  await openEdit(page, "baidu");
  const once = await page.run(`const b = document.getElementById("dlg-delete"); b.focus(); b.click(); await sleep(300);
    return { still: !!row("baidu"), open: document.getElementById("engine-dialog").open, text: b.textContent, hint: ${DEL_HINT} };`);
  if (!once.still || !once.open) problems.push(`只点一次“删除”：行应还在、对话框应还开着，实际 行${once.still ? "在" : "没了"}、对话框${once.open ? "开着" : "关了"}`);
  if (once.text !== msg("engine_delete_confirm")) problems.push(`点一次后按钮应为“${msg("engine_delete_confirm")}”，实际“${once.text}”`);
  problems.push(...hintProblems(once.hint));
  const esc = await escTwice(browser, page);
  if (esc.first.text !== msg("engine_delete") || !esc.first.open) problems.push(`确认态下第一次 Esc 应只撤确认、对话框不关，实际 ${J(esc.first)}`);
  if (esc.first.hint?.text || esc.first.hint?.describedBy) problems.push(`撤销确认后提醒应清空、去掉 aria-describedby，实际 ${J(esc.first.hint)}`);
  if (esc.second.open) problems.push("第二次 Esc 应关掉对话框");
  await openEdit(page, "baidu");
  await page.run(`const b = document.getElementById("dlg-delete"); b.focus(); b.click(); await sleep(100); b.click(); return true;`);
  await page.until(`return !row("baidu")`);
  const want = pre.prev && `edit-${pre.prev}`;
  const after = await page.until(`return !document.getElementById("engine-dialog").open && document.activeElement?.id === ${J(want)}`, 3000)
    .then(() => null, () => page.run(`return { open: document.getElementById("engine-dialog").open, focus: document.activeElement?.id || document.activeElement?.tagName }`));
  if (after) problems.push(`删除后对话框应关闭、焦点应在 #${want}，实际 ${J(after)}`);
  return `行上没有“删除”，新增模式下危险区全藏；编辑对话框里点一次“删除”变成“确认删除？”，提醒写在对话框里（role="status"，按钮 aria-describedby 指向它），第一次 Esc 只撤确认、第二次关对话框；再点才删，焦点交给 #${want}`;
}

// 删除第一次点击后的提醒：要写在对话框里（模态对话框开着时对话框外的 #notices 是 inert，读屏听不到，还压在遮罩下），
// role="status"，由删除按钮的 aria-describedby 指着；滚到可见后用 elementFromPoint 核对没被别的东西盖住
const DEL_HINT = `(() => { const h = document.getElementById("dlg-delete-hint"), b = document.getElementById("dlg-delete");
  if (!h) return null;
  if (h.textContent) h.scrollIntoView({ block: "nearest" });
  const r = h.getBoundingClientRect(), hit = h.textContent ? h.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) : false;
  return { text: h.textContent, visible: h.checkVisibility(), hit, inDialog: !!h.closest("#engine-dialog"), role: h.getAttribute("role"),
    describedBy: b.getAttribute("aria-describedby"),
    outside: [...document.querySelectorAll("#notices .notice-text")].some(n => n.textContent === ${JSON.stringify(msg("engine_delete_confirm_hint", BAIDU.name))}) }; })()`;

function hintProblems(h) {
  const want = msg("engine_delete_confirm_hint", BAIDU.name);
  if (!h) return ["编辑对话框里没有 #dlg-delete-hint"];
  const p = [];
  if (h.text !== want || !h.visible || !h.hit || !h.inDialog) p.push(`点一次后提醒“${want}”应在 #engine-dialog 里可见、没被遮住，实际 ${JSON.stringify(h)}`);
  if (h.role !== "status") p.push(`#dlg-delete-hint 应 role="status"，实际 ${JSON.stringify(h.role)}`);
  if (h.describedBy !== "dlg-delete-hint") p.push(`确认态的“删除”应 aria-describedby="dlg-delete-hint"，实际 ${JSON.stringify(h.describedBy)}`);
  if (h.outside) p.push("提醒不该再写进对话框外的 #notices（模态对话框开着时那里是 inert）");
  return p;
}

// 对话框开着、焦点在确认态的“删除”上：经 CDP 发真实的 Esc（页内派发的 keydown 不会触发对话框的 cancel），各按一次后读状态
async function escTwice(browser, page) {
  const key = async () => {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await browser.client.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, page.sid);
    }
    await sleep(200);
    return page.run(`return { open: document.getElementById("engine-dialog").open, text: document.getElementById("dlg-delete").textContent, hint: ${DEL_HINT} }`);
  };
  await browser.client.send("Target.activateTarget", { targetId: page.targetId }).catch(() => {});
  return { first: await key(), second: await key() };
}

const B8 = {
  id: "B8", title: "其他组合：默认收起、初值不等于默认组合；百度｜Google 触发网址与复制", kind: "auto", needs: [],
  async run({ browser, ext }) {
    const want = "https://www.baidu.com/s?wd=%s&_ss=baidu,google";
    await addCustom(ext, BAIDU);
    try {
      return await withOptions(browser, async page => {
        await page.until(`return !!row("baidu")`);
        // “其他组合”默认收起、不用默认组合卡的窗格；初值左侧同默认左侧、右侧不是默认右侧
        const pre = await page.run(`
          const l = document.getElementById("gen-left"), r = document.getElementById("gen-right"), d = l?.closest("details");
          const was = d ? d.open : null;
          if (d) d.open = true;
          return { was, panes: !!l?.closest(".pair-pickers"), left: l?.value, right: r?.value,
            pl: document.getElementById("pair-left")?.value, pr: document.getElementById("pair-right")?.value };`);
        const pp = [];
        if (pre.was !== false) pp.push(`“其他组合”应收在默认收起的 <details> 里，实际 ${pre.was === null ? "没有 <details>" : "已展开"}`);
        if (pre.panes) pp.push("生成器不该用默认组合卡的左右窗格");
        if (pre.left !== pre.pl || pre.right === pre.pr || pre.right === pre.left) pp.push(`初值应为左侧 ${pre.pl}、右侧不是 ${pre.pr}，实际 ${pre.left}｜${pre.right}`);
        if (pp.length) return { status: "fail", detail: pp.join("；") };
        const url = await page.run(`
          const set = (id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change")); };
          set("gen-left", "baidu"); set("gen-right", "google");
          await sleep(100);
          return document.querySelector(".gen-output .url-box")?.textContent ?? "";`);
        if (url !== want) return { status: "fail", detail: `触发网址应为 ${want}，实际 ${url || "(空)"}` };
        await page.ev(`document.querySelector(".gen-output .url-line button").click(); true`, { userGesture: true });
        const copiedText = msg("common_copied");
        const copied = await page.until(`return document.querySelector(".gen-output .url-line button").textContent === ${JSON.stringify(copiedText)}`, 3000).catch(() => false);
        if (copied) return { status: "pass", detail: `默认收起，初值 ${pre.left}｜${pre.right}；网址 ${url}；点“复制”后按钮变为“${copiedText}”` };
        const failPrefix = msg("notice_copy_failed", "\0").split("\0")[0]; // 提示里错误详情之前的部分
        const err = await page.run(`return [...document.querySelectorAll("#notices .notice-text")].map(n => n.textContent).find(t => t.startsWith(${JSON.stringify(failPrefix)})) || ""`);
        return { status: "fail", detail: `网址正确，但按钮没有变为“${copiedText}”；${err ? "页面提示：" + err : "也没有出现复制失败提示"}` };
      }, { tab: "add" });
    } finally { /* 清理由 guarded 统一恢复 */ }
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
    }, { tab: "engines" });
  },
};

// 每个步骤涉及的存储键：无论成败都恢复成步骤前的值
const wrap = (step, keys) => ({ ...step, run: ctx => guarded(ctx, keys, () => step.run(ctx)) });
export const B_STEPS_1 = [B2, B3, wrap(B6, ["customEngines", "order"]), wrap(B7, ["customEngines", "order"]),
  wrap(B8, ["customEngines", "order"]), wrap(B11, ["customEngines"])];
