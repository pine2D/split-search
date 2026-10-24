#!/usr/bin/env node
// 把 assets/templates/*.html 渲染成尺寸精确的 PNG（商店截图、宣传图块、README 配图）。Node 24，无依赖。
//
// 用法：node scripts/store/render-assets.mjs [--locale <zh_CN|en|zh_TW|es|all>] [--icon <svg>] [--no-tile] [--only a,b] [--templates <dir>] [--out <dir>] [--tmp <dir>] [--list]
//   --locale <l>  文案语言（默认 zh_CN）：读 <模板目录>/i18n/<l>.json，all = i18n/ 里有 json 的全部语言。
//                 输出：store/… → assets/store/<l>/…；readme/… → zh_CN 仍是 assets/readme/…，其他语言 assets/readme/<l>/…
//   --icon <svg>  图标文件（默认是选定的 c6 松针绿：assets/icon-proposals/v3-colors/c6-pine-fog/icon.svg，
//                 与 src/icons/ 同源）；试别的图标时传它的 icon.svg 或 .png
//   --no-tile     图标自带底板（如方案 6）时用：去掉模板里的白色圆角底板，避免“板中板”
//   --only a,b    只渲染这些模板（文件名去掉 .html）
//   --templates <dir>  模板目录（默认 assets/templates）；可放一套备选模板，不动现有的
//   --out <dir>   所有输出平铺到这一个目录，用模板声明的文件名（不含子目录；多个语言时再分 <dir>/<l>/）；省略时写到 assets/store、assets/readme（见 --locale）
//   --tmp <dir>   放临时 Chrome 配置的目录（默认系统临时目录），结束后删除
//   --list        只列出模板与目标尺寸，不渲染
//
// 模板约定（写在 <head> 里）：
//   <meta name="asset-size" content="1280x800">      CSS 尺寸；可加 @2 之类的倍率，输出像素 = 尺寸 × 倍率
//   <meta name="asset-out" content="store/screenshot-1.png">   相对输出根目录的路径
//   图标占位：<img data-icon>（渲染时 src 换成图标），或 CSS 里用 var(--icon)（url(...) 形式）
//   文案：<el data-t="shot1.title"></el>，渲染时换成 i18n/<l>.json 里同名键的文字（纯文本；值里的 \n 变成 <br>）。
//     缺键直接报错；文字超出所在块、定位容器或画布也报错（多半是译文太长，改译文或 i18n/<l>.css）。
//     <html lang> 设为 zh-CN / en / zh-TW / es；有 i18n/<l>.css 就追加进页面（用 :lang() 调字号、字距、折行）。
//   文件名以 _ 开头的模板（例如 _base.html）不渲染。
// 输出是去掉 alpha 通道的 24 位 PNG（Chrome 网上应用店的宣传图块要求不透明），尺寸不符直接报错。
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename, extname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync, deflateSync, crc32 } from "node:zlib";
import { createClient } from "../e2e/cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATES = join(ROOT, "assets/templates");
const DEFAULT_ICON = join(ROOT, "assets/icon-proposals/v3-colors/c6-pine-fog/icon.svg"); // 选定图标（c6）；src/icons/icon-48|128.png 由它导出，16/32 来自同目录按像素对齐的 icon-16.svg / icon-32.svg
const CHROME = "/opt/google/chrome/google-chrome";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 扩展的 _locales 目录名 → BCP 47 语言标签（<html lang>，base.css 按 :lang() 选字体）
export const LOCALES = { zh_CN: "zh-CN", en: "en", zh_TW: "zh-TW", es: "es" };
export const SOURCE_LOCALE = "zh_CN"; // 文案源语言；它的 README 图留在 assets/readme/ 根下（README.md 直接引用）

export function parseArgs(argv) {
  const o = { icon: DEFAULT_ICON, only: null, templates: TEMPLATES, out: null, tmp: tmpdir(), list: false, noTile: false, locale: SOURCE_LOCALE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw new Error(`${a} 缺少参数`); return argv[++i]; };
    if (a === "--icon") o.icon = resolve(v());
    else if (a === "--only") o.only = v().split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--templates") o.templates = resolve(v());
    else if (a === "--out") o.out = resolve(v());
    else if (a === "--tmp") o.tmp = resolve(v());
    else if (a === "--list") o.list = true;
    else if (a === "--no-tile") o.noTile = true;
    else if (a === "--locale") { o.locale = v(); if (o.locale !== "all" && !LOCALES[o.locale]) throw new Error(`--locale 只能是 ${Object.keys(LOCALES).join("、")} 或 all`); }
    else if (a === "-h" || a === "--help") o.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return o;
}

// "1280x800" / "1200x600@2" → { width, height, scale }
export function parseSize(s) {
  const m = /^\s*(\d+)\s*x\s*(\d+)\s*(?:@\s*(\d+(?:\.\d+)?))?\s*$/i.exec(s || "");
  if (!m) throw new Error(`asset-size 格式不对：${s}`);
  return { width: +m[1], height: +m[2], scale: m[3] ? +m[3] : 1 };
}

const meta = (html, name) => {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']`, "i");
  return re.exec(html)?.[1] ?? null;
};

// 模板声明的 "store/screenshot-1.png" → 该语言的输出路径（相对 assets/）
export function localizedOut(out, locale) {
  const [top, ...rest] = out.split("/");
  if (!rest.length || (top === "readme" && locale === SOURCE_LOCALE)) return out;
  return [top, locale, ...rest].join("/");
}

// i18n/<l>.json：平铺的 { 键: 文字 }，值必须是字符串
export function loadStrings(dir, locale) {
  const file = join(dir, "i18n", `${locale}.json`);
  if (!existsSync(file)) throw new Error(`没有 ${locale} 的文案：${file}`);
  const strings = JSON.parse(readFileSync(file, "utf8"));
  const bad = Object.entries(strings).filter(([, v]) => typeof v !== "string").map(([k]) => k);
  if (bad.length) throw new Error(`${file} 里这些键的值不是字符串：${bad.join("，")}`);
  return strings;
}

export function resolveLocales(locale, dir = TEMPLATES) {
  if (locale !== "all") return [locale];
  return Object.keys(LOCALES).filter(l => existsSync(join(dir, "i18n", `${l}.json`)));
}

export function readTemplates(dir = TEMPLATES) {
  return readdirSync(dir).filter(f => f.endsWith(".html") && !f.startsWith("_")).sort().map(f => {
    const html = readFileSync(join(dir, f), "utf8");
    const name = basename(f, ".html");
    const size = meta(html, "asset-size");
    if (!size) throw new Error(`${f} 缺少 <meta name="asset-size">`);
    return { name, file: join(dir, f), ...parseSize(size), out: meta(html, "asset-out") || `${name}.png` };
  });
}

// ---- PNG：读尺寸、去 alpha（RGBA 8 位 → RGB 8 位）----
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunks(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("不是 PNG");
  const out = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8);
    out.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
}
export function pngInfo(buf) {
  const h = chunks(buf)[0].data;
  return { width: h.readUInt32BE(0), height: h.readUInt32BE(4), depth: h[8], colorType: h[9], interlace: h[12] };
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

// 透明像素按白底合成；已是 RGB 的原样返回
export function stripAlpha(buf) {
  const info = pngInfo(buf);
  if (info.colorType === 2) return buf;
  if (info.colorType !== 6 || info.depth !== 8 || info.interlace) throw new Error(`不支持的 PNG 格式：colorType=${info.colorType} depth=${info.depth}`);
  const { width: w, height: h } = info, cs = chunks(buf);
  const raw = inflateSync(Buffer.concat(cs.filter(c => c.type === "IDAT").map(c => c.data)));
  const stride = w * 4, rgba = Buffer.alloc(stride * h), rgb = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[row + x - 4] : 0, b = y ? rgba[prev + x] : 0, c = x >= 4 && y ? rgba[prev + x - 4] : 0;
      const v = raw[src + x];
      rgba[row + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
    const o = y * (w * 3 + 1);
    rgb[o] = 0; // 过滤类型 None；deflate 足够小
    for (let x = 0; x < w; x++) {
      const al = rgba[row + x * 4 + 3];
      for (let k = 0; k < 3; k++) rgb[o + 1 + x * 3 + k] = Math.round((rgba[row + x * 4 + k] * al + 255 * (255 - al)) / 255);
    }
  }
  const ihdr = Buffer.from(cs[0].data); ihdr[9] = 2;
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rgb, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- 无头 Chrome（管道 CDP，临时配置）----
async function launch(tmpRoot) {
  mkdirSync(tmpRoot, { recursive: true });
  const profile = mkdtempSync(join(tmpRoot, "render-profile-"));
  const proc = spawn(CHROME, [`--user-data-dir=${profile}`, "--headless=new", "--disable-sync", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-pipe", "--hide-scrollbars", "--allow-file-access-from-files"],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const exited = new Promise(r => proc.once("exit", r));
  const client = createClient(proc.stdio[3], proc.stdio[4]);
  const close = async () => {
    await client.send("Browser.close", {}, undefined, { timeoutMs: 3000 }).catch(() => {});
    const t = setTimeout(() => proc.kill("SIGKILL"), 5000);
    await exited; clearTimeout(t); client.close();
    rmSync(profile, { recursive: true, force: true });
  };
  try { await client.send("Browser.getVersion", {}, undefined, { timeoutMs: 15000 }); }
  catch (e) { await close(); throw new Error(`启动无头 Chrome 失败：${e.message}`); }
  return { client, close };
}

function iconDataUrl(file) {
  if (!existsSync(file)) throw new Error(`找不到图标：${file}`);
  const ext = extname(file).toLowerCase();
  const mime = ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" : null;
  if (!mime) throw new Error("图标只支持 .svg 或 .png");
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

// 页面里执行：设语言、加语言样式、填文案、查溢出。L = { lang, css, strings }
const applyLocale = L => `(async () => {
  const L = ${JSON.stringify(L)};
  document.documentElement.lang = L.lang;
  if (L.css) await new Promise((res, rej) => { const l = Object.assign(document.createElement("link"), { rel: "stylesheet", href: L.css,
    onload: res, onerror: () => rej(new Error("加载失败：" + L.css)) }); document.head.append(l); });
  const missing = [];
  for (const el of document.querySelectorAll("[data-t]")) {
    const v = L.strings[el.dataset.t];
    if (typeof v !== "string") { missing.push(el.dataset.t); continue; }
    el.replaceChildren(...v.split("\\n").flatMap((s, i) => i ? [document.createElement("br"), s] : [s]));
  }
  if (missing.length) throw new Error("i18n 缺少文案：" + missing.join("，"));
})()`;
const checkOverflow = `(() => {
  const out = [], W = innerWidth, H = innerHeight, r = document.createRange();
  for (const el of document.querySelectorAll("[data-t]")) {
    r.selectNodeContents(el);
    const t = r.getBoundingClientRect(), boxes = [];
    if (getComputedStyle(el).display !== "inline") boxes.push(["所在块", el.getBoundingClientRect()]);
    if (el.offsetParent) boxes.push(["定位容器", el.offsetParent.getBoundingClientRect()]);
    boxes.push(["画布", { left: 0, top: 0, right: W, bottom: H }]);
    for (const [name, b] of boxes) {
      const d = Math.max(b.left - t.left, t.right - b.right, name === "画布" ? Math.max(b.top - t.top, t.bottom - b.bottom) : 0);
      if (d > 0.5) { out.push(el.dataset.t + " 超出" + name + " " + d.toFixed(1) + "px"); break; }
    }
  }
  return out;
})()`;

async function renderOne(client, t, icon, noTile, L) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p = {}, o) => client.send(m, p, s, o);
  try {
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: t.width, height: t.height, deviceScaleFactor: t.scale, mobile: false });
    const loaded = new Promise(r => client.on("Page.loadEventFired", (_, sid) => sid === s && r()));
    await send("Page.navigate", { url: pathToFileURL(t.file).href });
    await Promise.race([loaded, sleep(15000)]);
    const a = await send("Runtime.evaluate", { awaitPromise: true, expression: applyLocale(L) }, { timeoutMs: 15000 });
    if (a.exceptionDetails) throw new Error((a.exceptionDetails.exception?.description || a.exceptionDetails.text).split("\n")[0].replace(/^Error: /, ""));
    const r = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
      const icon = ${JSON.stringify(icon)};
      if (${noTile}) document.documentElement.classList.add("no-tile");
      document.documentElement.style.setProperty("--icon", 'url("' + icon + '")');
      for (const img of document.querySelectorAll("img[data-icon]")) img.src = icon;
      await document.fonts.ready;
      // decode() 加载失败会 reject；只有 viewBox 的 SVG naturalWidth 为 0，不能拿它判断
      const imgs = [...document.images];
      const res = await Promise.allSettled(imgs.map(i => i.decode()));
      if (typeof window.beforeCapture === "function") await window.beforeCapture();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { bad: imgs.filter((_, k) => res[k].status === "rejected").map(i => (i.getAttribute("src") || "(无 src)").slice(0, 80)) };
    })()` }, { timeoutMs: 20000 });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    const { bad } = r.result.value;
    if (bad.length) throw new Error(`图片加载失败：${bad.join("，")}`);
    const over = (await send("Runtime.evaluate", { returnByValue: true, expression: checkOverflow })).result.value;
    if (over.length) throw new Error(`文字溢出（${L.lang}）：${over.join("；")}`);
    const shot = await send("Page.captureScreenshot",
      { format: "png", clip: { x: 0, y: 0, width: t.width, height: t.height, scale: 1 } }, { timeoutMs: 30000 });
    return stripAlpha(Buffer.from(shot.data, "base64"));
  } finally {
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 21).join("\n")); return; }
  let list = readTemplates(o.templates);
  if (o.only) {
    const miss = o.only.filter(n => !list.some(t => t.name === n));
    if (miss.length) throw new Error(`没有这些模板：${miss.join("，")}`);
    list = list.filter(t => o.only.includes(t.name));
  }
  const locales = resolveLocales(o.locale, o.templates);
  if (!locales.length) throw new Error(`${join(o.templates, "i18n")} 里没有文案文件`);
  const show = f => f.startsWith(ROOT + "/") ? relative(ROOT, f) : f;
  const dest = (t, l) => o.out ? join(o.out, locales.length > 1 ? l : "", basename(t.out)) : join(ROOT, "assets", localizedOut(t.out, l));
  if (o.list) { for (const l of locales) for (const t of list) console.log(`${l}\t${t.name}\t${t.width * t.scale}x${t.height * t.scale}\t${show(dest(t, l))}`); return; }
  const strings = Object.fromEntries(locales.map(l => [l, loadStrings(o.templates, l)]));
  const source = Object.keys(strings[SOURCE_LOCALE] ?? loadStrings(o.templates, SOURCE_LOCALE));
  for (const l of locales) { // 缺键不退回源语言，直接报错
    const miss = source.filter(k => !(k in strings[l]));
    if (miss.length) throw new Error(`i18n/${l}.json 缺少 ${miss.length} 个键：${miss.join("，")}`);
  }
  const icon = iconDataUrl(o.icon);
  const b = await launch(o.tmp);
  let failed = 0;
  try {
    for (const l of locales) {
      const css = existsSync(join(o.templates, "i18n", `${l}.css`)) ? `i18n/${l}.css` : null;
      for (const t of list) {
        try {
          const png = await renderOne(b.client, t, icon, o.noTile, { lang: LOCALES[l], css, strings: strings[l] });
          const info = pngInfo(png), W = Math.round(t.width * t.scale), H = Math.round(t.height * t.scale);
          if (info.width !== W || info.height !== H) throw new Error(`输出 ${info.width}x${info.height}，应为 ${W}x${H}`);
          const file = dest(t, l);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, png);
          console.log(`✓ ${l} ${t.name} → ${show(file)} (${W}x${H})`);
        } catch (e) { failed++; console.error(`✗ ${l} ${t.name}：${e.message}`); }
      }
    }
  } finally { await b.close(); }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
