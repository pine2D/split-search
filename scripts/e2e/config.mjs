import os from "node:os";
import path from "node:path";

export const EXT_ID = "alngkkgnobglnfbhcplhpaflcgfiajnj";
export const PROFILE_DIR = path.join(os.homedir(), ".cache", "split-search-e2e", "profile");
export const DEFAULT_PORT = 8765;
// 直接启动真实二进制：~/.local/bin/google-chrome 包装脚本会 nohup 后台化，破坏管道
export const CHROME_BIN = "/opt/google/chrome/google-chrome";
export const HOSTS = { a: "engine-a.localhost", b: "engine-b.localhost", c: "engine-c.localhost", site: "site-x.localhost" };
// v0.4：不授权的模拟 host（spec 3.14、Spike S12）。不进 HOSTS，所以不进 GRANT_ORIGINS：
// 测试配置里没有它们的 host 权限，扩展只能经 activeTab 读到这些标签的网址
export const UNGRANTED_HOSTS = { u: "engine-u.localhost", page: "page-u.localhost", img: "engine-i.localhost" };

export function mockEngines(port) {
  return [
    { id: "ea", name: "模拟引擎 A", url: `http://${HOSTS.a}:${port}/search?q=%s` },
    { id: "eb", name: "模拟引擎 B", url: `http://${HOSTS.b}:${port}/search?q=%s` },
    { id: "ec", name: "模拟引擎 C", url: `http://${HOSTS.c}:${port}/wiki/%s` },
  ];
}

// 模拟引擎 U：能作左侧、没有授权（⑦ 补成分屏用）；只在 T20 里经 guarded 写进 customEngines
export const mockEngineU = port => ({ id: "eu", name: "模拟引擎 U", url: `http://${UNGRANTED_HOSTS.u}:${port}/search?q=%s` });
// 模拟以图搜图引擎：页面回显收到的 url 参数；只在 ⑧ 步骤里经 guarded 写进 imageEngines
export const mockImageEngine = port => ({ id: "ei", name: "模拟以图搜图", url: `http://${UNGRANTED_HOSTS.img}:${port}/imgsearch?url=%s` });

export function GRANT_ORIGINS(port) {
  return [
    ...Object.values(HOSTS).map(h => `http://${h}:${port}/*`),
    "https://www.google.com/*", "https://www.bing.com/*", "https://kagi.com/*",
    "https://duckduckgo.com/*", "https://www.perplexity.ai/*",
  ];
}

export function CHROME_ARGS(profileDir, { headless = false, restoreSession = false } = {}) {
  const args = [
    `--user-data-dir=${profileDir}`, "--disable-sync", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  ];
  if (headless) args.push("--headless=new");
  if (restoreSession) args.push("--restore-last-session");
  return args;
}
