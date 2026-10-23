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

触发网址 = 左侧引擎真实搜索网址 + 标记参数 `_ss=<左id>,<右id>`，例如 `https://kagi.com/search?q=%s&_ss=kagi,google`。

## 目录与职责

```
split-search/
├── CLAUDE.md                     项目约定
├── README.md                     面向用户的简介与安装
├── .gitignore
├── package.json                  仅含 "test": "node --test" 脚本
├── docs/acceptance-v0.1.md       v0.1 手测验收清单（B 表 + T1–T15）
├── scripts/
│   ├── gen-key.sh                打印扩展 ID；manifest 无 key 时才生成公钥写入（不保留私钥）
│   └── sync-to-windows.sh        rsync src/ → D 盘镜像目录
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
└── test/                         node --test（每个 lib 一个文件，另有 manifest、config-store、split-actions、options-edits、options-ui）
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
- 预置引擎（只写在代码里）：`kagi` Kagi `https://kagi.com/search?q=%s`；`google` Google `https://www.google.com/search?q=%s`；`bing` Bing `https://www.bing.com/search?q=%s`；`ddg` DuckDuckGo `https://duckduckgo.com/?q=%s`；`perplexity` Perplexity `https://www.perplexity.ai/search?q=%s`。默认组合为 `["kagi", "google"]`。
- 用户界面文案一律使用简体中文。
- 不使用 iframe，不修改响应头。只有经过用户确认的“本扩展分屏”才允许被覆盖。
- 开发镜像目录：`/mnt/d/APP/Chrome-Extensions/split-search`。之后只用“重新加载”，不要移除后重装。

## 命令

- `npm test`：等价于 `node --test`，自动发现 `**/*.test.js`。Node 24 上不能写成 `node --test test/`（会报 MODULE_NOT_FOUND）。
- `bash scripts/sync-to-windows.sh`：同步 `src/` 到 D 盘镜像目录。
- `bash scripts/gen-key.sh`：打印扩展 ID（`alngkkgnobglnfbhcplhpaflcgfiajnj`）。只有 manifest 里没有 `key` 时才会生成一把一次性密钥并写入公钥；已有 `key` 时绝不改动。将来上架 CWS 时，商店用自己的密钥签名并分配商店 ID；如果要让开发版和商店版并存，参照 `~/projects/Pinboard-Bookmark-Enhanced/CLAUDE.md` 的“扩展 ID 分层”：源码保留开发公钥，打发布 ZIP 时再换成 CWS 后台给出的公钥。

## 测试纪律

- `src/lib/` 新增逻辑先写 node 测试，再写实现。
- 涉及分屏、DNR、权限的行为，按 spec 第 7 节（T1–T15）手测，清单见 `docs/acceptance-v0.1.md`。拖拽到标签栏和真实配置（已登录、已同步的 profile）下的表现必须在用户的 Windows Chrome 155+ 里测。WSL 里的 Google Chrome 是 155.0.8059.84，可用于不涉及拖拽的检查。

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
