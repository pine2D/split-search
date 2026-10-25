// 发布打包的纯逻辑（无 IO）：manifest 改写、发布前检查、公钥校验与扩展 ID 计算。pack.mjs 负责读写文件和调用 zip。
import { createHash, createPublicKey } from "node:crypto";

// 与 CLAUDE.md“硬约束”一致
export const HARD = Object.freeze({
  manifest_version: 3,
  minimum_chrome_version: "155",
  incognito: "not_allowed",
  permissions: ["declarativeNetRequest", "storage"],
  optional_host_permissions: ["https://*/*", "http://*/*"],
  web_accessible_resources: [{ resources: ["go.html"], matches: ["<all_urls>"], use_dynamic_url: true }],
});

export const LIMITS = Object.freeze({ name: 75, short_name: 12, description: 132 });

const RUNTIME_EXT = new Set([".js", ".mjs", ".html", ".css", ".png", ".svg"]);
const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const TEST_DIRS = new Set(["test", "tests", "__tests__", "node_modules"]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const chars = s => [...String(s)].length; // 按 Unicode 字符计

// 扩展 ID：公钥 DER 的 sha256 前 16 字节，每个十六进制位映射到 a–p（同 scripts/gen-key.sh）
export function extensionId(keyB64) {
  const hex = createHash("sha256").update(Buffer.from(keyB64, "base64")).digest("hex").slice(0, 32);
  return [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

// 商店公钥文件：CWS 后台“软件包 → 公钥”给的 PEM（BEGIN/END PUBLIC KEY），或去掉首尾行的纯 base64。
// 返回 { ok, key }（规范化的单行 base64，即 manifest 的 key）或 { ok:false, error }
export function parsePublicKey(text) {
  const body = String(text ?? "").replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  if (!body) return { ok: false, error: "公钥文件是空的" };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length % 4) return { ok: false, error: "公钥不是合法的 base64" };
  const der = Buffer.from(body, "base64");
  if (der.toString("base64") !== body) return { ok: false, error: "公钥不是合法的 base64" };
  let k;
  try { k = createPublicKey({ key: der, format: "der", type: "spki" }); }
  catch { return { ok: false, error: "公钥不是 DER 编码的公钥（SubjectPublicKeyInfo）" }; }
  if (k.asymmetricKeyType !== "rsa") return { ok: false, error: `公钥类型应为 RSA，实际是 ${k.asymmetricKeyType}` };
  return { ok: true, key: body };
}

// 打包用的 manifest：默认去掉 key（首次上传 CWS 不能带开发公钥，ID 由商店分配）；给了 storeKey 就换成商店公钥
export function transformManifest(manifest, { storeKey } = {}) {
  const out = { ...manifest };
  delete out.key;
  if (storeKey) {
    // key 放回原来的位置，manifest 的字段顺序与源码一致
    const entries = Object.entries(manifest).map(([k, v]) => [k, k === "key" ? storeKey : v]);
    return "key" in manifest ? Object.fromEntries(entries) : { ...out, key: storeKey };
  }
  return out;
}

export function checkManifest(manifest, pkg) {
  const errors = [];
  if (manifest.version !== pkg.version) {
    errors.push(`manifest 的 version（${manifest.version}）与 package.json（${pkg.version}）不一致`);
  }
  for (const [field, want] of Object.entries(HARD)) {
    if (!same(manifest[field], want)) {
      errors.push(`manifest.${field} 应为 ${JSON.stringify(want)}，实际是 ${JSON.stringify(manifest[field])}`);
    }
  }
  if (manifest.host_permissions !== undefined) errors.push("manifest 不得有 host_permissions（只用 optional_host_permissions）");
  return errors;
}

// manifest 里所有字符串值中的 __MSG_xxx__ 引用（去重）
export function msgRefs(manifest) {
  const refs = new Set();
  const walk = v => {
    if (typeof v === "string") for (const m of v.matchAll(/__MSG_(\w+)__/g)) refs.add(m[1]);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(manifest);
  return [...refs];
}

const resolveMsg = (value, messages) =>
  String(value).replace(/__MSG_(\w+)__/g, (_, k) => messages?.[k]?.message ?? `__MSG_${k}__`);

// locales：{ <语言目录>: messages.json 的文本 }。每种语言都要能解析、定义 manifest 引用的全部 key，
// 解析后的 name / short_name / description 不超过 CWS 上限
export function checkLocales(manifest, locales) {
  const errors = [];
  const names = Object.keys(locales);
  if (!manifest.default_locale) errors.push("manifest 缺少 default_locale");
  else if (!names.includes(manifest.default_locale)) errors.push(`缺少默认语言 _locales/${manifest.default_locale}/messages.json`);
  const refs = msgRefs(manifest);
  for (const loc of names) {
    let messages;
    try { messages = JSON.parse(locales[loc]); }
    catch (e) { errors.push(`_locales/${loc}/messages.json 解析失败：${e.message}`); continue; }
    for (const k of refs) {
      if (typeof messages?.[k]?.message !== "string") errors.push(`_locales/${loc} 缺少 manifest 引用的 ${k}`);
    }
    for (const [field, max] of Object.entries(LIMITS)) {
      if (manifest[field] === undefined) continue;
      const n = chars(resolveMsg(manifest[field], messages));
      if (n > max) errors.push(`_locales/${loc}：${field} 有 ${n} 个字符，超过上限 ${max}`);
    }
  }
  return errors;
}

// manifest 引用的文件（图标、工具栏弹窗、SW、设置页、可供网页访问的资源）都要在包里
export function referencedFiles(manifest) {
  const files = new Set();
  for (const p of Object.values(manifest.icons ?? {})) files.add(p);
  for (const p of Object.values(manifest.action?.default_icon ?? {})) files.add(p);
  if (manifest.action?.default_popup) files.add(manifest.action.default_popup);
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  if (manifest.options_ui?.page) files.add(manifest.options_ui.page);
  for (const w of manifest.web_accessible_resources ?? []) for (const r of w.resources ?? []) files.add(r);
  return [...files];
}

export function checkReferenced(manifest, fileList) {
  const have = new Set(fileList);
  return referencedFiles(manifest).filter(p => !have.has(p)).map(p => `manifest 引用的文件不存在：${p}`);
}

// 包里只能有运行时文件：脚本、页面、样式、图片、manifest.json 和各语言的 messages.json；
// 不能有点文件、测试、系统垃圾文件
export function checkFileSet(fileList) {
  const errors = [];
  for (const p of fileList) {
    const parts = p.split("/");
    const base = parts[parts.length - 1];
    const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
    let why = null;
    if (JUNK.has(base)) why = "系统生成的垃圾文件";
    else if (parts.some(s => s.startsWith("."))) why = "点文件或点目录";
    else if (parts.some(s => TEST_DIRS.has(s)) || /\.(test|spec)\.[cm]?js$/.test(base)) why = "测试文件";
    else if (ext === ".json") { if (p !== "manifest.json" && !/^_locales\/[A-Za-z_]+\/messages\.json$/.test(p)) why = "不是 manifest 或语言文件的 JSON"; }
    else if (!RUNTIME_EXT.has(ext)) why = "不是运行时文件";
    if (why) errors.push(`src/${p}：${why}，不应进发布包`);
  }
  return errors;
}

// git status --porcelain 的输出 → 有改动的路径
export function dirtyPaths(porcelain) {
  return String(porcelain ?? "").split("\n").filter(Boolean).map(l => l.slice(3));
}

export const USAGE = `用法：npm run pack -- [选项]
  --store-key <文件>  把这个公钥（CWS 后台“软件包 → 公钥”，PEM 或 base64）写进包里的 manifest，
                      用于首次上传之后的版本，保持商店 ID 不变；不给时包里不带 key（首次上传）
  --allow-dirty       src/ 有未提交改动时只警告、不中止
  --smoke             打包后解压，在一次性 Chrome 配置里装上并做安装冒烟
  --help              显示本说明`;

export function parseArgs(argv) {
  const o = { storeKey: null, allowDirty: false, smoke: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--store-key") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error("--store-key 后面要跟公钥文件路径");
      o.storeKey = v;
    } else if (a === "--allow-dirty") o.allowDirty = true;
    else if (a === "--smoke") o.smoke = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return o;
}
