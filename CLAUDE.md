# Split Search

Chrome MV3 扩展：用户在地址栏搜索，或把文字拖到标签栏时，用两个自选搜索引擎打开 Chrome 原生分屏（Split View）。

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
- v0.2 模式 B（可选）：默认引擎保持单一，只有拖拽才分屏。依据是原型测到的 `transitionType` 差异，需排除结果页内的链接点击，届时再验证。
- 无痕窗口内分屏，需要 `incognito: "split"` 并重新设计生命周期。
- 每个引擎可配置“附加 host”，应对跨 origin 跳转。
- 右键菜单“分屏搜索选中文字”；快捷键“换另一个引擎并分屏”。
- 上架 Chrome 网上应用店，需要隐私说明和截图。

## 开发与安装

1. 运行 `bash scripts/sync-to-windows.sh`，把 `src/` 同步到 `/mnt/d/APP/Chrome-Extensions/split-search`。
2. 在 Windows Chrome 中“加载已解压的扩展程序”，选 `D:\APP\Chrome-Extensions\split-search`。
3. 之后只用 `chrome://extensions` 的“重新加载”，不要移除重装，否则授权会丢失。

## 机制速览

```
地址栏 / 拖拽 / 右键“在 X 中搜索”
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
├── README.md                     面向用户的简介与安装
├── .gitignore
├── package.json                  "test": "node --test"、"e2e": "node scripts/e2e/run.mjs"
├── docs/acceptance-v0.1.md       v0.1 验收：先跑 e2e，再做 Windows 冒烟；B/T 表注明覆盖方式
├── scripts/
│   ├── gen-key.sh                打印扩展 ID；manifest 无 key 时才生成公钥写入（不保留私钥）
│   ├── sync-to-windows.sh        rsync src/ → D 盘镜像目录
│   └── e2e/                      引导式端到端验收（Node 24，无依赖）：run.mjs 入口、cdp/browser 管道 CDP、
│                                 server.mjs 模拟引擎与向导页、runner/report、steps/*.mjs 各步骤（setup.mjs 安装/授权/Kagi 登录/收尾）、
│                                 display.mjs 嵌套显示（Xephyr/Xvfb）起停与遗留清理
├── src/                          扩展根目录（加载这个目录）
│   ├── manifest.json
│   ├── background.js             SW：重建 DNR 规则、打开设置页
│   ├── go.html / go.js           触发处理页（解析、判定、出错页与“只打开左侧搜索”兜底）
│   ├── options/options.html|css  设置页静态结构、引导文字与样式
│   ├── options/options.js        设置页编排：读配置、查授权、渲染、串行写入
│   ├── options/edits.js          设置页纯逻辑：表单校验、算出写回存储的补丁
│   ├── options/engine-list.js    引擎列表、已隐藏列表、新增/编辑对话框
│   ├── options/guide.js          触发网址卡片与组合生成器
│   ├── options/ui.js             DOM 小工具、提示、复制按钮、host 权限查询与申请
│   ├── lib/engines.js            预置引擎、模板校验、配置合并
│   ├── lib/trigger.js            触发网址生成与解析、模板展开
│   ├── lib/rules.js              DNR 规则构造
│   ├── lib/split-decision.js     分屏动作判定
│   ├── chrome/config-store.js    storage.sync 读写封装
│   └── chrome/split-actions.js   分屏动作执行（tabs / windows / storage.session 薄封装）
└── test/                         node --test（每个 lib 一个文件，另有 manifest、config-store、split-actions、options-edits、options-ui；e2e-*.test.js 测 e2e 脚本）
```

纯逻辑放 `src/lib/`（不碰 `chrome.*`），`src/chrome/` 是对 `chrome.*` 的薄封装，页面脚本只负责编排。

## 硬约束（违反任一条视为缺陷）

- `manifest_version: 3`；`minimum_chrome_version: "155"`；`incognito: "not_allowed"`。
- `permissions` 只能是 `["declarativeNetRequest", "storage"]`。禁止 `tabs`，禁止必需的 `host_permissions`。
- `optional_host_permissions: ["https://*/*", "http://*/*"]`。运行时只为引擎的精确 origin（`<origin>/*`）申请。
- `web_accessible_resources: [{ "resources": ["go.html"], "matches": ["<all_urls>"], "use_dynamic_url": true }]`。
- manifest 里固定 `key`（公钥），不得修改：扩展 ID 只由它决定，改了 ID 就变，已有授权和 `storage.sync` 数据都会对不上。不保留私钥：私钥只在自签 `.crx` 时才用得上，本项目走“加载已解压”和 CWS 上传，都不需要。
- 无构建工具、无运行时依赖。`src/lib/` 不得引用 `chrome`。JS 单文件不超过 300 行。
- 标记参数名为 `_ss`，值为 `<左id>,<右id>`，要兼容 `%2C`。引擎 id 必须匹配 `/^[a-z0-9-]{1,20}$/`，创建后不可修改。
- DNR 规则 id 固定为 `1`。`regexSubstitution` 写死为 `chrome-extension://<chrome.runtime.id>/go.html?u=\0`，不得使用 `runtime.getURL()`。
- 预置引擎（只写在代码里）：`google` Google `https://www.google.com/search?q=%s`；`bing` Bing `https://www.bing.com/search?q=%s`；`ddg` DuckDuckGo `https://duckduckgo.com/?q=%s`；`perplexity` Perplexity `https://www.perplexity.ai/search?q=%s`；`kagi` Kagi `https://kagi.com/search?q=%s`。默认组合为 `["google", "bing"]`。Perplexity 预置带 `leftDiscouraged: true`：它的 Service Worker（Workbox）接管所有 document 导航，DNR 的 main_frame 规则看不到，作左侧时退化为普通搜索（G5）；设置页的引擎列表、默认组合卡片和组合生成器都提示“建议只作右侧”。
- 用户界面文案一律使用简体中文。
- 不使用 iframe，不修改响应头。只有经过用户确认的“本扩展分屏”才允许被覆盖。
- 开发镜像目录：`/mnt/d/APP/Chrome-Extensions/split-search`。之后只用“重新加载”，不要移除后重装。

## 命令

- `npm test`：等价于 `node --test`，自动发现 `**/*.test.js`。Node 24 上不能写成 `node --test test/`（会报 MODULE_NOT_FOUND）。
- `npm run e2e`：引导式端到端验收（测试浏览器在一个独立的 Xephyr 窗口里，只在提示时需要人操作），见下节。`npm run e2e -- --auto-only` 只跑自动步骤（默认在不可见的 Xvfb 里、无人值守，xauto 照跑）；`--only B5,T7` 只跑指定步骤；`--timeout <毫秒>` 单步等待时长（默认 120000）；`--headed` 让 auto-only 改用可见的 Xephyr 窗口（退回 host 时则是不再无头）；`--no-xinput` 不用真实鼠标键盘，xauto 步骤改用人工协助版本；`--display <xephyr|xvfb|host>` 指定测试浏览器所在的显示（见下节“显示”）。
- `bash scripts/sync-to-windows.sh`：同步 `src/` 到 D 盘镜像目录。
- `bash scripts/gen-key.sh`：打印扩展 ID（`alngkkgnobglnfbhcplhpaflcgfiajnj`）。只有 manifest 里没有 `key` 时才会生成一把一次性密钥并写入公钥；已有 `key` 时绝不改动。将来上架 CWS 时，商店用自己的密钥签名并分配商店 ID；如果要让开发版和商店版并存，参照 `~/projects/Pinboard-Bookmark-Enhanced/CLAUDE.md` 的“扩展 ID 分层”：源码保留开发公钥，打发布 ZIP 时再换成 CWS 后台给出的公钥。

## 测试纪律

- `src/lib/` 新增逻辑先写 node 测试，再写实现。
- 涉及分屏、DNR、权限的行为，先跑 `npm run e2e`，再按 `docs/acceptance-v0.1.md` 第 2 节做 Windows 冒烟。WSL 里的 Google Chrome 155（155.0.8059.84）经 WSLg 可以验证除“从外部 Windows 应用拖入”（T3b）以外的全部项目，包括真实拖拽、地址栏、右键、授权框；涉及 Windows 环境本身的问题仍以 Windows Chrome 为准。

## 端到端验收（scripts/e2e）

- 设计：`docs/superpowers/specs/2026-10-23-e2e-and-default-pair-design.md`。步骤分 auto / xauto（真实鼠标键盘自动操作并判定，见下文 xinput）/ assist（向导指导用户操作、脚本判定）/ judge（用户点通过/不通过）。
- 测试配置固定为 `~/.cache/split-search-e2e/profile`：全新、独立，`--disable-sync`、不登录 Chrome 账号；绝不读写 `~/.config/google-chrome`、`~/.chrome-debug-profile` 或任何 Windows 配置。运行前要关掉占用这个配置的 Chrome。
- 一次性准备（首次 `npm run e2e` 时由向导带着做，结果保存在测试配置里）：在 `chrome://extensions` 开发者模式下“加载已解压”仓库的 `src/`（CDP `Extensions.loadUnpacked` 的扩展重启就没了，所以必须手动加载；这一步也验证 B1）；点一次授权框（`config.mjs` 的 `GRANT_ORIGINS`：四个模拟 host + 五个预置引擎）；需要 Kagi 的步骤前在 kagi.com 登录（只登录网站）。
- `--auto-only` 的前提：上面的一次性准备已完成（扩展已安装、授权齐全），否则报“前置条件缺失”退出码 2。它不需要 Kagi 登录。
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
- 向导页 `http://127.0.0.1:8765/guide`（端口固定，改端口要重新授权）。`chrome://settings` 扩展 API 写不了，但 CDP 可以：attach 到 `chrome://settings/searchEngines` 页面目标，经 WebUI 的 shadow DOM 点击、给 `cr-input` 赋值并派发 `input` 事件就能添加网站搜索、设默认、删除（实测可行，细节见 spike-xdotool.md §1.6）。xauto 步骤用这条路自动管理 `sse2e` 专用条目（`settings-se.mjs`，见下一条）；只有 assist 回退路径（无真实输入）里，向导仍给出可复制的网址和步骤让用户手动添加。回退路径里用户加的网站搜索（gb/bg/dg/px/kg），以及 T12（judge 步骤，每次引导式运行都做，与 xinput 无关）给 Kagi 条目追加的 `_ss`，只存在于隔离的测试配置里，收尾**不要求恢复**，保留供下次运行复用；默认引擎：有 xauto 步骤时，收尾的 `settings-se.restore` 会恢复为运行前的默认（T12 每次都会重新设默认），没有 xauto 步骤时保留最后设的默认；只有 T8(d) 在 assist 回退路径里改过“站点访问”才提示改回。T8(a) 让用户在无痕窗口粘贴触发网址，不依赖 gb（xauto 的 T1 不建 gb，全新配置里可能没有它）。
- xinput 真实输入（设计 `docs/superpowers/specs/2026-10-23-e2e-xinput-design.md`，代码 `xinput.mjs`、`gesture*.mjs`、`steps/xauto*.mjs`）：可用时默认开启，T1、T2、T3、T4、T5-DRAG、T6-NTP、T11、T14 以 xauto 步骤用 XTEST 真实鼠标键盘执行并自动判定；`--no-xinput` 或不可用时换回对应的 assist/judge 版本，不算失败。可用 = DISPLAY 存在、`xdotool`、`import`、`xdpyinfo`、`xwininfo` 可执行（`xprop` 可选，只作叠放顺序的后备来源）、`xdpyinfo -queryExtensions` 含 XTEST、非 headless。嵌套模式下 DISPLAY 指向嵌套显示号，Chrome 总是带界面，所以 `--auto-only` 在 Xvfb 上就跑 xauto；只有 host 模式的 `--auto-only` 要加 `--headed` 才跑 xauto。`gx.nested` 在 host 模式下是 `false`，嵌套模式下是模式名 `"xephyr"` 或 `"xvfb"`，手势层和提示文案按它分支。
  - 光标规则按显示分开：
    - 嵌套模式（xephyr、xvfb）：嵌套服务器的指针不是用户的光标。脚本不读用户光标、不等待、不出提示，自己用 `getwindowgeometry` 读测试窗口位置（没有窗口管理器就没有装饰，Position 可信），把指针移到窗口中心并读回；读回不在测试窗口上就判 env，不按下。xvfb 下用户什么都不用管。xephyr 下用户只要别把光标停在 Xephyr 窗口上：光标在窗口上移动时，Xephyr 会把真实移动转发进嵌套显示。所以静止采样、“move 后读回不符 → 中止（env）”、“两次读回不符落在同一点”这几道防护都保留，同一点时的原因写成“指针被用户光标带走（请把光标移出测试窗口 Xephyr）”。xvfb 下两次落在同一点，原因写成“不是你的光标造成的，多半是坐标在屏幕外”，不叫用户做任何事。xauto 开始卡片同样按模式写：xephyr 写“自动操作中，请不要把光标停在 Xephyr 窗口上”，xvfb 写可以照常使用电脑。
    - host 模式：WSLg 下 XWayland 的指针焦点跟着真实的 Windows 光标走，真实鼠标只要有物理移动（手搭在鼠标上、触摸板误触），X 指针就被同步回真实光标位置。所以 xauto 期间真实光标必须停在测试窗口上**并且**手离开鼠标。移动前先读指针：在根窗口上 → 向导提示，最多等 30 秒，仍不在 → skip“光标不在测试窗口上”（绝不移动真实光标去“找”窗口）；手势前静止采样确认用户没在动鼠标；move 后读回不符 → 中止（env），10 分钟内两次读回不符都落在同一点（±3px，可以跨尝试）→ 单独原因“指针被拉回真实光标位置（请把手从鼠标/触摸板上拿开）”并在向导页提示。
  - 防误触：每次 down/up/按键前断言目标窗口（测试窗口 id 在手势前按页面标题 token 取好，手势中不再找）；拖拽中指针下可以是测试 Chrome 自己的 XDND 拖拽图像窗口（按下后才出现、同一 X 客户端或 pid、大小与选区相符）；松开前还要核对没有冒出别的应用的新窗口、前台没换成别的应用、`xwininfo -root -children` 的叠放顺序里没有别的应用被提到测试窗口上面并盖住落点（WSLg 没有 `_NET_CLIENT_LIST_STACKING`；读不出叠放顺序就不按下）；任一不满足 → 回到拖拽起点按同样规则核对后松开（取消拖拽），起点也不行 → stuck：停掉剩余 xauto 步骤、向导请用户在测试窗口里点一下；第二次 Ctrl+C 同步尽力松开；浏览器关掉后只有指针停在根窗口上才补发 mouseup（嵌套模式下按着的键只在嵌套显示里，随服务器一起停止，不影响用户桌面）。拖拽节奏：host 模式不变（按下后停 150ms，越过阈值每步 30ms）；嵌套模式用 `NESTED_DRAG`：按下后停 300ms，每步 60–100ms 随机，松开前停 800ms。这是 Xephyr 上实测的值，快节奏有一次没能开始拖拽。键盘手势只在 `Target.createTarget({newWindow:true})` 新开、经断言拿到前台的窗口里做，每个字符前都再断言一次。host 模式用 `getactivewindow` 断言（WSLg 下键盘只送给 X 焦点窗口，焦点只跟 Windows 前台走，`windowactivate` 无效）。嵌套模式没有 EWMH：只有 `getactivewindow` 报 `_NET_ACTIVE_WINDOW` 不支持时才改用 `getwindowfocus`，其他报错仍判 env；新窗口出现 500ms 后焦点还没过去，就在页面中心点一下（点之前断言指针在新窗口上，只点一次），之后仍拿不到焦点就关掉新窗口、判 env，不按任何键；xauto 只用 ASCII 关键词。失败每次完整重建现场，最多 3 次；任何一次真实失败（非环境原因）之后，再出现跳过、环境失败或预期降级都不能把它吞掉，该步判失败；之后某次尝试通过仍判通过，detail 写明之前的失败（作为不稳定信号）；没有真实失败时 T14 最终判为预期降级就按预期降级记。
  - 网站搜索：xauto 用 `sse2e`（模拟引擎 A ｜ B）与 `sse2e-<引擎 id>`（T14）专用条目，经 CDP 操作 `chrome://settings/searchEngines` 自动添加、设默认；改动前快照到 `.e2e/settings-snapshot.json`（只记默认引擎的 keyword/name 和专用快捷字词，不记网址），结束（含中断）删除专用条目，只在本次改过默认引擎时才改回；遗留快照下次启动先恢复。不动用户的其他条目。
  - 窗口：只有选中了 xauto 步骤时才把测试窗口固定为 normal 1600×1000（每个 xauto 尝试前再核对），没有 xauto 步骤时不动窗口尺寸。坐标一律由 CDP 页面坐标换算（`(screenX + outerWidth − innerWidth + clientX)·dpr`），不用 `getwindowgeometry` 的 Position（它把窗口装饰算进去）；例外有两个：一是右键菜单这种 override-redirect 窗口（没有装饰，Position 可信），点击前还要核对指针确实在菜单上、离右键点不超过 80px；二是嵌套模式的指针归位，用测试窗口的 Position 算中心（没有窗口管理器，没有装饰），之后靠读回断言把关。
  - 预期降级：T14 某引擎作左侧时，触发前就读到该 origin 的 SW、没分屏、左侧停在该引擎上并带着查询词（网址或标题带查询词，或该标签自己的主框架跳转链经过触发网址——Perplexity 的 SPA 会改写网址），并且没有扩展接管过这次触发的反证（任何跳转链里出现带本次查询词的 `go.html?u=`、触发后新增扩展控制台错误、新出现不在分屏里的 Google 标签——go.js 分屏失败时 `location.replace(左侧)` 的结果和普通搜索长得一样，靠这些区分；没有控制台收集器时不判降级），记 `degrade`（预期降级）：单独计数、不算失败、退出码 0；没检测到 SW 仍是失败。多子项步骤里跳过/预期降级的子项，步骤整体通过或预期降级时写在说明第一行；无论步骤结果如何，都列进报告“未覆盖”小节。
- 运行前快照 `chrome.storage.sync` 到 `.e2e/storage-snapshot.json`，结束（含中断）后恢复；遗留快照下次启动先恢复。报告在 `.e2e/report-*.md|json`，网址里的 token/session/sid/auth/key/code、access_token 等 `*_token`、session_id/sessionid、`google_abuse` 等 `*_abuse` 与含 exemption 的参数值（含一次、两次百分号编码嵌套在 next=、r=、continue= 里的），以及单独出现的 `…ABUSE_EXEMPTION=…`（含用户 IP）脱敏为 `***`，终端与向导页同样。失败诊断除扩展读到的标签外，还列出 CDP 页面目标网址（扩展读不到的标签按窗口与网址对应）和步骤页面的主框架跳转链（控制台收集器在页面会话上 Network.enable 记录，没有时用 Page.getNavigationHistory）。左侧 Google 停在人机验证页（/sorry，`continue` 解码后是期望的搜索）算分屏已建成（`steps/captcha.mjs`）；脚本自己准备现场的等待，“重试”都会重新准备并重新记下判定用的 id。B4、T8 之后脚本自动核对扩展已启用、授权齐全，恢复不了就跳过剩余步骤。Kagi 登录检查打开 `https://kagi.com/settings`，只有最终停在 kagi.com/settings 才算已登录；用户登录期间只读现有标签的网址、不再发起导航（未登录时那条跳转链会重写会话 cookie，可能打断登录），用户点“我已完成”后再探测一次。
- 已知事实：扩展 SW 空闲约 30 秒就被回收，扩展 API 一律在扩展页（设置页）里经 CDP 执行（`browser.evalExt`），不要 attach SW；控制台收集器 attach 了 SW，调试会话让它一直存活，所以 e2e 测不到 SW 回收后冷启动的问题（靠 Windows 冒烟或手测）；必须直接 spawn `/opt/google/chrome/google-chrome`，`~/.local/bin/google-chrome` 包装脚本会 nohup 后台化、破坏调试管道；启动参数不得含 `--enable-automation`；正式版 Chrome 忽略 `--load-extension`。

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
