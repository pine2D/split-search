// 命令行参数解析（纯函数）
import { DEFAULT_PORT } from "./config.mjs";

export const USAGE = `用法：npm run e2e -- [选项]
  --auto-only        只跑自动步骤（默认无头运行，不需要人在场）
  --headed           强制显示浏览器窗口（与 --auto-only 合用时不再无头）
  --only <编号,...>  只跑指定步骤，例如 --only B5,T7
  --port <端口>      模拟服务端口，默认 ${DEFAULT_PORT}（改端口后需要重新授权）
  --timeout <毫秒>   单步超时，默认 120000
  --help             显示本说明`;

const fail = msg => { throw new Error(`${msg}\n\n${USAGE}`); };

export function parseArgs(argv) {
  const out = { autoOnly: false, headless: false, only: null, port: DEFAULT_PORT, timeoutMs: 120000 };
  let headed = false;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.indexOf("=");
    const name = raw.startsWith("--") && eq > 0 ? raw.slice(0, eq) : raw;
    const inline = name !== raw ? raw.slice(eq + 1) : undefined;
    const value = () => {
      if (inline !== undefined) return inline;
      if (i + 1 >= argv.length) fail(`参数 ${name} 缺少取值`);
      return argv[++i];
    };
    switch (name) {
      case "--auto-only": out.autoOnly = true; break;
      case "--headed": headed = true; break;
      case "--only": {
        const ids = value().split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
        if (!ids.length) fail("--only 需要至少一个步骤编号");
        out.only = ids;
        break;
      }
      case "--port": {
        const v = value();
        const p = Number(v);
        if (!/^\d+$/.test(v) || p < 1 || p > 65535) fail(`端口不合法：${v}`);
        out.port = p;
        break;
      }
      case "--timeout": {
        const v = value();
        const t = Number(v);
        if (!/^\d+$/.test(v) || t <= 0) fail(`超时必须是正整数毫秒：${v}`);
        out.timeoutMs = t;
        break;
      }
      case "--help": case "-h": {
        const e = new Error(USAGE);
        e.code = "HELP";
        throw e;
      }
      default: fail(`未知参数：${raw}`);
    }
  }
  out.headless = out.autoOnly && !headed;
  return out;
}
