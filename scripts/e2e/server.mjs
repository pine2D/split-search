// 模拟搜索引擎 + 验收向导页：单个 HTTP 服务，按 Host 头分流，仅绑定 127.0.0.1
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { HOSTS, UNGRANTED_HOSTS, mockEngines } from "./config.mjs";
import { redact } from "./report.mjs";

const GUIDE_DIR = fileURLToPath(new URL("./guide/", import.meta.url));
const ANSWERS = new Set(["pass", "fail", "skip", "retry", "done", "nosplit"]);
const STATIC = {
  "/guide": ["guide.html", "text/html; charset=utf-8"],
  "/guide/guide.js": ["guide.js", "text/javascript; charset=utf-8"],
  "/guide/guide.css": ["guide.css", "text/css; charset=utf-8"],
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const page = (title, body) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${body}</body></html>`;
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };

function createGuide() {
  let seq = 0, step = null, progress = { done: 0, total: 0 };
  const results = [];
  let pending = null;      // { resolve, timer }
  let answered = null;     // 当前 step 已收到、尚无人等待的答案
  let consumed = false;    // 当前 step 的答案是否已被接受

  const settle = value => {
    if (!pending) return;
    const p = pending; pending = null;
    clearTimeout(p.timer);
    p.resolve(value);
  };
  return {
    setStep(s) {
      settle("timeout");
      seq++; step = s; answered = null; consumed = false;
    },
    setResult(id, status, detail) { results.push({ id, status, detail: redact(detail) }); }, // 向导页上的说明也脱敏
    setProgress(done, total) { progress = { done, total }; },
    waitAnswer({ timeoutMs }) {
      settle("timeout");
      if (answered) { const a = answered; answered = null; return Promise.resolve(a); }
      return new Promise(resolve => {
        pending = { resolve, timer: setTimeout(() => settle("timeout"), timeoutMs) };
      });
    },
    cancel() { settle("timeout"); },
    state: () => ({ step, progress, results: results.slice(-20), seq }),
    answer(reqSeq, answer) {
      if (reqSeq !== seq || !step || consumed || !ANSWERS.has(answer)) return false;
      consumed = true;
      if (pending) settle(answer); else answered = answer;
      return true;
    },
  };
}

function engineRoutes(port) {
  const byHost = {};
  for (const e of mockEngines(port)) {
    const host = new URL(e.url).hostname;
    const key = Object.keys(HOSTS).find(k => HOSTS[k] === host);
    byHost[host] = key.toUpperCase();
  }
  byHost[UNGRANTED_HOSTS.u] = "U"; // 模拟引擎 U（没有授权），路由与 A/B/C 相同
  return byHost;
}

// 4×4 的纯色 PNG（页面里按 240×160 显示，够右键）：/img.png 与 data: 图片共用
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOwqs2GIwbiOADUcxIhZwX78wAAAABJRU5ErkJggg==", "base64");

// page-u 的普通文章页（边读边查、以图搜图用）：两段 ASCII 文字、一张 http 图片、一张 data: 图片；没有链接（链接会改变右键菜单的行数）
const article = port => page("page-u article", [
  `<h1>page-u</h1>`,
  `<p id="p1">The quick brown fox jumps over the lazy dog near the river bank.</p>`,
  `<p id="p2">Split views keep the page you are reading next to the search results.</p>`,
  `<p><img id="http-img" alt="http image" width="240" height="160" src="http://${UNGRANTED_HOSTS.page}:${port}/img.png"></p>`,
  `<p><img id="data-img" alt="data image" width="240" height="160" src="data:image/png;base64,${PNG.toString("base64")}"></p>`,
].join(""));

export function startServer({ port }) {
  const guide = createGuide();
  const engines = engineRoutes(port);
  const send = (res, code, type, body) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); };

  const server = http.createServer(async (req, res) => {
    const host = (req.headers.host || "").replace(/:\d+$/, "");
    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    try {
      if (engines[host]) {
        // 引擎的普通页面（不是搜索结果页）：T16 用它验证重启后兜底判“不是”
        if (path === "/about") return send(res, 200, "text/html; charset=utf-8", page(`${engines[host]} about`, `<h1>${esc(engines[host])}</h1><p>about</p>`));
        let q = null;
        if (path === "/search") q = url.searchParams.get("q") ?? "";
        else if (path.startsWith("/wiki/")) q = safeDecode(path.slice(6));
        if (q === null) return send(res, 404, "text/plain; charset=utf-8", "not found");
        const t = `${engines[host]} · ${q}`;
        return send(res, 200, "text/html; charset=utf-8", page(t, `<h1>${esc(engines[host])}</h1><p>${esc(q)}</p>`));
      }
      if (host === UNGRANTED_HOSTS.page) {
        if (path === "/article") return send(res, 200, "text/html; charset=utf-8", article(server.address().port));
        if (path === "/img.png") return send(res, 200, "image/png", PNG);
        return send(res, 404, "text/plain; charset=utf-8", "not found");
      }
      // 模拟以图搜图引擎：回显收到的 url 参数（已解码）
      if (host === UNGRANTED_HOSTS.img) {
        if (path !== "/imgsearch") return send(res, 404, "text/plain; charset=utf-8", "not found");
        const got = url.searchParams.get("url") ?? "";
        return send(res, 200, "text/html; charset=utf-8", page(`I · ${got}`, `<h1>I</h1><p id="got">${esc(got)}</p>`));
      }
      // 向导与 API 路径不属于 site-x（保证向导只能从 127.0.0.1 访问）
      const reserved = path === "/guide" || path.startsWith("/guide/") || path.startsWith("/api/");
      if (host === HOSTS.site && !reserved) return send(res, 200, "text/html; charset=utf-8", page(`site-x ${path}`, `<h1>site-x</h1><p>${esc(path)}</p>`));
      if (host === "127.0.0.1" || host === "localhost") {
        if (req.method === "GET" && STATIC[path]) {
          const [file, type] = STATIC[path];
          return send(res, 200, type, await readFile(GUIDE_DIR + file));
        }
        if (req.method === "GET" && path === "/api/state") return send(res, 200, "application/json", JSON.stringify(guide.state()));
        if (req.method === "POST" && path === "/api/answer") {
          // 只接受向导页自己（同源 fetch）发来的 JSON：本机其他浏览器里的网页不能伪造“通过”。
          // 跨源的简单请求不能带 application/json，带了就要预检，而这里不响应预检
          const own = `http://127.0.0.1:${server.address().port}`;
          if (req.headers.origin !== own || !/^application\/json\b/.test(req.headers["content-type"] || "")) {
            return send(res, 403, "text/plain; charset=utf-8", "forbidden");
          }
          let raw = "";
          for await (const c of req) { raw += c; if (raw.length > 4096) break; }
          let body = {};
          try { body = JSON.parse(raw) ?? {}; } catch { return send(res, 400, "text/plain", "bad json"); }
          return guide.answer(body.seq, body.answer) ? send(res, 200, "application/json", "{}") : send(res, 409, "text/plain", "stale");
        }
      }
      send(res, 404, "text/plain; charset=utf-8", "not found");
    } catch (e) {
      send(res, 500, "text/plain; charset=utf-8", String(e?.message || e));
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", err => {
      reject(err.code === "EADDRINUSE" ? new Error(`端口 ${port} 已被占用；可用 --port 换端口，但需要重新授权`) : err);
    });
    server.listen(port, "127.0.0.1", () => {
      resolve({
        guide,
        port: server.address().port, // 传 port: 0 时是系统分配的端口

        close: () => new Promise(r => { guide.cancel(); server.close(() => r()); server.closeAllConnections(); }),
      });
    });
  });
}
