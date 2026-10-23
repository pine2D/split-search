// 网页 Service Worker 注册情况（T14 用）：引擎的 SW 接管导航时 DNR 的 main_frame 重定向会失效，
// 按 G5 降级为一次普通的左侧搜索（diag-google-dnr.md s3 实验）。所以 T14 要按引擎 origin 核实 SW 是否真的注册了。
// 两个来源合并：CDP ServiceWorker 域（在一个页面会话上 enable，回放整个配置的注册与版本）和 Target.getTargets 的 service_worker 目标。
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

// T14 单个引擎的判定（纯函数）。split/plain 二选一；sw 为触发前后是否检测到该 origin 的 SW
// 无 SW：分屏才通过，不分屏是真缺陷。有 SW：分屏照样通过；不分屏记失败并写明“预期降级”，供决定是否给预置引擎设 leftDiscouraged
export function t14Verdict({ name, split, plain, swBefore, swAfter, splitText = "", plainText = "" }) {
  const sw = swBefore !== "无" || swAfter !== "无";
  const swLine = `SW 注册：触发前${swBefore}，触发后${swAfter}`;
  if (split) return { status: "pass", detail: `分屏：是；${swLine}；${splitText}` };
  const why = sw
    ? `预期降级（G5）：${name} 注册了 Service Worker，接管导航绕过了 DNR，退化为普通左侧搜索；建议给该预置引擎设 leftDiscouraged（设置页提示“建议仅作右侧”）`
    : `没检测到 ${name} 的 Service Worker 却没分屏，不是预期降级，需要排查`;
  return { status: "fail", detail: `分屏：否；${swLine}；${why}${plainText ? `；${plainText}` : ""}`, degraded: sw };
}
