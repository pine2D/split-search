# Split Search v0.7 验收清单

扩展 ID 应为 `alngkkgnobglnfbhcplhpaflcgfiajnj`。v0.7 处理用户 2026-10-28 在 Windows Chrome 上冒烟 0.6.1 后的反馈：开关滑块居中（A1）、引擎库去掉百度（A2）、左侧下拉框标出“建议作右侧”（A3）、设置页对话框点外部关闭（A4），以及关键词规则可选“去掉命中的词”（B）。不加权限；存储只多一个可选的规则字段 `strip: true`，DNR、分屏判定、记录形状都不变。设计见 `docs/superpowers/specs/2026-10-28-v0.7-design.md`。

v0.1、v0.3、v0.4、v0.5、v0.6 的表照旧有效，运行方式、显示模式、报告与结果分类都以 v0.1 第 1 节为准。本表只列 v0.7 新增和改写的项目。

## 1. 怎么跑

- 日常回归：`npm run e2e -- --auto-only`。
- 只跑 v0.7 相关的项目：`npm run e2e -- --auto-only --only T25,T26,B16,B20,B22,B23,I18N,B15`（T25、B16、B20 是被 v0.7 改到的旧步骤，期望不变；B15 汇总整次运行的控制台错误）。
- 设计稿第 4.2 节写的“T25 新子项 (m)”“B20 新步骤”“B16 没有百度”按计划拆成了独立的 T26、B23，覆盖内容相同；T25、B16、B20 本身没改。
- 存储基线不变。T26、B22、B23 改到的键都经 `guarded` 写回（见各节），I18N 的 v0.7 检查不保存任何改动。

## 2. T26 关键词规则去掉命中的词（新增，auto）

文件：`scripts/e2e/steps/v07-strip.mjs`。`guarded` 写回 `rightRules`、`customEngines`、`defaultPair`；默认组合写成模拟引擎 A ｜ B（ea ｜ eb），规则 `STRIP_RULE = { id: "r1", when: "words", words: ["vd"], engine: "ec", strip: true }`。每个子项先 `resetTabs`，在 site-x 标签上经 CDP 导航触发，等一对加载完，再用 `ruleRecordProblems` 核对两条记录（左侧不带 rule/base）。查询里的 token 由 `makeToken` 生成，不含 “vd”。

| 子项 | 做法 | 期望 |
|---|---|---|
| (a) 去词 | 触发 “vd <token>” | 左侧网址 = `expectLeft(port, token)`，右侧 = `expectRight(port, "ec", token)`；两侧记录的 query 都是 token；右侧记录 rule r1、base eb |
| (b) 只有规则词 | 触发 “vd” | 不去词：两侧都搜 “vd”；右侧仍换成 ec，记录 rule r1、base eb |
| (c) 其他参数 | 自建触发网址 `http://engine-a.localhost:<port>/search?q=vd+<token>&src=e2e&_ss=ea,eb`（`extraTrigger`） | 左侧 = `…/search?q=<token>&src=e2e`：只换 `q`，`src` 逐字保留、`_ss` 去掉；右侧 ec。单测另核对这个网址能被 DNR 正则认出、`parseTrigger` 读出 “vd <token>”，且与 go.js 的 `stripMarker(replaceQuery(…))` 逐字相同 |
| (d) 关掉 strip | 规则去掉 `strip` 后触发 “vd <token>” | 两侧都搜 “vd <token>”，右侧仍是 ec（rule r1） |
| (e) 隐私 | 照 T25(l)：`privacyProblems` 核对 `storage.sync`、`storage.local`、日志 | sync、local 与日志不含 token，local 只有 `setupDone`，记录键在白名单里；另加 `wordLogProblems`：日志（error 与 info）里不得整词出现 “vd” |

## 3. B22 设置页对话框点外部（新增，auto）

文件：`scripts/e2e/steps/v07-dialogs.mjs`。`guarded` 写回 `customEngines`。设置页开在 `#tab-engines`，先 `Target.activateTarget`。所有点击（打开对话框的按钮、确认框按钮、遮罩）都是 CDP `Input.dispatchMouseEvent` 可信事件（左键、clickCount 1）；遮罩点固定 `(8, 8)`，点之前读对话框的 `getBoundingClientRect`，断言这个点在矩形外（`pointOutside`，与 `dialogs.js` 的判定相同，边上算里面）。Esc 用 `Input.dispatchKeyEvent`。

| 子项 | 做法 | 期望 |
|---|---|---|
| (a) 引擎库 | `#catalog-open` → `#catalog-dialog`（③）、`#image-catalog-open` → `#image-catalog-dialog`（④），点外部 | 都关掉，不弹确认 |
| (b) 表单没改 | `#image-add-open` → `#image-dialog`、`#rule-add` → `#rule-dialog`、`#edit-ec` → `#engine-dialog`，不改就点外部 | 都关掉，不弹 `#discard-dialog` |
| (c) 改过 | 编辑 ec，改名称后点外部 | `#discard-dialog` 打开，`#engine-dialog` 还开着，焦点在 `#discard-save` |
| (d) 继续编辑 | 点 `#discard-keep` | 确认框关，表单开着，名称仍是改过的值，焦点回 `#dlg-name` |
| (d′) 确认框上 Esc | 再点外部 → 确认框开 → 按 Esc | 只关确认框，表单开着、修改还在，焦点回 `#dlg-name` |
| (e) 确认框外部、不保存 | 再点外部 → 确认框开 → 点确认框的遮罩；再点外部 → `#discard-drop` | 点确认框遮罩等同继续编辑（回到表单、修改还在、焦点回 `#dlg-name`）；“不保存”后两个都关，`storage.sync` 整体 JSON 不变，焦点同“取消”回到 `#edit-ec` |
| (f) 保存 | 再改名 → 点外部 → `#discard-save` | 两个都关，5 秒内 `customEngines` 里 ec 的名称变成新值 |
| (g) 校验不过 | 网址改成 `not a url` → 点外部 → `#discard-save` | 确认框关，表单留着并显示网址字段错误；再点 `#dlg-cancel` 关掉 |
| (h) 拖出不算 | 在 `#dlg-name` 里按下，分三步 `mouseMoved` 到 (8, 8) 松开 | 表单不关，不弹确认 |
| (i) Esc 与取消 | 改名后按 Esc；再打开、改名后点“取消” | 都直接关，不弹确认，也没有 JS 对话框 |
| (j) 保存进行中 | 编辑 ec、改名；在设置页里把 `chrome.storage.sync.set` 换成计数并扣住结果的版本（`HOLD_SETS`）；点 `#dlg-save`，等它禁用后点外部；再放行 | 保存中点外部不关、不弹确认；放行后两个都关，`set` 只调用 1 次，ec 名称是新值；收尾换回原来的 `set` |

## 4. B23 设置页 v0.7 小改动（新增，auto）

文件：`scripts/e2e/steps/v07-options.mjs`。`guarded` 写回 `rightRules`、`presetOverrides`；开始时删掉 `rightRules`；Perplexity 被隐藏时临时取消隐藏。

| 子项 | 做法 | 期望 |
|---|---|---|
| (a) 引擎库（A2） | 打开右侧引擎库 | 每个 `h3` 后紧跟的 `ul.catalog-list` 至少一行（没有空分类）；条目名与 `data-entry` 里没有百度（`catalogProblems`） |
| (b) 左侧下拉框（A3） | 读 `#pair-left` 里 value 为 perplexity 的选项 | 文字等于 `msg("engine_left_discouraged_suffix", "Perplexity")`（zh_CN：“Perplexity（建议作右侧）”） |
| (c) 复选框显隐 | 点“新增规则” | “这些词”时 `#rule-strip` 与 `#rule-strip-hint` 可见、默认不勾；勾上后切“某种文字”，两者看不见；切回来仍可见且保持勾选 |
| (d) 勾选保存 | 填 vd、选 ec、勾上保存 | 存储为 `[{ id: "r1", when: "words", words: ["vd"], engine: "ec", strip: true }]`；r1 行内 `.rule-strip` 文字等于 `msg("options_rules_strip_row")` |
| (e) 取消勾选 | 编辑 r1，取消勾选后保存 | 存储里没有 `strip` 键，行内没有 `.rule-strip` |

## 5. 改写的项目

| # | 检查 | 期望 | 覆盖 |
|---|---|---|---|
| I18N（扩充） | 每种语言另开一个设置页（`#tab-pair`）做 `v07I18nChecks`（`v07-i18n.mjs`） | 规则对话框：点 `#rule-add`、勾上 `#rule-strip`，标签文字是该语言的 `options_rules_strip_label`，把复选框滚到中间后对 `#rule-dialog` 的按钮、label、legend、select 做溢出审计，截 `.e2e/i18n/<语言>-rule-dialog-strip.png`，点“取消”关掉（不保存）。保存确认：切到 ③，可信点击 `#edit-ec`，名称后加 “ x”，点遮罩，等 `#discard-dialog` 打开、标题是该语言的 `options_discard_title`；对确认框做溢出审计，`lineProblems` 核对三个按钮各一行，截 `<语言>-discard-dialog.png`；点“不保存”关掉，存储不变 | e2e auto |
| B16、B20、T25（期望不变） | v0.7 改了引擎库数据、规则对话框、`ruleRight` 的返回值 | 原有断言照旧通过；没有百度、规则复选框、去词的新断言都在 B23、T26 里 | e2e auto |

## 6. A1 开关滑块（本机验证一次，不做常驻断言）

改动在 `3f7d07d`（`src/options/options.css` 的 `.switch`）：轨道加 `border: 0`；滑块 `::after` 改成 `top: 3px; bottom: 3px; left: 3px; aspect-ratio: 1`（大小和位置都从轨道推出，不写死 14px），开启时 `left: auto; right: 3px`。轨道尺寸 34×20、颜色、焦点框、`forced-colors` 分支不变。

- 原因推断：Windows Chrome 上复选框带默认边框时，写死的 `left/top` 从 padding box 算起，滑块会往右下偏约 1px；用户截图里轨道是主题绿色，说明没开高对比度，`forced-colors` 分支不是原因。
- 本机验证（WSL 的 Google Chrome，提交 `3f7d07d` 时做）：按 1、1.25、1.375、1.5 倍设备缩放渲染开、关两种状态，分别在轨道没有边框和人为加 1px 边框两种情况下量，滑块上下、左右的边距相差都不超过 1 个设备像素，即都居中。
- 这一步在改之前的本机上也能过，证明不了 Windows 上已经修好，所以**仍需用户在 Windows Chrome 上再看一眼**（第 7 节第 1 条，截至本表写成时尚未复测）；还不对就再来一轮。

## 7. Windows 手测项（设计稿第 6 节）

用户在 Windows Chrome 上装好 0.7.0 后逐条看，结果回报给 Claude：

1. 设置页“搜索组合”的窄窗口开关：开、关两种状态，白色滑块都在轨道里上下、左右居中（A1）。**待复测。**
2. 规则“有 vd → YouTube”勾上“搜索时去掉这些词”，在地址栏搜 “vd test”：左侧 Kagi 和右侧 YouTube 都只搜 “test”（B）。
3. 右侧引擎库、以图搜图引擎库点外部关闭；编辑引擎时改了名称再点外部，出现“保存修改吗？”确认框（A4）。
4. 默认组合卡的左侧下拉框里 Perplexity、YouTube 带“（建议作右侧）”（A3）。

## 8. 完整 e2e 结果

2026-10-28 在 main `6c3dfa2`（版本号仍是 0.6.1）上跑 `npm run e2e -- --auto-only`：Xvfb :90（2400×1500）、Chrome 156.0.8078.47，无人值守，用时约 6 分 23 秒。报告 `.e2e/report-20261028-121927.md`（不进 git）。

- 汇总：共 51 步，通过 50，失败 0，跳过 0，预期降级 1；`[split-search]` 控制台错误 0 条（B15）。
- v0.7 的步骤：T26 5/5、B22 9/9、B23 5/5、I18N 8/8（含每种语言的 `rule-dialog-strip`、`discard-dialog` 截图）；被改到的旧步骤 T25 14/14、B20 11/11、B16 4/4、B21 16/16 照旧通过。
- 预期降级 1：T14 里 Perplexity 作左侧（它的 Service Worker 接管导航，退化成普通搜索，G5），与以前各版相同。
- 子项跳过 1：T8(d) 站点访问“点击时”不适用（本扩展只有可选 host 权限，没有这个下拉），与以前各版相同。
- 收尾：storage 恢复后摘要与运行前一致；网站搜索默认引擎改回 kagi.com，专用条目都删掉；测试窗口改回运行前的尺寸。

商店包冒烟（`npm run pack -- --store-key … --smoke`）留到版本号改成 0.7.0 之后做，结果记在发版提交里。

## 9. 未覆盖与已知限制

e2e 判定不了或没覆盖的：

- 开关滑块的居中（第 6 节，只在本机量过一次；Windows 待复测）。
- 带 strip 的规则命中后，弹窗里的规则说明：记录里的 query 已经没有命中的词，`explainRule` 解释不出，显示通用说明 `popup_rule_generic` 和“换回 <原右侧>”（设计稿 3.5 的取舍，不为此多存原查询或命中的词）。没有 e2e，`explainRule` 的单测只覆盖“解释不出返回 null”的一般情形。
- `dialogs.js` 的 DOM 部分（`lightDismiss` 分支、确认框焦点归还、晚到的 `close` 事件、表单关掉时连带关掉确认框）没有单测，只有 B22 覆盖；“保存进行中”只在 B22 (j) 测了外部点击被忽略，确认框上“保存”遇到禁用的提交按钮被忽略这一支没有 e2e（正常流程里到不了：保存中点外部不会再弹确认框）。
- es、zh_TW 新文案（“搜索时去掉这些词”、保存确认）请母语者复核。

已知限制（设计稿接受）：

- 0.5、0.6 不认识 `strip`：读的时候丢掉；在旧版本上编辑任何一条规则，写回时所有规则的 `strip` 都会丢掉。只在新旧两个版本同时装、又在旧版本上改规则时发生，CHANGELOG 写明。
- 规范化和原文对不上的少见查询（大写希腊文词尾 Σ、半角片假名浊点、NFD 日文浊音等），整条查询不去词，仍按原查询正确搜索（实施时的裁定，比设计稿 3.3 的“这一处不删”更保守）。
- 规则词正好止于第 1000 个规范化码点、原文后面紧接着字母时，可能删掉半个词（与 `scanQuery` 的截断语义一致）。
- 去词的判定与 `matchWord` 相同，所以 “Objective-C++ 模板” 配词 `c++` 会去成 “Objective- 模板”。
- 左侧模板的 `%s` 在路径里（路径型模板），或原始网址里这个参数缺失、出现不止一次时，`replaceQuery` 抛错，整条规则不生效：右侧回到 `_ss` 原来的引擎，两侧都搜原查询。
- 右键菜单项加扩展图标做不到：`contextMenus` 没有图标参数，图标由 Chrome 自己加（设计稿第 1 节第 3 条）。

## 10. 反馈方式

把整份 e2e 报告（`.e2e/report-*.md`）贴回给 Claude。T26、B22、B23 的子项写在报告的“详细说明”小节里，跳过的子项列在“未覆盖”小节。
