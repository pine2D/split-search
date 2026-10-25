// chrome://extensions/shortcuts 驱动（CDP，同 ext-webui.mjs 的做法：attach 页面目标，走 WebUI 的 shadow DOM）：
// 给本扩展的命令绑定/清除快捷键，读回当前绑定。页面开在单独的后台窗口里，不动步骤用来测量的那个窗口。
// 页面结构（Chrome 156 实测）：每个命令一个 .command-entry，里面有 select[data-extension-id][data-command-name]
// 和 cr-shortcut-input；后者的 shadow DOM 里 #edit（开始录入）、#clear（清除）、#input。
// 绑定：点 #edit 开始录入，再用 CDP Input.dispatchKeyEvent 发可信的按键（页面按 keyCode 和修饰键拼出快捷键）；
// 清除：点 #clear。读回一律用同一页面里的 chrome.developerPrivate.getExtensionInfo（WebUI 自己也用它）。
// 改动前把原来的绑定记进 .e2e/shortcut-snapshot.json，restoreShortcut 按它改回并删掉文件；
// 收尾（teardown.mjs）与下次启动（run.mjs）遇到遗留文件同样改回，测试配置结束时与开始时一致。
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { EXT_ID } from "./config.mjs";
import { OUT_DIR } from "./ext.mjs";
import { infra } from "./ext-webui.mjs";

export const SHORTCUTS_URL = "chrome://extensions/shortcuts";
export const SHORTCUT_FILE = join(OUT_DIR, "shortcut-snapshot.json");
export const COMMAND = "cycle-right";
// 测试用组合键。Chrome（Linux）自带快捷键没有用 Alt+Shift+句点的（Alt+Shift 只有 A/B/I/T 等字母），
// 也不是 Ctrl+Alt（快捷键页默认不收）；嵌套显示里没有窗口管理器，不会被桌面截走
export const TEST_KEYS = "Alt+Shift+Period";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 纯逻辑：组合键字符串（Chrome 的写法，如 "Alt+Shift+Period"）→ CDP 按键参数 / xdotool 组合键 ----
const MODS = { Alt: { bit: 1, xdo: "alt" }, Ctrl: { bit: 2, xdo: "ctrl" }, Command: { bit: 4, xdo: "super" }, Shift: { bit: 8, xdo: "shift" } };
const NAMED = {
  Comma: { vk: 188, key: ",", xdo: "comma" }, Period: { vk: 190, key: ".", xdo: "period" },
  Home: { vk: 36, xdo: "Home" }, End: { vk: 35, xdo: "End" }, PageUp: { vk: 33, xdo: "Prior" }, PageDown: { vk: 34, xdo: "Next" },
  Space: { vk: 32, key: " ", xdo: "space" }, Insert: { vk: 45, xdo: "Insert" }, Delete: { vk: 46, xdo: "Delete" },
  Up: { vk: 38, key: "ArrowUp", code: "ArrowUp", xdo: "Up" }, Down: { vk: 40, key: "ArrowDown", code: "ArrowDown", xdo: "Down" },
  Left: { vk: 37, key: "ArrowLeft", code: "ArrowLeft", xdo: "Left" }, Right: { vk: 39, key: "ArrowRight", code: "ArrowRight", xdo: "Right" },
};

// 返回 { mods: ["Alt", ...], modifiers（CDP 位掩码）, key: { vk, key, code, xdo } }；不合法抛错
export function parseKeys(keys) {
  const parts = String(keys ?? "").split("+");
  const last = parts.pop();
  if (!parts.length || parts.some(p => !MODS[p]) || new Set(parts).size !== parts.length) throw new Error(`快捷键写法不对：${keys}`);
  if (!parts.includes("Alt") && !parts.includes("Ctrl") && !parts.includes("Command")) throw new Error(`快捷键必须带 Ctrl 或 Alt：${keys}`);
  let key;
  if (/^[A-Z]$/.test(last)) key = { vk: last.charCodeAt(0), key: last.toLowerCase(), code: `Key${last}`, xdo: last.toLowerCase() };
  else if (/^[0-9]$/.test(last)) key = { vk: last.charCodeAt(0), key: last, code: `Digit${last}`, xdo: last };
  else if (/^F([1-9]|1[0-2])$/.test(last)) key = { vk: 111 + Number(last.slice(1)), key: last, code: last, xdo: last };
  else if (NAMED[last]) key = { key: last, code: last, ...NAMED[last] };
  else throw new Error(`快捷键的主键不支持：${last}（${keys}）`);
  return { mods: parts, modifiers: parts.reduce((n, p) => n | MODS[p].bit, 0), key };
}

// xdotool key 的组合键写法，如 "alt+shift+period"
export const xdoCombo = keys => { const p = parseKeys(keys); return [...p.mods.map(m => MODS[m].xdo), p.key.xdo].join("+"); };

// CDP Input.dispatchKeyEvent 的按下/松开参数（只发主键，修饰键经 modifiers 位掩码带上）
export function keyEvents(keys) {
  const { modifiers, key } = parseKeys(keys);
  const base = { modifiers, key: key.key, code: key.code, windowsVirtualKeyCode: key.vk, nativeVirtualKeyCode: key.vk };
  return [{ type: "rawKeyDown", ...base }, { type: "keyUp", ...base }];
}

// ---- 页面驱动 ----
const DEEP = `const deepAll = (sel, root = document) => { const out = []; const walk = r => { out.push(...r.querySelectorAll(sel));
  for (const el of r.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); }; walk(root); return out; };`;
// 本扩展某个命令的 cr-shortcut-input；找不到返回 null
const INPUT = command => `${DEEP} const entry = deepAll(".command-entry").find(e => { const s = e.querySelector("select[data-command-name]");
  return s && s.dataset.extensionId === ${JSON.stringify(EXT_ID)} && s.dataset.commandName === ${JSON.stringify(command)}; });
  const inp = entry?.querySelector("cr-shortcut-input") ?? null;`;
const BINDING = command => `chrome.developerPrivate.getExtensionInfo(${JSON.stringify(EXT_ID)})
  .then(i => (i.commands ?? []).find(c => c.name === ${JSON.stringify(command)})?.keybinding ?? null)`;

// 打开快捷键页（后台新窗口），等到本扩展这个命令的输入框出现。返回 { binding(), set(keys), close() }
export async function openShortcuts(browser, command = COMMAND, { timeoutMs = 15000 } = {}) {
  const { client } = browser;
  let targetId, sid;
  try { ({ targetId } = await client.send("Target.createTarget", { url: SHORTCUTS_URL, newWindow: true, background: true })); }
  catch (e) { throw infra(`打不开 ${SHORTCUTS_URL}：${e.message}`); }
  const close = async () => {
    if (sid) await client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
    await browser.waitFor(async () => !(await browser.targets()).some(t => t.targetId === targetId), { timeoutMs: 3000, intervalMs: 100 }).catch(() => {});
  };
  const ev = expr => browser.evaluate(sid, expr, { timeoutMs: 10000 });
  try {
    sid = await browser.attach(targetId);
    await browser.waitFor(() => ev(`(() => { ${INPUT(command)} return !!inp?.shadowRoot?.querySelector("#edit"); })()`).catch(() => false),
      { timeoutMs, intervalMs: 250 });
  } catch (e) {
    await close();
    throw infra(`快捷键页里认不出本扩展命令 ${command} 的快捷键输入框（${e.message}）`);
  }
  // 后台窗口里的页面没有焦点：开启焦点模拟，录入时的按键才会送到输入框
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sid).catch(() => {});
  const binding = () => ev(BINDING(command));
  const waitBinding = (want, what) => browser.waitFor(async () => (await binding()) === want, { timeoutMs: 5000, intervalMs: 150 })
    .catch(async () => { throw infra(`${what}后读回的快捷键是 ${JSON.stringify(await binding().catch(() => null))}，应为 ${JSON.stringify(want)}`); });

  const set = async keys => {
    if ((await binding()) === keys) return "unchanged";
    if (!keys) {
      const ok = await ev(`(() => { ${INPUT(command)} const b = inp?.shadowRoot?.querySelector("#clear"); if (!b || b.disabled) return false; b.click(); return true; })()`);
      if (!ok) throw infra("快捷键页里的“清除”按钮找不到或不可用");
      await waitBinding("", "点“清除”");
      return "cleared";
    }
    const events = keyEvents(keys);
    const started = await ev(`(() => { ${INPUT(command)} const b = inp?.shadowRoot?.querySelector("#edit"); if (!b) return false; b.click(); return true; })()`);
    if (!started) throw infra("快捷键页里的“编辑”按钮找不到");
    await sleep(200);
    for (const e of events) await client.send("Input.dispatchKeyEvent", e, sid);
    await waitBinding(keys, `录入 ${keys} `);
    return "bound";
  };
  return { targetId, binding, set, close };
}

async function withShortcuts(browser, command, fn) {
  const page = await openShortcuts(browser, command);
  try { return await fn(page); } finally { await page.close(); }
}

// 第一次改动前记下原来的绑定（文件已在就不覆盖：那才是运行前的值）
function remember(command, before) {
  if (existsSync(SHORTCUT_FILE)) return;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(SHORTCUT_FILE, JSON.stringify({ command, before }));
}

async function change(browser, command, keys) {
  return withShortcuts(browser, command, async page => {
    const before = await page.binding();
    if (before === null) throw infra(`developerPrivate 读不到本扩展的命令 ${command}`);
    if (before !== keys) remember(command, before);
    return page.set(keys);
  });
}

export const bindShortcut = (browser, command, keys) => change(browser, command, keys);
export const clearShortcut = (browser, command) => change(browser, command, "");
export const readShortcut = (browser, command = COMMAND) => withShortcuts(browser, command, page => page.binding());

// 按快照改回运行前的绑定并删掉快照；没有快照返回 null。失败时保留快照（下次收尾或启动再试）
export async function restoreShortcut(browser) {
  if (!existsSync(SHORTCUT_FILE)) return null;
  let snap;
  try { snap = JSON.parse(readFileSync(SHORTCUT_FILE, "utf8")); } catch { snap = null; }
  if (!snap || typeof snap.command !== "string" || typeof snap.before !== "string") {
    unlinkSync(SHORTCUT_FILE);
    return { command: null, before: null, note: "快捷键快照格式不对，已删除" };
  }
  await withShortcuts(browser, snap.command, page => page.set(snap.before));
  unlinkSync(SHORTCUT_FILE);
  return snap;
}
