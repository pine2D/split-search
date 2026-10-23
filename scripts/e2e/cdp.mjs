import { StringDecoder } from "node:string_decoder";

export function encodeFrame(obj) { return JSON.stringify(obj) + "\0"; }

// 以 \0 分帧，能处理拆包与粘包
export function createDecoder(onMessage) {
  let buf = "";
  return chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (frame) onMessage(JSON.parse(frame));
    }
  };
}

const DEFAULT_TIMEOUT_MS = 15000;

export function createClient(writable, readable) {
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();
  const sd = new StringDecoder("utf8");

  const feed = createDecoder(msg => {
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const fn of [...(handlers.get(msg.method) || [])]) fn(msg.params, msg.sessionId);
    }
  });
  const onData = d => feed(typeof d === "string" ? d : sd.write(d));
  readable.on("data", onData);

  let closed = false;
  function rejectAll(err) {
    closed = true;
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(err); pending.delete(id); }
  }
  readable.on("close", () => rejectAll(new Error("CDP 连接已关闭")));
  const onErr = e => rejectAll(new Error("CDP 连接错误：" + e.message));
  readable.on("error", onErr);
  writable.on("error", onErr);

  return {
    send(method, params = {}, sessionId, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
      if (closed) return Promise.reject(new Error("CDP 连接已关闭"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} 超时`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, method, timer });
        const msg = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        try { writable.write(encodeFrame(msg)); }
        catch (e) { pending.delete(id); clearTimeout(timer); reject(e); }
      });
    },
    on(method, fn) { (handlers.get(method) || handlers.set(method, new Set()).get(method)).add(fn); },
    off(method, fn) { handlers.get(method)?.delete(fn); },
    close() {
      readable.off("data", onData);
      rejectAll(new Error("CDP 客户端已关闭"));
      handlers.clear();
    },
  };
}
