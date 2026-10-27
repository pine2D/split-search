// 设置页自动步骤（二）：B10 B12 B13 B15（B13 的实现在 options-b3.mjs）
import { openOptions, withOptions, guarded, keySel, openEdit, closeDialog, dangerState, readKeys, setReorder } from "./optpage.mjs";
import { msg } from "../i18n.mjs";
import { pressEsc, B13_STEP } from "./options-b3.mjs";

const J = JSON.stringify;

// 打开某一行的编辑对话框读危险区；press 时再点一下看得见的那个按钮（不可用时应没有效果），300 ms 后读回，最后点“取消”。
// 读回对话框是否还开着、#notices 里有没有新的出错提示：对话框自己的拦截失效时，edits.js 还会以 pair_uses_* 拒绝，
// 行照样在、文字不变，只有“对话框被关掉 + 一条出错提示”能说明第一道拦截坏了
async function probeEdit(page, id, press = false) {
  await openEdit(page, id);
  const s = await dangerState(page);
  if (press && s.btn) {
    s.pressed = await page.run(`const errs = () => document.querySelectorAll("#notices .notice-error").length;
      const b = document.getElementById(${J(s.btn?.id)}), before = errs(); b.focus(); b.click(); await sleep(300);
      return { text: b.textContent, row: !!row(${J(id)}), open: document.getElementById("engine-dialog").open, newErrors: errs() - before };`);
  }
  await closeDialog(page);
  return s;
}

// 默认组合在用：按钮可见、没有 disabled、aria-disabled 并由 aria-describedby 指向可见原因；点了没有效果
function inPairProblems(id, s, kind) {
  const p = [], label = kind === "hide" ? "隐藏" : "删除", wantBtn = kind === "hide" ? "dlg-hide" : "dlg-delete";
  const wantReason = msg(kind === "hide" ? "engine_in_pair_hide" : "engine_in_pair_delete");
  if (s.btn?.id !== wantBtn) return [`${id} 的编辑对话框应显示“${label}”，实际 ${J(s.btn)}`];
  if (s.btn.disabled) p.push(`${id} 的“${label}”不该用 disabled（要能拿到焦点）`);
  if (s.btn.ariaDisabled !== "true") p.push(`${id} 的“${label}”应 aria-disabled="true"，实际 ${J(s.btn.ariaDisabled)}`);
  if (s.btn.describedBy !== "dlg-remove-reason") p.push(`${id} 的“${label}”应 aria-describedby="dlg-remove-reason"，实际 ${J(s.btn.describedBy)}`);
  if (!s.reason || s.reasonText !== wantReason) p.push(`${id} 的原因应可见且为“${wantReason}”，实际 ${s.reason ? "" : "不可见、"}“${s.reasonText}”`);
  if (s.pressed && (!s.pressed.row || s.pressed.text !== s.btn.text || !s.pressed.open || s.pressed.newErrors !== 0)) {
    p.push(`${id} 的“${label}”不可用时点了有效果（应保持行、文字不变、对话框开着、没有新的出错提示）：${J(s.pressed)}`);
  }
  return p;
}

const freeProblems = (id, s) => (s.btn && !s.btn.ariaDisabled && !s.reason ? []
  : [`${id} 的隐藏/删除应可用、没有原因，实际 ${J({ btn: s.btn, reason: s.reason })}`]);

const B10 = {
  id: "B10", title: "默认组合引用的引擎在编辑对话框里不能隐藏/删除：按钮 aria-disabled，下方写原因", kind: "auto", needs: [],
  async run({ browser, ext }) {
    const before = (await readKeys(ext, ["customEngines"])).customEngines;
    return withOptions(browser, async page => {
      const problems = [];
      if (await page.run(`return !!document.querySelector("#engines .row-reason")`)) problems.push("引擎行上不该再有原因小字（.row-reason）");
      for (const id of ["ea", "eb"]) problems.push(...inPairProblems(id, await probeEdit(page, id, true), "delete"));
      if (J((await readKeys(ext, ["customEngines"])).customEngines) !== J(before)) problems.push("点了不可用的“删除”后 customEngines 变了");
      for (const id of ["ec", "ddg"]) problems.push(...freeProblems(id, await probeEdit(page, id)));
      // 再把默认组合切到 Google ｜ Bing，验证预置引擎的“隐藏”同样不可用
      await page.run(`
        const set = (id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change")); };
        set("pair-left", "google"); set("pair-right", "bing"); return true;`);
      await page.until(`return !!row("google")?.querySelector(${keySel("engine_tag_default_left")})`);
      for (const id of ["google", "bing"]) problems.push(...inPairProblems(id, await probeEdit(page, id, true), "hide"));
      for (const id of ["ddg", "ea"]) problems.push(...freeProblems(id, await probeEdit(page, id)));
      if (problems.length) return { status: "fail", detail: problems.join("；") };
      return { status: "pass", detail: `默认组合 ea｜eb：ea、eb 的“删除”aria-disabled、原因“${msg("engine_in_pair_delete")}”，点了没有效果（对话框不关、没有出错提示）；ec、ddg 可用。切到 Google｜Bing 后 google、bing 的“隐藏”同样不可用（原因“${msg("engine_in_pair_hide")}”），ddg、ea 可用（已还原默认组合）` };
    }, { tab: "engines" });
  },
};

const HIDDEN_ROW = `[...document.querySelectorAll("#hidden-engines .hidden-row")].find(r => r.querySelector(".engine-id").textContent === "ddg")`;
const UNDO = `[...document.querySelectorAll("#notices .notice")].find(n => n.querySelector(".notice-text").textContent === want)?.querySelector(".notice-action")`;

// 调整顺序模式中焦点要找的元素不在了：模式中的行没有“编辑”、“新增引擎”藏着，焦点都应交给看得见的“完成”。
// (4) 隐藏后提示还在时进入模式，再点提示里的“撤销”；(5) 焦点停在 ddg 的上移/下移上，另一页把 ddg 隐藏；
// (6) 接着在本页模式中点“已隐藏”里的“恢复”；(7) 见 autoExitFocusProblems
async function reorderFocusProblems(browser, page, want) {
  const problems = [];
  const focusIs = (id) => page.until(`return document.activeElement?.id === ${J(id)}`, 2000).then(() => true, () => false);
  const focused = () => page.run(`return document.activeElement?.id || document.activeElement?.tagName || ""`);
  await hideViaDialog(page);
  await page.until(`return !row("ddg") && !!${HIDDEN_ROW}`);
  await page.until(`const want = ${J(want)}; return !!${UNDO}`);
  await setReorder(page, true);
  await page.run(`const want = ${J(want)}; const b = ${UNDO}; b.focus(); b.click(); return true;`);
  await page.until(`return !!row("ddg") && !${HIDDEN_ROW}`);
  if (!(await focusIs("engines-reorder"))) problems.push(`模式中点“撤销”后焦点应交给“完成”，实际 ${J(await focused())}`);
  if (!(await page.run(`return reordering()`))) problems.push("模式中点“撤销”后不该退出模式");
  let p2 = null;
  try {
    const btn = await page.run(`const b = [moveBtn("ddg", "down"), moveBtn("ddg", "up")].find(b => b && !b.disabled); b.focus(); return b.id;`);
    p2 = await openOptions(browser, { tab: "engines" });
    await hideViaDialog(p2);
    await page.until(`return !row("ddg")`);
    if (!(await focusIs("engines-reorder"))) problems.push(`焦点在 #${btn} 上、另一页隐藏 ddg 后焦点应交给“完成”，实际 ${J(await focused())}`);
    if (!(await page.run(`return reordering()`))) problems.push("另一页隐藏引擎后（仍有 2 个以上可见引擎）不该退出模式");
    // (6) 模式中点“已隐藏”里的“恢复”：焦点交给 ddg 新出现的上移/下移（还在引擎卡里，Esc 仍能退出模式）
    await page.until(`return !!${HIDDEN_ROW}`);
    await page.run(`const b = ${HIDDEN_ROW}.querySelector(${keySel("engine_restore")}); b.focus(); b.click(); return true;`);
    await page.until(`return !!row("ddg")`);
    const moveFocused = await page.until(`return /^move-(up|down)-ddg$/.test(document.activeElement?.id ?? "")`, 2000).then(() => true, () => false);
    if (!moveFocused) problems.push(`模式中恢复 ddg 后焦点应交给 ddg 的上移/下移，实际 ${J(await focused())}`);
    else {
      await pressEsc(page);
      if (!(await page.until(`return !reordering()`, 2000).then(() => true, () => false))) problems.push("恢复后在 ddg 的上移/下移上按 Esc 应退出模式");
    }
  } finally {
    await p2?.close();
  }
  await setReorder(page, false);
  problems.push(...await autoExitFocusProblems(page, focusIs, focused));
  return problems;
}

// (7) 卡头按钮有焦点时可见引擎掉到 2 个以下：按钮被藏起来（模式中还会自动退出），焦点交给“新增引擎”，不留在隐藏的按钮上。
// 界面上隐藏、删除都拒绝默认组合在用的引擎，可见引擎不会少于 2 个：直接写存储构造（另一台设备同步来的配置就可能这样）。
// presetOverrides、customEngines 由 B12 的 guarded 写回
async function autoExitFocusProblems(page, focusIs, focused) {
  const problems = [];
  const keep = (hide) => page.run(`const o = Object.fromEntries(${J(hide)}.map(id => [id, { hidden: true }]));
    await chrome.storage.sync.set({ presetOverrides: o, customEngines: [] }); return true;`);
  await keep(["ddg", "perplexity", "kagi"]);
  await page.until(`return ids().join() === "google,bing" || ids().join() === "bing,google"`);
  for (const mode of [true, false]) {
    const label = mode ? "完成" : "调整顺序";
    await setReorder(page, mode);
    await page.run(`document.getElementById("engines-reorder").focus(); return true;`);
    await keep(["ddg", "perplexity", "kagi", "bing"]);
    await page.until(`return ids().join() === "google" && !document.getElementById("engines-reorder").checkVisibility()`);
    if (await page.run(`return reordering()`)) problems.push(`焦点在“${label}”上、可见引擎只剩 1 个后应退出模式`);
    if (!(await focusIs("add-engine"))) problems.push(`焦点在“${label}”上、按钮被藏起来后焦点应交给“新增引擎”，实际 ${J(await focused())}`);
    await keep(["ddg", "perplexity", "kagi"]);
    await page.until(`return ids().length === 2 && document.getElementById("engines-reorder").checkVisibility()`);
  }
  return problems;
}

const B12 = {
  id: "B12", title: "隐藏/恢复预置引擎：不弹确认框，提示里的“撤销”可用键盘点、能恢复；“已隐藏”列表里的“恢复”同样可用；调整顺序模式中焦点不掉回 body", kind: "auto", needs: [],
  async run({ browser }) {
    return await withOptions(browser, async page => {
      const name = await page.run(`return row("ddg").querySelector(".engine-name").textContent`);
      const want = msg("notice_hidden", name);
      const problems = [];
      // (0) 行上没有“隐藏”，“编辑”的无障碍名称带引擎名
      const rowState = await page.run(`const b = document.getElementById("edit-ddg");
        return { inline: !!row("ddg").querySelector(${keySel("engine_hide")}), aria: b?.getAttribute("aria-label") ?? null };`);
      if (rowState.inline) problems.push("引擎行上不该再有“隐藏”按钮");
      if (rowState.aria !== msg("engine_edit_label", name)) problems.push(`#edit-ddg 的 aria-label 应为“${msg("engine_edit_label", name)}”，实际 ${J(rowState.aria)}`);
      // (1) 在编辑对话框里点“隐藏”：不弹框，ddg 进“已隐藏”，提示带“撤销”，焦点交给“撤销”（键盘用户回车即可撤回）
      await hideViaDialog(page);
      await page.until(`return !row("ddg") && !!${HIDDEN_ROW}`);
      const undo = await page.until(`const want = ${JSON.stringify(want)}; const b = ${UNDO};
        return b ? { text: b.textContent, focused: document.activeElement === b, tag: b.tagName } : false;`);
      if (page.dialogs.length) problems.push(`不该弹确认框，实际弹了：${JSON.stringify(page.dialogs[0])}`);
      if (undo.text !== msg("common_undo") || undo.tag !== "BUTTON") problems.push(`提示里应有“${msg("common_undo")}”按钮，实际 ${undo.tag}“${undo.text}”`);
      if (!undo.focused) problems.push("隐藏后焦点应在“撤销”上");
      // (2) 点“撤销”：ddg 回到列表，焦点回到它的“编辑”按钮
      await page.run(`const want = ${JSON.stringify(want)}; ${UNDO}.click(); return true;`);
      await page.until(`return !!row("ddg") && !${HIDDEN_ROW}`);
      const back = await page.until(`return document.activeElement?.id === "edit-ddg" ? true : (await sleep(100), document.activeElement?.id === "edit-ddg") || "no";`)
        .catch(() => "no");
      if (back !== true) problems.push("撤销后焦点应回到 ddg 的“编辑”按钮");
      // (3) 再隐藏一次，用“已隐藏的预置引擎”里的“恢复”
      await hideViaDialog(page);
      await page.until(`return !row("ddg") && !!${HIDDEN_ROW}`);
      // 先聚焦再点（键盘用户的路径）：只 click() 不移焦点，焦点会留在提示里的“撤销”上
      await page.run(`const b = ${HIDDEN_ROW}.querySelector(${keySel("engine_restore")}); b.focus(); b.click(); return true;`);
      await page.until(`return !!row("ddg") && !document.querySelector("#hidden-engines .hidden-row")`);
      // 恢复后这一行没了：焦点交给 ddg 新出现的“编辑”
      if (!(await page.until(`return document.activeElement?.id === "edit-ddg"`, 2000).then(() => true, () => false))) {
        problems.push(`用“恢复”后焦点应交给 ddg 的“编辑”，实际 ${J(await page.run(`return document.activeElement?.id || document.activeElement?.tagName || ""`))}`);
      }
      if (page.dialogs.length) problems.push(`不该弹确认框，共弹了 ${page.dialogs.length} 个`);
      problems.push(...await reorderFocusProblems(browser, page, want));
      if (problems.length) return { status: "fail", detail: problems.join("；") };
      return { status: "pass", detail: `行上没有“隐藏”，“编辑”的无障碍名称是“${rowState.aria}”；在编辑对话框里隐藏 ddg 不弹框，提示“${want}”带“${undo.text}”且焦点在它上面，点了后 ddg 回到列表、焦点回到“编辑”；再隐藏后用“已隐藏”里的“恢复”同样回到列表；恢复后焦点交给 ddg 的“编辑”；调整顺序模式中点“撤销”、另一页隐藏焦点所在的行，焦点都交给“完成”，模式中“恢复”后焦点交给 ddg 的上移/下移、Esc 能退出；卡头按钮有焦点时可见引擎只剩 1 个，焦点交给“新增引擎”` };
    }, { tab: "engines" });
  },
};

// 打开 ddg 的编辑对话框，聚焦并点“隐藏”
async function hideViaDialog(page) {
  await openEdit(page, "ddg");
  await page.run(`const b = document.getElementById("dlg-hide"); b.focus(); b.click(); return true;`);
}

// 由运行器汇总的控制台错误：此步骤放在最后（编号最大），以便覆盖此前所有步骤
const B15 = {
  id: "B15", last: true, title: "无 [split-search] 控制台错误", kind: "auto", needs: [],
  async run({ consoleCollector: col }) {
    if (!col) return { status: "fail", detail: "控制台收集器未启用，无法判断（不能当作没有错误）" };
    const consoleErrors = col.errors;
    const st = col.stats();
    if (st.attached === 0) return { status: "fail", detail: "控制台收集器没有附着到任何页面或 worker，结果不可信" };
    if (st.extAttached === 0) return { status: "fail", detail: `收集器附着了 ${st.attached} 个会话，但没有一个属于本扩展（SW 或扩展页），结果不可信` };
    if (consoleErrors.length) {
      const lines = consoleErrors.slice(0, 10).map(e => `- ${e.text}${e.url ? `（${e.url}）` : ""}`);
      return { status: "fail", detail: `收集到 ${consoleErrors.length} 条 [split-search] 错误：\n${lines.join("\n")}` };
    }
    return { status: "pass", detail: `本次运行至此没有收集到 [split-search] 控制台错误（收集器共附着 ${st.attached} 个会话，其中扩展 ${st.extAttached} 个）` };
  },
};

const wrap = (step, keys) => ({ ...step, run: ctx => guarded(ctx, keys, () => step.run(ctx)) });
export const B_STEPS_2 = [wrap(B10, ["defaultPair", "presetOverrides", "customEngines"]), wrap(B12, ["presetOverrides", "customEngines"]), B13_STEP, B15];
