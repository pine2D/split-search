// 设置页自动步骤（三）：B13（“调整顺序”模式；从 options-b2.mjs 拆出，免得单文件超过 300 行）
import { openOptions, guarded, sleep, readKeys, setReorder } from "./optpage.mjs";
import { msg } from "../i18n.mjs";

const J = JSON.stringify;

const orderOf = page => page.run(`return ids()`);
// 聚焦并点 #move-<dir>-<id>（键盘用户的回车同样派发 click）
const click = (page, id, dir) => page.run(`const b = moveBtn(${J(id)}, ${J(dir)}); b.focus(); b.click(); return true;`);
// 焦点所在元素的 id 与播报（#engines-status）
const focusAndStatus = page => page.run(`return { focus: document.activeElement?.id ?? "", status: document.getElementById("engines-status").textContent };`);
// 在焦点所在的元素上派发 Esc（监听挂在整张引擎卡上，冒泡上去）
export const pressEsc = page => page.run(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return true;`);
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

      // (3) 第二次下移后马上点“完成”（防抖还没到）：顺序应立即写进 storage.sync。
      // 时刻都在页内记：防抖定时器在下移的 click 里就开始走（move() 同步 setTimeout），写入时刻取自本页的
      // storage.onChanged。判据是写入早于“下移 + 500 ms”——那之前防抖不可能写出，只能是“完成”立即写的；
      // 另要求在“完成”后 150 ms 内。下移到“完成”之间就超过 400 ms 时区分不了，单独报出来，不当作通过
      const want = [start[0], start[2], x, ...start.slice(3)];
      const before = await p1.run(`const want = ${J(J(want))};
        let tWrite = null;
        const onCh = (ch, area) => { if (area === "sync" && ch.order && tWrite === null && JSON.stringify(ch.order.newValue) === want) tWrite = Date.now(); };
        chrome.storage.onChanged.addListener(onCh);
        try {
          const b = moveBtn(${J(x)}, "down"); b.focus();
          const tMove = Date.now(); b.click();
          const end = Date.now() + 2000; while (ids()[2] !== ${J(x)} && Date.now() < end) await sleep(20);
          const r = { moved: ids()[2] === ${J(x)}, focus: document.activeElement?.id ?? "", status: document.getElementById("engines-status").textContent };
          const tDone = Date.now(); document.getElementById("engines-reorder").click();
          const until = Date.now() + 1500; while (tWrite === null && Date.now() < until) await sleep(10);
          return { ...r, gap: tDone - tMove, sinceMove: tWrite === null ? null : tWrite - tMove, sinceDone: tWrite === null ? null : tWrite - tDone };
        } finally { chrome.storage.onChanged.removeListener(onCh); }`);
      if (!before.moved) problems.push("第二次下移后 2 秒内顺序没有变");
      if (before.focus !== `move-down-${x}`) problems.push(`点“完成”前焦点应在 #move-down-${x}，实际 ${J(before.focus)}`);
      if (before.status !== msg("engine_moved", name, 3, total)) problems.push(`第二次下移后播报应为第 3 位，实际“${before.status}”`);
      if (before.gap > 400) problems.push(`第二次下移到点“完成”用了 ${before.gap} ms，太接近 500 ms 防抖，区分不了是否立即写`);
      else if (before.sinceMove === null) problems.push(`点“完成”后 1.5 秒内本页没有收到 order = ${want.join(",")} 的写入`);
      else if (before.sinceMove >= 500 || before.sinceDone > 150) {
        problems.push(`order 在下移后 ${before.sinceMove} ms、点“完成”后 ${before.sinceDone} ms 才写入（应在“完成”时立即写：下移 500 ms 以内、“完成”后 150 ms 以内）`);
      }
      const { order: stored } = await readKeys(ext, ["order"]);
      if (J(stored) !== J(want)) problems.push(`点“完成”后 storage.sync.order 应为 ${want.join(",")}，实际 ${J(stored)}`);
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
      return { status: "pass", detail: `模式中卡头只剩“${m.text}”、行里只有上移/下移；${x} 上移到顶后焦点交给“下移”、播报“${msg("engine_moved", name, 1, total)}”，再下移两次焦点留在“下移”上；点“完成”后 ${before.sinceDone} ms（下移后 ${before.sinceMove} ms）写入 ${want.join(",")}、焦点留在按钮上，刷新后保持；另一页 Esc 退出后第一页 ${sync} ms 内刷新且仍在模式中；“完成”上按 Esc 也退出` };
    } finally {
      await p2?.close();
      await p1?.close();
    }
  },
};

const wrap = (step, keys) => ({ ...step, run: ctx => guarded(ctx, keys, () => step.run(ctx)) });
export const B13_STEP = wrap(B13, ["order"]);
