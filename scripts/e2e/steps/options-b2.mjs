// 设置页自动步骤（二）：B12 B13 B15
import { openOptions, withOptions, guarded, sleep } from "./optpage.mjs";

const B12 = {
  id: "B12", title: "隐藏/恢复预置引擎（确认框含网站搜索提示）", kind: "auto", needs: [],
  async run({ browser, ext }) {
    {
      return await withOptions(browser, async page => {
        await page.run(`btn(row("ddg"), "隐藏").click(); return true;`);
        await page.until(`return !row("ddg") && [...document.querySelectorAll("#hidden-engines .hidden-row")].some(r => r.querySelector(".engine-id").textContent === "ddg")`);
        const problems = [];
        const msg = page.dialogs[0] || "";
        if (!msg.includes("网站搜索")) problems.push(`确认框文字应含“网站搜索”，实际 ${JSON.stringify(msg)}`);
        await page.run(`
          const r = [...document.querySelectorAll("#hidden-engines .hidden-row")].find(r => r.querySelector(".engine-id").textContent === "ddg");
          btn(r, "恢复").click(); return true;`);
        await page.until(`return !!row("ddg") && !document.querySelector("#hidden-engines .hidden-row")`);
        if (problems.length) return { status: "fail", detail: problems.join("；") };
        return { status: "pass", detail: `确认框（${msg.split("\n")[0]}）含“网站搜索”；ddg 隐藏后出现在“已隐藏的预置引擎”，点“恢复”后回到列表` };
      });
    }
  },
};

const orderOf = page => page.run(`return ids()`);
const click = (page, id, label) => page.run(`btn(row(${JSON.stringify(id)}), ${JSON.stringify(label)}).click(); return true;`);

const B13 = {
  id: "B13", title: "排序防抖保存、刷新后保持、另一页自动刷新", kind: "auto", needs: [],
  async run({ browser, ext }) {
    let p1 = null, p2 = null;
    try {
      p1 = await openOptions(browser);
      const start = await orderOf(p1);
      if (start.length < 3) return { status: "fail", detail: `引擎少于 3 个：${start.join(",")}` };
      const x = start[0];
      const want = [...start.slice(1, 3), x, ...start.slice(3)];
      await click(p1, x, "↓");
      await p1.until(`return ids()[1] === ${JSON.stringify(x)}`);
      await click(p1, x, "↓");
      await p1.until(`return ids()[2] === ${JSON.stringify(x)}`);
      await sleep(1200);
      await p1.reload();
      const after = await orderOf(p1);
      const problems = [];
      if (after.join() !== want.join()) problems.push(`刷新后顺序应为 ${want.join(",")}，实际 ${after.join(",")}`);

      // 另开一个设置页改动顺序：把 x 上移一位，第一个页面应自动刷新
      p2 = await openOptions(browser);
      await click(p2, x, "↑");
      const t0 = Date.now();
      const want2 = [want[0], x, want[1], ...want.slice(3)];
      let sync = null;
      for (;;) {
        const cur = await orderOf(p1);
        if (cur.join() === want2.join()) { sync = Date.now() - t0; break; }
        if (Date.now() - t0 > 4000) break;
        await sleep(100);
      }
      if (sync === null) problems.push("另一页改动顺序后 4 秒内第一个页面没有自动刷新");
      else if (sync > 2500) problems.push(`第一个页面 ${sync} ms 后才刷新（超过 2 秒量级，含 0.5 秒防抖）`);
      if (problems.length) return { status: "fail", detail: problems.join("；") };
      return { status: "pass", detail: `${x} 连点两次↓ 后顺序 ${want.join(",")} 刷新后保持；另一页上移后第一页 ${sync} ms 内自动刷新（含 0.5 秒防抖）` };
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
export const B_STEPS_2 = [wrap(B12, ["presetOverrides"]), wrap(B13, ["order"]), B15];
