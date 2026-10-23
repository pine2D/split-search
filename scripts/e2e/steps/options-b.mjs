// 设置页自动步骤（一）：B2 B3 B6 B7 B8 B10 B11
import { EXT_ID } from "../config.mjs";
import {
  OPTIONS_URL, withOptions, fillDialog, dialogState, closeDialog,
  readKeys, BAIDU, hasEngine, addCustom, removeCustom,
} from "./optpage.mjs";

const optionsTargets = async browser =>
  (await browser.targets()).filter(t => t.type === "page" && t.url.startsWith(OPTIONS_URL.replace("options.html", "")));

const B2 = {
  id: "B2", title: "点工具栏图标打开设置页", kind: "auto", needs: [],
  async run({ browser }) {
    // openOptionsPage 遇到已打开的设置页只会聚焦，所以先关掉所有设置页，再等“新的”出现
    // triggerAction 只接受 tab 目标：取一个非设置页的 tab（没有就新建 about:blank）
    const tabs = async () => (await browser.client.send("Target.getTargets", { filter: [{ type: "tab" }] })).targetInfos;
    const notOptions = list => list.find(t => !t.url.startsWith(`chrome-extension://${EXT_ID}/`));
    let host = notOptions(await tabs());
    if (!host) {
      await browser.client.send("Target.createTarget", { url: "about:blank" });
      host = await browser.waitFor(async () => notOptions(await tabs()), { timeoutMs: 5000 });
    }
    for (const t of await optionsTargets(browser)) await browser.client.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
    await browser.waitFor(async () => (await optionsTargets(browser)).length === 0, { timeoutMs: 5000 });
    await browser.client.send("Extensions.triggerAction", { id: EXT_ID, targetId: host.targetId });
    const t = await browser.waitFor(async () => (await optionsTargets(browser))[0], { timeoutMs: 10000 })
      .catch(() => null);
    if (!t) return { status: "fail", detail: "触发扩展图标动作后 10 秒内没有出现设置页" };
    return { status: "pass", detail: `触发图标动作后出现新的设置页：${t.url}` };
  },
};

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
      await page.until(`return !!document.querySelector('.field-error[data-for="id"]:not([hidden])')`);
      const st = await dialogState(page);
      const stored = (await hasEngine(ext, "Baidu")) || (await hasEngine(ext, "baidu"));
      await closeDialog(page);
      const problems = [];
      if (!/只能由|格式|小写/.test(st.id)) problems.push(`id 旁没有格式错误提示：${JSON.stringify(st.id)}`);
      if (!st.open) problems.push("对话框被关闭了");
      if (stored) problems.push("引擎被错误地保存了");
      if (problems.length) return { status: "fail", detail: problems.join("；") };
      return { status: "pass", detail: `id 旁提示“${st.id}”，对话框仍打开，未保存` };
    });
  },
};

const B7 = {
  id: "B7", title: "新增百度：列表末尾出现且授权按钮高亮", kind: "auto", needs: [],
  async run({ browser, ext }) {
    try {
      return await withOptions(browser, async page => {
        await page.run(`document.getElementById("add-engine").click(); return true;`);
        await fillDialog(page, BAIDU);
        await page.until(`return !document.getElementById("engine-dialog").open && !!row("baidu")`);
        const r = await page.run(`
          const last = ids().at(-1), rw = row("baidu"), b = btn(rw, "授权");
          const notice = [...document.querySelectorAll("#notices .notice-text")].map(n => n.textContent).find(t => t.includes("没授权"));
          return { last, hasAuth: !!b, attention: !!b && b.classList.contains("btn-attention"), name: rw.querySelector(".engine-name").textContent, notice: notice || "" };`);
        const problems = [];
        if (r.last !== "baidu") problems.push(`列表末尾应是 baidu，实际 ${r.last}`);
        if (r.name !== "百度") problems.push(`名称应为百度，实际 ${r.name}`);
        if (!r.hasAuth) problems.push("没有“授权”按钮");
        else if (!r.attention) problems.push("授权按钮没有高亮（btn-attention）");
        if (!r.notice) problems.push("没有“尚未授权”的提示");
        // 顺带验证 UI 删除：删掉自己新建的引擎
        await page.run(`btn(row("baidu"), "删除").click(); return true;`);
        await page.until(`return !row("baidu")`);
        if (problems.length) return { status: "fail", detail: problems.join("；") };
        return { status: "pass", detail: "百度出现在列表末尾，授权按钮高亮，右下角有未授权提示；已通过界面删除" };
      });
    } finally { await removeCustom(ext, "baidu").catch(() => {}); }
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
        const copied = await page.until(`return document.querySelector(".gen-output .url-line button").textContent === "已复制"`, 3000).catch(() => false);
        if (copied) return { status: "pass", detail: `网址 ${url}；点“复制”后按钮变为“已复制”` };
        const err = await page.run(`return [...document.querySelectorAll("#notices .notice-text")].map(n => n.textContent).find(t => t.startsWith("复制失败")) || ""`);
        return { status: "fail", detail: `网址正确，但按钮没有变为“已复制”；${err ? "页面提示：" + err : "也没有出现复制失败提示"}` };
      });
    } finally { await removeCustom(ext, "baidu").catch(() => {}); }
  },
};

const B10 = {
  id: "B10", title: "默认组合引用的引擎不能隐藏/删除", kind: "auto", needs: [],
  async run({ browser, ext }) {
    const probe = ids => `
      const out = {};
      for (const id of ${JSON.stringify(ids)}) {
        const rw = row(id), b = rw && (btn(rw, "隐藏") || btn(rw, "删除"));
        out[id] = !rw ? "无此行" : !b ? "无按钮" : b.disabled ? "禁用" : "可用";
      }
      return out;`;
    const before = (await readKeys(ext, ["defaultPair"])).defaultPair;
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
        await page.until(`return document.getElementById("pair-left").value === "google" && btn(row("google"), "隐藏")?.disabled === true`);
        const gb = await page.run(probe(["google", "bing", "ddg", "ea"]));
        for (const id of ["google", "bing"]) if (gb[id] !== "禁用") problems.push(`默认组合为 Google ｜ Bing 时 ${id} 的隐藏应禁用，实际 ${gb[id]}`);
        for (const id of ["ddg", "ea"]) if (gb[id] !== "可用") problems.push(`默认组合为 Google ｜ Bing 时 ${id} 应可用，实际 ${gb[id]}`);
        if (problems.length) return { status: "fail", detail: problems.join("；") };
        return { status: "pass", detail: `当前默认组合 ea｜eb：ea、eb 禁用，ec、ddg 可用；切到 Google｜Bing 后：google、bing 的“隐藏”禁用，ddg、ea 可用（已还原默认组合）` };
      } finally {
        if (before) await ext.eval(`chrome.storage.sync.set({ defaultPair: ${JSON.stringify(before)} })`);
      }
    });
  },
};

const B11 = {
  id: "B11", title: "默认左侧改成非左侧模板被拒绝", kind: "auto", needs: [],
  async run({ browser, ext, port }) {
    const bad = `http://engine-a.localhost:${port}/wiki/%s`;
    const before = (await readKeys(ext, ["customEngines"])).customEngines;
    return withOptions(browser, async page => {
      await page.run(`btn(row("ea"), "编辑").click(); return true;`);
      await fillDialog(page, { url: bad });
      await page.until(`return !!document.querySelector('.field-error[data-for="url"]:not([hidden])')`);
      const st = await dialogState(page);
      await closeDialog(page);
      const after = (await readKeys(ext, ["customEngines"])).customEngines;
      const problems = [];
      if (!/默认组合的左侧/.test(st.url)) problems.push(`没有说明原因（默认组合的左侧）：${JSON.stringify(st.url)}`);
      if (!st.open) problems.push("对话框被关闭了");
      if (JSON.stringify(before) !== JSON.stringify(after)) problems.push("存储被修改了");
      if (problems.length) return { status: "fail", detail: problems.join("；") };
      return { status: "pass", detail: `左侧 ea 改为 ${bad} 被拒绝：${st.url.slice(0, 60)}…；对话框仍打开，存储未变` };
    });
  },
};

export const B_STEPS_1 = [B2, B3, B6, B7, B8, B10, B11];
