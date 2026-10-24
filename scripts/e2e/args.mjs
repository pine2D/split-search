// 命令行参数解析（纯函数）
import { DEFAULT_PORT } from "./config.mjs";

export const USAGE = `用法：npm run e2e -- [选项]
  --auto-only        只跑自动步骤（默认在不可见的 Xvfb 里无人值守运行，xauto 照跑；退回 host 时无头）
  --headed           auto-only 改用可见的 Xephyr 窗口（退回 host 时则是不再无头）
  --only <编号,...>  只跑指定步骤，例如 --only B5,T7
  --port <端口>      模拟服务端口，默认 ${DEFAULT_PORT}（改端口后需要重新授权）
  --timeout <毫秒>   单步超时，默认 120000
  --no-xinput        不用真实鼠标/键盘（xdotool）：xauto 步骤改用人工协助版本
  --display <方式>   测试浏览器所在的显示：xephyr（独立可见窗口）、xvfb（不可见）、host（当前桌面）；
                     默认引导式用 xephyr，--auto-only 用 xvfb（加 --headed 时用 xephyr）；不可用时退回 host
  --help             显示本说明`;

const DISPLAY_MODES = ["xephyr", "xvfb", "host"];
const fail = msg => { throw new Error(`${msg}\n\n${USAGE}`); };

export function parseArgs(argv) {
  const out = { autoOnly: false, headless: false, only: null, port: DEFAULT_PORT, timeoutMs: 120000, noXinput: false, display: null };
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
      case "--no-xinput": out.noXinput = true; break;
      case "--display": {
        const v = value();
        if (!DISPLAY_MODES.includes(v)) fail(`--display 只能是 ${DISPLAY_MODES.join(" / ")}：${v}`);
        out.display = v;
        break;
      }
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
