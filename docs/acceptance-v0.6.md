# Split Search v0.6 验收清单

扩展 ID 应为 `alngkkgnobglnfbhcplhpaflcgfiajnj`。v0.6 只改设置页：分成四个 tab（添加到 Chrome｜搜索组合｜搜索引擎｜右键查询），内容列收到 680px，说明、网址框、下拉框顶到同一条右边界，关键词规则从默认组合卡里的折叠区提成“搜索组合”里默认展开的规则卡，跨 tab 的依赖用就地提示、带按钮的提示、tab 标记和页内链接接上。不加权限，存储键、DNR、分屏判定都不变。设计见 `docs/superpowers/specs/2026-10-27-options-tabs-design.md`。

v0.1、v0.3、v0.4、v0.5 的表照旧有效，运行方式、显示模式、报告与结果分类都以 v0.1 第 1 节为准。本表只列 v0.6 新增和改写的项目；v0.4、v0.5 表里被改写的条目已加“见 v0.6”。

## 1. 怎么跑

- 日常回归：`npm run e2e -- --auto-only`。
- 只跑设置页相关的项目：`npm run e2e -- --auto-only --only B4,B6,B7,B8,B10,B11,B12,B13,B16,B17,B18,B19,B20,B21,B14,I18N`。
- e2e 打开设置页一律带上要用的 tab：`optpage.mjs` 的 `openOptions(browser, { tab })` 在网址后接 `#tab-<key>`（真实用户也会用的深链，不是测试后门），`withOptions(browser, fn, opts)` 把第三个参数原样交给 `openOptions`，已打开的页面中途换 tab 用 `showTab(page, key)`（点 `#tabbtn-<key>`，等 `#panel-<key>` 的 `checkVisibility()` 为 true）。隐藏面板里的节点仍在 DOM 里，READY（`#engines .engine-row` 存在）不变；但做焦点、可见性、坐标、截图、行数、溢出检查时，目标 tab 必须可见。
- `setupDone` 仍在 `storage.local`、不在 storage 快照里：B4、B19、B21、I18N 用 `keepSetupDone` 写回步骤前的值。

## 2. B21 设置页 tab 与宽度（新增，auto）

文件：`scripts/e2e/steps/b21.mjs`（入口与 (a)(b)(c)(d)(e)(i)(j)）、`b21-links.mjs`（(f)(g)(h)(k)(m)(n)）、`b21-width.mjs`（(l)）。`guarded` 写回 `defaultPair`、`uiLocale`、`customEngines`、`presetOverrides`、`order`；`keepSetupDone` 写回 `setupDone`、`setupTryTabs`；子项撤销过的授权记进 `env.revoked`，子项自己恢复不了的由收尾 `requestGrant` 恢复（之前授权过，Chrome 直接批准，不弹框）。

| 子项 | 做法 | 期望 |
|---|---|---|
| (a) ARIA | 设置完成、已授权，无 hash 打开 | 恰好 4 个 `.tab[role=tab]`，只有一个 `aria-selected=true` 且 `tabindex=0`，其余 −1；`aria-controls` 与面板一一对应；面板的 `aria-labelledby` 指向只包 tab 名的 `#tabname-<key>`（不指向按钮，读屏进面板时不读“未完成”）；未选中的面板 `hidden`、`checkVisibility()` 为 false |
| (b) 键盘 | CDP `Input.dispatchKeyEvent` 在 tab 上依次按 →、End、Home、←；再按带修饰键的 → 与 ↓ | 每次选中项、`activeElement.id`、对应面板一起变，← 从第一个循环到最后一个；带修饰键的 → 和 ↓ 不换 tab（不占用 Ctrl+PageUp/PageDown） |
| (c) hash | 点 `#tabbtn-engines`，再 `Page.reload` | `location.hash === "#tab-engines"`，`history.length` 不变（`replaceState`）；刷新后仍是 ③ |
| (d) 默认 tab | 依次：清掉 `setupDone`、无 hash；`#tab-lookup`；写 `setupDone: true` 且已授权后：无 hash、`#setup`（卡片不显示）、`#foo`、`#tab-foo`、`#engines`、`#guide` | ①、④、②、②（焦点 BODY）、②、②、②、②；最后两个是元素 id，`scrollY === 0`（静态面板全 `hidden`，浏览器在路由之前找不到滚动目标） |
| (e) 不跟状态跳 | 停在 ① 时写 `setupDone: true` | 卡片换成完成确认，仍在 ① |
| (f) 跨 tab 链接 | steps 档：点 ① 第 2 步“更换组合”；回 ① 展开 5 步说明，点第 5 步“搜索引擎”；在 ② 点末行指引。hidden 档：在 ② 改右侧，点 `#pair-changed` 里的“查看设置步骤” | “更换组合”→ ② 选中、焦点 `#pair-left`；第 5 步链接 → ③ 选中、焦点在默认左侧的 `.perm-line button`（已授权时没有，落到 `#edit-<左>`）；末行指引 → ① 选中、hash `#tab-add`、`#guide-other` 展开、焦点在它的 summary；“查看设置步骤”→ ① 选中、hash `#tab-add`、焦点在 `#guide-steps-title`。steps 档“两段展开、焦点在 summary”由 B19 detailsLink 覆盖 |
| (g) `#pair-changed` 按档位 | 依次：steps 档改右侧；写 `setupDone: true`（不刷新）；再改右侧；撤销左侧授权（regrant）；改回记下的原组合。补充：hidden 档第一页改右侧后另开第二页，在第二页改回原组合 | steps：`options_pair_changed_setup` 加“继续设置”，没有网址框，保存提示 `notice_pair_saved_setup`；写 `setupDone: true` 后提示框消失；hidden 再改：`options_pair_changed`，网址框等于新组合的触发网址，提示 `notice_pair_saved`；regrant：仍是替换文案；改回后提示框消失、保存提示 `notice_pair_saved_back`；`#pair-changed` 没有 `role`。补充：第二页没有 `#pair-changed`（记录只在第一页内存里）；第二页改回原组合后，第一页重渲染、提示框消失 |
| (h) 模板变化 | 在 ③ 编辑默认左侧，改网址模板（仍合法）后保存 | 出现常驻的 `notice_template_changed`，带“查看触发网址”；点它后 ① 选中、焦点在 `#triggers` 的复制按钮 |
| (i) 排序模式 | 进“调整顺序”，移动一次，切到 ② | `storage.onChanged` 在 1 秒内收到 `order`；焦点留在 `#tabbtn-pair`；切回 ③ 时已退出模式 |
| (j) 已开页 | 已开的设置页切到 `#tab-engines`、写页面标记；从弹窗点“打开设置”（B2 的 `openOptionsFromPopup`） | 没有新标签，原页标记还在（没重载），仍是 ③ |
| (k) 焦点兜底 | regrant 档在 ① 用 CDP 可信点击点 `#setup-grant`；再撤销一次，在 ② 可信点击 `#pair-grant` | 授权成功、按钮消失后，前者焦点在 `#tabbtn-add`，后者在 `#pair-left`，都不是 BODY |
| (l) 宽度 | 四种语言 × 1280、600 两档（`setDeviceMetricsOverride`），`setupDone: true`、两侧已授权，加一个模板在 engine-u.localhost 上的自定义引擎（一行“未授权（可选）”）；每个 tab 展开所有折叠区后量 | 说明文字（`.hint`、`.steps li`、`.caveats li`、`.step-body p`、标语）计算出的 `max-width` 都是 `none`；折行的说明块文字右缘 ÷ 父节点内容盒宽度 ≥ 0.9（排除和按钮同行的 `.step-actions > .hint`）；`.steps .url-line` 与 `.trigger-card .url-line` 右缘相差 ≤ 2px；右键查询卡两个下拉框等于卡片内宽 ±1px；“其他组合”生成器两个 label 的左缘与默认组合两个窗格的左缘对齐 ±1px；`documentElement.scrollWidth <= innerWidth`；`.tablist` 没有竖向溢出；600 档每个引擎行（含未授权的行）左块与右侧控件组顶边相同；600 档页头 h1 只有一行，且与 `.lang-box` 同行（竖向中线相差不到较矮一方高度的一半；Task 6 修正第 1 轮加） |
| (m) 换语言 | steps 档打开、切到 ③，写 `uiLocale: "en"` | 仍是 ③、hash `#tab-engines` 不变；`#tabname-engines` 和 ① 标记里的读屏文字（`options_tab_todo`）换成英文 |
| (n) 手改 hash | `setupDone: true`、已授权，停在 ③，焦点 BODY，依次在地址栏改 hash | `#setup`（卡片不显示）→ 仍 ③、焦点 BODY；`#tab-foo` → 仍 ③；`#tab-lookup` → ④；`#guide-steps` → ①、hash 换成 `#tab-add`、焦点在 `#guide-steps-title` |

## 3. 改写的项目

规律：在哪个 tab 里操作就带上哪个 tab。只加 `tab` 参数、期望不变的有 B6、B7、B11、B12、B13、B16（③），B8（①），B18、v04-i18n（④），B2 的 `openOptionsFromPopup` 比较网址时只比路径（已开的页 hash 可能是 `#tab-*`）。

| # | 检查 | 期望 | 覆盖 |
|---|---|---|---|
| B4（改写） | 清掉 `setupDone`、撤销 Google 与 Bing 后打开设置页，点“开始使用”卡第 1 步的授权按钮 | 默认选中“添加到 Chrome”（`#tabbtn-add[aria-selected=true]`）；其余同 v0.4（恰好一次申请、同时含两个 origin，第 1 步变成已授权；引擎列表的必需/可选样式在 ③ 里核对） | e2e auto |
| B10（改写） | 默认组合在用的引擎在编辑对话框里隐藏/删除 | 同 v0.4，`#dlg-remove-reason` 的文字改成指向“搜索组合”tab：“默认组合正在用它，不能删除。先到‘搜索组合’把它换成别的引擎。”（隐藏同理）；期望值用 `msg()` 取，四语都含 `options_tab_pair` 的文字（`test/i18n-catalog.test.js` 守着） | e2e auto（③） |
| B12(4)（期望不变） | “调整顺序”模式中点提示里的“撤销” | 焦点交给“完成”，仍在模式中（`undoHide` 保留 `isReordering()` 兜底） | e2e auto（③） |
| B14（改写） | 深色模式 | `b14-options-dark.png` 拍的是**默认 tab**（不带 hash 打开；测试配置里 `setupDone` 一直是 true，所以是 ②）；`b14-options-rules-dark.png` 点 `#tabbtn-pair`，等规则卡 `#rules-card` 可见且至少一行规则后拍整个 ②（文件名不变）；其余同 v0.5 | e2e auto |
| B17（改写） | 快捷键卡与轮换清单 | 快捷键卡挪到 ③，紧跟搜索引擎卡（轮换顺序就是引擎列表的顺序，两者放在一起）；`#cycle details` 仍是默认收起的折叠区；其余同 v0.4 | e2e auto（③） |
| B19（改写） | “开始使用”卡与弹窗三档 | 卡片在 ①。左侧未授权时 `pairCallouts`（`#pair-body .callout-warn`，`#pair-changed` 不算）期望 **1**：regrant 时 ② 的左侧未授权提示框常驻（带 `#pair-grant`），报错文案“左侧未授权时默认组合卡应有 1 个提示框（实际 N 个）”；弹窗 (a′)(d) 点“查看第 2 步”/“完成设置”后 ① 选中，hash 是 `#tab-add`、`#setup` 或原值；(e) `#setup` 页卡片不显示时 ② 选中、焦点 BODY；detailsLink、keepsFocus、hashOpen 都在 ① 内，期望不变 | e2e auto |
| B20（改写） | 规则卡 | 规则不再是默认组合卡里的折叠区：“搜索组合”tab 里紧跟默认组合卡有独立的规则卡 `section#rules-card`（`h2#rules-title`），默认展开、卡里没有折叠区，`#rule-list` 的 `aria-labelledby="rules-title"`；第 1 步核对卡片可见、紧跟 `pair-title` 那张卡、标题、空状态；第 4 步改核对列表 `aria-labelledby` 与行数（不再有带条数的 summary）；第 10 步先 `showTab(page, "engines")`（关对话框后焦点还给看得见的 `#edit-ed`），第 11 步先 `showTab(page, "pair")` | e2e auto（②） |
| I18N（改写） | 多语言 | 设置页按 tab 审：`auditTabs` 对每个 tab 先确认面板里至少有一个看得见的后代（否则隐藏面板里的溢出检查会静默通过，判失败），审面板，页头和 tab 栏另审一次；展开所有折叠区后逐个 tab 再审；之后视口模拟成 600 宽，四个 tab 各审一次溢出，核对每个 `.tab` 不截字、选中的 tab 完全在 `.tablist` 可视范围里。截图改名：`<语言>-options-<tab>.png`、`<语言>-options-<tab>-open.png`（替代原来的 `-options.png`、`-options-open.png`）；`-options-reorder.png` 在 ③ 拍；`-options-lookup.png` 在 ④ 拍；其余文件名不变 | e2e auto |
| v05-i18n（改写） | 规则卡四语 | 打开 `{ tab: "pair" }`，等规则卡可见、标题等于 `options_rules_title`、4 行；审计范围、截图裁切都换成 `#rules-card`；`<语言>-options-rules.png` 文件名不变，内容是规则卡的裁切 | e2e auto |

## 4. 路由约定（预期行为）

- 默认 tab 只在首次 render 判一次：卡片显示（steps、regrant）进 ①，否则进 ②，`#tab-<key>` 优先。之后状态变化不自动换 tab：授权成功、`setupDone` 变成 true 都不把用户从当前 tab 带走（B21 (e)(k)）。
- 读配置失败时停在 ②（`routeOnce("hidden")`），之后渲染成功也不再换 tab。只有静态接线检查（`test/options-wiring.test.js`），没有 e2e。
- tab 状态只在网址 hash 里（`#tab-<key>`，`replaceState`，不产生历史），不进 `chrome.storage`，也不用 `sessionStorage`。`#setup`、`#guide-steps` 是定位请求，不是 tab；认不出的 hash 什么都不做。
- 弹窗、`background.js`、`go.js`、`lib/messages.js` 没改：`pickOptionsTab` 只比路径，任何 hash 的设置页都算；收到 `reveal-setup` 且卡片显示时先切到 ①。

## 5. Tab 停靠点（CDP 实测一次，不做常驻断言）

算法同 v0.4（`docs/acceptance-v0.4.md`“Tab 停靠点”）：从 `body` 起用 CDP `Input.dispatchKeyEvent` 连按 Tab，记下不重复的 `document.activeElement`（按元素本身认，不按文字），回到第一个停靠点为止。

实测（2026-10-27，Chrome 156.0.8078.47，无头，视口 1280 宽，界面 zh_CN）：在 e2e 测试配置 `~/.cache/split-search-e2e/profile` 里把状态临时改成全新安装（`storage.sync` 清空后只写 `uiLocale: "zh_CN"`，默认组合 Google ｜ Bing、五个预置引擎、规则 0 条；没有 `setupDone`；五个预置引擎的授权经 `permissions.remove` 撤销），每种状态用 `#tab-<key>` 打开一页数一次；“① 设置完成”另写 `setupDone: true` 并授权 Google 与 Bing。量完写回 `storage.sync`、`storage.local`，撤销过的授权重新 `permissions.request`（之前授权过，不弹框），核对与量之前一致。

| tab | 状态 | 实测 | 设计稿 3.1 估算 | 明细 |
|---|---|---|---|---|
| ① 添加到 Chrome | 设置中（steps，全新） | 12 | 12 | 语言框、tab、面板 3 + 开始使用卡 5（授权、复制地址、复制触发网址、“详细步骤”、“更换组合”）+ 4 个 summary |
| ① 添加到 Chrome | 设置完成 | 8 | 8 | 3 + 默认组合复制 1 + “其他组合”summary 1 + 5 步说明第 1 步复制 1 + 第 5 步“搜索引擎”链接 1 + “注意事项”summary 1 |
| ② 搜索组合 | 全新，0 条规则 | 9 | 9 | 3 + 2 个下拉框 + 窄窗口开关 1 + 左侧未授权提示框的 `#pair-grant` 1 + 末行指引链接 1 + `#rule-add` 1；每多一条规则 +3（编辑、上移、下移） |
| ③ 搜索引擎 | 全新 | 18 | 18 | 3 + 卡头 3（调整顺序、从引擎库添加、新增引擎）+ 5 行 × 2（授权、编辑）+ 设置快捷键 1 + 轮换 summary 1 |
| ④ 右键查询 | 全新 | 8 | 8 | 3 + 2 个下拉框 + 2 个按钮 + “说明与限制”summary 1 |

改前（v0.5，同样的全新状态）整页 33 个停靠点，一个接一个都要 Tab 过去；改后单个 tab 最多 18 个（③），其余 8–12 个。语言框和 tab 栏各占 1 个，面板本身占 1 个（`tabindex="0"`，APG 的做法）；隐藏面板是 `display: none`，不占停靠点。

## 6. 设计复评（impeccable）

- **`impeccable detect` 的 line-length 不算失败**：用户 2026-10-27 选了四种语言同一条右边界（设计稿第 10 节第 3 条），en、es 的说明每行约 95–105 个字符，detect 会报 line-length。这是有意的取舍，不按失败处理；其余检测项照常判。

复评（2026-10-27）：在 e2e 测试配置里开设置页四个 tab（zh_CN、en；1280 与 600 宽；① 另看“开始使用”卡显示的 steps 档），截整页图人工看一遍，并对每一页跑 `impeccable detect --cdp`（共 20 页）。`/impeccable critique` 按单上下文的降级方式运行（实施子代理不能再派评审子代理）。

- detect 结果：1280 宽 zh_CN 全部 0 条；1280 宽 en 只有 line-length（① 2 条，② ③ 各 1 条），按上一条不算失败。600 宽每一页都报 1 条 body-text-viewport-edge：页脚说明 `footer.page-foot > p.hint` 离视口左缘 12px。600px 视口下 `.page` 左右内边距是 12px（设计稿 3.4 定的），detect 对 480px 以上的视口要求至少 16px；卡片里的文字有卡片内边距，不受影响。
- 人工看到、需要改 `src/` 的问题（都由本批改动引入；Task 6 不改代码，交由控制方裁定）：
  1. ① steps 档里“设置步骤”上方多出约 16px：5 步说明收进折叠区时，`#guide-steps` 里的 `details.disclosure` 带着 `.disclosure { margin: 16px 0 4px }`，“其他组合”与“设置步骤”之间比别的折叠区之间宽一截（1280 宽截图里约 107 比 82 原图像素）。候选改法：`#guide-steps > .disclosure { margin: 0; }`。
  2. 600 宽 en 页头的 h1“Split Search settings”折成两行。设计稿 3.5 按 h1 约 140px 估算一行放得下；实测语言下拉框约 261px 宽，留给 h1 的宽度不够一行。B21 (l) 不量页头，所以没报（第 8 节已列“600 宽 en 页头一行没有断言”）。
  3. 上面 600 宽页脚 12px 的 body-text-viewport-edge（轻微）。

修正（Task 6 修正第 1 轮，控制方裁定三条都在打标签前修）：

  1. `#guide-steps > .disclosure { margin: 0; }`：steps 档四个收起标题的间距变成 56、55、55 CSS 像素（修前 55、71、55）；卡片不显示时 `#guide-steps` 里没有折叠区，不受影响。
  2. 481–600px 视口里页头标题缩到 20px、不折行，语言框占剩下的宽度并靠右，下拉框可以变窄（`@media (min-width: 481px) and (max-width: 600px)`；480 及以下照旧换行）。实测 600 宽四语 h1 都是一行、与语言框同行：en 标题 203px、下拉框保持 255px 全宽；es 标题 292px、下拉框从 271px 收到 193px，481 宽时收到 75px。下拉框变窄时，选中项是较长的“跟随浏览器（当前：…）”那一项，文字尾部会被截掉；选中具体语言时看得全，展开的列表不受影响。B21 (l) 600 档加了这项读数断言（先 RED：en、es 600 报“页头 h1 折成 2 行”，修后 GREEN）。
  3. 600px 视口的 `.page` 左右内边距从 12px 改成 16px，页头、tab 栏、卡片、页脚共用这条边界。复跑 20 页 detect：body-text-viewport-edge 消失，只剩 en 的 line-length（① 2 条，② 1280 与 600 各 1 条，③ 1280 1 条）。代价是 600 档内容宽少 8px：tab 栏 en 还余 44px，引擎行在 Linux 字体下 B21 (l) 照常通过。

## 7. 手测项与未覆盖

手测（e2e 判定不了）：

- Windows Chrome + NVDA（或 ChromeVox）：tab 栏方向键与面板名播报，面板名不带“未完成”“需要授权”；窄窗口开关行的播报（名称来自 `<label for>`、说明经 `aria-describedby`）；规则卡 h2 加列表 `aria-labelledby` 的朗读。
- 读配置失败时 `routeOnce("hidden")` 的实际效果（只有静态接线检查）。
- 真实 Chrome 里 Ctrl+点、中键点“继续设置”“查看设置步骤”“详细步骤”在新标签打开，hash 正确（只有静态守门）。
- “调整顺序”模式中点常驻提示里的“查看触发网址”后，焦点落在默认组合一段的复制按钮 `#trigger-default-copy` 上（只有静态守门）。
- Windows 字体（Segoe UI）与 macOS 覆盖式滚动条下：600 宽 tab 栏（en 在 Linux 字体下只余约 3.5px）、引擎行（es 未授权行在 Windows 下原估计只余 13px，修正第 1 轮把 600 宽的页面边距加到 16px 后再少 8px）、481–600 宽页头一行（Windows 字体下标题与下拉框的宽度不同，下拉框靠变窄兜底）。
- 禁用按钮与步骤圆圈的实际对比度；forced-colors 下的开关与 tab 栏。
- `#pair-changed` 在深色模式下的观感（B14 不截这块）。
- es、zh_TW 文案请母语者复核。

已知限制：

- Ctrl+F 搜不到其他 tab 里的文字。面板用普通 `hidden`，没用 `hidden="until-found"`：后者会让隐藏面板留下看不见的 Tab 停靠点（设计稿 3.2、3.12）。

e2e 没覆盖的分支：

- 左侧未授权时 `#pair-grant` 授权后焦点落到 `.perm-line button` 的分支（left-grant）。
- `revealTriggers` 在 steps 档展开 `#guide-default` 的分支。

## 8. 下一轮

整体审查分诊为“以后再说”的小问题，本版不修：

- e2e：`b19-popup.mjs` 的 `cardProblems` 放行 `prevHash` 偏松；`b21-width.mjs` 的 `widthProblems` 对空读数静默通过；`v05-options.mjs` 第 1 步没断言 `#rule-add` 带 `btn-small`。
- 文案：zh_CN、zh_TW 的 `notice_template_changed`“左侧用它的网站搜索”有轻微歧义。
- 行为：弹窗的 `reveal-setup` 赶在设置页首次渲染前到达会丢定位（v0.4 起就有）；“其他组合”生成器的授权按钮没有 id，授权后焦点回到 BODY（设计稿 3.12）；go.html 不深链到 ③。

## 9. 反馈方式

把整份 e2e 报告（`.e2e/report-*.md`）贴回给 Claude。B21 的子项写在报告的“详细说明”小节里，跳过的子项列在“未覆盖”小节。
