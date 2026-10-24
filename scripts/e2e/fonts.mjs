// 测试浏览器的字体配置：屏蔽 9P 挂载（WSL 的 /mnt/c 等 Windows 盘）上的字体。
// 原因（实测）：系统 fontconfig 把
// /mnt/c/Windows/Fonts 列为字体目录时，Chrome 浏览器进程匹配字体要对候选字体文件逐个 access()，每次都是一趟到 Windows 的 9P 往返；
// 渲染进程主线程在同步字体请求上等它，期间 CDP 的 Runtime.evaluate 一律得不到回复。平时约 2 秒，Windows 侧忙时十几秒以上，
// 启动阶段的 evalExt（3 秒/15 秒超时）就报“Runtime.evaluate 超时”。
// 做法：生成一份只给测试浏览器用的 fontconfig 配置，先 include 原配置（保留发行版的别名与渲染规则），再用 rejectfont 排除
// 这些挂载点下的字体文件；只经 FONTCONFIG_FILE 传给测试浏览器，不改系统或用户的配置。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SLOW_FS = new Set(["9p", "v9fs", "drvfs"]);
const SYSTEM_CONF = "/etc/fonts/fonts.conf";

// /proc/mounts 里的路径用 \040 这类八进制转义表示空格等字符
const unescapeMount = s => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

// 9P 类文件系统的挂载点（去重、按出现顺序）；根目录不算（真那样就没有可用字体了，交给 fontconfig 原样处理）
export function slowFontRoots(mountsText) {
  const roots = [];
  for (const line of String(mountsText ?? "").split("\n")) {
    const [, mp, type] = line.trim().split(/\s+/);
    if (!mp || !SLOW_FS.has(type)) continue;
    const p = unescapeMount(mp).replace(/\/+$/, "");
    if (p && !roots.includes(p)) roots.push(p);
  }
  return roots;
}

const xmlEscape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// fontconfig 的 glob 里 * ? [ 是通配符，挂载点本身的这些字符要转义
const globEscape = s => s.replace(/[\\*?[\]]/g, c => `\\${c}`);

export function fontconfigXml(roots, base = SYSTEM_CONF) {
  const globs = roots.map(r => `      <glob>${xmlEscape(globEscape(r))}/*</glob>`).join("\n");
  return [
    '<?xml version="1.0"?>',
    '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
    "<!-- split-search e2e 生成：测试浏览器不用 9P 挂载上的字体（见 scripts/e2e/fonts.mjs） -->",
    "<fontconfig>",
    `  <include ignore_missing="yes">${xmlEscape(base)}</include>`,
    "  <selectfont>",
    "    <rejectfont>",
    globs,
    "    </rejectfont>",
    "  </selectfont>",
    "</fontconfig>",
    "",
  ].join("\n");
}

// 返回要合并进测试浏览器环境变量的补丁：没有 9P 挂载时为 null（普通 Linux 不受影响）。
// 用户自己设了 FONTCONFIG_FILE 时 include 它而不是系统配置。任何读写失败都返回 null，按原配置启动。
export function prepareFontconfig({ dir, env = process.env, readMounts = () => readFileSync("/proc/mounts", "utf8"),
  write = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); } } = {}) {
  let roots;
  try { roots = slowFontRoots(readMounts()); } catch { return null; }
  if (!roots.length) return null;
  const file = join(dir, "fonts.conf");
  const base = env.FONTCONFIG_FILE && env.FONTCONFIG_FILE !== file ? env.FONTCONFIG_FILE : SYSTEM_CONF;
  try { write(file, fontconfigXml(roots, base)); } catch { return null; }
  return { FONTCONFIG_FILE: file };
}
