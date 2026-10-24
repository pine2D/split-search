// 网页 Service Worker 注册情况（T14 用）：引擎的 SW 接管导航时 DNR 的 main_frame 重定向会失效，
// 按 G5 降级为一次普通的左侧搜索（diag-google-dnr.md s3 实验）。所以 T14 要按引擎 origin 核实 SW 是否真的注册了。
// 两个来源合并：CDP ServiceWorker 域（在一个页面会话上 enable，回放整个配置的注册与版本）和 Target.getTargets 的 service_worker 目标。
import { hostOf, G } from "./assisted.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const originOf = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } };

// 纯函数：合并三类记录，返回 Map(origin → [{ url, how }])，只保留网页（http/https）origin
export function swByOrigin({ registrations = [], versions = [], targets = [] } = {}) {
  const out = new Map();
  const add = (url, how) => {
    const o = originOf(url);
    if (!o) return;
    if (!out.has(o)) out.set(o, []);
    if (!out.get(o).some(x => x.url === url && x.how === how)) out.get(o).push({ url, how });
  };
  const live = new Set();
  for (const r of registrations) if (!r.isDeleted) { live.add(r.registrationId); add(r.scopeURL, "注册"); }
  for (const v of versions) {
    if (v.status === "redundant" || (v.registrationId !== undefined && registrations.length && !live.has(v.registrationId))) continue;
    add(v.scriptURL, `版本 ${v.status}/${v.runningStatus}`);
  }
  for (const t of targets) if (t.type === "service_worker") add(t.url, "运行中的 worker");
  return out;
}

export const swText = (map, origin) => {
  const hits = map?.get(origin);
  return hits?.length ? `有（${hits.map(h => `${h.how} ${h.url}`).slice(0, 2).join("；")}）` : "无";
};

// 读当前配置里的 SW。attach 一个已有页面（优先向导页/设置页），ServiceWorker.enable 后等 waitMs 收事件再 disable、detach
export async function readServiceWorkers(browser, { waitMs = 1500, prefer = () => false } = {}) {
  const { client } = browser;
  const targets = await browser.targets();
  const pages = targets.filter(t => t.type === "page" && /^(https?|chrome-extension):/.test(t.url));
  const page = pages.find(prefer) ?? pages[0];
  const registrations = [], versions = [];
  let error = null;
  if (page) {
    const sid = await browser.attach(page.targetId);
    const onReg = (p, s) => { if (s === sid) registrations.push(...(p.registrations || [])); };
    const onVer = (p, s) => { if (s === sid) versions.push(...(p.versions || [])); };
    client.on("ServiceWorker.workerRegistrationUpdated", onReg);
    client.on("ServiceWorker.workerVersionUpdated", onVer);
    try {
      await client.send("ServiceWorker.enable", {}, sid);
      await sleep(waitMs);
      await client.send("ServiceWorker.disable", {}, sid).catch(() => {});
    } catch (e) { error = e.message; }
    finally {
      client.off("ServiceWorker.workerRegistrationUpdated", onReg);
      client.off("ServiceWorker.workerVersionUpdated", onVer);
      await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
    }
  } else error = "没有可 attach 的页面";
  // 同一注册会先后报多次，按 id 留最后一条（isDeleted 以最新为准）
  const lastReg = [...new Map(registrations.map(r => [r.registrationId, r])).values()];
  return { map: swByOrigin({ registrations: lastReg, versions, targets }), error };
}

// SW 状态三态：swText 的“有（…）”→ 有；“无”→ 无；读不到（“未知…”或其他）→ 未知
export const swState = t => (typeof t === "string" && t.startsWith("有") ? "有" : t === "无" ? "无" : "未知");

// ---- 左侧是否停在引擎上并带着这次的查询（预期降级的第三个条件；Perplexity 的 SPA 可能改写网址、丢掉 _ss）----
export const hasSs = url => { try { return [...new URL(url).searchParams.keys()].some(k => k === "_ss" || k === "amp;_ss"); } catch { return false; } };
const plus = s => s.replace(/\+/g, " ");
// s（网址或标题）里有没有 text：原文、+ 还原为空格、百分号解码后任一处包含即可
export function carriesQuery(s, text) {
  if (!s || !text) return false;
  const raw = String(s);
  let dec = plus(raw);
  try { dec = decodeURIComponent(dec); } catch {}
  return raw.includes(text) || plus(raw).includes(text) || dec.includes(text);
}
// go.html?u=<原网址>：DNR 重定向的落点（静态 id 或 use_dynamic_url 的 GUID 网址）。\0 未经编码，和 go.js 一样取 "?u=" 之后的全部文本；
// 它带着这次的查询词 → 扩展接管了这次触发
const GO_RE = /^chrome-extension:\/\/[^/]+\/go\.html\?u=/;
export const goCarries = (url, text) => GO_RE.test(url || "") && carriesQuery(url.slice(url.indexOf("?u=") + 3), text);
// tab：扩展读到的标签（url、title、splitViewId）；chain：这个标签自己的主框架跳转链（网址列表，读不到为空）。
// 在 host 上、不在分屏里，且网址或标题带查询词，或它自己的跳转链经过了触发网址（host 上、带 _ss 和查询词）→ 返回依据，否则 null。
// 自己的链里出现过 go.html 的不算普通搜索（扩展接管了，例如分屏失败后 go.js 退回左侧）
export function plainEvidence(tab, { host, text, chain = [] }) {
  if (!tab || hostOf(tab.url) !== host || (tab.splitViewId ?? -1) !== -1) return null;
  if (chain.some(u => GO_RE.test(u || ""))) return null;
  if (carriesQuery(tab.url, text)) return "网址带查询词";
  if (carriesQuery(tab.title, text)) return "标题带查询词";
  if (chain.some(u => hostOf(u) === host && hasSs(u) && carriesQuery(u, text))) return "跳转链经过触发网址";
  return null;
}

// 新出现的（不在 beforeTabs 里）、满足 plainEvidence 的标签：{ tab, how } 或 null。chains：Map(tabId → 跳转链)
export function findPlain(st, { host, text, beforeTabs, chains }) {
  for (const t of st?.tabs || []) {
    if (beforeTabs.has(t.id)) continue;
    const how = plainEvidence(t, { host, text, chain: chains?.get(t.id) ?? [] });
    if (how) return { tab: t, how };
  }
  return null;
}
// 纯函数：把标签按网址唯一对应到 CDP 页面目标（同一网址有多个目标时不认），取那个目标自己的跳转链。返回 Map(tabId → 网址列表)
export function tabChains(tabs = [], pages = [], navChain = () => []) {
  const out = new Map();
  for (const t of tabs) {
    if (!t.url) continue;
    const same = pages.filter(p => p.type === "page" && p.url === t.url);
    if (same.length === 1) out.set(t.id, navChain(same[0].targetId).map(e => (typeof e === "string" ? e : e.url)));
  }
  return out;
}
// 新出现的、没在分屏里的 Google 标签（像是分屏没建成时留下的右侧）
export const strayRight = (st, beforeTabs) =>
  (st?.tabs || []).filter(t => !beforeTabs.has(t.id) && hostOf(t.url) === G && (t.splitViewId ?? -1) === -1);
// “扩展没有接管这次触发”的反证（有反证就不能判预期降级）：返回原因或 null。
// chains：收集器记下的全部主框架跳转链（null = 没有收集器，读不到）；errors：触发后新增的控制台错误；stray：strayRight 的结果
export function takeoverEvidence({ text, chains, errors = [], stray = [] }) {
  if (!chains) return "没有控制台收集器，读不到跳转链，无法排除扩展接管了这次触发";
  if (chains.some(c => c.some(u => goCarries(u, text)))) return "跳转链里出现了带这次查询词的 go.html（DNR 生效、扩展接管了触发）";
  if (errors.length) return `触发后出现了扩展的控制台错误：${String(errors[0].text).slice(0, 80)}`;
  if (stray.length) return `触发后出现了没在分屏里的 Google 标签 ${stray.map(t => t.id).join("、")}（像是分屏没建成时留下的右侧）`;
  return null;
}

// 同一个标签连续 stableMs 都满足才返回它（避开导航中间态）；reset() 在重试时清掉
export function plainTracker(stableMs = 3000, now = Date.now) {
  let seen = null;
  return {
    reset() { seen = null; },
    see(hit) {
      if (!hit) { seen = null; return null; }
      if (seen?.id !== hit.tab.id) seen = { id: hit.tab.id, at: now() };
      return now() - seen.at >= stableMs ? hit : null;
    },
  };
}
export const plainLine = hit => `普通左侧搜索（${hit.how}）：标签 ${hit.tab.id} ${hit.tab.url}`;

// T14 单个引擎的判定（纯函数）。split/plain：分屏了 / 左侧停在引擎上带着查询词（plainEvidence）；
// swBefore/swAfter 为触发前后该 origin 的 SW 文字（swText 或“未知…”）。
// takeover：takeoverEvidence 的结果（扩展接管过这次触发的反证）。
// 分屏：通过。没分屏时只有“触发前就读到 SW + 左侧停在引擎上带着查询词 + 没有扩展接管的反证”才是预期降级（status degrade：G5，不算失败，
// 供决定 leftDiscouraged）；触发后才有 SW 不算（触发那次导航不可能被它接管）；两次都“无”→ 真缺陷；
// 读不到（“未知”）且触发前没读到“有”→ 无法区分降级和缺陷，不给产品建议
export function t14Verdict({ name, split, plain = false, takeover = null, swBefore, swAfter, splitText = "", plainText = "" }) {
  const b = swState(swBefore), a = swState(swAfter);
  const sw = [b, a].includes("有") ? "有" : [b, a].includes("未知") ? "未知" : "无";
  const swLine = `SW 注册：触发前${swBefore}，触发后${swAfter}`;
  if (split) return { status: "pass", detail: `分屏：是；${swLine}；${splitText}`, sw };
  const tail = plainText ? `；${plainText}` : "";
  if (b === "有" && plain && !takeover) {
    return { status: "degrade", degraded: true, sw,
      detail: `分屏：否；${swLine}；预期降级（G5）：${name} 注册了 Service Worker，接管导航绕过了 DNR，退化为普通左侧搜索；建议给该预置引擎设 leftDiscouraged（设置页提示“建议仅作右侧”）${tail}` };
  }
  const why = b === "有" && plain ? `左侧停在 ${name} 上带着查询词，但扩展接管过这次触发（${takeover}），不是 SW 绕过 DNR，不能算预期降级：像是分屏失败后退回了左侧，需要排查`
    : b === "有" ? `触发前有 ${name} 的 Service Worker，但没确认左侧停在 ${name} 上并带着这次的查询词，不能算预期降级，需要排查`
    : a === "有" ? (b === "未知"
      ? `触发前 SW 状态读不到、触发后才读到有，无法确认触发时已注册，不算预期降级（需要重跑或手动查 chrome://serviceworker-internals）`
      : `触发前没有检测到 ${name} 的 Service Worker（触发后才有），触发那次导航不可能被它接管，不是预期降级，需要排查`)
      : sw === "未知" ? `SW 状态读不到，无法区分降级和缺陷（不据此给 ${name} 设 leftDiscouraged，需要重跑或手动查 chrome://serviceworker-internals）`
        : `没检测到 ${name} 的 Service Worker 却没分屏，不是预期降级，需要排查`;
  return { status: "fail", detail: `分屏：否；${swLine}；${why}${tail}`, degraded: false, sw };
}
