// chrome://extensions 详情页驱动（CDP，同 settings-se.mjs 的做法：attach 页面目标，走 WebUI 的 shadow DOM）：
// 停用/启用本扩展（点 #enableToggle，读回 detailView.data.state），读“站点访问”区块的结构（T8(d)）。
// 只操作本扩展（EXT_ID）的详情页；页面开在单独的后台窗口里，不动步骤用来测量的那个窗口。
import { EXT_ID } from "./config.mjs";

export const DETAILS_URL = `chrome://extensions/?id=${EXT_ID}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 测试设施问题（详情页打不开、结构认不出）：调用方据此回退（引导式运行）或跳过（--auto-only），不当成产品失败
export const infra = msg => Object.assign(new Error(msg), { kind: "infra" });

const DEEP = `const deepAll = (sel, root = document) => { const out = []; const walk = r => { out.push(...r.querySelectorAll(sel));
  for (const el of r.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); }; walk(root); return out; };
  const deep = (s, r) => deepAll(s, r)[0];
  const dv = () => { const d = deep("extensions-detail-view"); if (!d || !d.data || d.data.id !== ${JSON.stringify(EXT_ID)}) throw new Error("详情页没有显示本扩展"); return d; };`;

// 站点访问区块：只有可选 host 权限时 Chrome 渲染逐站开关列表（extensions-host-permissions-toggle-list），
// 有必需 host 权限时才渲染带“点击时 / 在特定网站上 / 在所有网站上”下拉的 extensions-runtime-host-permissions
const SITE_ACCESS = `(() => { ${DEEP} const root = dv().shadowRoot;
  const rt = deep("extensions-runtime-host-permissions", root);
  const options = rt ? deepAll("option", rt.shadowRoot).map(o => o.value) : [];
  return { runtime: !!rt, toggleList: !!deep("extensions-host-permissions-toggle-list", root), options,
    hostAccess: dv().data.permissions?.runtimeHostPermissions?.hostAccess ?? null }; })()`;

// 纯逻辑：T8(d) 是否适用。返回 { applicable, detail }；结构认不出时抛 infra
export function onClickVerdict(info) {
  if (info?.runtime) {
    if ((info.options ?? []).includes("ON_CLICK")) return { applicable: true, detail: "详情页的站点访问下拉里有“点击时（ON_CLICK）”" };
    return { applicable: false, detail: `站点访问下拉里没有“点击时”（只有 ${(info.options ?? []).join("、") || "无选项"}）` };
  }
  if (info?.toggleList) {
    return { applicable: false, detail: "不适用：本扩展只有可选 host 权限，详情页的站点访问是逐个网站的开关（extensions-host-permissions-toggle-list），没有“点击时”选项" };
  }
  throw infra("扩展详情页里认不出“站点访问”区块（既没有逐站开关列表，也没有站点访问下拉）");
}

// 打开详情页（后台新窗口）。返回 { state(), setEnabled(on), siteAccess(), incognito(), close() }
export async function openDetails(browser, { timeoutMs = 15000 } = {}) {
  const { client } = browser;
  let targetId, sid;
  try { ({ targetId } = await client.send("Target.createTarget", { url: DETAILS_URL, newWindow: true, background: true })); }
  catch (e) { throw infra(`打不开 ${DETAILS_URL}：${e.message}`); }
  const close = async () => {
    if (sid) await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
    await browser.waitFor(async () => !(await browser.targets()).some(t => t.targetId === targetId), { timeoutMs: 3000, intervalMs: 100 }).catch(() => {});
  };
  const ev = expr => browser.evaluate(sid, expr, { timeoutMs: 10000 });
  const state = () => ev(`(() => { ${DEEP} return dv().data.state; })()`);
  try {
    sid = await browser.attach(targetId);
    await browser.waitFor(() => state().catch(() => null), { timeoutMs, intervalMs: 250 });
  } catch (e) { await close(); throw infra(`扩展详情页没有加载出来（${e.message}）`); }

  // 点开关并读回；点了不生效时用页面里的 chrome.management.setEnabled 兜底（同一个 WebUI 页面有这个 API）
  const setEnabled = async on => {
    const want = on ? "ENABLED" : "DISABLED";
    if ((await state()) === want) return "unchanged";
    await ev(`(() => { ${DEEP} const t = deep("#enableToggle", dv().shadowRoot); if (!t) throw new Error("找不到启用开关"); t.click(); return true; })()`);
    const ok = await browser.waitFor(async () => (await state()) === want, { timeoutMs: 5000, intervalMs: 200 }).then(() => true, () => false);
    if (ok) return "toggle";
    if (!on) throw infra("点了详情页的开关，扩展没有停用");
    await ev(`chrome.management.setEnabled(${JSON.stringify(EXT_ID)}, true).then(() => true)`);
    await browser.waitFor(async () => (await state()) === want, { timeoutMs: 5000, intervalMs: 200 })
      .catch(() => { throw infra("点开关和 chrome.management.setEnabled 都没能重新启用扩展"); });
    return "management";
  };
  // “在无痕模式下启用”：data.incognitoAccess = { isEnabled（用户能不能打开）, isActive（是否已打开）}；
  // incognito: "not_allowed" 时实测 { isEnabled: false, isActive: false }，详情页也没有这个开关
  const incognito = () => ev(`(() => { ${DEEP} return dv().data.incognitoAccess ?? null; })()`);
  return { targetId, state, setEnabled, siteAccess: () => ev(SITE_ACCESS), incognito, close };
}

export async function withDetails(browser, fn) {
  const page = await openDetails(browser);
  try { return await fn(page); } finally { await page.close(); }
}

// 确保扩展已启用（T8(b) 的 finally、步骤后的恢复检查用）：读回 ENABLED 才返回 true；任何失败返回 false，不抛
export async function ensureEnabled(browser) {
  try { return await withDetails(browser, async p => { await p.setEnabled(true); return (await p.state()) === "ENABLED"; }); }
  catch { return false; }
}

// 等扩展页能执行脚本（停用再启用后旧的设置页已关闭，evalExt 会新开一个）
export async function waitAlive(alive, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await alive()) return true;
    if (Date.now() >= end) return false;
    await sleep(intervalMs);
  }
}
