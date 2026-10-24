# 引导式 e2e 验收 + 默认组合调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 默认组合改为 Google ｜ Bing。新增 `npm run e2e`：在 WSL Chrome 155 的有界面窗口里，自动执行全部 auto 验收项；需要用户亲手做的步骤由浏览器内的向导页提示，再由脚本自动判定结果。

**Architecture:** 脚本放在 `scripts/e2e/`，纯 Node 24、无 npm 依赖。用自写的管道 CDP 客户端（`--remote-debugging-pipe --enable-unsafe-extension-debugging`，不加 `--enable-automation`）驱动独立的测试配置 `~/.cache/split-search-e2e/profile`，并加 `--disable-sync`。扩展由用户一次性手动“加载已解压”，之后每次运行用 `chrome.runtime.reload()` 加载最新代码。本地 HTTP 服务同时提供模拟引擎（`*.localhost:8765`）和向导页（`127.0.0.1:8765/guide`）。判定方式：在扩展 service worker 里调用 `chrome.tabs` / `chrome.windows` / DNR，读取状态并断言。

**Tech Stack:** Node 24（`node:child_process`、`node:http`、`node:test`），Chrome DevTools Protocol（管道传输），MV3 扩展 API。

**Spec:** `docs/superpowers/specs/2026-10-23-e2e-and-default-pair-design.md`（以下称 e2e spec）。主 spec 为 `docs/superpowers/specs/2026-10-23-split-search-design.md`。

## Global Constraints

- 扩展本身的硬约束不变（见 `CLAUDE.md` 的“硬约束”）。e2e 不得为了测试修改扩展的权限或行为，**不做测试专用的 manifest**。
- `DEFAULT_PAIR = ["google", "bing"]`；预置引擎顺序为 `google, bing, ddg, perplexity, kagi`（id 和 URL 模板不变）。
- e2e 脚本：Node 24，**无 npm 依赖**，全部放在 `scripts/e2e/`，每个 JS 文件不超过 300 行；单元测试放在 `test/e2e-*.test.js`，由 `npm test` 一并运行。
- 测试配置目录固定为 `~/.cache/split-search-e2e/profile`。Chrome 启动参数必须包含 `--disable-sync`、`--remote-debugging-pipe`、`--enable-unsafe-extension-debugging`、`--no-first-run`、`--no-default-browser-check`，**不得**包含 `--enable-automation`。
- **绝不**读写 `~/.config/google-chrome`、`~/.chrome-debug-profile` 和任何 Windows 配置；不复制用户配置。
- Kagi 的 cookie、token 和密码不得出现在仓库、报告或日志中。
- 模拟服务固定端口默认 8765（`--port` 可改）。主机名固定：`engine-a.localhost`、`engine-b.localhost`、`engine-c.localhost`（只作右侧，路径模板）、`site-x.localhost`（非引擎站点）；向导页为 `http://127.0.0.1:<port>/guide`。
- 一次性授权的 origin 列表固定在 `scripts/e2e/config.mjs` 的 `GRANT_ORIGINS` 中：四个模拟 host（含端口）加上 `https://www.google.com/*`、`https://www.bing.com/*`、`https://kagi.com/*`、`https://duckduckgo.com/*`、`https://www.perplexity.ai/*`。
- 扩展 ID 固定为 `alngkkgnobglnfbhcplhpaflcgfiajnj`。
- 测试前把 `chrome.storage.sync` 全量快照写入 `.e2e/storage-snapshot.json`，结束后（包括中断）恢复；启动时如果发现有遗留快照，先恢复它。
- 报告写到 `.e2e/report-<YYYYMMDD-HHMMSS>.md` 和同名 `.json`；`.e2e/` 加入 `.gitignore`。有失败时退出码为 1，前置条件缺失时为 2。
- 向导页和终端输出用简体中文；向导页适配深色模式；DOM 操作只用 textContent / createElement。
- 提交身份：`git -c user.name=pine2D -c user.email=oumu323@gmail.com commit`，Conventional Commits，body 以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。

## Review Focus

1. **测试配置正被另一个 Chrome 占用**（`SingletonLock` 存在，且对应进程还活着）：期望立即退出码 2，并提示“请关闭使用 ~/.cache/split-search-e2e/profile 的 Chrome”，而不是卡住或启动失败后报莫名其妙的错。用例放在 Task 3（`checkProfileLock`）。
2. **端口 8765 已被占用**：期望退出码 2，提示改用 `--port` 并说明授权要重做，不要静默换端口。用例放在 Task 4。
3. **运行中途按 Ctrl+C，或用户关掉了测试浏览器窗口**：期望写出部分报告，尽量恢复 storage；浏览器已经没了时，保留快照文件，下次启动时自动恢复。用例放在 Task 5（`runSteps` 中断路径 + 遗留快照恢复）。
4. **扩展未安装、ID 不对，或磁盘代码比加载的旧**：未安装或 ID 不对时，非 auto-only 模式进入安装引导，auto-only 模式退出码 2；代码一律 reload。用例放在 Task 5（`ensureExtension` 的分支）。
5. **用户在 assist 步骤里超时或点了“跳过”**：期望记为 fail 或 skip 并附上诊断信息（当前所有标签的 url、splitViewId），然后继续下一步，整次运行不被中断。用例放在 Task 5（步骤执行器）。

---

## File Structure

```
scripts/e2e/
├── run.mjs            CLI 入口：解析参数 → 前置检查 → 启动 → 确认扩展 → 配置模拟引擎 → 执行步骤 → 恢复 → 写报告
├── args.mjs           解析命令行参数（纯函数）
├── config.mjs         常量：扩展 ID、配置目录、端口、主机名、GRANT_ORIGINS、模拟引擎定义
├── cdp.mjs            管道 CDP 客户端（消息帧编解码、send/on、会话）
├── browser.mjs        启动/关闭/重启 Chrome；配置锁检查；attach 到 SW 或页面；evaluate；等待某个条件成立
├── ext.mjs            扩展操作：确认已安装、reload、storage 快照与恢复、读取 tabs/windows/rules 状态
├── server.mjs         HTTP：模拟引擎页面 + 向导页静态资源 + /api/state、/api/answer
├── guide/guide.html|js|css   向导页
├── report.mjs         生成报告 md/json（纯函数）
└── steps/
    ├── index.mjs      步骤注册表与过滤（--only / --auto-only）
    ├── setup.mjs      B1 安装引导、一次性授权、Kagi 登录引导
    ├── options.mjs    B2、B3、B5–B8、B10–B13、B15（auto）
    ├── flow.mjs       核心链路、T5、T6、T7、T10、T13(a–e)（auto）
    └── assisted.mjs   B4、T1–T4、T5 拖拽、T6 新标签页、T8、T9、T11、T14（assist），T12、B14、T8(d)（judge）
test/e2e-*.test.js     纯逻辑单元测试
```

步骤对象的统一形状（Task 5 定义，Task 6–8 使用）：

```js
{ id: "T7", title: "错误的 _ss 停在错误页", kind: "auto" | "assist" | "judge", needs: [] /* 例如 ["kagi"] */, run: async (ctx) => ({ status: "pass" | "fail" | "skip", detail: string }) }
```

---

### Task 1: 默认组合改为 Google ｜ Bing

**Files:**
- Modify: `src/lib/engines.js`（PRESETS 顺序、DEFAULT_PAIR）、`src/options/options.html:37`（示例名改为“Google ｜ Bing”、快捷字词示例改为 `gb`）、`README.md:3`（示例改为 Google 和 Bing）
- Modify: `CLAUDE.md`（硬约束里的预置引擎行改为新顺序和新默认组合；第 62 行的触发网址示例改为 `https://www.google.com/search?q=%s&_ss=google,bing`）
- Modify: 主 spec `docs/superpowers/specs/2026-10-23-split-search-design.md`（§4.1 示例、§5.1 预置说明、§10 增加一行“默认组合改为 Google ｜ Bing，Kagi 排最后 | 用户 | Kagi 用户群小”）
- Test: 所有依赖原默认值或原预置顺序的测试（`test/engines.test.js`、`test/config-store.test.js`、`test/options-edits.test.js`，以及 grep 到的其他文件）

- [ ] **Step 1：先改测试期望。** 写入新断言：`mergeConfig({}).engines.map(e => e.id)` 等于 `["google","bing","ddg","perplexity","kagi"]`；`mergeConfig({}).defaultPair` 等于 `["google","bing"]`；`mergeConfig({ defaultPair: ["kagi","nope"] }).defaultPair` 等于 `["google","bing"]`。原来以 kagi 作为“默认组合引用、不能隐藏或删除”的测试，改用 google 和 bing。用 `grep -rn "kagi" test/` 逐个检查，只修改依赖“默认值或顺序”的断言；显式使用 kagi 的用例保留。
- [ ] **Step 2：运行 `npm test`**，预期这些断言失败。
- [ ] **Step 3：修改 `src/lib/engines.js`** 的 PRESETS 顺序和 DEFAULT_PAIR，然后改上面列出的文案和文档。
- [ ] **Step 4：运行 `npm test`**，预期全部通过。另外执行 `grep -rn -i "kagi ｜ google\|kagi,google" src README.md CLAUDE.md`，应只剩下显式举例 Kagi 的地方，不应再出现在描述默认组合的语境里。
- [ ] **Step 5：运行 `bash scripts/sync-to-windows.sh`，然后提交** `feat: default pair Google | Bing, Kagi moves last`。

---

### Task 2:【控制端与用户一起做】技术探针 + 测试配置的一次性准备

本任务**不派发给子代理**。由控制端带着用户完成，因为需要用户在浏览器里操作。临时脚本放在 scratchpad，不进仓库。

- [ ] **Step 1：** 控制端用 `google-chrome --user-data-dir=~/.cache/split-search-e2e/profile --disable-sync --no-first-run --no-default-browser-check --remote-debugging-pipe --enable-unsafe-extension-debugging` 启动有界面窗口，并保持 CDP 连接。
- [ ] **Step 2（用户）：** 在 `chrome://extensions` 打开开发者模式，选“加载已解压的扩展程序”，在 Linux 文件选择框里选 `/home/oumu/projects/split-search/src`。控制端核对 service worker 出现在 target 列表中、扩展 ID 正确、安装后自动打开了设置页（B1）。
- [ ] **Step 3（用户）：** 控制端在设置页上下文里用 `Runtime.evaluate({ userGesture: true })` 调用 `chrome.permissions.request({ origins: GRANT_ORIGINS })`，用户点“允许”。核对 `chrome.permissions.getAll()`（探针第 4 点）。
- [ ] **Step 4：** 用模拟引擎做三次触发，分别是新标签页、在已有标签上跳转、带 `_ss` 的网址，核对 go.html 能完整执行并建出分屏（探针第 2 点）。如果仍像无头模式那样卡住，就改用 HTTPS 模拟引擎：自签证书，加 `--ignore-certificate-errors`。记下最终采用的方案。
- [ ] **Step 5：** 执行 `Browser.close`，再加 `--restore-last-session` 重启，核对三件事：扩展仍在且授权仍在（探针第 1 点）；分屏恢复后两个标签是否仍共享同一个 splitViewId（探针第 3 点）；在 SW 里调用 `chrome.runtime.reload()` 后，能否重新连上新的 SW。
- [ ] **Step 6（用户）：** 在测试浏览器里登录 kagi.com，只登录网站，不登录 Chrome 账号。
- [ ] **Step 7：** 把结论写进 SDD ledger，内容包括：模拟引擎用 http 还是 https、分屏能否恢复、reload 后重新连接的方法。如果某一点不成立，在 ledger 里写下裁定：怎么改相关任务的做法，或者把相关步骤降级为 assist / judge。后续各任务的派发说明都要附上这份结论。

---

### Task 3: 管道 CDP 客户端与浏览器控制

**Files:**
- Create: `scripts/e2e/config.mjs`、`scripts/e2e/cdp.mjs`、`scripts/e2e/browser.mjs`
- Test: `test/e2e-cdp.test.js`、`test/e2e-browser.test.js`

**Interfaces:**
- Produces:
  - `config.mjs`：`EXT_ID`、`PROFILE_DIR`（按 `os.homedir()` 拼出）、`DEFAULT_PORT = 8765`、`HOSTS = { a: "engine-a.localhost", b: "engine-b.localhost", c: "engine-c.localhost", site: "site-x.localhost" }`、`mockEngines(port) → Engine[]`（ea、eb 为 `http://<host>:<port>/search?q=%s`；ec 为 `http://<host>:<port>/wiki/%s`；协议以 Task 2 的结论为准）、`GRANT_ORIGINS(port) → string[]`、`CHROME_ARGS(profileDir, { headless }) → string[]`。
  - `cdp.mjs`：`encodeFrame(obj) → string`（JSON 加 `\0`）；`createDecoder(onMessage) → (chunk: string) => void`（能处理拆包和粘包）；`createClient(writable, readable) → { send(method, params?, sessionId?) → Promise<result>, on(method, fn), off(method, fn), close() }`。send 遇到 CDP error 时用 `Error(method + ": " + message)` reject。
  - `browser.mjs`：
    - `checkProfileLock(profileDir) → { locked: boolean, pid?: number }`：读取 `SingletonLock` 的符号链接目标，形如 `<host>-<pid>`，再用 `process.kill(pid, 0)` 判断该进程是否还在；
    - `launch({ headless, restoreSession }) → Promise<Browser>`；
    - `Browser = { client, attach(targetId) → sessionId, evaluate(sessionId, expr, { userGesture?: boolean } = {}) → value, targets() → TargetInfo[], waitFor(fn, { timeoutMs, intervalMs = 250 }) → value, close() }`。

- [ ] **Step 1：写测试。**
  - 解码器：一个 chunk 里含 2 条消息；1 条消息拆成 3 个 chunk；结果都应正好回调 2 次和 1 次。
  - `createClient`：用一对 PassThrough 流模拟 Chrome，按 id 回包，断言 send 能拿到 result；回 error 时 reject，且错误信息包含 method。
  - `checkProfileLock`：在临时目录里分别建指向 `host-<当前进程 pid>` 的锁，断言 locked 为 true；建指向 `host-999999` 的锁，断言 locked 为 false；没有锁文件时 locked 为 false。
  - `CHROME_ARGS`：包含 `--disable-sync` 和 `--remote-debugging-pipe`，不包含 `--enable-automation`；`headless: true` 时包含 `--headless=new`。
- [ ] **Step 2：运行 `node --test test/e2e-cdp.test.js test/e2e-browser.test.js`**，预期失败。
- [ ] **Step 3：实现。** `launch` 用 `spawn("google-chrome", CHROME_ARGS(...), { stdio: ["ignore","ignore","ignore","pipe","pipe"] })`，CDP 消息写入 fd 3、从 fd 4 读取。启动后用 `Browser.getVersion` 确认连接，超时 10 秒。
- [ ] **Step 4：运行测试**，预期通过。补充实测：确认测试配置没有被占用后，用一行 `node -e` 以无头模式 launch，打印 `Browser.getVersion` 和 SW target 的 url，然后 close；把输出贴进报告。
- [ ] **Step 5：提交** `feat(e2e): pipe CDP client and browser control`。

---

### Task 4: 模拟服务与向导页

**Files:**
- Create: `scripts/e2e/server.mjs`、`scripts/e2e/guide/guide.html`、`scripts/e2e/guide/guide.js`、`scripts/e2e/guide/guide.css`
- Test: `test/e2e-server.test.js`

**Interfaces:**
- Consumes: `config.mjs`。
- Produces：`startServer({ port }) → Promise<{ close(), guide }>`。端口被占用时 reject，错误信息为 `端口 <port> 已被占用；可用 --port 换端口，但需要重新授权`。
  - `guide.setStep({ id, title, kind, instruction, sampleText?, copyText?, buttons: ["pass","fail","skip","retry"] 的子集 })`；
  - `guide.setResult(id, status, detail)`；
  - `guide.waitAnswer({ timeoutMs }) → Promise<"pass"|"fail"|"skip"|"retry"|"timeout">`；
  - `guide.cancel()`：让当前的 waitAnswer resolve 为 `"timeout"`；
  - `guide.setProgress(done, total)`。
  - HTTP 路由：
    - `GET http://<engine host>:<port>/search?q=…` 和 `GET /wiki/<词>`：返回 `<title>` 为 `<引擎名> · <解码后的关键词>` 的页面，正文也包含这两项；
    - `GET http://site-x.localhost:<port>/<任意路径>`：返回 `<title>site-x <path></title>`；
    - `GET 127.0.0.1:<port>/guide`：向导页（不在此 host 上时返回 404）；
    - `GET /api/state`：返回 JSON `{ step, progress, results, seq }`；
    - `POST /api/answer`，body 为 `{ seq, answer }`：seq 与当前一致时才接受，否则返回 409。

- [ ] **Step 1：写测试**（用 `fetch` 访问 `127.0.0.1`，设置 `Host` 头来模拟各个主机名）。
  - 模拟引擎页面的 `<title>`：`engine-a.localhost` 加 `/search?q=a+b%26c` 得到 `A · a b&c`；`engine-c.localhost` 加 `/wiki/%E4%B8%AD%E6%96%87` 得到 `C · 中文`。
  - site-x 的 title。
  - `/guide` 在 site-x host 上返回 404。
  - `setStep` 之后 `/api/state` 返回该 step，并且 seq 自增。
  - `POST /api/answer` 带正确的 seq 时，`waitAnswer` resolve 为对应值；带旧 seq 时返回 409；超时 resolve 为 `"timeout"`。
  - 端口被占用时 reject 并给出上述中文信息。
- [ ] **Step 2：运行测试**，预期失败。
- [ ] **Step 3：实现 server.mjs 和向导页。** 向导页每 500ms 轮询 `/api/state`，显示步骤编号、标题、说明。`sampleText` 放在一个大号、可选中、可拖拽的文本块里；`copyText` 旁边放“复制”按钮；页面上有进度和最近结果列表。按钮按 `buttons` 显示：pass 为“通过”、fail 为“不通过”、skip 为“跳过”、retry 为“重试”。中文界面，适配深色模式，DOM 只用 textContent 或 createElement。
- [ ] **Step 4：运行测试**，预期通过；`find scripts/e2e -name '*.js' -o -name '*.mjs' | xargs wc -l` 显示每个文件都不超过 300 行。
- [ ] **Step 5：提交** `feat(e2e): mock engines server and guide page`。

---

### Task 5: 运行器、扩展操作、步骤框架与报告

**Files:**
- Create: `scripts/e2e/run.mjs`、`scripts/e2e/args.mjs`、`scripts/e2e/ext.mjs`、`scripts/e2e/report.mjs`、`scripts/e2e/steps/index.mjs`、`scripts/e2e/steps/options.mjs`（先只实现 B5，用来跑通整条流水线）
- Modify: `package.json`（加 `"e2e": "node scripts/e2e/run.mjs"`）、`.gitignore`（加 `.e2e/`）
- Test: `test/e2e-args.test.js`、`test/e2e-report.test.js`、`test/e2e-runner.test.js`

**Interfaces:**
- Consumes: Task 3、Task 4 的全部导出。
- Produces:
  - `args.mjs`：`parseArgs(argv) → { autoOnly: boolean, headless: boolean, only: string[] | null, port: number, timeoutMs: number }`。`--auto-only` 隐含 headless；默认 timeoutMs 为 120000。遇到未知参数时 throw，并给出中文用法说明。
  - `ext.mjs`：
    - `ensureExtension(browser, { autoOnly }) → { ok: true, swSession } | { ok: false, reason: "not-installed" | "wrong-id" }`；
    - `reloadExtension(browser) → swSession`：在 SW 里调用 `chrome.runtime.reload()`，然后等待新的 SW target 出现并重新 attach；具体做法按 Task 2 的结论；
    - `snapshotStorage(browser, file)` / `restoreStorage(browser, file)`：restore 先 `chrome.storage.sync.clear()` 再 `set(snapshot)`，成功后删除快照文件；
    - `restorePendingSnapshot(browser, file) → boolean`；
    - `state(browser) → { tabs: [{ id, index, windowId, splitViewId, pinned, groupId, url?, status }], windows: [{ id, type, focused }], rules }`；
    - `configureMocks(browser, port)`：写入 `customEngines`（mockEngines）和 `defaultPair: ["ea","eb"]`。
  - `steps/index.mjs`：`STEPS: Step[]`（按 B1–B15、T1–T15 排序），以及 `selectSteps(steps, { autoOnly, only }) → Step[]`。`autoOnly` 只保留 kind 为 auto 的步骤；`only` 按 id 过滤，遇到未知 id 时 throw。
  - `runSteps(steps, ctx, { timeoutMs }) → Result[]`：逐个执行，单步的异常或超时都记为 fail 并附带 `state()` 的诊断信息。收到 `ctx.abortSignal` 时停止，剩余步骤记为 skip（原因为“中断”）。
  - `report.mjs`：`renderReport({ startedAt, args, results, consoleErrors, chromeVersion }) → { md, json }`。md 包含汇总表（编号 | 类型 | 结果 | 耗时 | 说明）、失败详情和控制台中的 `[split-search]` 错误；json 是同样内容的机器可读版本。
  - `ctx = { browser, guide, ext, port, timeoutMs, abortSignal, log }`。
- `run.mjs` 的流程：
  1. `parseArgs`；
  2. `checkProfileLock`，被占用时退出码 2；
  3. `startServer`；
  4. `launch`；
  5. `ensureExtension`：未安装且非 auto-only 时，跑 `setup.mjs` 的安装引导（Task 8 实现，这里先报“前置条件缺失”退出码 2）；
  6. `reloadExtension`；
  7. `restorePendingSnapshot`；
  8. `snapshotStorage`；
  9. `configureMocks`；
  10. `runSteps`；
  11. `restoreStorage`；
  12. 写报告；
  13. close。

  监听 SIGINT：设置 abort，并保证第 11–13 步执行；如果浏览器已经不在，保留快照。退出码：有失败为 1，全部 pass 或 skip 为 0，前置条件问题为 2。

- [ ] **Step 1：写测试。**
  - `parseArgs`：`[]` 得到默认值；`["--auto-only"]` 得到 `autoOnly` 和 `headless` 都为 true；`["--only","B5,T7"]` 得到 `["B5","T7"]`；`["--port","9000"]` 得到 9000；`["--bogus"]` 会 throw。
  - `selectSteps`：autoOnly 过滤；only 过滤；未知 id 会 throw。
  - `runSteps`（用假的步骤和假的 ctx）：步骤 throw 时记为 fail 且 detail 含诊断；abort 后剩余步骤记为 skip，原因为“中断”；assist 步骤 resolve 为 skip 时如实记录。
  - `renderReport`：汇总行数等于步骤数；有 fail 时 md 含“失败详情”；consoleErrors 出现在 md 里；json 中能找到对应的 results。
- [ ] **Step 2：运行测试**，预期失败。
- [ ] **Step 3：实现上面列出的文件，以及 B5 步骤。** B5 为 auto：断言 `rules.length === 1`，`requestDomains` 包含五个真实引擎 host 和模拟引擎的左侧 host，`regexSubstitution` 以 `chrome-extension://alngkkgnobglnfbhcplhpaflcgfiajnj/go.html?u=` 开头。
- [ ] **Step 4：运行 `npm test`**，预期全部通过。前提是 Task 2 已经完成测试配置的准备。然后实测 `npm run e2e -- --auto-only --only B5`：预期 B5 通过、退出码 0、`.e2e/` 下生成报告；运行后 storage 与运行前一致（运行前后各读一次 `chrome.storage.sync.get(null)` 做对比，写进报告）。
- [ ] **Step 5：提交** `feat(e2e): runner, extension helpers, step framework and report`。

---

### Task 6: auto 步骤之一（设置页 B 系列）

**Files:**
- Modify: `scripts/e2e/steps/options.mjs`（如果超过 300 行，拆出 `options-b2.mjs` 等文件）
- Test: 无新增单元测试。这部分只能在真实浏览器里验证，验收标准是 Step 2 的实测运行。

**Interfaces:**
- Consumes: `ctx`（Task 5）。打开设置页：`Target.createTarget({ url: "chrome-extension://<EXT_ID>/options/options.html" })`，然后 attach；`confirm` 对话框用 `Page.enable` 加 `Page.javascriptDialogOpening` 事件，再调用 `Page.handleJavaScriptDialog`。

- [ ] **Step 1：实现以下步骤**（都为 auto；期望值以 `docs/acceptance-v0.1.md` 对应行和设置页源码为准，并按 Task 1 改后的默认组合 Google ｜ Bing 调整）：
  - B2：调用 `Extensions.triggerAction({ id: EXT_ID, targetId: <任一页面> })`，等待出现 options 页面 target。
  - B3：读取 `chrome.extension.isAllowedIncognitoAccess()`，断言为 false；并断言 manifest 的 `incognito` 为 `not_allowed`。
  - B6：新增引擎时 id 填 `Baidu`，断言出现格式错误提示，且对话框仍然打开。
  - B7：新增 `baidu`（百度，`https://www.baidu.com/s?wd=%s`），断言列表末尾出现百度，且该行授权按钮高亮。
  - B8：在“其他组合”里选左百度、右 Google，断言网址为 `https://www.baidu.com/s?wd=%s&_ss=baidu,google`；点“复制”后按钮文字变为“已复制”。
  - B10：Google 和 Bing 两行的“隐藏”按钮为 disabled。
  - B11：编辑 Google，把网址改为 `https://www.google.com/search/%s`，断言表单拒绝并显示原因。
  - B12：隐藏 DuckDuckGo，确认对话框文字包含“网站搜索”；之后 ddg 出现在“已隐藏的预置引擎”里；点“恢复”后它回到列表。
  - B13：连点两次 ↓，等 1.2 秒后刷新页面，断言顺序保持；另开一个设置页修改顺序，断言第一个页面在 2 秒内自动刷新。
  - B15：断言整次运行收集到的 `[split-search]` console error 数量为 0。这一步放在最后执行，由 runner 汇总。
  - 每个步骤结束后删掉自己新建的引擎，确保不影响后续步骤。
- [ ] **Step 2：实测运行** `npm run e2e -- --auto-only --only B2,B3,B5,B6,B7,B8,B10,B11,B12,B13,B15`，预期全部通过。把报告路径和汇总贴进报告文件。`npm test` 仍然全部通过。
- [ ] **Step 3：提交** `feat(e2e): options page auto steps`。

---

### Task 7: auto 步骤之二（分屏流程 T 系列）

**Files:**
- Create: `scripts/e2e/steps/flow.mjs`（如果超过 300 行，拆出 `flow-restart.mjs`）

**Interfaces:**
- Consumes: `ctx`。触发方式：用 `Target.createTarget({ url })` 打开新标签页，相当于拖到两个标签之间；在已有标签的会话上调用 `Page.navigate`，相当于拖到该标签上。
- 判定工具：在 `flow.mjs` 内定义 `splitPairs(state) → Array<[leftTab, rightTab]>`，按 splitViewId 分组，组内按 index 排序。各断言都基于这个函数。

- [ ] **Step 1：实现以下步骤**（都为 auto，使用模拟引擎，默认组合为 `["ea","eb"]`）：
  - **CORE-NEW**：新标签页打开 `http://engine-a.localhost:<port>/search?q=hello+world&_ss=ea,eb`。断言出现一个新的分屏：左侧 url 为 `…engine-a…/search?q=hello+world`，不含 `_ss`；右侧 url 为 `…engine-b…/search?q=hello%20world`。
  - **CORE-EXISTING**：在一个已有的普通标签（site-x）上跳转到触发网址。断言这个标签变成左侧，右侧是新开的标签。
  - **T5**：在 CORE-NEW 建出的分屏中，先在左侧标签上跳转一次，再在右侧标签上跳转一次。断言分屏数量不变、左右顺序不变、两侧关键词都是最新的。然后重启浏览器（`--restore-last-session`），再在左侧跳转一次。按 Task 2 的结论判定：如果分屏能恢复，断言是就地更新；如果不能恢复，把这一子项记为 skip，并写明原因。
  - **T6**：用 SW 调用 `chrome.tabs.create` 新开两个 site-x 页面，再调用 `chrome.tabs.createSplit`，组成一个“用户手动建的分屏”。在其中一个标签上跳转到触发网址。断言：手动分屏的另一侧 url 不变；新出现一个分屏，内容为 ea ｜ eb；被跳转的那个标签退回原来的 site-x 页面。
  - **T7**：分别打开 `…/search?q=test&_ss=ea` 和 `…&_ss=ea,nope`，断言页面停在 go.html，正文分别包含“标记参数格式不对”和“未知引擎：nope”，并且“只打开左侧搜索”按钮可见。
  - **T10**：建一个分屏后，对左侧执行 `history.back()` 再 `history.forward()`，断言不会产生新的分屏。然后重启浏览器，断言恢复后标签总数没有增加（go.html 没有被重新执行）。
  - **T13(a–e)**：
    - (a)：用 `chrome.tabs.update({ pinned: true })` 固定源标签后触发，断言新标签也是固定标签，并且两者组成了分屏；
    - (b)(c)：在 SW 里调用 `chrome.tabs.group({ tabIds })` 把源标签放进标签组（`tabs.group` 属于 tabs API，不需要 `tabGroups` 权限）后触发，断言新标签在同一个组里；(c) 让源标签成为组里唯一的标签。如果实测发现调用需要额外权限，就记为 skip 并写明原因，**不得**为此给扩展加权限；
    - (d)：窗口里只剩一个标签时触发；
    - (e)：用 `chrome.windows.create({ type: "popup", url: 触发网址 })`，断言出现一个 normal 窗口里的分屏，popup 窗口自己显示左侧页面。
  - 每个步骤开始前关掉上一步留下的标签，只保留向导页。
- [ ] **Step 2：实测运行** `npm run e2e -- --auto-only --only CORE-NEW,CORE-EXISTING,T5,T6,T7,T10,T13`，预期全部通过（允许的 skip 必须写明原因）。`npm test` 仍然全部通过。
- [ ] **Step 3：提交** `feat(e2e): split-flow auto steps`。

---

### Task 8: 安装引导、assist 与 judge 步骤、文档

**Files:**
- Create: `scripts/e2e/steps/setup.mjs`、`scripts/e2e/steps/assisted.mjs`
- Modify: `scripts/e2e/run.mjs`（未安装时调用安装引导）、`docs/acceptance-v0.1.md`、`CLAUDE.md`

**Interfaces:**
- Consumes: `ctx.guide`（Task 4）、`ctx.ext.state()`（Task 5），以及 Task 7 的 `splitPairs`（如有需要，把它挪到 `steps/util.mjs`）。
- 每个 assist 步骤的写法：先调用 `guide.setStep({ instruction, sampleText? / copyText?, buttons: ["skip","retry"] })`，再用 `browser.waitFor(predicate, { timeoutMs })` 等待满足条件；同时 `guide.waitAnswer()`，两者谁先完成就以谁为准。judge 步骤只用 `buttons: ["pass","fail","skip"]` 让用户选。

- [ ] **Step 1：实现 setup.mjs。**
  - 安装引导：说明在 `chrome://extensions` 开开发者模式，再“加载已解压”`/home/oumu/projects/split-search/src`。等待扩展 SW 出现，记为 B1，并断言自动打开了设置页。
  - 一次性授权：如果 `chrome.permissions.contains({ origins: GRANT_ORIGINS })` 为 false，提示用户“即将弹出授权框，请点允许”，然后用 userGesture 调用 request。
  - Kagi 登录：只在 `needs` 包含 `"kagi"` 的步骤之前检查。在新标签页打开 `https://kagi.com/`，根据最终 url 是否为 `/signin` 来判断；未登录就提示用户登录，等待最终 url 不再是 signin。
- [ ] **Step 2：实现 assisted.mjs**，期望值以 `docs/acceptance-v0.1.md` 为准，并按新的默认组合调整：
  - **B4**：先用 `chrome.permissions.remove` 撤销 Google 和 Bing 的授权，提示用户点设置页横幅上的“授权”按钮并允许；等待 `permissions.contains` 变为 true。
  - **T1**：用 copyText 给出触发网址 `https://www.google.com/search?q=%s&_ss=google,bing`，提示用户在 `chrome://settings/searchEngines` 添加网站搜索 `gb`，再在地址栏输入 `gb 测试`；等待出现 Google ｜ Bing 分屏，且两侧关键词都是“测试”。
  - **T2**：(a) 提示用户把该条目“设为默认”后，在地址栏直接输入；(b) 按 Alt+Enter；断言出现分屏或新开标签，并且没有崩溃。
  - **T3(a) / T4 / T5 的拖拽**：sampleText 给出“拖拽测试文字”。分别提示用户拖到两个标签之间、拖到已有标签上、拖到本扩展分屏的右侧标签上。由于默认引擎已设为 gb，等待对应的分屏状态。
  - **T6 新标签页子项**：提示用户手动建一个包含新标签页的分屏，再拖文字进去；按钮 pass / fail / skip，由用户判断。
  - **T8**：
    - (a) 无痕窗口：judge，提示用户按 Ctrl+Shift+N 后在地址栏搜索，判断是否为普通搜索；
    - (b) 停用扩展：assist，等待 SW 消失后再触发；完成后提示用户重新启用；
    - (c)(e) 用 `permissions.remove` 后由脚本触发，断言没有分屏，然后脚本恢复授权（恢复授权需要用户点一次允许）；
    - (d) “点击时”选项：judge。
  - **T9**：needs `["kagi"]`。打开 `https://kagi.com/search?q=split+test&_ss=kagi,google`，断言左侧 url 以 `https://kagi.com/search` 开头（不是 signin 或 turnstile），右侧为 Google。
  - **T11**：提示用户选中 sampleText 后右键，选“在 gb 中搜索”；等待出现分屏。
  - **T12**：judge，提示用户编辑自动发现的条目，给出完整步骤；最后提示把默认搜索引擎恢复为 Google，并删除追加的 `_ss`。
  - **T14**：对 ddg、perplexity、kagi 各当一次左侧，给出触发网址，提示用户把对应条目设为默认后拖一次，等待左侧 host 正确；最后提示恢复默认。
  - **B14**：judge，用 `Emulation.setEmulatedMedia` 切到深色模式，再让用户看设置页和向导页。
  - 在 run.mjs 里把这些步骤按清单编号顺序插入完整运行。auto-only 模式下不包含它们。
- [ ] **Step 3：修改文档。**
  - `docs/acceptance-v0.1.md` 改为：开头写“先运行 `npm run e2e`（首次运行会引导你安装扩展、授权、登录 Kagi）”；然后是“Windows Chrome 冒烟”，共 4 项：加载 `D:\APP\Chrome-Extensions\split-search` 并核对扩展 ID；从记事本拖文字到标签栏（T3b）；在网页上选中文字拖一次；在地址栏用默认引擎搜一次。原来的 B/T 表格保留，在备注列标注“e2e auto / e2e assist / e2e judge / Windows 冒烟 / 未覆盖”。默认组合相关的期望全部改为 Google ｜ Bing。
  - `CLAUDE.md` 补充 e2e 的命令、测试配置目录、一次性准备、`--auto-only` 的前提，并说明 WSL Chrome 155 可以用于除“外部应用拖入”以外的全部验证。
- [ ] **Step 4：** `npm test` 全部通过；`npm run e2e -- --auto-only` 全部通过（skip 必须写明原因）。完整的引导式运行在 Task 9 由控制端和用户一起做。
- [ ] **Step 5：提交** `feat(e2e): guided setup, assist and judge steps; docs`。

---

### Task 9:【控制端与用户一起做】完整的引导式运行

不派发给子代理。

- [ ] **Step 1：** 控制端在后台启动 `npm run e2e`，告诉用户：“测试浏览器窗口已经打开，请照着窗口里‘验收向导’标签页的提示操作。”
- [ ] **Step 2：** 运行结束后读取 `.e2e/report-*.md`。失败项按缺陷处理，走修复流程：先补 node 测试或 e2e 步骤再修，修完后用 `--only` 重跑。
- [ ] **Step 3：** 用户在 Windows Chrome 里做 4 项冒烟测试。全部通过后，打标签 `v0.1.0`（需要用户确认）。
