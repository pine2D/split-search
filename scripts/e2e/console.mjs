// 收集整次运行中的 [split-search] 控制台错误：浏览器级自动 attach 到所有页面与 worker，
// 在每个会话上 Runtime.enable（会回放已有的控制台消息），只保留含标记的 error 和扩展里的未捕获异常。
import { EXT_ID } from "./config.mjs";

const MARK = "[split-search]";
const TYPES = new Set(["page", "service_worker", "worker", "shared_worker"]);

const argText = a => (a.type === "string" ? a.value : a.value !== undefined ? JSON.stringify(a.value) : a.description ?? "");

export async function collectConsole(browser) {
  const { client } = browser;
  const errors = [];
  const seen = new Set();
  const extPrefix = `chrome-extension://${EXT_ID}/`;
  const sessions = new Set();
  let attached = 0, extAttached = 0; // 历次附着的会话数（会话 detach 后 sessions 会减少）
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
  };
  const onDetached = ({ sessionId }) => sessions.delete(sessionId);

  client.on("Runtime.consoleAPICalled", onConsole);
  client.on("Runtime.exceptionThrown", onException);
  client.on("Target.attachedToTarget", onAttached);
  client.on("Target.detachedFromTarget", onDetached);
  await client.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  return {
    errors,
    sessionCount: () => sessions.size,
    stats: () => ({ attached, extAttached }),
    stop: async () => {
      client.off("Runtime.consoleAPICalled", onConsole);
      client.off("Runtime.exceptionThrown", onException);
      client.off("Target.attachedToTarget", onAttached);
      client.off("Target.detachedFromTarget", onDetached);
      await client.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    },
  };
}
