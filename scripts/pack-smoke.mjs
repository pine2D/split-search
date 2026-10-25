// 发布包安装冒烟：把 ZIP 解压到临时目录，在一次性 Chrome 配置（无头、--disable-sync、no-first-run、管道 CDP）里
// 用 Extensions.loadUnpacked 装上，核对：没有 manifest 错误和安装警告、SW 起得来、设置页按英文渲染且没有 [split-search]
// 控制台错误、DNR 规则指向本次装出的 ID、切换 uiLocale 后 SW 重建右键菜单没有错误、工具栏弹窗按英文渲染、
// go.html 收到格式不对的 _ss 时显示出错页。临时配置和解压目录用完即删
// （SIGINT/SIGTERM/SIGHUP 也删；被 SIGKILL 留下的，下次开头清掉）；只关自己起的浏览器，
// 绝不碰 ~/.cache/split-search-e2e/profile 或真实配置。
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./e2e/browser.mjs";
import { collectConsole } from "./e2e/console.mjs";
import { EXT_ID as DEV_ID } from "./e2e/config.mjs";

const J = JSON.stringify;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 安装时 Chrome 显示的权限警告原文（v0.3 实测只有 DNR 一条；activeTab、contextMenus 不产生警告）。变了就判冒烟失败
export const EXPECTED_PERMISSION_WARNINGS = ["Block content on any page"];
// 格式不对的标记（只有一个引擎 id）：期望出错页显示 err_marker_format
const BAD_TRIGGER = "https://www.google.com/search?q=split&_ss=google";

// 本扩展的两个右键菜单项（src/lib/menu-spec.js）
const MENU_IDS = ["ss-lookup-text", "ss-lookup-image"];
// 扩展页里没有读菜单项的 API：update 成功就说明这一项存在
const menusExist = (page) => page.ev(`Promise.all(${J(MENU_IDS)}.map(id => new Promise(r =>
  chrome.contextMenus.update(id, { enabled: true }, () => r(!chrome.runtime.lastError))))).then(xs => xs.every(Boolean))`,
{ timeoutMs: 3000 });

// 等启动时的重建完成 → removeAll 并确认两项都没了 → 改 uiLocale → 等两项重新出现（SW 的 rebuildMenus）
async function menusRebuiltAfter(b, page, locale) {
  await b.waitFor(() => menusExist(page), { timeoutMs: 10000 });
  await page.ev(`chrome.contextMenus.removeAll().then(() => true)`, { timeoutMs: 3000 });
  const gone = await page.ev(`Promise.all(${J(MENU_IDS)}.map(id => new Promise(r =>
    chrome.contextMenus.update(id, { enabled: true }, () => r(!!chrome.runtime.lastError))))).then(xs => xs.every(Boolean))`,
  { timeoutMs: 3000 });
  if (!gone) throw new Error("removeAll 之后菜单项还在，探针不可信");
  await page.ev(`chrome.storage.sync.set({ uiLocale: ${J(locale)} }).then(() => true)`, { timeoutMs: 5000 });
  try { await b.waitFor(() => menusExist(page), { timeoutMs: 10000 }); }
  catch { throw new Error(`uiLocale 改成 ${locale} 后 10 秒内菜单项没有重建出来`); }
}

async function openPage(b, url) {
  const { targetId } = await b.client.send("Target.createTarget", { url });
  const sid = await b.attach(targetId);
  return { targetId, sid, ev: (expr, o) => b.evaluate(sid, expr, o),
    close: async () => {
      await b.client.send("Target.detachFromTarget", { sessionId: sid }).catch(() => {});
      await b.client.send("Target.closeTarget", { targetId }).catch(() => {});
    } };
}

const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// 以前的运行被强杀留下的临时目录：Chrome 已退出（SingletonLock 记录的 pid 不在，或没有锁）且超过 10 分钟才删，
// 不会删到正在跑的另一次冒烟
function pruneStale(log) {
  let names;
  try { names = readdirSync(tmpdir()); } catch { return; }
  for (const n of names) {
    if (!/^split-search-smoke-[A-Za-z0-9]{6}$/.test(n)) continue;
    const dir = join(tmpdir(), n);
    try {
      if (Date.now() - statSync(dir).mtimeMs < 10 * 60e3) continue;
      let pid = null;
      try { pid = Number(/-(\d+)$/.exec(readlinkSync(join(dir, "profile", "SingletonLock")))?.[1]) || null; } catch { /* 没有锁 */ }
      if (pid && pidAlive(pid)) continue;
      rmSync(dir, { recursive: true, force: true });
      log(`已清理遗留的临时目录 ${dir}`);
    } catch { /* 读不到就留着 */ }
  }
}

// 页面里显示成 key 的 data-i18n 元素（文案没加载出来时 t() 返回 key 本身）；设置页和弹窗共用
const rawKeys = page => page.ev(`[...document.querySelectorAll("[data-i18n]")]
  .filter(el => /^[a-z]+_[a-z0-9_]+$/.test(el.textContent.trim())).map(el => el.getAttribute("data-i18n"))`);

const waitTrue = (b, page, expr, what, timeoutMs = 15000) =>
  b.waitFor(() => page.ev(expr, { timeoutMs: 3000 }), { timeoutMs }).catch(e => { throw new Error(`${what}：${e.message}`); });

// 返回 { results: [{ name, ok, detail }], id }；任何一项不过都在 results 里写明，不抛
export async function smoke(zipPath, { expectId = null, log = console.log } = {}) {
  pruneStale(log);
  const tmp = mkdtempSync(join(tmpdir(), "split-search-smoke-"));
  const extDir = join(tmp, "ext"), profileDir = join(tmp, "profile");
  const results = [];
  const record = (name, ok, detail = "") => { results.push({ name, ok, detail }); log(`${ok ? "通过" : "失败"}  ${name}${detail ? "：" + detail : ""}`); };
  let browser = null, collector = null, id = null;
  const savedEnv = { LANGUAGE: process.env.LANGUAGE, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
  const SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  const onSignal = sig => { cleanup().finally(() => process.exit(SIGNALS[sig])); };
  async function cleanup() {
    for (const sig of Object.keys(SIGNALS)) process.off(sig, onSignal);
    if (collector) await collector.stop().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    browser = null;
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const sig of Object.keys(SIGNALS)) process.on(sig, onSignal);
  try {
    const uz = spawnSync("/usr/bin/unzip", ["-q", zipPath, "-d", extDir], { encoding: "utf8" });
    if (uz.status !== 0) { record("解压", false, (uz.stderr || uz.error?.message || "").trim()); return { results, id }; }
    const enMessages = JSON.parse(readFileSync(join(extDir, "_locales/en/messages.json"), "utf8"));
    const en = k => enMessages[k].message;

    // 界面语言跟随浏览器：让一次性浏览器以英文启动（launch 把 process.env 传给 Chrome）
    Object.assign(process.env, { LANGUAGE: "en", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" });
    browser = await launch({ headless: true, profileDir });
    const b = browser;

    try { id = (await b.client.send("Extensions.loadUnpacked", { path: extDir })).id; }
    catch (e) { record("装载扩展", false, e.message); return { results, id }; }
    if (expectId && id !== expectId) record("扩展 ID", false, `期望 ${expectId}，实际 ${id}`);
    else if (!expectId && id === DEV_ID) record("扩展 ID", false, `装出的是开发 ID ${id}，发布包里的 key 没去掉`);
    else record("装载扩展", true, `id ${id}${expectId ? "（商店 ID）" : "（不是开发 ID）"}`);
    collector = await collectConsole(b, { extId: id });

    // chrome://extensions 的 developerPrivate 能读到 manifest 错误、安装警告与运行时错误
    const mgr = await openPage(b, `chrome://extensions/?id=${id}`);
    try {
      const info = await b.waitFor(() => mgr.ev(`new Promise(r => chrome.developerPrivate
        ? chrome.developerPrivate.getExtensionInfo(${J(id)}, i => r(i ? { state: i.state, manifestErrors: i.manifestErrors ?? [],
          installWarnings: i.installWarnings ?? [], runtimeErrors: i.runtimeErrors ?? [],
          permissionWarnings: i.permissions?.simplePermissions?.map(p => p.message) ?? null } : null)) : r(null))`, { timeoutMs: 5000 }), { timeoutMs: 15000 });
      // 结构变了读不到的字段按空处理，不让回调抛错（那样 Promise 永不结算，会被误报成“读不到扩展信息”）；
      // 读不到权限警告记成 null，下面的比较照样判失败并写明实际值
      const problems = [...info.manifestErrors.map(e => `manifest 错误：${e.message}`),
        ...info.installWarnings.map(w => `安装警告：${w}`), ...info.runtimeErrors.map(e => `运行时错误：${e.message}`)];
      record("manifest 无错误与警告", info.state === "ENABLED" && !problems.length,
        problems.length ? problems.join("；") : `state ${info.state}`);
      const warns = info.permissionWarnings;
      record("权限警告与 v0.3 相同", J(warns) === J(EXPECTED_PERMISSION_WARNINGS),
        `实际 ${J(warns)}，期望 ${J(EXPECTED_PERMISSION_WARNINGS)}`);
    } catch (e) { record("manifest 无错误与警告", false, `读不到扩展信息：${e.message}`); }
    finally { await mgr.close(); }

    const swUrl = `chrome-extension://${id}/background.js`;
    try {
      await b.waitFor(async () => (await b.targets()).some(t => t.type === "service_worker" && t.url === swUrl), { timeoutMs: 15000 });
      record("Service Worker 已启动", true, swUrl);
    } catch (e) { record("Service Worker 已启动", false, e.message); }

    const opt = await openPage(b, `chrome-extension://${id}/options/options.html`);
    try {
      try {
        await waitTrue(b, opt, `document.documentElement.lang === "en" && document.title === ${J(en("options_title"))}
          && !document.documentElement.classList.contains("i18n-pending")`, "设置页按英文渲染");
        const raw = await rawKeys(opt);
        await sleep(1500); // 等设置页的异步渲染（读配置、查授权）把可能的错误打出来
        const errs = collector.errors.map(e => e.text);
        const ok = !raw.length && !errs.length;
        record("设置页英文渲染、无控制台错误", ok, ok ? `lang en，标题“${en("options_title")}”`
          : [raw.length ? `显示成 key：${raw.join("、")}` : "", errs.length ? `控制台错误：${errs.join(" | ")}` : ""].filter(Boolean).join("；"));
      } catch (e) { record("设置页英文渲染、无控制台错误", false, e.message); }

      // DNR 规则的 regexSubstitution 写死了 runtime.id；发布包的 ID 与开发版不同，核对规则指向本次装出的 ID
      const wantSub = `chrome-extension://${id}/go.html?u=\\0`;
      try {
        const rule = await b.waitFor(() => opt.ev(`chrome.declarativeNetRequest.getDynamicRules().then(rs => rs.find(r => r.id === 1) || null)`,
          { timeoutMs: 3000 }), { timeoutMs: 10000 });
        const sub = rule.action?.redirect?.regexSubstitution;
        record("DNR 规则指向本扩展", sub === wantSub, `regexSubstitution ${sub}`);
      } catch (e) { record("DNR 规则指向本扩展", false, `读不到 id 为 1 的动态规则：${e.message}`); }

      // 改 uiLocale 让 SW 重建右键菜单：t() 缺 key、目录没加载、重建失败都会在 SW 里记 [split-search] 错误
      // （收集器自动 attach 了 SW，能收到它的 console.error）。正面证据：先在设置页 removeAll 拿掉两项，
      // 改 uiLocale 后两项又能 update 成功，说明是 SW 重建出来的。依次切 zh_CN、en，最后停在 en（后面的弹窗按英文核对）
      try {
        const before = collector.errors.length;
        for (const locale of ["zh_CN", "en"]) await menusRebuiltAfter(b, opt, locale);
        const errs = collector.errors.slice(before).map(e => e.text);
        record("切换 uiLocale 后 SW 重建菜单无错误", !errs.length,
          errs.length ? errs.join(" | ") : `uiLocale zh_CN、en 各重建一次，${MENU_IDS.join("、")} 都在`);
      } catch (e) { record("切换 uiLocale 后 SW 重建菜单无错误", false, e.message); }
    } finally { await opt.close(); }

    // 工具栏弹窗页直接当标签打开：活动标签就是它自己，不是本扩展的拆分视图，显示说明文字
    const pop = await openPage(b, `chrome-extension://${id}/popup/popup.html`);
    try {
      const want = en("popup_not_ours");
      await waitTrue(b, pop, `document.documentElement.lang === "en" && !document.documentElement.classList.contains("i18n-pending")
        && !document.querySelector("main").classList.contains("loading")`, "弹窗按英文渲染");
      const raw = await rawKeys(pop);
      const text = await pop.ev(`document.getElementById("not-ours").hidden ? null : document.getElementById("not-ours").textContent`);
      const ok = !raw.length && text === want;
      record("弹窗英文渲染", ok, ok ? `lang en，“${want}”`
        : [raw.length ? `显示成 key：${raw.join("、")}` : "", text !== want ? `说明文字应为“${want}”，实际 ${J(text)}` : ""].filter(Boolean).join("；"));
    } catch (e) { record("弹窗英文渲染", false, e.message); }
    finally { await pop.close(); }

    const go = await openPage(b, `chrome-extension://${id}/go.html?u=${BAD_TRIGGER}`);
    try {
      const want = en("err_marker_format");
      await waitTrue(b, go, `!document.getElementById("error").hidden
        && document.getElementById("error-message").textContent === ${J(want)}`, "go.html 出错页");
      record("go.html 格式不对的 _ss 显示出错页", true, `“${want}”`);
    } catch (e) { record("go.html 格式不对的 _ss 显示出错页", false, e.message); }
    finally { await go.close(); }

    const late = collector.errors.map(e => e.text);
    record("全程无 [split-search] 控制台错误", !late.length, late.join(" | "));
    return { results, id };
  } catch (e) {
    record("冒烟运行", false, e.message);
    return { results, id };
  } finally {
    await cleanup();
  }
}

