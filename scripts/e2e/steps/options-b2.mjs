// 设置页自动步骤（二）：B10 B12 B13 B15
import { openOptions, withOptions, guarded, sleep, keySel, openEdit, closeDialog, dangerState, readKeys, setReorder } from "./optpage.mjs";
import { msg } from "../i18n.mjs";

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
    });
  },
};

const HIDDEN_ROW = `[...document.querySelectorAll("#hidden-engines .hidden-row")].find(r => r.querySelector(".engine-id").textContent === "ddg")`;
const UNDO = `[...document.querySelectorAll("#notices .notice")].find(n => n.querySelector(".notice-text").textContent === want)?.querySelector(".notice-action")`;

const B12 = {
  id: "B12", title: "隐藏/恢复预置引擎：不弹确认框，提示里的“撤销”可用键盘点、能恢复；“已隐藏”列表里的“恢复”同样可用", kind: "auto", needs: [],
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
      await page.run(`${HIDDEN_ROW}.querySelector(${keySel("engine_restore")}).click(); return true;`);
      await page.until(`return !!row("ddg") && !document.querySelector("#hidden-engines .hidden-row")`);
      if (page.dialogs.length) problems.push(`不该弹确认框，共弹了 ${page.dialogs.length} 个`);
      if (problems.length) return { status: "fail", detail: problems.join("；") };
      return { status: "pass", detail: `行上没有“隐藏”，“编辑”的无障碍名称是“${rowState.aria}”；在编辑对话框里隐藏 ddg 不弹框，提示“${want}”带“${undo.text}”且焦点在它上面，点了后 ddg 回到列表、焦点回到“编辑”；再隐藏后用“已隐藏”里的“恢复”同样回到列表` };
    });
  },
};

// 打开 ddg 的编辑对话框，聚焦并点“隐藏”
async function hideViaDialog(page) {
  await openEdit(page, "ddg");
  await page.run(`const b = document.getElementById("dlg-hide"); b.focus(); b.click(); return true;`);
}

const orderOf = page => page.run(`return ids()`);
// 聚焦并点 #move-<dir>-<id>（键盘用户的回车同样派发 click）
const click = (page, id, dir) => page.run(`const b = moveBtn(${J(id)}, ${J(dir)}); b.focus(); b.click(); return true;`);
// 焦点所在元素的 id 与播报（#engines-status）
const focusAndStatus = page => page.run(`return { focus: document.activeElement?.id ?? "", status: document.getElementById("engines-status").textContent };`);
// 在焦点所在的元素上派发 Esc（监听挂在整张引擎卡上，冒泡上去）
const pressEsc = page => page.run(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return true;`);
const MODE_STATE = `const v = id => document.getElementById(id).checkVisibility();
  return { text: document.getElementById("engines-reorder").textContent, add: v("add-engine"), catalog: v("catalog-open"),
    hint: v("engines-reorder-hint"), plainHint: v("engines-hint"), perm: !!document.querySelector("#engines .perm"),
    actions: !!document.querySelector("#engines .row-actions"), edit: !!document.querySelector('#engines [id^="edit-"]'),
    status: document.getElementById("engines-status").textContent };`;

// 移动后焦点应停在 wantFocus、播报“<name>：第 pos 位，共 total 个”。焦点在重渲染后才还回来，等一会儿再判
async function moved(page, wantFocus, wantStatus) {
  return page.until(`const s = { focus: document.activeElement?.id ?? "", status: document.getElementById("engines-status").textContent };
    return s.focus === ${J(wantFocus)} && s.status === ${J(wantStatus)} ? s : false;`, 2000).catch(() => focusAndStatus(page));
}

const B13 = {
  id: "B13", title: "调整顺序模式：移动后焦点与播报、完成时立即保存、刷新后保持、另一页自动刷新且不退出模式", kind: "auto", needs: [],
  async run({ browser, ext }) {
    let p1 = null, p2 = null;
    try {
      p1 = await openOptions(browser);
      const start = await orderOf(p1);
      if (start.length < 3) return { status: "fail", detail: `引擎少于 3 个：${start.join(",")}` };
      const problems = [];
      if (await p1.run(`return !!document.querySelector('#engines [id^="move-"]')`)) problems.push("平时的引擎行上不该有上移/下移");
      // (1) 进入模式：按钮变“完成”，新增与引擎库藏起，说明换成模式说明，行里只剩上移/下移，播报模式说明
      await setReorder(p1, true);
      const m = await p1.run(MODE_STATE);
      if (m.text !== msg("engine_reorder_done")) problems.push(`模式中卡头按钮应为“${msg("engine_reorder_done")}”，实际“${m.text}”`);
      if (m.add || m.catalog) problems.push("模式中“新增引擎”“从引擎库添加”应不可见");
      if (!m.hint || m.plainHint) problems.push("模式中应显示模式说明、藏起平时的说明");
      if (m.perm || m.actions || m.edit) problems.push(`模式中的行不该有授权状态、.row-actions 或“编辑”：${J({ perm: m.perm, actions: m.actions, edit: m.edit })}`);
      if (m.status !== msg("engine_reorder_hint")) problems.push(`进入模式时 #engines-status 应播报模式说明，实际“${m.status}”`);

      // (2) x 上移到第 1 位：↑ 变成禁用，焦点交给同一行的 ↓；再下移一次，焦点留在 ↓ 上
      const x = start[1], total = start.length;
      const name = await p1.run(`return row(${J(x)}).querySelector(".engine-name").textContent`);
      await click(p1, x, "up");
      await p1.until(`return ids()[0] === ${J(x)}`);
      let s = await moved(p1, `move-down-${x}`, msg("engine_moved", name, 1, total));
      if (s.focus !== `move-down-${x}`) problems.push(`上移到顶后焦点应在 #move-down-${x}，实际 ${J(s.focus)}`);
      if (s.status !== msg("engine_moved", name, 1, total)) problems.push(`上移后播报应为“${msg("engine_moved", name, 1, total)}”，实际“${s.status}”`);
      await click(p1, x, "down");
      await p1.until(`return ids()[1] === ${J(x)}`);
      s = await moved(p1, `move-down-${x}`, msg("engine_moved", name, 2, total));
      if (s.focus !== `move-down-${x}`) problems.push(`下移后焦点应留在 #move-down-${x}，实际 ${J(s.focus)}`);
      if (s.status !== msg("engine_moved", name, 2, total)) problems.push(`下移后播报应为第 2 位，实际“${s.status}”`);

      // (3) 第二次下移后马上点“完成”（防抖还没到）：顺序应在 400 ms 内写进 storage.sync
      const want = [start[0], start[2], x, ...start.slice(3)];
      const before = await p1.run(`const b = moveBtn(${J(x)}, "down"); b.focus(); b.click();
        const end = Date.now() + 2000; while (ids()[2] !== ${J(x)} && Date.now() < end) await sleep(20);
        const r = { moved: ids()[2] === ${J(x)}, focus: document.activeElement?.id ?? "", status: document.getElementById("engines-status").textContent };
        document.getElementById("engines-reorder").click(); return r;`);
      const t0 = Date.now();
      if (!before.moved) problems.push("第二次下移后 2 秒内顺序没有变");
      if (before.focus !== `move-down-${x}`) problems.push(`点“完成”前焦点应在 #move-down-${x}，实际 ${J(before.focus)}`);
      if (before.status !== msg("engine_moved", name, 3, total)) problems.push(`第二次下移后播报应为第 3 位，实际“${before.status}”`);
      let saved = null;
      for (;;) {
        const { order } = await readKeys(ext, ["order"]);
        if (J(order) === J(want)) { saved = Date.now() - t0; break; }
        if (Date.now() - t0 > 400) break;
        await sleep(25);
      }
      if (saved === null) problems.push(`点“完成”后 400 ms 内 storage.sync.order 没有变成 ${want.join(",")}（应立即写，不等 500 ms 防抖）`);
      await p1.until(`return !reordering()`).catch(() => problems.push("点“完成”后没有退出模式"));
      const after = await p1.run(`const b = document.getElementById("engines-reorder"); return { focus: document.activeElement === b, text: b.textContent };`);
      if (!after.focus) problems.push("点“完成”后焦点应留在卡头按钮上");
      if (after.text !== msg("engine_reorder")) problems.push(`退出后卡头按钮应为“${msg("engine_reorder")}”，实际“${after.text}”`);

      // (4) 刷新后顺序保持、回到平时
      await p1.reload();
      const reloaded = await orderOf(p1);
      if (reloaded.join() !== want.join()) problems.push(`刷新后顺序应为 ${want.join(",")}，实际 ${reloaded.join(",")}`);
      if (await p1.run(`return reordering()`)) problems.push("刷新后不该还在模式中");

      // (5) p1 在模式中；另一页进入模式、把 x 上移一位、在 ↑ 上按 Esc 退出：p1 自动刷新且仍在模式中
      await setReorder(p1, true);
      p2 = await openOptions(browser);
      await setReorder(p2, true);
      await click(p2, x, "up");
      await p2.until(`return ids()[1] === ${J(x)}`);
      await p2.until(`return document.activeElement?.id === ${J(`move-up-${x}`)}`, 2000).catch(() => {});
      await pressEsc(p2);
      const t1 = Date.now();
      const want2 = [want[0], x, want[1], ...want.slice(3)];
      let sync = null;
      for (;;) {
        const cur = await orderOf(p1);
        if (cur.join() === want2.join()) { sync = Date.now() - t1; break; }
        if (Date.now() - t1 > 4000) break;
        await sleep(100);
      }
      if (sync === null) problems.push("另一页按 Esc 退出后 4 秒内第一个页面没有自动刷新");
      else if (sync > 2000) problems.push(`第一个页面 ${sync} ms 后才刷新（Esc 退出时立即写，应在 2 秒内）`);
      if (!(await p1.run(`return reordering()`))) problems.push("另一页改了顺序后第一个页面不该退出模式");
      const p2s = await p2.run(`return { mode: reordering(), focus: document.activeElement?.id ?? "" }`);
      if (p2s.mode) problems.push("在 ↑ 上按 Esc 后另一页应退出模式");
      if (p2s.focus !== "engines-reorder") problems.push(`Esc 退出后焦点应回到卡头按钮，实际 ${J(p2s.focus)}`);

      // (6) 焦点在“完成”上按 Esc 同样退出，焦点留在按钮上
      await p1.run(`document.getElementById("engines-reorder").focus(); return true;`);
      await pressEsc(p1);
      await p1.until(`return !reordering()`, 2000).catch(() => problems.push("焦点在“完成”上按 Esc 后没有退出模式"));
      if (!(await p1.run(`return document.activeElement?.id === "engines-reorder"`))) problems.push("在“完成”上按 Esc 后焦点应留在卡头按钮上");

      if (problems.length) return { status: "fail", detail: problems.join("；") };
      return { status: "pass", detail: `模式中卡头只剩“${m.text}”、行里只有上移/下移；${x} 上移到顶后焦点交给“下移”、播报“${msg("engine_moved", name, 1, total)}”，再下移两次焦点留在“下移”上；点“完成”后 ${saved} ms 写入 ${want.join(",")}、焦点留在按钮上，刷新后保持；另一页 Esc 退出后第一页 ${sync} ms 内刷新且仍在模式中；“完成”上按 Esc 也退出` };
    } finally {
      await p2?.close();
      await p1?.close();
    }
  },
};

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
export const B_STEPS_2 = [wrap(B10, ["defaultPair", "presetOverrides", "customEngines"]), wrap(B12, ["presetOverrides"]), wrap(B13, ["order"]), B15];
