// 测试窗口尺寸快照：e2e 第一次改测试窗口尺寸（xauto 的 fixWindow、T17 的窄窗口）之前，把原来的 bounds 记进
// .e2e/window-snapshot.json；收尾（teardown.mjs 的 restoreWindowStep）按它改回并删掉文件。
// 强制退出（例如 T17 把窗口设成 900 宽的途中）留下的快照，下次启动先改回：Chrome 会把窗口尺寸存进测试配置，
// 不改回的话下次启动窗口还是窄的，后面的步骤会被窄窗口降级打乱。
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { EXT_ID } from "./config.mjs";
import { OUT_DIR } from "./ext.mjs";

export const WINDOW_FILE = join(OUT_DIR, "window-snapshot.json");
const STATES = ["normal", "minimized", "maximized", "fullscreen"];

// 纯逻辑：CDP Browser.getWindowForTarget 的 bounds → 要记的字段；不合法返回 null
export function snapBounds(b) {
  if (!b || !STATES.includes(b.windowState)) return null;
  if (b.windowState !== "normal") return { windowState: b.windowState };
  const nums = ["left", "top", "width", "height"];
  if (!nums.every(k => Number.isInteger(b[k]))) return null;
  return Object.fromEntries([["windowState", "normal"], ...nums.map(k => [k, b[k]])]);
}

// 纯逻辑：改回 snap 要依次发的 Browser.setWindowBounds 参数（先回到 normal 才能设尺寸）
export function restoreCalls(snap) {
  if (snap.windowState !== "normal") return [{ windowState: snap.windowState }];
  const { left, top, width, height } = snap;
  return [{ windowState: "normal" }, { left, top, width, height }];
}

// 第一次改尺寸前调用：文件已在就不覆盖（那才是运行前的尺寸）
export function rememberWindow(bounds, { file = WINDOW_FILE } = {}) {
  if (existsSync(file)) return false;
  const snap = snapBounds(bounds);
  if (!snap) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snap));
  return true;
}

// 测试窗口：设置页所在的窗口（resetTabs 在它里面开 site-x，步骤测量的就是它）；没有设置页就取第一个页面
async function testWindowId(browser) {
  const pages = (await browser.targets()).filter(t => t.type === "page");
  const page = pages.find(t => t.url.startsWith(`chrome-extension://${EXT_ID}/options/`)) ?? pages[0];
  if (!page) throw new Error("没有页面目标，找不到测试窗口");
  return (await browser.client.send("Browser.getWindowForTarget", { targetId: page.targetId })).windowId;
}

// 有快照就改回并删掉文件，返回改回的 bounds；没有快照返回 null。失败抛出、保留文件（下次收尾或启动再试）
export async function restoreWindow(browser, { file = WINDOW_FILE } = {}) {
  if (!existsSync(file)) return null;
  let snap;
  try { snap = snapBounds(JSON.parse(readFileSync(file, "utf8"))); } catch { snap = null; }
  if (!snap) { unlinkSync(file); return { invalid: true }; }
  const windowId = await testWindowId(browser);
  for (const bounds of restoreCalls(snap)) await browser.client.send("Browser.setWindowBounds", { windowId, bounds });
  unlinkSync(file);
  return snap;
}

export const describeBounds = s => (s.invalid ? "快照格式不对，已删除" : s.windowState === "normal" ? `${s.width}×${s.height}（${s.left},${s.top}）` : s.windowState);

// 启动时：上次强制退出留下的快照先改回。返回要写进报告的备注（没有快照返回 null）
export async function restorePendingWindow(browser, { file = WINDOW_FILE } = {}) {
  if (!existsSync(file)) return null;
  try { return `启动时发现上次遗留的窗口尺寸快照，测试窗口已改回 ${describeBounds(await restoreWindow(browser, { file }))}`; }
  catch (e) { return `启动时改回遗留的窗口尺寸失败：${e.message}；快照保留，收尾再试`; }
}
