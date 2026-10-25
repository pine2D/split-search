# Split Search

Chrome MV3 扩展：用户在地址栏搜索，或把文字拖到标签栏时，用两个自选搜索引擎打开 Chrome 拆分视图（Split view）。

- 设计文档（spec）：`docs/superpowers/specs/2026-10-23-split-search-design.md`
- 实现计划：`docs/superpowers/plans/2026-10-23-split-search-v0.1.md`

## 目标与方向

**目标（v0.1）**
- G1：地址栏输入关键词、拖拽文字到标签栏，都打开“默认组合”的原生分屏。
- G2：引擎可自定义（增删改、排序），用 URL 模板描述，`%s` 代表关键词。
- G3：可有多个组合，每个组合通过 Chrome 原生“网站搜索”绑定用户自己定的快捷字词。扩展不占用固定关键词。
- G4：设置页提供引导：生成可复制的触发网址，说明如何添加网站搜索、设为默认及副作用。
- G5：优雅降级。没装扩展或扩展没生效（同步到的其他设备、无痕窗口、扩展停用、未授权、引擎 Service Worker 接管导航）时，触发网址就是一次普通的左侧引擎搜索。

**非目标（v0.1 不做）**
- 三个及以上引擎同屏（API 不支持）。
- 无痕窗口内分屏（按 G5 降级）。
- 模式 B：默认引擎保持单一，只有拖拽才分屏。
- `chrome.omnibox` 关键词和地址栏实时联想。
- 右键菜单、快捷键、多语言、上架 Chrome 网上应用店。

**反目标（即使能用也算失败）**
- 破坏 Chrome 原生的拖拽搜索或地址栏行为，包括同步到的其他设备和无痕窗口。
- 劫持与本扩展无关的标签或新标签页。
- 使用 iframe，或修改任何网站的响应头。
- 申请 `<all_urls>` 或宽泛 host 权限、申请 `tabs` 权限，或把查询词发给用户所选引擎以外的任何一方。（`web_accessible_resources` 的 `matches` 写 `<all_urls>` 不算权限申请。）
- 未经允许覆盖用户手动建的分屏里的页面。

**路线图（方向，不承诺）**
- v0.2 多语言（en/zh_CN/zh_TW/es，页内切换，见 `docs/superpowers/specs/2026-10-24-i18n-design.md`）。
- v0.3 模式 B（可选）：默认引擎保持单一，只有拖拽才分屏。依据是原型测到的 `transitionType` 差异，需排除结果页内的链接点击，届时再验证。
- v0.3 上架 Chrome 网上应用店（已定，2026-10-24；4 种语言详情、隐私说明、截图见 `docs/store/`）。
- 无痕窗口内分屏，需要 `incognito: "split"` 并重新设计生命周期。
- 每个引擎可配置“附加 host”，应对跨 origin 跳转。
- 右键菜单“分屏搜索选中文字”；快捷键“换另一个引擎并分屏”。

## 开发与安装

1. 运行 `bash scripts/sync-to-windows.sh`，把 `src/` 同步到 `/mnt/d/APP/Chrome-Extensions/split-search`。
2. 在 Windows Chrome 中“加载未打包的扩展程序”，选 `D:\APP\Chrome-Extensions\split-search`。
3. 之后只用 `chrome://extensions` 的“重新加载”，不要移除重装，否则授权会丢失。

## 机制速览

```
地址栏 / 拖拽 / 右键“使用X搜索“…””
  → Chrome 用默认引擎或网站搜索拼出触发网址
  → DNR 动态规则在请求发出前把它重定向到 chrome-extension://<静态id>/go.html?u=<原始网址>
  → go.html 依次执行：
      1. 防重入：导航类型是 back_forward 或 reload 时，不自动分屏，只显示“重新执行”按钮
      2. 解析：取 location.search 中 "u=" 之后的全部文本作为原始网址（\0 未经编码，不能用 URLSearchParams.get('u')）
              → 用 URL + URLSearchParams 读出 _ss（可兼容 %2C）和左侧模板里 %s 所在参数的值作为关键词（+ 会自动还原为空格）
      3. 窗口检查：当前窗口不是 normal 类型（popup/app）时 → 在一个 normal 窗口里新建一对标签组成分屏；当前标签 location.replace(左侧网址)
      4. 分屏：
          ├─ 当前标签不在分屏中：tabs.create({url: 右侧, splitWithTabId: 当前, index: 当前+1, windowId, active:false})
          │                   → 然后 location.replace(左侧网址)
          ├─ 当前标签在“本扩展的分屏”中（判定见 spec 5.3）：tabs.update(另一侧, 右侧) → location.replace(左侧)
          └─ 当前标签在其他分屏中：见 spec 5.3
```

触发网址 = 左侧引擎真实搜索网址 + 标记参数 `_ss=<左id>,<右id>`，例如 `https://www.google.com/search?q=%s&_ss=google,bing`。

## 目录与职责

```
split-search/
├── CLAUDE.md                     项目约定
├── README.md                     面向用户的简介与安装（英文，默认）；README.zh-CN.md / README.zh-TW.md / README.es.md 是同结构的其他语言版，改一份四份同改，标题下的语言切换行保持一致
├── .gitignore
├── package.json                  "test": "node --test"、"e2e": "node scripts/e2e/run.mjs"、"pack": "node scripts/pack.mjs"
├── dist/                         发布 ZIP（npm run pack 生成，不进 git）
├── docs/acceptance-v0.1.md       v0.1 验收：跑 e2e（Windows 冒烟 v0.1 不做，2026-10-24 用户决定）；B/T 表注明覆盖方式
├── docs/i18n/chrome-terms.md     Chrome 术语表：各语言功能术语以此为准（由 scripts/i18n/chrome-terms.mjs 生成）
├── docs/store/                   商店详情（各语言）、隐私做法与隐私政策、图片素材规格
├── docs/_config.yml _layouts/ index.md privacy.md privacy.zh-CN.md   GitHub Pages 站点（main:/docs，Jekyll；_config.yml 的 exclude 只放行这些公开页，新增内部文档要加进 exclude）
├── assets/                       商店与 README 图片：templates/ 模板、raw/ 真实截图、store/ 与 readme/ 成品、icon-proposals/ 图标提案
├── scripts/
│   ├── gen-key.sh                打印扩展 ID；manifest 无 key 时才生成公钥写入（不保留私钥）
│   ├── pack.mjs                  发布打包：检查 → 临时目录改写 manifest（去掉 key 或换商店公钥）→ dist/ 的 ZIP
│   ├── pack-lib.mjs              打包纯逻辑：manifest 改写、发布前检查、公钥校验与扩展 ID 计算
│   ├── pack-smoke.mjs            --smoke：一次性 Chrome 配置里装 ZIP 做安装冒烟（复用 e2e 的 browser/cdp/console/fonts）
│   ├── sync-to-windows.sh        rsync src/ → D 盘镜像目录
│   ├── i18n/chrome-terms.mjs     从 Chrome 的 locales/*.pak 取各语言界面原文，生成术语表
│   ├── store/render-assets.mjs   把 assets/templates 渲染成商店与 README 图片（无头 Chrome，无依赖）
│   └── e2e/                      引导式端到端验收（Node 24，无依赖）：run.mjs 入口、cdp/browser 管道 CDP、
│                                 server.mjs 模拟引擎与向导页、runner/report、steps/*.mjs 各步骤（setup.mjs 安装/授权/Kagi 登录/收尾）、
│                                 display.mjs 嵌套显示（Xephyr/Xvfb）起停与遗留清理、fonts.mjs 测试浏览器屏蔽 9P 挂载上的字体、
│                                 settings-se/settings-kagi.mjs 网站搜索、ext-webui.mjs chrome://extensions 详情页、
│                                 ext-source.mjs 让测试配置里的扩展装自本检出的 src/
├── src/                          扩展根目录（加载这个目录）
│   ├── manifest.json
│   ├── _locales/                 界面文案：en、zh_CN（源文案）、zh_TW、es 各一份 messages.json
│   ├── icons/                    工具栏与扩展管理页图标，16/32/48/128，配色 c6 pine-fog
│   ├── background.js             SW：重建 DNR 规则、打开设置页
│   ├── go.html / go.js           触发处理页（解析、判定、出错页与“只打开左侧搜索”兜底）
│   ├── options/options.html|css  设置页静态结构、引导文字与样式
│   ├── options/options.js        设置页编排：读配置、查授权、渲染、串行写入
│   ├── options/edits.js          设置页纯逻辑：表单校验、算出写回存储的补丁
│   ├── options/engine-list.js    引擎列表、已隐藏列表、新增/编辑对话框
│   ├── options/guide.js          触发网址卡片与组合生成器
│   ├── options/ui.js             DOM 小工具、提示、复制按钮、host 权限查询与申请
│   ├── options/locale-ui.js      设置页与语言相关的界面：带内联元素的句子、语言下拉框
│   ├── lib/engines.js            预置引擎、模板校验、配置合并
│   ├── lib/trigger.js            触发网址生成与解析、模板展开
│   ├── lib/rules.js              DNR 规则构造
│   ├── lib/split-decision.js     分屏动作判定
│   ├── lib/i18n.js               语言选择、占位符替换等纯逻辑
│   ├── lib/errors.js             错误码：lib 和设置页逻辑只返回码，页面经 t("err_<code>") 显示
│   ├── chrome/i18n.js            页内文案加载器：t()，fetch 读包内 _locales，按 uiLocale 切换
│   ├── chrome/config-store.js    storage.sync 读写封装；新增顶层键 uiLocale（"auto"|"en"|"zh_CN"|"zh_TW"|"es"）
│   └── chrome/split-actions.js   分屏动作执行（tabs / windows / storage.session 薄封装）
└── test/                         node --test（每个 lib 一个文件，另有 manifest、config-store、split-actions、options-edits、options-ui；i18n.test.js、chrome-i18n.test.js、i18n-catalog.test.js（4 种语言 key 对齐与 fetch 守门）、errors.test.js、i18n-pak.test.js（Chrome 术语表脚本）、store-i18n.test.js（宣传图文案键对齐）；e2e-*.test.js 测 e2e 脚本，其中 e2e-i18n.test.js 测 I18N 步骤；pack.test.js 测发布打包）
```

纯逻辑放 `src/lib/`（不碰 `chrome.*`），`src/chrome/` 是对 `chrome.*` 的薄封装，页面脚本只负责编排。

## 硬约束（违反任一条视为缺陷）

- `manifest_version: 3`；`minimum_chrome_version: "155"`；`incognito: "not_allowed"`。
- `permissions` 只能是 `["declarativeNetRequest", "storage"]`。禁止 `tabs`，禁止必需的 `host_permissions`。
- `optional_host_permissions: ["https://*/*", "http://*/*"]`。运行时只为引擎的精确 origin（`<origin>/*`）申请。
- `web_accessible_resources: [{ "resources": ["go.html"], "matches": ["<all_urls>"], "use_dynamic_url": true }]`。
- manifest 里固定 `key`（公钥），不得修改：扩展 ID 只由它决定，改了 ID 就变，已有授权和 `storage.sync` 数据都会对不上。不保留私钥：私钥只在自签 `.crx` 时才用得上，本项目走“加载未打包的扩展程序”和 CWS 上传，都不需要。发布包里的 `key` 由 `npm run pack` 处理（去掉或换成商店公钥，见“命令”），源码里的不动。
- 无构建工具、无运行时依赖。`src/lib/` 不得引用 `chrome`。JS 单文件不超过 300 行（`test/` 下的测试文件不受此限）。
- 标记参数名为 `_ss`，值为 `<左id>,<右id>`，要兼容 `%2C`。引擎 id 必须匹配 `/^[a-z0-9-]{1,20}$/`，创建后不可修改。
- DNR 规则 id 固定为 `1`。`regexSubstitution` 写死为 `chrome-extension://<chrome.runtime.id>/go.html?u=\0`，不得使用 `runtime.getURL()`。
- 预置引擎（只写在代码里）：`google` Google `https://www.google.com/search?q=%s`；`bing` Bing `https://www.bing.com/search?q=%s`；`ddg` DuckDuckGo `https://duckduckgo.com/?q=%s`；`perplexity` Perplexity `https://www.perplexity.ai/search?q=%s`；`kagi` Kagi `https://kagi.com/search?q=%s`。默认组合为 `["google", "bing"]`。Perplexity 预置带 `leftDiscouraged: true`：它的 Service Worker（Workbox）接管所有 document 导航，DNR 的 main_frame 规则看不到，作左侧时退化为普通搜索（G5）；设置页的引擎列表、默认组合卡片和组合生成器都提示“建议只作右侧”。
- 用户界面文案一律写在 `src/_locales/<语言>/messages.json`（首期 `en`、`zh_CN`、`zh_TW`、`es`），代码和 HTML 里不得出现界面文字。页面经 `src/chrome/i18n.js` 的 `t()` 取文案（按设置页所选语言，默认跟随浏览器）；`chrome.i18n.getMessage` 只用于 manifest 的 `__MSG_…__`。`zh_CN` 是源文案，`default_locale` 是 `en`。新增或修改文案时 4 种语言的 key 必须同时补齐（`test/i18n-catalog.test.js` 检查）。唯一允许的 `fetch` 是读取扩展包内的 `_locales`。文案的术语、润色与翻译流程见“## 文案”。
- 不使用 iframe，不修改响应头。只有经过用户确认的“本扩展分屏”才允许被覆盖。
- 开发镜像目录：`/mnt/d/APP/Chrome-Extensions/split-search`。之后只用“重新加载”，不要移除后重装。

## 命令

- `npm test`：等价于 `node --test`，自动发现 `**/*.test.js`。Node 24 上不能写成 `node --test test/`（会报 MODULE_NOT_FOUND）。
- `npm run e2e`：引导式端到端验收（测试浏览器在一个独立的 Xephyr 窗口里，只在提示时需要人操作），见下节。`npm run e2e -- --auto-only` 只跑自动步骤（默认在不可见的 Xvfb 里、无人值守，xauto 照跑）；`--only B5,T7` 只跑指定步骤；`--timeout <毫秒>` 单步等待时长（默认 120000）；`--headed` 让 auto-only 改用可见的 Xephyr 窗口（退回 host 时则是不再无头）；`--no-xinput` 不用真实鼠标键盘，xauto 步骤改用人工协助版本；`--display <xephyr|xvfb|host>` 指定测试浏览器所在的显示（见下节“显示”）。
- `bash scripts/sync-to-windows.sh`：同步 `src/` 到 D 盘镜像目录。
- `bash scripts/gen-key.sh`：打印扩展 ID（`alngkkgnobglnfbhcplhpaflcgfiajnj`）。只有 manifest 里没有 `key` 时才会生成一把一次性密钥并写入公钥；已有 `key` 时绝不改动。源码始终保留这把开发公钥（开发 ID）。上架 CWS 的 ID 分层：首次上传用不带 key 的包（`npm run pack`），商店分配 ID；上传后在 CWS 后台“软件包 → 公钥”复制商店公钥，存到 git 以外的本地文件；之后的版本都用 `npm run pack -- --store-key <文件>` 打包，商店 ID 保持不变，开发版与商店版可并存。
- `npm run pack`：发布打包，生成 `dist/split-search-<版本>.zip`（`dist/` 不进 git），打印大小、sha256 和 key 情况；同一份源码打出的 ZIP 逐字节相同（时间戳取最近一次改动 `src/` 的提交）。不改动 `src/`：复制到临时目录，manifest 默认去掉 `key`；`--store-key <文件>` 改写成商店公钥（相对路径按执行命令的目录解析；PEM 或 base64，校验是 DER 编码的 RSA 公钥，打印对应扩展 ID；给的是开发公钥会中止）。发布前检查（不过即中止）：manifest 与 `package.json` 版本一致；硬约束里的 manifest 字段（版本、无痕、权限、可选 host 权限、`web_accessible_resources`）与上文一致，且没有 `host_permissions`；每种语言的 `messages.json` 能解析、有 manifest 引用的全部 `__MSG_…__`，`name` ≤75、`description` ≤132 字符；manifest 引用的图标、SW、设置页、go.html 存在；`src/` 里只有运行时文件（没有点文件、测试、`.DS_Store` 之类）；`src/` 在 git 里没有未提交改动（`--allow-dirty` 改为警告）。
- 商店信息（2026-10-25 首次提交 v0.2.0）：商店 ID `ebefmgpipceocigodihbbbhdiagmjdak`；商店公钥存在 `~/.config/split-search/cws-public-key.pem`（不进 git，丢了从 CWS 后台“软件包”页重新复制）。首次上传的包不带 key；之后每个版本都用 `npm run pack -- --store-key ~/.config/split-search/cws-public-key.pem --smoke`。
- `npm run pack -- --smoke`：打包后把 ZIP 解压到临时目录，在一次性 Chrome 配置（无头、`--disable-sync`、no-first-run、管道 CDP，参数与字体配置同 e2e 的 `launch()`）里用 `Extensions.loadUnpacked` 装上，核对：没有 manifest 错误、安装警告和运行时错误（chrome://extensions 的 `developerPrivate.getExtensionInfo`）、SW 起得来、设置页以英文渲染且没有显示成 key 的文字、DNR 动态规则 1 的 `regexSubstitution` 指向本次装出的 ID、全程没有 `[split-search]` 控制台错误、go.html 收到格式不对的 `_ss` 显示出错页；带 `--store-key` 时核对装出的 ID 等于商店 ID，不带时核对它不是开发 ID（key 确实去掉了）。临时配置和解压目录用完即删（SIGINT/SIGTERM/SIGHUP 同样清理；被强杀留下的 `split-search-smoke-*`，下次冒烟开头在 Chrome 已退出且超过 10 分钟时删掉），只关自己起的浏览器，不碰 e2e 测试配置或真实配置。

## 测试纪律

- `src/lib/` 新增逻辑先写 node 测试，再写实现。
- 涉及分屏、DNR、权限的行为，先跑 `npm run e2e`。v0.1 不做 Windows 冒烟（2026-10-24 用户决定跳过；`docs/acceptance-v0.1.md` 第 2 节保留作以后的参考）。WSL 里的 Google Chrome 155（155.0.8059.84）经 WSLg 可以验证除“从外部 Windows 应用拖入”（T3b）以外的全部项目，包括真实拖拽、地址栏、右键、授权框；涉及 Windows 环境本身的问题仍以 Windows Chrome 为准。

## 端到端验收（scripts/e2e）

- 设计：`docs/superpowers/specs/2026-10-23-e2e-and-default-pair-design.md`。步骤分 auto / xauto（真实鼠标键盘自动操作并判定，见下文 xinput）/ assist（向导指导用户操作、脚本判定）/ judge（用户点通过/不通过）。
- 目标（2026-10-24 用户决定）：整次运行除了偶尔重新登录 Kagi 不需要人。B4、B14、T8、T9 是 auto，T12 是 xauto（--auto-only 都会跑）；剩下需要人的只有首次安装（B1，一次性准备）、Kagi 登录，以及各步骤的回退路径：`--no-xinput`/xinput 不可用时 xauto 换回 assist/judge 版本；自动版本遇到测试设施问题（详情页打不开、结构认不出、找不到 Kagi 条目，错误 kind `infra`/`missing`）时，引导式运行回退到人工版本，`--auto-only` 判跳过并写明原因。
- 测试配置固定为 `~/.cache/split-search-e2e/profile`：全新、独立，`--disable-sync`、不登录 Chrome 账号；绝不读写 `~/.config/google-chrome`、`~/.chrome-debug-profile` 或任何 Windows 配置。运行前要关掉占用这个配置的 Chrome。
- 一次性准备（首次 `npm run e2e` 时由向导带着做，结果保存在测试配置里）：在 `chrome://extensions` 开发者模式下“加载未打包的扩展程序”加载仓库的 `src/`（CDP `Extensions.loadUnpacked` 单独装的是临时扩展、重启就没了，所以首次必须手动加载；这一步也验证 B1）；点一次授权框（`config.mjs` 的 `GRANT_ORIGINS`：四个模拟 host + 五个预置引擎）；需要 Kagi 的步骤前在 kagi.com 登录（只登录网站）。
- 测的是哪份代码（`ext-source.mjs`）：测试配置只能登记一个本扩展，可能装自另一个检出（主检出或别的 worktree）。每次启动后，登记路径不是本检出的 `src/` 时，先用 CDP `Extensions.loadUnpacked` 就地改装本检出的 `src/`（同一 id，授权、storage、Kagi 登录和网站搜索都保留），紧接着的 `chrome.runtime.reload()` 把这个临时装载转成持久登记，再经 `Extensions.getExtensions` 核对装载路径，不一致即中止；收尾时（恢复 storage 和网站搜索之后、关浏览器之前）用同样的办法改回运行前的目录。运行前的目录记在本检出的 `.e2e/ext-source.json`，改回后才删；没改回成的，下次从本检出运行时由收尾接着改回。所以从哪个检出运行就测哪个检出，别的检出（不论带不带这套逻辑）之后运行，测的仍是它自己。改装后 reload 抛错（loadUnpacked 已成功）时，收尾仍会再试一次改回运行前的目录并 reload。改装到 reload 完成之间约 1 秒，若此时被强制退出，扩展停在临时装载，下次启动会被 Chrome 移除；状态文件会记下这件事，启动时据此提示重新做一次性准备。
- `--auto-only` 的前提：上面的一次性准备已完成（扩展已安装、授权齐全），否则报“前置条件缺失”退出码 2。它不等 Kagi 登录：T9、T12 开头经 `kagiGate`（setup.mjs）探测一次，没登录就跳过并写明原因；引导式运行仍由向导带着登录。
- 显示（设计 `docs/superpowers/specs/2026-10-24-e2e-nested-display-design.md`，代码 `display.mjs`）：`--display <xephyr|xvfb|host>` 决定测试 Chrome 跑在哪个 X 服务器上。测试配置、登录态、授权在三种显示下通用。
  - `xephyr`：嵌套的独立可见窗口（标题 `e2e 测试显示 :N`），屏幕 2400×1500，即 CSS 1600×1000 乘以包装脚本固定的 1.5 倍缩放。它的指针和键盘与用户桌面分开，自动步骤和需要用户操作的步骤都在这个窗口里进行。引导式运行（`npm run e2e`）和 `--auto-only --headed` 默认用它。
  - `xvfb`：不可见的嵌套服务器，屏幕同样 2400×1500。`--auto-only`（不加 `--headed`）默认用它，完全无人值守。Chrome 在这里带界面（不再无头），xauto 照跑。xvfb 只适合 `--auto-only`：引导式运行用 xvfb 时整个显示不可见，需要用户操作的 assist 步骤做不了，只能跳过或等到超时（代码没有拦这种组合）。
  - `host`：原来的行为，直接用 WSLg 的 :0，保留作对照。引导式运行带界面；`--auto-only` 不加 `--headed` 时无头，不跑 xauto。
  - 默认值与退回：显式给了 `--display` 就用它；否则 `--auto-only` 且不加 `--headed` 用 xvfb，其余用 xephyr。选中的嵌套服务器不可用时退回 host，不判失败：PATH 里没有 `Xephyr`/`Xvfb`；Xephyr 还要求有宿主 DISPLAY；服务器起不来（启动后立即退出、10 秒内 `xdpyinfo -display :N` 连不上、:90–:119 都被占用）。原因打印在终端，并写进报告头和备注。退回后完全按 host 模式运行，包括无头规则和下面 host 的光标规则。
  - 外部命令：在 xinput 用到的 `xdotool`、`import`、`xdpyinfo`、`xwininfo`、`xprop` 之外，嵌套显示还用 `Xephyr`、`Xvfb`（spawn，不经 shell），并用 `xdpyinfo -display :N` 等服务器就绪。
  - 生命周期：run.mjs 先查配置锁（配置被占用时，可能有另一次运行在跑，直接退出，不清理），再清理遗留、选模式、起服务器，都在启动 Chrome 和检测 xinput 之前。嵌套模式下把 `process.env.DISPLAY` 指向嵌套显示号，Chrome、xdotool、import、xwininfo、xdpyinfo 都继承它，所以输入和截图只会落到嵌套显示上，绝不打到 :0。显示号从 :90 起，跳过已有 `/tmp/.X11-unix/X<n>` 或 `/tmp/.X<n>-lock` 的号。服务器以 detached 方式启动；收尾（含中断、出错）在浏览器关掉之后停掉它（先 SIGTERM，3 秒不退再 SIGKILL）；第二次 Ctrl+C 走同步路径，直接发 SIGTERM 并删 pid 文件。
  - pid 文件：`.e2e/display.pid`，内容是 `{ pid, display, mode }`，服务器停掉后删除。下次启动先按它清理遗留实例，以下条件全部满足才杀：pid 文件合法，记录的显示号不是 :0；进程还在；`/proc/<pid>/comm` 是记录模式对应的 `Xephyr`/`Xvfb`；命令行里有记录的显示号。任一不满足只删 pid 文件。只杀本次或上次运行自己起的服务器，绝不碰 :0 或别人起的显示。
  - 报告头写 `- 显示：xvfb :90（2400x1500）`、`xephyr :N（2400x1500）` 或 `host :0`；退回时写成 `host :0（退回 host：<原因>）`。
  - 剪贴板：Windows 剪贴板和 Xephyr 不通。assist 回退路径要复制的网址（触发网址、`&_ss=kagi,bing` 等），从 Xephyr 窗口内向导页的“复制”按钮复制，再在窗口里粘贴；不要从 Windows 侧复制后往窗口里粘。如果 WSL 的 localhost 转发可用，用户也可以在自己的浏览器里打开 `http://127.0.0.1:8765/guide` 只看进度（未实测；server 只监听 WSL 内的 127.0.0.1）；复制网址仍然要用 Xephyr 窗口里的向导页。
  - 嵌套显示里不装窗口管理器：Chrome 顶层窗口直接是根窗口的子窗口；`getactivewindow` 报错（没有 `_NET_ACTIVE_WINDOW`），焦点改用 `getwindowfocus`；`xwininfo -root -children` 照常可用。
- 向导页 `http://127.0.0.1:8765/guide`（端口固定，改端口要重新授权）。`chrome://settings` 扩展 API 写不了，但 CDP 可以：attach 到 `chrome://settings/searchEngines` 页面目标，经 WebUI 的 shadow DOM 点击、给 `cr-input` 赋值并派发 `input` 事件就能添加网站搜索、设默认、删除（实测可行，细节见 spike-xdotool.md §1.6）。xauto 步骤用这条路自动管理 `sse2e` 专用条目（`settings-se.mjs`，见下一条）；只有 assist 回退路径（无真实输入）里，向导仍给出可复制的网址和步骤让用户手动添加。回退路径里用户加的网站搜索（gb/bg/dg/px/kg），以及 T12 给 Kagi 条目追加的 `_ss`，只存在于隔离的测试配置里，收尾**不要求恢复**，保留供下次运行复用；默认引擎：脚本改过默认（sse2e 条目，或 xauto 的 T12 把 Kagi 条目设为默认）时，收尾的 `settings-se.restore` 恢复为运行前的默认；人工回退路径里用户自己设的默认保留；只有 T8(d) 在人工回退路径里改过“有权访问的网站”才提示改回。T8(a) 的人工回退让用户在无痕窗口粘贴触发网址，不依赖 gb（xauto 的 T1 不建 gb，全新配置里可能没有它）。
- xinput 真实输入（设计 `docs/superpowers/specs/2026-10-23-e2e-xinput-design.md`，代码 `xinput.mjs`、`gesture*.mjs`、`steps/xauto*.mjs`）：可用时默认开启，T1、T2、T3、T4、T5-DRAG、T6-NTP、T11、T12、T14 以 xauto 步骤用 XTEST 真实鼠标键盘执行并自动判定；`--no-xinput` 或不可用时换回对应的 assist/judge 版本，不算失败。可用 = DISPLAY 存在、`xdotool`、`import`、`xdpyinfo`、`xwininfo` 可执行（`xprop` 可选，只作叠放顺序的后备来源）、`xdpyinfo -queryExtensions` 含 XTEST、非 headless。嵌套模式下 DISPLAY 指向嵌套显示号，Chrome 总是带界面，所以 `--auto-only` 在 Xvfb 上就跑 xauto；只有 host 模式的 `--auto-only` 要加 `--headed` 才跑 xauto。`gx.nested` 在 host 模式下是 `false`，嵌套模式下是模式名 `"xephyr"` 或 `"xvfb"`，手势层和提示文案按它分支。
  - 光标规则按显示分开：
    - 嵌套模式（xephyr、xvfb）：嵌套服务器的指针不是用户的光标。脚本不读用户光标、不等待、不出提示，自己用 `getwindowgeometry` 读测试窗口位置（没有窗口管理器就没有装饰，Position 可信），把指针移到窗口中心并读回；读回不在测试窗口上就判 env，不按下。xvfb 下用户什么都不用管。xephyr 下用户只要别把光标停在 Xephyr 窗口上：光标在窗口上移动时，Xephyr 会把真实移动转发进嵌套显示。所以静止采样、“move 后读回不符 → 中止（env）”、“两次读回不符落在同一点”这几道防护都保留，同一点时的原因写成“指针被用户光标带走（请把光标移出测试窗口 Xephyr）”。xvfb 下两次落在同一点，原因写成“不是你的光标造成的，多半是坐标在屏幕外”，不叫用户做任何事。xauto 开始卡片同样按模式写：xephyr 写“自动操作中，请不要把光标停在 Xephyr 窗口上”，xvfb 写可以照常使用电脑。
    - host 模式：WSLg 下 XWayland 的指针焦点跟着真实的 Windows 光标走，真实鼠标只要有物理移动（手搭在鼠标上、触摸板误触），X 指针就被同步回真实光标位置。所以 xauto 期间真实光标必须停在测试窗口上**并且**手离开鼠标。移动前先读指针：在根窗口上 → 向导提示，最多等 30 秒，仍不在 → skip“光标不在测试窗口上”（绝不移动真实光标去“找”窗口）；手势前静止采样确认用户没在动鼠标；move 后读回不符 → 中止（env），10 分钟内两次读回不符都落在同一点（±3px，可以跨尝试）→ 单独原因“指针被拉回真实光标位置（请把手从鼠标/触摸板上拿开）”并在向导页提示。
  - 防误触：每次 down/up/按键前断言目标窗口（测试窗口 id 在手势前按页面标题 token 取好，手势中不再找）；拖拽中指针下可以是测试 Chrome 自己的 XDND 拖拽图像窗口（按下后才出现、同一 X 客户端或 pid、大小与选区相符）；松开前还要核对没有冒出别的应用的新窗口、前台没换成别的应用、`xwininfo -root -children` 的叠放顺序里没有别的应用被提到测试窗口上面并盖住落点（WSLg 没有 `_NET_CLIENT_LIST_STACKING`；读不出叠放顺序就不按下）；任一不满足 → 回到拖拽起点按同样规则核对后松开（取消拖拽），起点也不行 → stuck：停掉剩余 xauto 步骤、向导请用户在测试窗口里点一下；第二次 Ctrl+C 同步尽力松开；浏览器关掉后只有指针停在根窗口上才补发 mouseup（嵌套模式下按着的键只在嵌套显示里，随服务器一起停止，不影响用户桌面）。拖拽节奏：host 模式不变（按下后停 150ms，越过阈值每步 30ms）；嵌套模式用 `NESTED_DRAG`：按下后停 300ms，每步 60–100ms 随机，松开前停 800ms。这是 Xephyr 上实测的值，快节奏有一次没能开始拖拽。键盘手势只在 `Target.createTarget({newWindow:true})` 新开、经断言拿到前台的窗口里做，每个字符前都再断言一次。host 模式用 `getactivewindow` 断言（WSLg 下键盘只送给 X 焦点窗口，焦点只跟 Windows 前台走，`windowactivate` 无效）。嵌套模式没有 EWMH：只有 `getactivewindow` 报 `_NET_ACTIVE_WINDOW` 不支持时才改用 `getwindowfocus`，其他报错仍判 env；新窗口出现 500ms 后焦点还没过去，就在页面中心点一下（点之前断言指针在新窗口上，只点一次），之后仍拿不到焦点就关掉新窗口、判 env，不按任何键；xauto 只用 ASCII 关键词。失败每次完整重建现场，最多 3 次；任何一次真实失败（非环境原因）之后，再出现跳过、环境失败或预期降级都不能把它吞掉，该步判失败；之后某次尝试通过仍判通过，detail 写明之前的失败（作为不稳定信号）；没有真实失败时 T14 最终判为预期降级就按预期降级记。
  - 网站搜索：xauto 用 `sse2e`（模拟引擎 A ｜ B）与 `sse2e-<引擎 id>`（T14）专用条目，经 CDP 操作 `chrome://settings/searchEngines` 自动添加、设默认；改动前快照到 `.e2e/settings-snapshot.json`（只记默认引擎的 keyword/name、专用快捷字词和 `scriptDefaults`，不记网址），结束（含中断）删除专用条目，只在本次改过默认引擎时才改回；遗留快照下次启动先恢复。不动用户的其他条目，唯一例外是 T12（`settings-kagi.mjs`）：Chrome 自动发现的 Kagi 条目（快捷字词 `kagi.com`、网址 host 为 kagi.com）——在页面里给它的网址追加或改写 `_ss=kagi,bing`（网址带 Kagi 私有 token，读取和改写都在 chrome://settings 页面内完成，不传回 Node），并设为默认；设默认前把它记进快照的 `scriptDefaults`，收尾当前默认是它（且不是运行前的默认）时同样改回，之后 T14 把默认切到专用条目时也不会把它当成“要恢复的默认”。找不到这个条目（或它在“未使用的快捷字词”里）时 `--auto-only` 跳过，引导式运行回退到人工 T12。T12 用真实键盘在地址栏 (a) 直接输入、(b) 输入 `kagi.com 关键词` 进入快捷字词模式，都要 Kagi ｜ Bing 分屏；回车前截地址栏下拉框存 `.e2e/t12-suggest-default.png`、`t12-suggest-keyword.png`（嵌套显示截整屏；host 模式只截测试窗口、不截 :0 整屏，下拉框是单独的弹出窗口，截图里多半没有它；只供参考，联想有无不判通过/失败）。
  - 窗口：只有选中了 xauto 步骤时才把测试窗口固定为 normal 1600×1000（每个 xauto 尝试前再核对），没有 xauto 步骤时不动窗口尺寸。坐标一律由 CDP 页面坐标换算（`(screenX + outerWidth − innerWidth + clientX)·dpr`），不用 `getwindowgeometry` 的 Position（它把窗口装饰算进去）；例外有两个：一是右键菜单这种 override-redirect 窗口（没有装饰，Position 可信），点击前还要核对指针确实在菜单上、离右键点不超过 80px；二是嵌套模式的指针归位，用测试窗口的 Position 算中心（没有窗口管理器，没有装饰），之后靠读回断言把关。
  - 预期降级：T14 某引擎作左侧时，触发前就读到该 origin 的 SW、没分屏、左侧停在该引擎上并带着查询词（网址或标题带查询词，或该标签自己的主框架跳转链经过触发网址——Perplexity 的 SPA 会改写网址），并且没有扩展接管过这次触发的反证（任何跳转链里出现带本次查询词的 `go.html?u=`、触发后新增扩展控制台错误、新出现不在分屏里的 Google 标签——go.js 分屏失败时 `location.replace(左侧)` 的结果和普通搜索长得一样，靠这些区分；没有控制台收集器时不判降级），记 `degrade`（预期降级）：单独计数、不算失败、退出码 0；没检测到 SW 仍是失败。多子项步骤里跳过/预期降级的子项，步骤整体通过或预期降级时写在说明第一行；无论步骤结果如何，都列进报告“未覆盖”小节。
- I18N（`steps/i18n.mjs`，auto，`--auto-only` 会跑）：en、zh_CN、zh_TW、es 逐一打开设置页和 go.html 出错页，核对 `lang`、没有显示成 key 的文字、没有横向和按钮内容溢出；再测页内切换（不刷新、2 秒内）、连切 en → zh_TW 停在最后一次、第二个设置页跟随，以及 `uiLocale = "auto"` 时 `t()` 与 `chrome.i18n.getMessage` 逐 key 相同。它会改写 `storage.sync` 的 `uiLocale`，用 `guarded` 写回步骤前的值（中断时由 storage 快照兜底）。截图存 `.e2e/i18n/<locale>-options.png`、`<locale>-go-error.png`。
- 运行前快照 `chrome.storage.sync` 到 `.e2e/storage-snapshot.json`，结束（含中断）后恢复；遗留快照下次启动先恢复。报告在 `.e2e/report-*.md|json`，网址里的 token/session/sid/auth/key/code、access_token 等 `*_token`、session_id/sessionid、`google_abuse` 等 `*_abuse` 与含 exemption 的参数值（含一次、两次百分号编码嵌套在 next=、r=、continue= 里的），以及单独出现的 `…ABUSE_EXEMPTION=…`（含用户 IP）、Google 人机验证页 `/sorry/…` 的 `q`（编码了访问者 IP 的令牌）脱敏为 `***`，终端与向导页同样。失败诊断除扩展读到的标签外，还列出 CDP 页面目标网址（扩展读不到的标签按窗口与网址对应）和步骤页面的主框架跳转链（控制台收集器在页面会话上 Network.enable 记录，没有时用 Page.getNavigationHistory）。左侧 Google 停在人机验证页（/sorry，`continue` 解码后是期望的搜索）算分屏已建成（`steps/captcha.mjs`）；脚本自己准备现场的等待，“重试”都会重新准备并重新记下判定用的 id。B4、T8 之后脚本自动核对扩展已启用、授权齐全（扩展不可用先经 chrome://extensions 详情页自动启用，缺授权自动重新申请），恢复不了就跳过剩余步骤（`--auto-only` 不请用户启用扩展）。Kagi 登录检查打开 `https://kagi.com/settings`，只有最终停在 kagi.com/settings 才算已登录；用户登录期间只读现有标签的网址、不再发起导航（未登录时那条跳转链会重写会话 cookie，可能打断登录），用户点“我已完成”后再探测一次。
- 授权框与扩展管理页（2026-10-24 在 Xvfb 上实测）：
  - `chrome.permissions.remove` 撤销的可选 host 权限只是从“生效中”拿掉，仍留在配置的“已授予”记录里；再 `permissions.request` 同样的 origin，Chrome 直接批准、不弹框（实测 12 ms）。一次性授权检查保证这些 origin 运行前都生效，所以 B4、T8(c)(e) 的恢复、步骤后的恢复检查都不需要点授权框。`requestGrant`（guided.mjs）只申请一次，从独占一个新窗口的设置页发起；15 秒内没批准才说明弹了原生框：`--auto-only` 关掉这个窗口（对话框随之关闭）、返回 false；引导式运行换成“请点允许”的说明，继续等同一个对话框（不关掉重弹，开头的说明也已写明“万一弹框请点允许”），中断时同样关掉窗口。
  - 真正弹框时（从没授予过的 origin），授权框画在浏览器窗口内部，不是单独的 X 窗口，CDP 也看不到；初始焦点在“拒绝”，Tab 一次到“允许”，Escape = 拒绝。内容读不到、焦点位置是实现细节，**不做原生对话框点击器**。授权框挂在浏览器窗口上、不是标签上：只关掉发起申请的设置页标签，对话框还留在那个窗口里（请求也不结算）；关掉它所在的窗口，对话框才随之消失。所以 `requestGrant` 和 B4 的设置页都开在单独的新窗口里（`openOptions(browser, { newWindow: true })`）。
  - B4（`steps/b4.mjs`）：在设置页里包一层 `chrome.permissions.request` 记录调用，用 CDP `Input.dispatchMouseEvent`（可信事件，带用户激活，headless 也可用）点横幅按钮，断言恰好一次申请且同时含 www.google.com 与 www.bing.com、授权生效、横幅消失。
  - chrome://extensions 详情页（`ext-webui.mjs`）：后台新窗口打开 `chrome://extensions/?id=<扩展>`，shadow DOM 里 `extensions-detail-view` 的 `#enableToggle` 点一下即停用/启用，读回 `data.state`（`DISABLED`/`ENABLED`）；重新启用点开关不生效时用页面里的 `chrome.management.setEnabled` 兜底。T8(b) 在 finally 里一定重新启用，再等扩展页能执行脚本。停用期间只读 CDP 目标（扩展的页面和 SW 目标应随停用消失），不新开扩展页（停用时新开的扩展页要等满 10 秒才知道不可用），整段可被中断：中断后立刻进 finally 重新启用、不再等扩展页，停用窗口约 5 秒，落在运行器的收尾期限（15 秒）以内。兜底还有两道：收尾（`teardown.mjs` 的 `reenableStep`，开始过 B4/T8 且扩展不可用时，先经详情页启用再恢复 storage）和下次启动（`ext.ensureExtensionUp`：扩展已登记但设置页打不开，稍等重试仍不行就经详情页启用；第二次 Ctrl+C 强制退出留下的停用状态靠它）。“已登记”按扩展 id 读测试配置的 Preferences，不论装自哪个目录（启动时可能还登记在别的检出的 `src/`，随后才改装本检出，见上文“测的是哪份代码”）。T8(a) 先读详情页的 `data.incognitoAccess`：“在无痕模式下启用”打开了就判失败（测的不是用户看到的行为），读不到只在说明里注明。本扩展只有可选 host 权限，“有权访问的网站”渲染成逐站开关列表（`extensions-host-permissions-toggle-list`），没有带“点击时”的下拉（`extensions-runtime-host-permissions`），T8(d) 据此自动记“不适用”（跳过）。
  - T8(a)：`Target.createBrowserContext` 建的是 off-the-record（无痕）上下文，扩展（`incognito: "not_allowed"`）不在里面运行；在新窗口里打开模拟触发网址，断言网址原样（带 `_ss`）、`Page.getNavigationHistory` 里没有 go.html、没有右侧引擎页面，最后 `disposeBrowserContext`。
  - B14（`steps/b14.mjs`）：`Emulation.setEmulatedMedia` 依次模拟 dark、light，期望值从页面样式表源码里读（body 引用的颜色变量在 `:root` 与 `@media (prefers-color-scheme: dark)` 里的取值），经探针元素换算成计算值后与 body 的背景色、文字色比较；深色截图存 `.e2e/b14-options-dark.png`、`b14-guide-dark.png`。`--auto-only` 不打开向导页，B14 自己开一个、用完关掉（`focusGuide` 在 auto-only 下不新开向导页）。
- 已知事实：扩展 SW 空闲约 30 秒就被回收，扩展 API 一律在扩展页（设置页）里经 CDP 执行（`browser.evalExt`），不要 attach SW；控制台收集器 attach 了 SW，调试会话让它一直存活，所以 e2e 测不到 SW 回收后冷启动的问题（靠 Windows 冒烟或手测）；必须直接 spawn `/opt/google/chrome/google-chrome`，`~/.local/bin/google-chrome` 包装脚本会 nohup 后台化、破坏调试管道；启动参数不得含 `--enable-automation`；正式版 Chrome 忽略 `--load-extension`。
- 已知事实：WSL 的 `/etc/fonts/local.conf` 把 `/mnt/c/Windows/Fonts`（9P）列为字体目录时，Chrome 浏览器进程匹配字体要对候选字体文件逐个 `access()`（每次一趟 9P 往返），渲染进程主线程在同步字体请求上等它，期间该页的 CDP `Runtime.evaluate` 全部没有回复（平时约 2 秒，Windows 侧忙时十几秒以上，表现为启动时“Runtime.evaluate 超时”、设置页“没有加载出来”）。所以 `launch()` 经 `FONTCONFIG_FILE` 给测试浏览器一份生成的配置（`~/.cache/split-search-e2e/fonts.conf`：include 原配置 + `rejectfont` 排除所有 9p/drvfs 挂载点下的字体），不改系统配置；测试浏览器里只有 Linux 侧字体（中文用 Noto Sans CJK）。复现：并行跑几个只读的 `find /mnt/c/Windows/System32 /mnt/c/Windows/WinSxS -maxdepth 3` 让 9P 变慢，修复前 `--only B5` 12 次失败 10 次，修复后 37 次全过。

## 文案

适用于所有面向用户的文字：扩展界面（设置页、go.html 出错页）、README、商店详情与隐私政策（`docs/store/`）、宣传图文字（`assets/templates/i18n/*.json`）。v0.2 起支持 en、zh_CN、zh_TW、es（见 `docs/superpowers/specs/2026-10-24-i18n-design.md`），之前界面仍只有简体中文。

- 隐私政策有任何改动，`docs/privacy.md`、`docs/privacy.zh-CN.md`（GitHub Pages 托管副本）必须与 `docs/store/privacy.md` (f) 一起改。
- 术语用 Chrome 官方界面在该语言里的叫法（拆分视图/Split view、地址栏、标签栏、网站搜索、设为默认等），从 `/opt/google/chrome/locales/<语言>.pak` 或 Chrome 官方帮助页核实，不自造译名。
- 产品名所有语言都是 `Split Search`，不翻译、不加本地副标题。
- 写给真实用户看：只讲用户关心的关键点（能做什么、怎么设置、有什么限制、隐私），短句、精炼；不解释实现原理和设计取舍，不加“部分截图里的 X 就是这样来的”之类旁白。细节留给设置页的逐步说明和内部文档（2026-10-24 用户要求，商店详情、README 同样适用）。
- 每种语言按本语言的习惯写，去掉翻译腔和 AI 味，分别过一遍：
  - zh_CN：lieflat-less-ai-tone + humanizer-zh；
  - zh_TW：humanizer-zh，再按台湾用语审校（不得有简体字和大陆用语）；
  - en：humanizer；
  - es：content-l10n 做本地化质检（翻译腔、机器腔），再按母语标准审校（中性国际西语，用 tú）。
- 顺序：中文源文案先润色定稿 → 各语言按市场转写（不逐字直译）→ 每种语言单独润色一轮。改了中文源文案，其他语言跟着重做这一流程。
- 宣传图文字改完要重新出图（`node scripts/store/render-assets.mjs --locale <语言>`，`all` 为全部），渲染器会报出溢出和超行。目前只维护 `en` 的商店截图（2026-10-24 用户决定）：其他语言的图可以重渲，但不上传，`assets/store/zh_TW|es`、`assets/readme/es` 停在旧模板文案上属于有意为之（见 `docs/store/assets-spec.md` 第 4 节）。

## 提交

使用 git-commit skill（Conventional Commits）。仓库没有 git 身份配置时，用内联身份：`git -c user.name=pine2D -c user.email=oumu323@gmail.com commit`。

## 已知事实（spec 2.2 核查结论，避免重复踩坑）

- DNR `redirect` 只要求请求网址的 host 权限，可通过 `optional_host_permissions` 运行时授予；main_frame 导航不检查 initiator 权限。`regexSubstitution` 可指向 `chrome-extension://`，`\0` 代表整个匹配串。
- 有某 origin 的 host 权限但没有 `tabs` 权限时，可读到该 origin 上标签的 `url`；`tabs.query({splitViewId})` 不需要 `tabs` 权限。
- `incognito: "not_allowed"` 合法，DNR 规则不作用于无痕窗口。若改用 `spanning` 并允许无痕，重定向到扩展页会以 `ERR_BLOCKED_BY_CLIENT` 失败，用户看到错误页而不是降级为普通搜索。
- `use_dynamic_url: true` 下 DNR 重定向仍可用（Chrome 把静态 id 网址改写为 GUID 网址，再 307 回静态 id，query 完整保留，M146 修复）。
- Chrome 网站搜索展开 `%s`：在 query 中时空格编为 `+`；在 path 中用 EscapePath，空格编为 `%20`，`/ & + =` 保持原样；多次出现全部替换；`%S`（大写）表示不转义。Chrome 不给用户自建网站搜索追加任何参数，也不预取。
- Google 忽略未知参数 `_ss`。Kagi 访客状态结果正常，但会在客户端把逗号编成 `%2C`；经 Turnstile 跳转时参数名可能变成 `amp;_ss`。登录状态下表现待 T9 实测。
- `tabs.create({splitWithTabId})`：源标签是固定标签或在标签组中时，新标签自动继承固定状态和标签组。在 popup/app 类型窗口里调用，按源码推断可能触发 CHECK 崩溃，必须提前拦住，不调用。
- go.html 里 `history.back()` 能回到被 DNR 重定向之前的页面。不要用 `navigation.canGoBack` 判断能否后退，它在扩展页上恒为 false。关闭分屏中的一侧后，另一侧自动解除分屏。
- API 版本：`tabs.create({splitWithTabId})`、`tabs.createSplit`、`tabs.unsplit` 需 Chrome 155+；`Tab.splitViewId`、`tabs.query({splitViewId})` 需 140+。一个分屏只能放两个标签。
