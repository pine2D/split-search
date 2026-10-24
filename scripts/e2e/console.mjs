// 收集整次运行中的 [split-search] 控制台错误：浏览器级自动 attach 到所有页面与 worker，
// 在每个会话上 Runtime.enable（会回放已有的控制台消息），只保留含标记的 error 和扩展里的未捕获异常。
// 顺带在页面会话上 Network.enable，记下每个页面主框架的 Document 请求与跳转（失败诊断用，见 diag.mjs）：
// 有这条链就能看出触发网址有没有被 DNR 重定向到 go.html。每个页面只留最近 NAV_MAX 条，最多记 NAV_PAGES 个页面
import { EXT_ID } from "./config.mjs";

const MARK = "[split-search]";
const TYPES = new Set(["page", "service_worker", "worker", "shared_worker"]);

const NAV_MAX = 12, NAV_PAGES = 60;

const argText = a => (a.type === "string" ? a.value : a.value !== undefined ? JSON.stringify(a.value) : a.description ?? "");

// carry：浏览器重启前的收集器，沿用它的错误列表、去重集合与附着计数（B15 要覆盖整次运行）
export async function collectConsole(browser, { carry } = {}) {
  const { client } = browser;
  const errors = carry?.errors ?? [];
  const seen = carry?.seen ?? new Set();
  const extPrefix = `chrome-extension://${EXT_ID}/`;
  const sessions = new Set();
  const base = carry?.stats() ?? { attached: 0, extAttached: 0 };
  let attached = base.attached, extAttached = base.extAttached; // 历次附着的会话数（会话 detach 后 sessions 会减少）
  const push = e => {
    const k = `${e.text}|${e.url}|${e.ts}`;
    if (seen.has(k)) return;
    seen.add(k);
    errors.push(e);
  };

  const onConsole = (p, sessionId) => {
    if (!sessions.has(sessionId) || p.type !== "error") return;
    const text = (p.args || []).map(argText).join(" ");
    if (!text.includes(MARK)) return;
    push({ text, url: p.stackTrace?.callFrames?.[0]?.url || "", ts: p.timestamp });
  };
  const onException = (p, sessionId) => {
    if (!sessions.has(sessionId)) return;
    const d = p.exceptionDetails || {};
    const url = d.url || d.stackTrace?.callFrames?.[0]?.url || "";
    const text = d.exception?.description || d.text || "";
    if (!url.startsWith(extPrefix) && !text.includes(MARK)) return;
    push({ text: `未捕获异常：${text}`, url, ts: p.timestamp });
  };
  const onAttached = ({ sessionId, targetInfo }) => {
    if (!TYPES.has(targetInfo.type)) return;
    sessions.add(sessionId);
    attached++;
    if ((targetInfo.url || "").startsWith(extPrefix)) extAttached++;
    client.send("Runtime.enable", {}, sessionId).catch(() => {});
    if (targetInfo.type === "page") {
      pageOf.set(sessionId, targetInfo.targetId);
      client.send("Network.enable", {}, sessionId).catch(() => {});
    }
  };
  const onDetached = ({ sessionId }) => { sessions.delete(sessionId); pageOf.delete(sessionId); };
  // 主框架的 frameId 等于页面的 targetId；redirectResponse 表示这一条是上一条跳转来的
  const pageOf = new Map(), nav = new Map();
  const onRequest = (p, sessionId) => {
    const targetId = pageOf.get(sessionId);
    if (!targetId || p.type !== "Document" || p.frameId !== targetId) return;
    if (!nav.has(targetId)) {
      nav.set(targetId, []);
      if (nav.size > NAV_PAGES) nav.delete(nav.keys().next().value);
    }
    const list = nav.get(targetId);
    list.push({ url: p.request?.url ?? "", status: p.redirectResponse?.status ?? null });
    if (list.length > NAV_MAX) list.shift();
  };

  client.on("Runtime.consoleAPICalled", onConsole);
  client.on("Runtime.exceptionThrown", onException);
  client.on("Target.attachedToTarget", onAttached);
  client.on("Target.detachedFromTarget", onDetached);
  client.on("Network.requestWillBeSent", onRequest);
  await client.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  return {
    errors,
    seen,
    sessionCount: () => sessions.size,
    stats: () => ({ attached, extAttached }),
    navChain: targetId => [...(nav.get(targetId) ?? [])],
    navChains: () => [...nav.values()].map(list => list.map(e => e.url)), // 全部页面的跳转链（只要网址），T14 认“普通左侧搜索”用
    stop: async () => {
      client.off("Runtime.consoleAPICalled", onConsole);
      client.off("Runtime.exceptionThrown", onException);
      client.off("Target.attachedToTarget", onAttached);
      client.off("Target.detachedFromTarget", onDetached);
      client.off("Network.requestWillBeSent", onRequest);
      await client.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    },
  };
}
