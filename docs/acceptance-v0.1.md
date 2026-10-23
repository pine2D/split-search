# Split Search v0.1 验收清单

扩展 ID 应为 `alngkkgnobglnfbhcplhpaflcgfiajnj`。默认组合为 **Google ｜ Bing**。

验收分两段：先在 WSL 里跑引导式端到端验收（覆盖绝大多数项目），再在 Windows Chrome 里做 4 项冒烟。

## 1. 引导式端到端验收（WSL）

先运行 `npm run e2e`（首次运行会引导你安装扩展、授权、登录 Kagi）。

- 测试浏览器是 WSL 里的 Google Chrome 155（带界面），使用独立的测试配置 `~/.cache/split-search-e2e/profile`，不登录 Chrome 账号、不开同步，不碰日常配置。
- 浏览器里会固定打开“Split Search 验收向导”页（`http://127.0.0.1:8765/guide`）。照着向导页的说明操作即可：
  - **auto**：脚本自己做、自己判；
  - **assist**：你按说明操作（拖拽、在地址栏输入、右键、点授权框、在 `chrome://settings/searchEngines` 添加网站搜索等），脚本检测到预期的标签/分屏状态就判通过；做不了点“跳过”，没反应可以点“重试”；
  - **judge**：只能人眼判断的，你点“通过 / 不通过 / 跳过”。
- 第一次运行时的一次性准备由向导带着做：在 `chrome://extensions` 打开开发者模式并“加载已解压”仓库的 `src/`（同时验证 B1）；点一次授权框（模拟引擎 + 五个预置引擎的网站）；需要 Kagi 的步骤前在 kagi.com 登录。之后都保存在测试配置里。
- Google 偶尔会弹人机验证页（`google.com/sorry`），向导会提示你完成验证后继续。
- 全部步骤结束后，向导会列出要恢复的设置（默认搜索引擎改回 Google、删除 `gb`/`bg`/`dg`/`px`/`kg`、删掉 Kagi 条目追加的 `_ss` 等），只影响测试配置，但请恢复。
- 报告写到 `.e2e/report-<时间>.md` / `.json`；网址里的 token、session、sid、auth、key、code 以及 `*_token`、session_id 等参数值会被替换成 `***`。中途中断或出错时，需要恢复的设置清单也会打印在终端并写进报告备注。
- 日常回归用 `npm run e2e -- --auto-only`（无头、无人值守），前提是已完成过一次完整的引导式运行。

## 2. Windows Chrome 冒烟

WSL 覆盖不到 Windows 环境本身，以及从 Windows 应用拖入。在 Windows Chrome 155+ 里做这 4 项：

1. 在 WSL 运行 `bash scripts/sync-to-windows.sh`；`chrome://extensions` 里“加载已解压的扩展程序”选 `D:\APP\Chrome-Extensions\split-search`（已加载过就点“重新加载”，不要移除重装），核对扩展 ID 为 `alngkkgnobglnfbhcplhpaflcgfiajnj`，并在设置页横幅里授权 Google 和 Bing。
2. 在 `chrome://settings/searchEngines` 添加网站搜索 `gb`（网址 `https://www.google.com/search?q=%s&_ss=google,bing`）并设为默认，然后从记事本拖一段文字到标签栏（T3b）：出现 Google ｜ Bing 分屏。
3. 在普通网页上选中一段文字，拖到标签栏两个标签之间：出现 Google ｜ Bing 分屏。
4. 在地址栏直接输入关键词回车（用默认引擎 `gb`）：出现 Google ｜ Bing 分屏。

结束后把默认搜索引擎改回原来的，删掉 `gb`。

## 3. 原 B/T 表（参考，注明覆盖方式）

“覆盖”一列：**e2e auto** = 脚本全自动；**e2e assist** = 向导指导你操作、脚本判定；**e2e judge** = 向导里由你判断；**Windows 冒烟** = 第 2 节；**未覆盖** = v0.1 不测或需要时手测。e2e 里的“核心链路”（CORE-NEW、CORE-EXISTING：用模拟引擎触发，相当于拖到两个标签之间、拖到已有标签上）单独列在报告里，不算作 T3/T4 通过。

### 安装与基础检查

| # | 检查 | 期望 | 覆盖 |
|---|---|---|---|
| B1 | 首次加载 | 自动打开设置页，扩展 ID 正确（之前已加载过、这次只是重新启用的，记“跳过”） | e2e assist（安装引导） |
| B2 | 点工具栏图标 | 打开设置页 | e2e auto |
| B3 | 扩展详情页 | 没有“在无痕模式下启用”开关（`incognito: not_allowed`） | e2e auto |
| B4 | 撤销 Google、Bing 授权后点横幅“授权” | 弹一次权限框，同时列出 www.google.com 和 www.bing.com；允许后横幅消失，两者显示“已授权” | e2e assist |
| B5 | `chrome.declarativeNetRequest.getDynamicRules()` | 恰好 1 条规则；requestDomains 含 www.google.com、www.bing.com、duckduckgo.com、www.perplexity.ai、kagi.com；ID 为静态扩展 ID；无 `rebuildRules failed` | e2e auto |
| B6 | 新增引擎：id 填 `Baidu`，点“保存” | id 旁提示格式错误，对话框不关闭 | e2e auto |
| B7 | 新增 id `baidu`、名称 百度、网址 `https://www.baidu.com/s?wd=%s` | 保存成功，末尾出现百度，授权按钮高亮，右下角提示未授权 | e2e auto |
| B8 | “其他组合”左百度、右 Google | 网址为 `https://www.baidu.com/s?wd=%s&_ss=baidu,google`，“复制”变“已复制” | e2e auto |
| B9 | 把 B8 网址加为快捷字词 `bk`，地址栏输 `bk 测试` | 百度 ｜ Google 分屏 | 未覆盖（地址栏快捷字词机制由 T1 覆盖） |
| B10 | Google、Bing 行的“隐藏” | 按钮禁用（被默认组合引用） | e2e auto |
| B11 | 编辑默认组合左侧的引擎，网址改为路径型（如 `https://www.google.com/search/%s`） | 表单内拒绝并说明原因 | e2e auto |
| B12 | 隐藏一个预置引擎，然后在“已隐藏的预置引擎”里点“恢复” | 弹确认框（含网站搜索提示）；隐藏后出现在“已隐藏”中，恢复后回到列表 | e2e auto |
| B13 | 连点 ↑/↓，至少等 1 秒再刷新；另开一个设置页改动 | 顺序保持；另一页自动刷新 | e2e auto |
| B14 | 深色模式 | 设置页（和向导页）配色跟随 | e2e judge（CDP 模拟深色） |
| B15 | 整次运行中的 `[split-search]` 报错 | 除预期降级外无 `[split-search]` 报错 | e2e auto |

### 验收用例 T1–T15

| 编号 | 操作步骤 | 期望 | 覆盖 |
|---|---|---|---|
| T1 | 添加网站搜索 `gb`（网址 `https://www.google.com/search?q=%s&_ss=google,bing`），地址栏输入 `gb 测试` 回车 | Google ｜ Bing 原生分屏，左侧 Google 为当前焦点，搜索词都是“测试” | e2e assist |
| T2 | (a) 把 `gb` 设为默认，地址栏直接输入关键词回车；(b) 输入关键词后按 Alt+Enter | (a) Google ｜ Bing 分屏；(b) 在新标签打开（分屏也可），不崩溃 | e2e assist |
| T3 | (a) 选中网页文字拖到标签栏两个标签之间；(b) 从外部应用（如记事本）拖文字到标签栏 | 都产生 Google ｜ Bing 分屏 | (a) e2e assist；(b) Windows 冒烟 |
| T4 | 选中文字拖到一个已有标签上 | 该标签变成左侧 Google，右侧为新开的 Bing | e2e assist |
| T5 | 在本扩展建的分屏里再次触发（左侧、右侧各试），拖到右侧标签上确认左右不对调；重启浏览器后再触发一次 | 两侧就地刷新，标签数不增加，左右位置不变；重启后同样 | e2e auto（模拟引擎，含重启）+ e2e assist（T5-DRAG：真实拖到右侧标签） |
| T6 | 手动把两个网页组成分屏，把文字拖到其中一个标签上。另：新开“新标签页”，手动和另一个标签组成分屏，再把文字拖到新标签页上 | 在该分屏右侧新开一对 Google ｜ Bing 分屏，被拖的标签回到原页面（新标签页也算），另一侧不动。“没有历史就关闭原标签”的分支由 `test/split-actions.test.js` 覆盖 | e2e auto（模拟站点）+ e2e judge（T6-NTP：新标签页子项） |
| T7 | 访问带错误 `_ss` 的触发网址（`_ss=ea`、`_ss=ea,nope`） | 停在 go.html，分别显示“标记参数格式不对”“未知引擎：nope”；出现“只打开左侧搜索”按钮 | e2e auto |
| T8 | (a) 无痕窗口触发；(b) 停用扩展后触发；(c) 撤销左侧引擎授权后触发；(d) 扩展详情页“站点访问”改为“点击时”后触发；(e) 只撤销右侧引擎授权后触发。每项做完先恢复 | (a)-(d) 为普通左侧搜索，不分屏；(e) 仍然分屏。(d) 没有“点击时”选项记“不适用”。结束后扩展已启用、授权齐全 | e2e assist：(b)(c)(e) 由脚本判定（(c)(e) 用模拟引擎，脚本撤销授权，恢复时你点一次“允许”）；(a)(d) 有 judge 环节 |
| T9 | 带 `_ss` 的触发网址：(a) 已登录的 Kagi（`https://kagi.com/search?q=split+test&_ss=kagi,google`）；(b) 经过 Turnstile 跳转的 Kagi（退出登录后触发）；(c) Google | (a) Kagi ｜ Google 分屏，左侧停在 kagi.com/search，结果页正常；参数被改写导致没分屏请记录 | (a) e2e assist（向导引导登录）；(b) 未覆盖；(c) 由 T1–T5 覆盖 |
| T10 | 分屏后在左侧后退、前进；退出 Chrome 再用“继续上次浏览的位置”恢复会话 | 不再次分屏；不停在 go.html；会话恢复后 go.html 不重新分屏 | e2e auto |
| T11 | 网页选中文字，右键 ->“使用 gb 搜索…”（默认引擎） | Google ｜ Bing 分屏 | e2e assist |
| T12 | 编辑 Chrome 自动发现的 Kagi 条目，网址末尾追加 `&_ss=kagi,bing`，设为默认，地址栏直接输入关键词；再试快捷字词模式 | 记录：(1) 是否分屏；(2) 地址栏是否仍有该引擎的联想（建议）；(3) 快捷字词模式下的联想。结束后默认改回、删掉追加的 `_ss` | e2e judge（分屏由脚本判定，联想由你回答） |
| T13 | 触发源为：(a) 固定标签；(b) 标签组里的标签；(c) 标签组里最后一个标签；(d) 窗口里唯一的标签；(e) popup 窗口；(f) PWA/应用窗口 | 不崩溃，按预期分屏或降级；(e)(f) 在普通窗口里新建一对分屏 | (a)–(e) e2e auto；(f) 未覆盖 |
| T14 | 先访问五个引擎首页（注册 Service Worker），再让 Bing、DuckDuckGo、Perplexity、Kagi 各当一次左侧（网站搜索 `bg`/`dg`/`px`/`kg`，`_ss=<id>,google`），设为默认后拖一次文字（Google 作左侧由 T1–T5 覆盖） | 每个引擎作左侧都分屏。某引擎的 SW 让分屏失效（表现为普通搜索）时，写下引擎和现象回报，由控制端设为“仅建议作右侧” | e2e assist（脚本先打开五个首页） |
| T15 | 在装了 uBlock Origin 的配置下跑 T1–T4 | 分屏 | 未覆盖 |

## 4. 反馈方式

把 e2e 报告（`.e2e/report-*.md`）里失败和跳过的项目，加上 Windows 冒烟里不通过的项，直接贴回给 Claude。T12 的联想结果、T14 的 SW 现象、T8(d) 是否“不适用”都会写在报告的说明里。全部通过后，Claude 再打 `v0.1.0` 标签。
