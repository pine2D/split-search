// 设置页自动化的公共工具：打开/关闭额外的设置页、页内脚本、confirm 对话框处理、临时引擎。
import { EXT_ID } from "../config.mjs";

export const OPTIONS_URL = `chrome-extension://${EXT_ID}/options/options.html`;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// 页内脚本的公共前缀：按 id 找引擎行、按文字找按钮
const PRELUDE = `
const row = id => [...document.querySelectorAll("#engines .engine-row")].find(r => r.querySelector(".engine-id").textContent === id);
const btn = (root, text) => root && [...root.querySelectorAll("button")].find(b => b.textContent === text);
const ids = () => [...document.querySelectorAll("#engines .engine-row .engine-id")].map(e => e.textContent);
const sleep = ms => new Promise(r => setTimeout(r, ms));
`;

const READY = `document.readyState === "complete" && !!globalThis.chrome?.runtime?.id
  && !document.body.classList.contains("loading") && document.querySelectorAll("#engines .engine-row").length > 0`;

// 打开一个新的设置页并等它渲染完。返回页面对象；用完必须 close()。
export async function openOptions(browser) {
  const { client } = browser;
  const { targetId } = await client.send("Target.createTarget", { url: OPTIONS_URL });
  const sid = await browser.attach(targetId);
  const page = { targetId, sid, dialogs: [], acceptDialogs: true };
  const onDialog = (p, s) => {
    if (s !== sid) return;
    page.dialogs.push(p.message);
    client.send("Page.handleJavaScriptDialog", { accept: page.acceptDialogs }, sid).catch(() => {});
  };
  client.on("Page.javascriptDialogOpening", onDialog);
  page.ev = (expr, opts) => browser.evaluate(sid, expr, opts);
  // body 里可用 row / btn / ids / sleep，需要结果时自己 return
  page.run = (body, opts) => page.ev(`(async () => { ${PRELUDE} ${body} })()`, opts);
  page.until = async (body, timeoutMs = 5000) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = await page.run(body).catch(() => false);
      if (v) return v;
      if (Date.now() >= end) throw new Error(`等待页面条件超时：${body.slice(0, 100)}`);
      await sleep(100);
    }
  };
  page.ready = () => browser.waitFor(() => page.ev(READY, { timeoutMs: 3000 }), { timeoutMs: 15000 });
  page.reload = async () => { await client.send("Page.reload", {}, sid); await sleep(300); await page.ready(); };
  page.close = async () => {
    client.off("Page.javascriptDialogOpening", onDialog);
    await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
    // 等目标真正消失：否则下一步的 evalExt 可能挑中正在关闭的设置页，得到“会话不存在”
    await browser.waitFor(async () => !(await browser.targets()).some(t => t.targetId === targetId), { timeoutMs: 5000 }).catch(() => {});
  };
  try {
    await client.send("Page.enable", {}, sid);
    await page.ready();
  } catch (e) { await page.close(); throw e; }
  return page;
}

// 打开设置页执行 fn(page)，无论成败都关闭
export async function withOptions(browser, fn) {
  const page = await openOptions(browser);
  try { return await fn(page); } finally { await page.close(); }
}

// 填写并提交新增/编辑对话框里的表单（url 需触发 input 事件刷新提示）
export const fillDialog = (page, { id, name, url }) => page.run(`
  const set = (n, v) => { const el = document.getElementById("dlg-" + n); el.value = v; if (n === "url") el.dispatchEvent(new Event("input")); };
  ${id !== undefined ? `set("id", ${JSON.stringify(id)});` : ""}
  ${name !== undefined ? `set("name", ${JSON.stringify(name)});` : ""}
  ${url !== undefined ? `set("url", ${JSON.stringify(url)});` : ""}
  document.getElementById("dlg-save").click();
  return true;`);

export const dialogState = page => page.run(`
  const f = n => { const el = document.querySelector('.field-error[data-for="' + n + '"]'); return el && !el.hidden ? el.textContent : ""; };
  return { open: document.getElementById("engine-dialog").open, id: f("id"), name: f("name"), url: f("url"), form: f("form") };`);

export const closeDialog = page => page.run(`document.getElementById("dlg-cancel").click(); return true;`);

// ---- 经设置页读写存储（只动指定键，其余保持不变）----
export const readKeys = (ext, keys) => ext.eval(`chrome.storage.sync.get(${JSON.stringify(keys)})`);

export const BAIDU = { id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" };

export const hasEngine = (ext, id) => ext.eval(`(async () => (await chrome.storage.sync.get("customEngines")).customEngines?.some(e => e.id === ${JSON.stringify(id)}) ?? false)()`);

export const addCustom = (ext, eng) => ext.eval(`(async () => {
  const { customEngines = [] } = await chrome.storage.sync.get("customEngines");
  if (!customEngines.some(e => e.id === ${JSON.stringify(eng.id)})) customEngines.push(${JSON.stringify(eng)});
  await chrome.storage.sync.set({ customEngines }); return true; })()`);

export const removeCustom = (ext, id) => ext.eval(`(async () => {
  const { customEngines = [], order } = await chrome.storage.sync.get(["customEngines", "order"]);
  const patch = { customEngines: customEngines.filter(e => e.id !== ${JSON.stringify(id)}) };
  await chrome.storage.sync.set(patch);
  if (order?.includes(${JSON.stringify(id)})) await chrome.storage.sync.set({ order: order.filter(x => x !== ${JSON.stringify(id)}) });
  return true; })()`);
