#!/usr/bin/env node
// 把 assets/templates/*.html 渲染成尺寸精确的 PNG（商店截图、宣传图块、README 配图）。Node 24，无依赖。
//
// 用法：node scripts/store/render-assets.mjs [--icon <svg>] [--only a,b] [--out <dir>] [--tmp <dir>] [--list]
//   --icon <svg>  图标文件（默认 assets/templates/icon-placeholder.svg）；选定图标后用它重渲宣传图块
//   --only a,b    只渲染这些模板（文件名去掉 .html）
//   --out <dir>   输出根目录（默认 assets/）；模板声明的相对输出路径接在它后面
//   --tmp <dir>   放临时 Chrome 配置的目录（默认系统临时目录），结束后删除
//   --list        只列出模板与目标尺寸，不渲染
//
// 模板约定（写在 <head> 里）：
//   <meta name="asset-size" content="1280x800">      CSS 尺寸；可加 @2 之类的倍率，输出像素 = 尺寸 × 倍率
//   <meta name="asset-out" content="store/screenshot-1.png">   相对输出根目录的路径
//   图标占位：<img data-icon>（渲染时 src 换成图标），或 CSS 里用 var(--icon)（url(...) 形式）
//   文件名以 _ 开头的模板（例如 _base.html）不渲染。
// 输出是去掉 alpha 通道的 24 位 PNG（Chrome 网上应用店的宣传图块要求不透明），尺寸不符直接报错。
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync, deflateSync, crc32 } from "node:zlib";
import { createClient } from "../e2e/cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATES = join(ROOT, "assets/templates");
const CHROME = "/opt/google/chrome/google-chrome";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function parseArgs(argv) {
  const o = { icon: join(TEMPLATES, "icon-placeholder.svg"), only: null, out: join(ROOT, "assets"), tmp: tmpdir(), list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw new Error(`${a} 缺少参数`); return argv[++i]; };
    if (a === "--icon") o.icon = resolve(v());
    else if (a === "--only") o.only = v().split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--out") o.out = resolve(v());
    else if (a === "--tmp") o.tmp = resolve(v());
    else if (a === "--list") o.list = true;
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

async function renderOne(client, t, icon) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p = {}, o) => client.send(m, p, s, o);
  try {
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: t.width, height: t.height, deviceScaleFactor: t.scale, mobile: false });
    const loaded = new Promise(r => client.on("Page.loadEventFired", (_, sid) => sid === s && r()));
    await send("Page.navigate", { url: pathToFileURL(t.file).href });
    await Promise.race([loaded, sleep(15000)]);
    const r = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
      const icon = ${JSON.stringify(icon)};
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
    const shot = await send("Page.captureScreenshot",
      { format: "png", clip: { x: 0, y: 0, width: t.width, height: t.height, scale: 1 } }, { timeoutMs: 30000 });
    return stripAlpha(Buffer.from(shot.data, "base64"));
  } finally {
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 9).join("\n")); return; }
  let list = readTemplates();
  if (o.only) {
    const miss = o.only.filter(n => !list.some(t => t.name === n));
    if (miss.length) throw new Error(`没有这些模板：${miss.join("，")}`);
    list = list.filter(t => o.only.includes(t.name));
  }
  if (o.list) { for (const t of list) console.log(`${t.name}\t${t.width * t.scale}x${t.height * t.scale}\t${t.out}`); return; }
  const icon = iconDataUrl(o.icon);
  const b = await launch(o.tmp);
  let failed = 0;
  try {
    for (const t of list) {
      try {
        const png = await renderOne(b.client, t, icon);
        const info = pngInfo(png), W = Math.round(t.width * t.scale), H = Math.round(t.height * t.scale);
        if (info.width !== W || info.height !== H) throw new Error(`输出 ${info.width}x${info.height}，应为 ${W}x${H}`);
        const dest = join(o.out, t.out);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, png);
        console.log(`✓ ${t.name} → ${dest} (${W}x${H})`);
      } catch (e) { failed++; console.error(`✗ ${t.name}：${e.message}`); }
    }
  } finally { await b.close(); }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
