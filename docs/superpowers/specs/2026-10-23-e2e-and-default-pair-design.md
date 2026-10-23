# 引导式端到端验收 + 默认组合调整 设计文档

日期：2026-10-23　作者：pine2D　状态：待审
关联：v0.1 主设计 `2026-10-23-split-search-design.md`（下称“主 spec”），验收清单 `docs/acceptance-v0.1.md`

## 1. 意图

主 spec 第 7 节的 T1–T15 和清单里的 B1–B15 目前全靠用户手动执行和记录，步骤多、容易记错，每次改动后也没法回归。实测表明，WSL 里的 Google Chrome 155 可以通过调试管道（`--remote-debugging-pipe` + `--enable-unsafe-extension-debugging` + CDP `Extensions.loadUnpacked`）加载本扩展，DNR 重定向和原生分屏都能正常工作。

本设计把验收改成一个**引导式**端到端脚本：

- 能自动做的步骤全部自动执行、自动判定；
- 必须由用户亲手完成的步骤（拖拽、在地址栏输入、右键菜单、权限弹窗、登录 Kagi），由脚本在浏览器里提示用户怎么做，用户做完后脚本自动检测并判定；
- 只能靠人眼判断的项目，由用户点按钮给出结论。

另外，用户决定：**Kagi 不再作为默认组合**，因为它的用户群小得多。测试中仍然会覆盖 Kagi。

## 2. 产品改动：默认组合与预置顺序（用户决定）

- `DEFAULT_PAIR` 改为 `["google", "bing"]`。
- 预置引擎的顺序改为 Google、Bing、DuckDuckGo、Perplexity、Kagi，各自的 id 和 URL 模板不变。
- 需要同步更新的地方：主 spec（§5.1 预置说明，及其他提到默认组合为 Kagi ｜ Google 的地方）、`CLAUDE.md` 的硬约束、`src/lib/engines.js`、所有依赖原默认值的测试、设置页文案（横幅、引导里的示例）、README 的示例，以及 `docs/acceptance-v0.1.md`。
- 迁移：已在 `storage.sync` 里保存过 `defaultPair` 的用户不受影响，代码不主动改写；只有从未设置过默认组合的配置会变成新的默认值。

## 3. 引导式端到端验收（`npm run e2e`）

### 3.1 运行环境

- 浏览器：WSL 中的 `google-chrome`（155+），**带界面运行**（经 WSLg 显示在用户桌面上）。不加 `--enable-automation`。
- 加载方式：调试管道 + CDP `Extensions.loadUnpacked`，加载仓库里的 `src/`，使用**正式 manifest**，不另做权限更宽的测试版。实测已确认，正式版 Chrome 会忽略 `--load-extension` 参数。
- 测试配置目录：`~/.cache/split-search-e2e/profile`，全新创建，与用户的日常配置完全隔离，下次运行时复用。启动时**一律加 `--disable-sync`**，测试浏览器里也**不登录 Chrome 账号**。
- **不从用户配置复制**。审阅时发现，用户的 WSL Chrome 配置登录了 Chrome 同步；复制出来的测试配置会把测试写入的 `storage.sync`、新增的网站搜索和默认搜索引擎同步到用户的 Windows Chrome，违反反目标。需要 Kagi 登录态时，由向导提示用户在测试浏览器里登录 kagi.com（只登录网站，不登录 Chrome 账号）。登录态保存在测试配置里，下次运行不必再登。
- **扩展的持久安装（已实测）**：通过 CDP `Extensions.loadUnpacked` 加载的扩展只在当次进程有效，浏览器重启后就不在了。因此首次运行时有一个一次性的 assist 步骤：用户在测试浏览器的 `chrome://extensions` 打开开发者模式，选“加载已解压的扩展程序”，选择仓库的 `src/`。这样扩展会永久安装在测试配置里，重启后也还在，B1“首次安装自动打开设置页”就在这一步验证。之后每次运行，脚本先确认已安装的扩展 ID 是 `alngkkgnobglnfbhcplhpaflcgfiajnj`，然后在 service worker 里执行 `chrome.runtime.reload()`，从磁盘重新加载最新代码。若发现扩展未安装，非 `--auto-only` 模式下进入上面的安装引导，`--auto-only` 模式下报“前置条件缺失”并退出。
- 授权（一次性）：首次运行时，脚本在设置页上下文里用带用户手势的 `Runtime.evaluate` 调用 `chrome.permissions.request`，一次申请全部模拟引擎 origin，以及 Google、Bing、Kagi、DuckDuckGo、Perplexity 的 origin，由用户点“允许”。授权保存在测试配置里，供以后（包括 `--auto-only`）使用。B4（设置页横幅上的授权按钮）在一个单独的 assist 步骤里测：先撤销 Google 和 Bing 的授权，再让用户点横幅按钮。
- 模拟引擎使用**固定端口**（默认 8765，可配置），否则带端口的 origin 授权每次都会失效。
- 不使用任何 npm 依赖：自写一个基于管道的最小 CDP 客户端；Node 24 内置 `http` 用来提供模拟引擎和向导页。

### 3.2 模拟引擎

本地 HTTP 服务充当搜索引擎，避免人机验证，也不依赖网络：

- 使用两个以上互不相同的 host（例如 `engine-a.localhost`、`engine-b.localhost`，Chrome 会把 `*.localhost` 解析到本机），同一个端口；
- 每个模拟引擎都有 `/search?q=%s` 页面，并能另配一个路径型模板，用于测试“只能作右侧”的引擎；
- 页面标题和正文写明“引擎名 + 关键词”，方便断言；
- 测试开始时，脚本通过写扩展的 `storage.sync` 把模拟引擎配置进去（在扩展页上下文中执行 `chrome.storage.sync.set`），结束后恢复成测试前的配置。

### 3.3 向导页

- 脚本在 `http://127.0.0.1:<端口>/guide` 提供向导页，它是一个独立的 origin，不属于任何引擎。测试浏览器里固定打开这个标签页。
- 向导页显示：当前步骤编号、标题、具体操作说明，必要时附上可拖拽的示例文字、可复制的网址，以及进度和最近一步的结果。
- 页面通过轮询或 SSE 和脚本通信，提供这几个按钮：“通过 / 不通过”（只在需要用户判断的步骤出现），“跳过”（记为跳过并写明原因），“重试”。
- 步骤有三种：
  - **auto**：全程由脚本完成并判定；
  - **assist**：用户照着向导操作，脚本轮询标签和分屏状态，满足预期就判通过；超时（默认 120 秒，可配置）判失败，并附上诊断信息；
  - **judge**：只能人眼判断，由用户点按钮。

### 3.4 判定方式

- 标签、分屏、窗口的状态：attach 到扩展的 service worker，执行 `chrome.tabs.query`、`chrome.windows.getAll`（看 `splitViewId`、`index`、`pinned`、`groupId`、窗口类型）。已授权 host 上的标签网址可以直接读到；其他网址通过 CDP `Target.getTargets` 读取。
- DNR 规则：在 service worker 里调用 `getDynamicRules()`。
- 设置页：attach 到 options 页面，操作 DOM、读取文本；`confirm` 对话框用 CDP `Page.handleJavaScriptDialog` 处理；深色模式用 `Emulation.setEmulatedMedia` 切换。
- 控制台：收集扩展所有上下文的 console 输出和异常。整次运行中只要出现 `[split-search]` 的 error，就在报告里标红。
- 需要重启浏览器的步骤（T5 重启后、T10 恢复会话）：用 `Browser.close` 关闭，再用同一配置加 `--restore-last-session` 重新启动。扩展已持久安装，重启后会随浏览器一起启动，所以这个场景是真实的。
- `chrome.tabs` 和 CDP target 之间没有 tabId 可以直接对应，因此所有需要读取网址的页面都放在**已授权的 origin** 上。T6 里“用户手动建的分屏”改用非引擎的模拟站点（例如 `site-x.localhost`，它的 origin 包含在一次性授权里），不用 example.com 或新标签页。T6 的“新标签页”子项改为 assist 步骤，由用户确认结果。
- B2 用 CDP `Extensions.triggerAction` 真实触发工具栏按钮的点击。

### 3.5 步骤覆盖（与 `docs/acceptance-v0.1.md` 的编号对应）

| 类别 | 项目 |
|---|---|
| auto | B2、B3、B5–B8、B10–B13、B15，T5（含重启）、T6（模拟站点）、T7、T10、T13(a–e)，以及“核心链路”：用模拟引擎触发 T1–T4，新标签页相当于拖到两个标签之间，在已有标签上跳转相当于拖到该标签上。核心链路在报告里单独列出，**不**算作 T3/T4 通过 |
| assist | 首次安装 B1、一次性授权、横幅授权 B4、T8 撤销授权与停用扩展、在 WSLg 中真实拖拽 T3(a)/T4/T5/T14（**算正式通过**）、地址栏输入 T1/T2（含 Alt+Enter）、右键搜索 T11、登录 Kagi 并验证 T9、T6 的新标签页子项、在 `chrome://settings/searchEngines` 添加网站搜索或设为默认（向导给出可复制的网址和步骤） |
| judge | T12 地址栏联想、B14 深色模式配色、T8(d) 站点访问里有没有“点击时”选项 |
| 留给 Windows 冒烟 | T3(b) 从外部应用（记事本等）拖入：WSLg 拖不了 Windows 应用 |
| 不覆盖 | T13(f) PWA、T15 uBlock Origin（v1 不做，报告里标“未覆盖”） |

`chrome://settings` 的修改只能由用户手动完成，因为扩展 API 和 CDP 都写不了搜索引擎设置。验证方式是看下一步的触发结果。

### 3.6 运行模式与报告

- `npm run e2e`：完整的引导式运行。
- `npm run e2e -- --auto-only`：只跑 auto 步骤，可以无头运行（`--headless=new`），不需要用户在场，用于日常回归。前提是测试配置已经完成过一次引导式运行（扩展已安装、已授权），否则报“前置条件缺失”。
- `--only B5,T7`：只跑指定步骤。
- 报告写到 `.e2e/report-<时间戳>.md` 和 `.json`（`.e2e/` 加入 .gitignore），内容包括每步的类型、结果、耗时、诊断信息和控制台摘要。终端最后打印一行汇总；有失败时退出码不为 0。

### 3.7 与现有验收清单的关系

- `docs/acceptance-v0.1.md` 改为：先跑 `npm run e2e`，再在 **Windows Chrome** 里做一个简短的冒烟测试（加载、拖一次、在地址栏搜一次、确认扩展 ID）。原来的 B/T 表格保留作为参考，每一项注明由 e2e 覆盖还是需要手测。
- `CLAUDE.md` 补充 e2e 的用法，并说明：除拖拽外，WSL Chrome 155 可以用来验证；涉及 Windows 环境的问题仍以 Windows Chrome 为准。

## 4. 目标、非目标、反目标

- **目标**：验收项中 auto 和 assist 两类合计不少于 22 项；一次完整运行中，用户只需照着向导操作，不需要另外记录；`--auto-only` 能无人值守地回归。
- **非目标**：不在 CI 或 GitHub Actions 上运行（本机 WSL 专用）；不驱动 Windows Chrome；不做 PWA 和 uBlock Origin 相关的覆盖。
- **反目标**：
  - 修改用户的真实 Chrome 配置（`~/.config/google-chrome`、`~/.chrome-debug-profile`，以及任何 Windows 配置），包括经 Chrome 同步间接修改；
  - 把 Kagi 的 token、cookie 或密码写进仓库、报告或日志；
  - 为了方便测试而改变扩展的权限或行为（不做测试专用的 manifest）；
  - 给扩展本身引入任何依赖；
  - 测试结束后不清理留在扩展里的模拟引擎配置。

## 4.5 实现第一步：技术探针（必须先做）

正式写测试步骤之前，先用一个临时脚本（不进仓库）实测以下几点，结果记入实现报告。任何一点不成立，都先回报再决定怎么改：

1. 在 `chrome://extensions` 手动“加载已解压”的扩展，在加 `--remote-debugging-pipe --enable-unsafe-extension-debugging` 启动时，service worker 会出现在 target 里；`chrome.runtime.reload()` 能加载最新代码；已授予的 host 权限在重启后仍在。
2. 带 `_ss` 的模拟引擎网址（http + `*.localhost` + 固定端口）能被 DNR 重定向，并且 go.html 能完整执行、建出分屏。2026-10-23 的无头实测里，go.html 迟迟没有完成加载（请求已经发出，直到下一次导航时才提交），需要在有界面模式下复测。仍有问题时，改用 HTTPS 模拟引擎（自签证书，测试浏览器加 `--ignore-certificate-errors`）。
3. `Browser.close` 后加 `--restore-last-session` 重启，原生分屏能否恢复：恢复后两个标签是否还共享同一个 `splitViewId`。
4. CDP 带 `userGesture: true` 的 `Runtime.evaluate` 能否触发 `chrome.permissions.request` 的弹窗。

## 5. 留给实现者决定

- 目录拆分（建议 `scripts/e2e/`：`run.mjs`、`cdp.mjs`、`browser.mjs`、`mock-engines.mjs`、`guide/`、`steps/*.mjs`），每个 JS 文件不超过 300 行；
- 向导页的视觉和文案（中文，适配深色模式）；
- 端口的选择方式；
- 超时时长；
- 报告的排版。

## 6. 决策记录

| 决策 | 由谁决定 | 理由 |
|---|---|---|
| 默认组合改为 Google ｜ Bing，Kagi 排到预置引擎最后 | 用户 | Kagi 的用户群小 |
| 需要用户亲手操作的步骤由向导提示、脚本判定 | 用户 | 用户愿意配合点击和登录 |
| 用 WSL Chrome 155 带界面运行，测试配置全新且隔离，加 `--disable-sync`，不复制用户配置 | Claude | 用户的配置开了 Chrome 同步，复制会把测试数据同步到 Windows Chrome |
| 扩展由用户一次性手动“加载已解压”到测试配置中 | Claude | 已实测：`Extensions.loadUnpacked` 加载的扩展重启后就不在了，无法测试重启相关场景 |
| 在 WSLg 中真实拖拽的结果算正式通过；从外部应用拖入留给 Windows 冒烟 | Claude | WSL Chrome 155 和 Windows 版的拖拽走同一套代码路径；WSLg 拖不了 Windows 应用 |
| 加载正式 manifest，权限由用户点弹窗授予 | Claude | 测试对象必须和发布版完全一致 |
| 用模拟引擎做 auto 步骤，真实引擎只用在 assist 步骤 | Claude | 避开人机验证，结果稳定，不依赖网络 |
| 不使用 npm 依赖，自写管道 CDP 客户端 | Claude | 和项目“不引入依赖”的约定保持一致 |
