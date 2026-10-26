// 设置页自动化的公共工具：打开/关闭额外的设置页、页内脚本、confirm 对话框处理、临时引擎。
import { EXT_ID } from "../config.mjs";
import { sel } from "../i18n.mjs";

export const OPTIONS_URL = `chrome-extension://${EXT_ID}/options/options.html`;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// 页内脚本里按 data-i18n 的 key 找元素：返回选择器的 JS 字面量，直接拼进页内脚本，如 rw.querySelector(${keySel("engine_hide")})
export const keySel = key => JSON.stringify(sel(key));

// 页内脚本的公共前缀：按 id 找引擎行、按 data-move 找上移/下移按钮（图标按钮，没有文字；带文案的按钮用 keySel）
const PRELUDE = `
const row = id => [...document.querySelectorAll("#engines .engine-row")].find(r => r.querySelector(".engine-id").textContent === id);
const moveBtn = (root, dir) => root && root.querySelector('button[data-move="' + dir + '"]');
const ids = () => [...document.querySelectorAll("#engines .engine-row .engine-id")].map(e => e.textContent);
const sleep = ms => new Promise(r => setTimeout(r, ms));
`;

const READY = `document.readyState === "complete" && !!globalThis.chrome?.runtime?.id
  && !document.body.classList.contains("loading") && document.querySelectorAll("#engines .engine-row").length > 0`;

// 打开一个新的设置页并等它渲染完。返回页面对象；用完必须 close()。
// newWindow：开在单独的新窗口里。授权框（chrome.permissions.request）挂在浏览器窗口上、不是标签上：只关标签它还留着，
// 关掉它所在的窗口才会随之消失（perm-dialog spike 第 4 条），所以发起授权申请的设置页要独占一个窗口
export async function openOptions(browser, { newWindow = false } = {}) {
  const { client } = browser;
  const { targetId } = await client.send("Target.createTarget", { url: OPTIONS_URL, ...(newWindow ? { newWindow: true } : {}) });
  const sid = await browser.attach(targetId);
  const page = { targetId, sid, dialogs: [], acceptDialogs: true };
  const onDialog = (p, s) => {
    if (s !== sid) return;
    page.dialogs.push(p.message);
    client.send("Page.handleJavaScriptDialog", { accept: page.acceptDialogs }, sid).catch(() => {});
  };
  client.on("Page.javascriptDialogOpening", onDialog);
  page.ev = (expr, opts) => browser.evaluate(sid, expr, opts);
  // body 里可用 row / moveBtn / ids / sleep，需要结果时自己 return
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
  // 刷新前在旧页面上做标记，等到没有标记的新页面就绪：否则可能在刷新提交前读到旧 DOM（B13 会因此假通过）
  page.reload = async () => {
    await page.ev("globalThis.__e2eOld = 1");
    await client.send("Page.reload", {}, sid);
    await browser.waitFor(() => page.ev(`!globalThis.__e2eOld && (${READY})`, { timeoutMs: 3000 }), { timeoutMs: 15000 });
  };
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

// 只看引擎对话框里的错误提示（v0.4 的以图搜图对话框 #image-dialog 也有同名的 .field-error，排在它前面）
export const dialogState = page => page.run(`
  const f = n => { const el = document.querySelector('#engine-dialog .field-error[data-for="' + n + '"]'); return el && !el.hidden ? el.textContent : ""; };
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

// 把某个键恢复成步骤前的值：undefined 表示原本不存在，直接删除
export const restoreKey = (ext, key, value) => ext.eval(value === undefined
  ? `chrome.storage.sync.remove(${JSON.stringify(key)}).then(() => true)`
  : `chrome.storage.sync.set({ ${JSON.stringify(key)}: ${JSON.stringify(value)} }).then(() => true)`);

// 步骤包装：记下涉及的键，fn 结束（无论成败）后恢复到原值并读回核对。
// 清理失败：记日志、追加到说明；步骤本来通过则改判失败；步骤抛异常则把清理失败附在异常上。
// 步骤已超时或运行被中断（ctx.signal / ctx.abortSignal 已触发）时不写回：运行器可能已开始
// 恢复快照，此时写回会把模拟数据写进用户的真实配置；整体由 run.mjs 的快照恢复兜底。
export const stopped = ctx => !!(ctx.signal?.aborted || ctx.abortSignal?.aborted);

export async function guarded(ctx, keys, fn) {
  const saved = await readKeys(ctx.ext, keys);
  let res, thrown;
  try { res = await fn(); } catch (e) { thrown = e; }
  if (stopped(ctx)) {
    const note = `步骤已中断，跳过 ${keys.join("、")} 的写回（由快照恢复兜底）`;
    ctx.log?.(note);
    if (thrown) throw thrown;
    return { status: "skip", detail: `${res?.detail ?? ""}；${note}` };
  }
  const errs = [];
  for (const k of keys) {
    try {
      await restoreKey(ctx.ext, k, saved[k]);
      const now = (await readKeys(ctx.ext, [k]))[k];
      if (JSON.stringify(now) !== JSON.stringify(saved[k])) errs.push(`${k} 读回与原值不一致`);
    } catch (e) { errs.push(`${k}：${e.message}`); }
  }
  const msg = errs.join("；");
  if (msg) ctx.log?.(`清理失败：${msg}`);
  if (thrown) { if (msg) thrown.message += `；清理失败：${msg}`; throw thrown; }
  if (msg) return { status: "fail", detail: `${res?.detail ?? ""}；清理失败：${msg}` };
  return res;
}
