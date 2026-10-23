# Split Search v0.1 验收清单

环境：Windows Chrome 155+。逐项填写“实际 / 通过 / 备注”，完成后见文末“反馈方式”。
扩展 ID 应为 `alngkkgnobglnfbhcplhpaflcgfiajnj`。

## 1. 前置准备

1. 在 WSL 运行 `bash scripts/sync-to-windows.sh`，同步到 `D:\APP\Chrome-Extensions\split-search`。
2. `chrome://extensions` 打开“开发者模式” -> “加载已解压的扩展程序”，选 `D:\APP\Chrome-Extensions\split-search`。之后一律点“重新加载”，不要移除重装。
3. 打开设置页（安装时自动打开，或点工具栏图标），点顶部黄色横幅授权 Kagi 和 Google；再给 Bing 授权（引擎列表里点 Bing 的“授权”）。T14 前建议给五个预置引擎全部授权。
4. 设置页“默认组合”选 Kagi | Google，复制触发网址。
5. 打开 `chrome://settings/searchEngines`（设置页有“复制地址”按钮），“网站搜索”点“添加”：
   - 默认条目：名称 `ss-default`，快捷字词 `ssd`，网址 = 默认组合触发网址（形如 `https://kagi.com/search?q=%s&_ss=kagi,google`），保存后点“设为默认”。
   - 关键词条目：名称 `ss-kb`，快捷字词 `kb`，网址 = 设置页“其他组合”里选 Kagi | Bing 生成的网址（`...&_ss=kagi,bing`）。
6. 验收结束后恢复：把原来的 Kagi 条目“设为默认”（或删除 `ss-default`、`ss-kb`）。

## 2. 安装与基础检查

| # | 检查 | 期望 | 实际 / 通过 |
|---|---|---|---|
| B1 | 首次加载 | 自动打开设置页，扩展 ID 正确 | |
| B2 | 点工具栏图标 | 打开设置页 | |
| B3 | 扩展详情页 | 没有“在无痕模式下启用”开关 | |
| B4 | 点横幅“授权” | 弹一次权限框，同时列出 kagi.com 和 www.google.com；允许后横幅消失，Kagi、Google 显示“已授权”（没弹窗请回报） | |
| B5 | SW 控制台（chrome://extensions 点“service worker”）执行 `await chrome.declarativeNetRequest.getDynamicRules()` | 恰好 1 条规则；requestDomains 含 kagi.com、www.google.com、www.bing.com、duckduckgo.com、www.perplexity.ai；ID 为静态扩展 ID；Console 无 `rebuildRules failed` | |
| B6 | 新增引擎：id 填 `Baidu` | id 旁提示格式错误 | |
| B7 | 新增 id `baidu`、名称 百度、网址 `https://www.baidu.com/s?wd=%s` | 保存成功，末尾出现百度，授权按钮高亮，右下角提示未授权；授权后恢复 | |
| B8 | “其他组合”左百度、右 Kagi | 网址为 `https://www.baidu.com/s?wd=%s&_ss=baidu,kagi`，“复制”变“已复制” | |
| B9 | 把 B8 网址加为快捷字词 `bk`，地址栏输 `bk 测试` | 百度 ｜ Kagi 分屏（验证后可删除百度和 `bk`） | |
| B10 | Kagi、Google 行的“隐藏” | 按钮禁用（被默认组合引用） | |
| B11 | 编辑 Kagi，网址改为 `https://kagi.com/search/%s` | 表单内拒绝并说明原因 | |
| B12 | 隐藏 Bing | 弹确认框（含网站搜索提示）；在“已隐藏”中可恢复 | |
| B13 | 连点 ↑/↓ 后刷新设置页；另开一个设置页改动 | 顺序保持；另一页自动刷新 | |
| B14 | 系统切深色模式 | 设置页配色跟随 | |
| B15 | 任一页面 DevTools Console | 除预期降级外无 `[split-search]` 报错 | |

## 3. 验收用例 T1–T15

| 编号 | 操作步骤 | 期望 | 实际 | 通过 | 备注 |
|---|---|---|---|---|---|
| T1 | 地址栏输入 `kb 测试` 回车 | 打开 Kagi ｜ Bing 原生分屏，左侧 Kagi 为当前焦点，搜索词都是“测试” | | | |
| T2 | (a) 地址栏直接输入 `测试` 回车（默认引擎）；(b) 输入 `测试` 后按 Alt+Enter | (a) 默认组合分屏；(b) 在新标签打开，不崩溃 | | | |
| T3 | 先在普通网页选中一段文字；(a) 拖到标签栏两个标签之间；(b) 从外部应用（如记事本）拖一段文字到标签栏 | 都产生分屏 | | | |
| T4 | 选中文字拖到一个已有标签上 | 该标签变成左侧，右侧为新开的搜索 | | | |
| T5 | 在本扩展建的分屏里连续拖文字 3 次，左侧标签、右侧标签各试；再拖到右侧标签上，确认左右不对调；然后重启浏览器，再拖一次 | 两侧就地刷新，标签数不增加，左右位置不变；重启后同样 | | | |
| T6 | 手动把 example.com 与 wikipedia 组成分屏，把文字拖到其中一个标签上。另：源标签是“新标签页”时再拖一次 | 在该分屏右侧新开一对 Kagi｜Google 分屏，被拖的标签回到原页面（新标签页也算原页面），另一侧不动。“没有历史就关闭原标签”这个分支靠拖拽很难构造（任何已有标签至少有一条历史，脚本会 history.back()），记“不适用”，该分支已由 task-7 的测试覆盖 | | | |
| T7 | 访问 `https://kagi.com/search?q=test&_ss=kagi`，再访问 `https://kagi.com/search?q=test&_ss=kagi,nope` | 停在 go.html，分别显示“标记参数格式不对”“未知引擎：nope”；“打开设置”可用。（第一个若被当作普通 Kagi 搜索也可接受，请备注） | | | |
| T8 | 依次做，每项做完先按括号里的方法恢复，再做下一项：(a) 无痕窗口触发（恢复：关窗口）；(b) 在 chrome://extensions 停用扩展后触发（恢复：重新启用）；(c) 撤销 Kagi 授权：在设置页 DevTools 控制台执行 `await chrome.permissions.remove({origins:["https://kagi.com/*"]})`（设置页没有撤销按钮，扩展详情页不一定能撤销可选权限）后触发；(d) 恢复：在设置页点横幅重新授权 Kagi（Google 也确认为已授权），刷新设置页确认；然后在扩展详情页把“站点访问”改为“点击时”后触发（恢复：改回，必要时再次授权）；(e) 只撤销右侧：控制台执行 `await chrome.permissions.remove({origins:["https://www.google.com/*"]})` 后触发（恢复：点授权重新授权 Google） | (a)-(d) 为普通左侧 Kagi 搜索，不分屏；(e) 仍然分屏。(d) 若详情页没有“站点访问”选项或没有“点击时”，记“不适用”并写明。**T8 结束后确认设置页 Kagi、Google 都是“已授权”、扩展已启用、站点访问为默认，再做 T9 起的用例，否则会全部降级** | | | |
| T9 | 带 `_ss` 的触发网址：(a) 已登录的 Kagi；(b) 经过 Turnstile 跳转的 Kagi（可用无痕外的新会话）；(c) Google | 结果页正常可用；参数被改写导致没分屏可接受，请记录 | | | |
| T10 | 分屏后在左侧点后退，再点前进；然后用“继续上次浏览”恢复会话（chrome://settings/onStartup 选“继续上次浏览的位置”，退出再开） | 不再次分屏；不停在 go.html（若停在 go.html 应只显示“重新执行”）；会话恢复后 go.html 不重新分屏 | | | |
| T11 | 网页选中文字，右键 -> “在 X 中搜索”（X 为 ss-default 条目；若没有右键项，在 chrome://settings/searchEngines 确认条目已启用） | 分屏 | | | |
| T12 | 先确认 chrome://settings/searchEngines 里有 Chrome 自动发现的 Kagi 条目（没有就在 kagi.com 搜索一次，让 Chrome 发现）。编辑它，网址末尾追加 `&_ss=kagi,google`，保存，点“设为默认”。然后在地址栏直接输入关键词（不用快捷字词）。额外：再试一次快捷字词模式 | 记录：(1) 是否分屏；(2) 地址栏下拉里是否仍有该引擎的搜索联想（建议）；(3) 额外：快捷字词模式下联想情况。结束后把默认引擎恢复 | | | |
| T13 | 触发源分别为：(a) 固定标签；(b) 标签组里的标签；(c) 标签组里最后一个标签；(d) 窗口里唯一的标签；(e) popup 窗口：在普通页面 DevTools 控制台执行 `window.open("https://kagi.com/search?q=test&_ss=kagi,google", "", "popup")`；(f) PWA/应用窗口：在该窗口页面的 DevTools 控制台执行 `location.href="https://kagi.com/search?q=test&_ss=kagi,google"`（没有可用的应用窗口就记“不适用”） | 不崩溃，按预期分屏或降级。(e)(f) 的预期：该 popup/应用窗口自己会显示左侧 Kagi，同时在一个普通窗口里新建一对 Kagi｜Google 分屏（所以会多出一个 Kagi，这是预期，不算缺陷）；请留意新分屏是否出现在后台窗口里 | | | |
| T14 | 先打开 `chrome://serviceworker-internals`，看有无 kagi、google、bing、duckduckgo、perplexity 的 Service Worker。五个引擎各自正常访问一遍（保证 SW 已注册）。DNR 只拦截左侧引擎的导航，所以要让每个引擎都当一次左侧：在设置页“其他组合”分别生成 google｜kagi、bing｜kagi、ddg｜kagi、perplexity｜kagi，各加一个网站搜索（如 `gk`、`bk2`、`dk`、`pk`），并授权这些引擎的 origin；每个都像 T1 那样触发一次（Kagi 作左侧已在 T1 覆盖）。拖拽用例（T3/T4）则在设置页把默认组合的左侧临时改成该引擎后各跑一次。结束后把默认组合改回 Kagi｜Google | 每个引擎作左侧都分屏。若某引擎的 SW 让分屏失效（DNR 被绕过，表现为普通搜索），写下是哪个引擎和现象，回报给 Claude，由控制端将它设为“仅建议作右侧”（leftDiscouraged） | | | |
| T15 | 在装了 uBlock Origin 的配置下跑 T1–T4 | 分屏 | | | |

## 4. 反馈方式

把填好的 T 表（只贴失败项也可以，加上 B 表中不通过的编号）直接粘贴回给 Claude。T12 的联想结果、T14 的 SW 现象、T8(d) 是否“不适用”请务必写在备注里。全部通过后，Claude 再打 `v0.1.0` 标签。
