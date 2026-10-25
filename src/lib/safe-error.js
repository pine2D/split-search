// 日志里的错误一律先经这里（纯逻辑，不得引用 chrome）：只留错误名和消息，不带堆栈。
// Chrome 的消息可能嵌着网址或查询词（如 Invalid url: "…"），所以引号里的内容和网址样的文字都换成 …，
// console.info / console.error 里不出现标签网址、关键词、选中文字或图片网址。

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX = 200;
const CLOSE = { '"': '"', "`": "`", "“": "”", "‘": "’", "'": "'" };

// 一次扫描，匹配不重叠：成对的引号整段换掉，没闭合的从引号换到结尾。
// 单引号只在词首才算开引号（Can't 里的撇号不算）。
const QUOTED = /"[^"]*(?:"|$)|`[^`]*(?:`|$)|“[^”]*(?:”|$)|‘[^’]*(?:’|$)|(^|[^\p{L}\p{N}_])'[^']*(?:'|$)/gu;

const URLISH = [
  /\b(?:data|blob|about|javascript|mailto|file|filesystem):\S+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi,
  /\blocalhost(?::\d+)?(?:[/?#]\S*)?/gi,
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]\S*)?/g,
  /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?::\d+)?(?:[/?#]\S*)?/gi,
  /(?<=^|\s)\/\S+/g,
  /\S*(?:%[0-9a-f]{2}|=)\S*/gi,
];

function scrub(text) {
  let out = text.replace(QUOTED, (m, pre) => {
    const lead = pre ?? "";
    const body = m.slice(lead.length);
    const open = body[0];
    const closed = body.length > 1 && body.endsWith(CLOSE[open]);
    return lead + open + "…" + (closed ? CLOSE[open] : "");
  });
  for (const re of URLISH) out = out.replace(re, "…");
  return out.length > MAX ? out.slice(0, MAX) + "…" : out;
}

function read(obj, key) {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

// 返回 "<名字>: <清理过的消息>"，消息为空时只有名字；名字不像标识符时用 Error
export function safeError(err) {
  let name = "Error";
  let message = "";
  if (err !== null && (typeof err === "object" || typeof err === "function")) {
    const n = read(err, "name");
    if (typeof n === "string" && NAME.test(n)) name = n;
    const m = read(err, "message");
    if (typeof m === "string") message = m;
  } else if (err !== null && err !== undefined) {
    message = String(err);
  }
  const clean = scrub(message);
  return clean ? `${name}: ${clean}` : name;
}

// 给日志用：对象和函数换成 safeError 的结果，原始值（本扩展自己的说明文字、标签 id、错误码）原样保留
export function safeArgs(args) {
  return args.map(a => (a !== null && (typeof a === "object" || typeof a === "function")) ? safeError(a) : a);
}
