# Split Search v0.6 设置页分 tab 与宽度统一 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置页分成 4 个顶部 tab（添加到 Chrome｜搜索组合｜搜索引擎｜右键查询），内容列收到 680px、所有块顶到同一条右边界，关键词规则提成“搜索组合”里默认展开的独立卡，跨 tab 依赖用就地提示框、带按钮的提示、tab 标记和页内链接接上，发 v0.6.0。

**Architecture:** 路由的纯逻辑放新文件 `src/lib/options-route.js`（hash 解析、默认 tab、方向键），网址切段放 `src/lib/url-break.js`；`src/options/tabs.js` 是唯一管 tab 栏、`hashchange` 和 `#tab-*` 链接委托点击的模块，焦点去向由 options.js 注入。`render()` 仍整页重建、四个面板都渲染、只切 `hidden`；默认 tab 只在首次 render 判一次（`routeOnce`）。默认组合卡挪进新文件 `src/options/pair.js`，“改了组合”的提示状态只在本页内存。

**Tech Stack:** Chrome MV3（minimum 155），原生 ES 模块，无构建、无依赖；`node --test`；e2e 用 `scripts/e2e`（CDP 管道，Node 24）。

**Spec:** `docs/superpowers/specs/2026-10-27-options-tabs-design.md`（用户 2026-10-27 批准，含第 10 节四项决定）。下文“设计稿 X.Y”指它的章节；计划与设计稿冲突时以设计稿为准，下面“与设计稿的出入”一节列出的除外。

基线：main @ 3cf1688（与设计稿基线 1ce8561 相比只多了设计稿本身的提交，`src/`、`scripts/`、`test/` 无变化）。下文行号都在 3cf1688 上核对过。在 main 上做还是在 worktree 分支上做由用户选，本计划两种都适用，不含 rebase、合并、打标签和推送的步骤。

## 与设计稿的出入

核对设计稿引用的文件与代码后发现的不符。设计稿不改，按右列处理。

| # | 设计稿 | 代码实际 | 处理 |
|---|---|---|---|
| 1 | 5.7：T1 就跑 `--only …,B21,…`；7 节把 B21 全部子项放在 T2、T3 | `scripts/e2e/steps/index.mjs:58–63` 的 `selectSteps` 遇到不认识的 id 直接抛“未知步骤”（:62），T1 时还没有 B21，整条命令跑不起来 | B21 的 (a)(b)(c)(d)(e)(i)(j) 测的都是 T1 的代码（tab 骨架、路由、`leaveReorder`、已开页），挪进 Task 1，`b21.mjs` 在 Task 1 建好并登记；(l) 留在 Task 2（`b21-width.mjs`），(f)(g)(h)(k) 留在 Task 3（`b21-links.mjs`）。三个文件的分工与设计稿 5.4 相同，5.7 的命令每个任务照抄都能跑 |
| 2 | 5.7 的 `--only` 清单不含 B15 | B15（id 在 options-b2.mjs:183，`last: true`）汇总此前所有步骤的 `[split-search]` 控制台错误；不点名就不跑，tabs.js 抛的错会漏掉。CLAUDE.md v0.5 一节的命令也显式带 `B15` | 每条 e2e 命令在设计稿清单末尾加 `,B15`，其余照抄 |
| 3 | 3.13“依赖方向：`tabs.js` 只依赖 `lib/options-route.js`” | 3.3 要求 ① 的标记里放 `icons.js` 的 `alert-circle` 和带 `data-i18n` 的 `.sr-only`（换语言由 `applyI18n` 重写），这两样分别来自 `src/ui/icons.js` 的 `icon` 和 `src/options/ui.js` 的 `ht` | tabs.js 另 import `./ui.js`（`ht`）与 `../ui/icons.js`（`icon`）。两者模块顶层都不碰 `document`（ui.js 已被 `test/options-actions.test.js` 在 Node 里导入过），也不 import tabs.js，没有循环；tabs.js 仍不 import setup.js、guide.js、actions.js |
| 4 | 5.2：I18N 的 600 宽审计（`setDeviceMetricsOverride` 宽 600）随 `auditTabs` 在 T1 做 | 600 宽下的引擎行、卡头、页头要等 Task 2 的 3.4、3.5 CSS 才稳定；放在 T1 会让 T1 为 T2 的问题失败 | `auditTabs` 的 1280 宽部分在 Task 1，600 宽那一段在 Task 2 加进同一个函数 |
| 5 | 6 节、7 节 T6 第 3、4 步：rebase 到 main、`git merge --ff-only`、在 main 的 HEAD 上打本地标签 `v0.6.0` | 控制方指示：标签由控制方在用户确认后打；main 还是 worktree 由用户选 | Task 6 不写 rebase、合并、打标签、推送；其余收尾照设计稿 |
| 6 | 7 节 T6 第 1、2 步：先把版本号、CHANGELOG 提交，再跑完整 e2e 与 `pack --store-key … --smoke` | 控制方指示：完整 e2e、`npm run pack -- --smoke` 在前，`chore: release v0.6.0` 提交之后再冒烟一次 | Task 6：版本仍是 0.5.0 时跑完整 e2e 和 `npm run pack -- --smoke`（发布提交前必须冒烟通过）；release 提交后再跑 `npm run pack -- --store-key ~/.config/split-search/cws-public-key.pem --smoke`（CLAUDE.md“商店信息”规定之后每版都带商店公钥）。升版前那次 pack 按 manifest 版本命名、先 `rmSync` 再写（scripts/pack.mjs:90、:99），会覆盖待上传的商店公钥版 `dist/split-search-0.5.0.zip`：pack 前把它复制到 scratchpad 并记下 sha256，冒烟后放回原处、核对 sha256 一致（与 v0.5 发布时的做法相同）。两次都满足 pack 的发布前检查（`src/` 无未提交改动、manifest 与 package.json 版本一致） |

## 计划定下的开放项

- `routeFromHash` 只认逐字相等的 hash：`#TAB-pair`、`#tab-pair/`、`#tab-%70air`、`#`、空串、`null`、`undefined` 都返回 `{}`，不抛错。`initialTab` 对认不出的 `mode` 按“卡片不显示”处理（进 ②）。
- `stepTab(keys, current, key)` 只认 `ArrowLeft`、`ArrowRight`、`Home`、`End`，其他键返回 `null`；`current` 不在 `keys` 里时方向键返回 `null`，Home/End 照常。tabs.js 的 keydown 遇到 `altKey`、`ctrlKey`、`metaKey` 任一为真直接返回、不 `preventDefault`（Alt+← 是浏览器后退）。
- `initTabs` 的 `onLeave(fromKey)` 每次离开一个 tab 都调；options.js 传 `from => { if (from === "engines") leaveReorder({ focus: false }); }`。`routeOnce` 不调 `onLeave`。
- hashchange 收到 `#tab-*` 时直接调 `showTab(key)`：它会 `replaceState` 写同一个 hash，等于不写，不另加参数。
- options.js 在模块顶层、`render()` 之前同步调 `initTabs(...)`（不放进 `i18nReady.then`），保证首次 render 里的 `routeOnce` 之前监听已挂好。
- `urlBreakParts`：在 `/ ? & = ,` 之后切段，连续的分隔符算一处；开头的 `<scheme>://`（`/^[a-z][a-z0-9+.-]*:\/\//i`）不单独成段，和它后面的 host 一段直到下一个分隔符之后。所以 `chrome://settings/searchEngines` 切成 `["chrome://settings/", "searchEngines"]`，与设计稿 3.10 手写的 `chrome://settings/<wbr>searchEngines` 一致。各段 `join("")` 恒等于原串；空串、非字符串返回 `[]`。
- “改了组合”的判定是三个纯函数，放进 `src/options/edits.js`（设置页纯逻辑，已有 `test/options-edits.test.js`），pair.js 只持有模块变量并调用它们：`notePairChange`、`pairChangedView`、`pairSavedKey`（签名见 Task 3）。不放 lib：它们只服务设置页，和 `generatorPick` 同类。
- `#pair-changed` 里的网址框用 `urlBox(url, undefined, "guide_copy_default_aria")`；`$PAIR$` 代入 `t("guide_pair_label", 左.name, 右.name)`。两条链接不加 id，B21 按 `#pair-changed a[href="#setup"]`、`a[href="#guide-steps"]` 找；末行指引按 `#pair-body a[data-reveal="generator"]` 找。链接的 onclick 先 `ev.preventDefault()`，否则浏览器会改 hash、再经 hashchange 重复 reveal。
- B21 里点 tab、点按钮一律先 `focus()` 再 `click()`（同 B20 的 `press`），键盘用 CDP `Input.dispatchKeyEvent`；只有授权按钮用 CDP `Input.dispatchMouseEvent` 可信点击（同 B4）。
- e2e 的纯判定函数（`tabStateProblems`、`widthProblems`、`tabAuditProblems`）照 `auditProblems`、`substepProblems` 的做法导出，在 `test/e2e-b21.test.js`、`test/e2e-i18n.test.js` 里先写测试。
- 截图（Task 6）三张都在 `setupDone: true`、五个预置引擎已授权的状态下拍，tab 栏上没有 ① 的标记；`options-top.png` 用 `#tab-pair`，`options-engines.png` 用 `#tab-engines`，`options-fullpage.png` 用 `#tab-add`。

## Global Constraints

- `permissions` 只能是 `["activeTab", "contextMenus", "declarativeNetRequest", "storage"]`，`optional_host_permissions: ["https://*/*", "http://*/*"]`，没有 `host_permissions`；本批不加任何权限，manifest 只在 Task 6 改 `version`。
- 权限、存储键与写法、DNR、分屏判定、所有硬约束不变（设计稿 1）。tab 状态只放在网址 hash 里，不进 `chrome.storage`（`storage.local` 只许 `setupDone`，`storage.session` 只多 `setupTryTabs`），也不用 `sessionStorage`。
- 弹窗、`background.js`、`go.js`、`lib/messages.js` 不改。
- `render()` 仍是整页重建；四个面板都渲染，只切显隐；切 tab 不触发 render。
- 所有现有 `section.card` 的 `aria-labelledby` 和 h2 的 id、所有现有控件 id（`#setup-*`、`#pair-left`、`#gen-left`、`#lookup-engine`、`#engines-reorder`、`#edit-<id>`、`#cycle-<id>`、`#rule-*` 等）不变。
- tab 的 key 与 id：`TAB_KEYS = ["add", "pair", "engines", "lookup"]`；按钮 `#tabbtn-<key>`、名称 `#tabname-<key>`、面板 `#panel-<key>`、标记 `#tab-flag-add`；tab hash 是 `#tab-<key>`；类名 `.tabbar`、`div.tablist[role=tablist]#tabs`、`button.tab`、`.tab-flag`（`.todo` / `.regrant`）。
- 面板一律用普通 `hidden`，不用 `hidden="until-found"`，面板不写任何 `display` 样式；`.tab-flag` 不用 `hidden` 切换，用类。静态 HTML 里四个按钮都 `aria-selected="false" tabindex="-1"`、四个面板都 `hidden`。
- 键盘：←/→ 循环、Home/End，焦点和选中一起移动；不处理 ↑/↓，不占用 Ctrl+PageUp/PageDown。tab 栏不吸顶，切换没有动画。
- `--page-max: 680px`（卡片内宽 638px）；四种语言说明都不设行长上限；`.engine-main, .rule-main { flex: 1 1 180px; min-width: 0; }`。
- 不加颜色变量（只用 `src/styles/tokens.css` 现有变量），不加图标（只用 `ui/icons.js` 已有的），不加依赖。`test/popup-css.test.js`、`test/ui-icons.test.js` 守着。
- JS 单文件 ≤300 行（含 `scripts/e2e/`，`test/` 除外）。`src/lib/` 不得引用 `chrome`；`src/lib/` 新增逻辑先写 node 测试，再写实现。`npm test` 等价于 `node --test`（Node 24 上不能写成 `node --test test/`）。
- `tabs.js`、`guide.js` 不得在模块顶层访问 `window`、`location` 或 `document`（`test/options-actions.test.js` 是守门）。
- 整个 `src/options/` 只有 tabs.js 注册 `hashchange`。
- 界面文案只在 `src/_locales/{en,zh_CN,zh_TW,es}/messages.json`，四种同时补齐、删除，zh_CN 是源文案；新 key 都要有 `description`（不得含 `[needs-translation]`），占位符写成 `$NAME$` + `placeholders`。代码和 HTML 里不出现界面文字。
- 文案流程（CLAUDE.md“## 文案”）：zh_CN 先用 lieflat-less-ai-tone + humanizer-zh 定稿 → en 按市场转写后过 humanizer；zh_TW 过 humanizer-zh 再按台湾用语审校（不得有简体字和大陆用语）；es 用 content-l10n 做本地化质检，再按母语标准审校（中性国际西语，用 tú）→ 每种语言单独再润一轮。术语以 `docs/i18n/chrome-terms.md` 为准（“搜索引擎”与 Chrome 一字不差；“拆分视图”zh_TW 是「分割畫面」；“快捷键”zh_TW「快速鍵」、es «Acceso directo»，不和“快捷字词”混用）。Task 1–4 只写草稿，Task 5 定稿。
- 日志（`console.info`/`console.error`）不带网址、关键词；打印错误一律经 `lib/safe-error.js`（`test/log-wiring.test.js` 守着）。
- e2e 只在测试配置 `~/.cache/split-search-e2e/profile` 里跑，运行前关掉占用它的 Chrome；绝不读写 `~/.config/google-chrome`、`~/.chrome-debug-profile` 或任何 Windows 配置。扩展只用“重新加载”，manifest 的 `key` 不动。
- `src/manifest.json`、`package.json` 在 Task 1–5 期间保持 `0.5.0`，只在 Task 6 的 release 提交里改成 `0.6.0`。
- 提交用 git-commit skill（Conventional Commits），命令 `git -c user.name=pine2D -c user.email=oumu323@gmail.com commit`，消息末尾两行：
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9`
- 不推送、不打标签。

## Review Focus

设计稿隐含、但它的测试清单没覆盖、最可能让用户碰上的五类输入：

1. 手打或别处复制来的怪 hash（`#TAB-pair`、`#tab-pair/`、百分号编码的 `#tab-%70air`、只有 `#`、空 hash）：一律当认不出处理，进默认 tab，不抛错、不滚动。测试在 Task 1（`test/options-route.test.js` 的 `routeFromHash`、`initialTab` 各一组）。
2. 焦点在 tab 上按带修饰键的方向键（Alt+← 是浏览器后退，Ctrl+→ 等）或 ↑/↓：tab 不变、事件不被 `preventDefault`，浏览器自己的快捷键照常。测试在 Task 1（`test/options-route.test.js` 的 `stepTab` 非方向键返回 `null`；B21(b) 派发带 `altKey`/`ctrlKey` 的 keydown 与 ArrowDown，核对选中项不变、`defaultPrevented === false`）。
3. 停在非默认 tab 时换界面语言（本页下拉框或另一页改 `uiLocale`）：仍停在原 tab、hash 不变，tab 名和 ① 标记的读屏文字换成新语言。测试在 Task 1（B21 新子项 (m)）。
4. 开着两个设置页，A 页改了默认组合：只有 A 出现 `#pair-changed`，B 页（没保存过）不出现；B 页把组合改回 A 的原组合后，A 的提示框在下一次渲染消失。测试在 Task 3（`test/options-edits.test.js` 的 `pairChangedView(null, …)` 与改回原组合两例；B21(g) 末尾加第二个设置页的核对）。
5. 页面开着时在地址栏手改 hash：改成 `#setup` 而卡片隐藏时不切 tab、不动焦点；`#tab-foo` 什么都不做；`#tab-lookup` 切到 ④；`#guide-steps` 切到 ①、hash 变成 `#tab-add`、焦点给 5 步说明的标题。测试在 Task 1（B21 新子项 (n)）。

---

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/lib/options-route.js`（新，约 45 行） | `TAB_KEYS`、`tabHash`、`routeFromHash`、`initialTab`、`stepTab` | 1 |
| `src/options/tabs.js`（新，约 125 行） | tab 栏点击与键盘、唯一的 `hashchange`、`#tab-*` 链接的委托点击、`showTab`、`activeTab`、`routeOnce`、`setTabFlag`、`focusIn` | 1 |
| `src/options/options.html` | 设计稿 3.2 骨架（Task 1）；`#hidden-title`、静态 `<wbr>`（Task 2）；`#guide-step-grant`（Task 3）；`#rules-card`（Task 4） | 1–4 |
| `src/options/options.css`（352） | tab 栏与 `body.loading .page`（1）；3.4、3.5、3.10 宽度与杂项（2）；开关行、`.step-links`（3） | 1–3 |
| `src/options/options.js`（211） | 接 tabs、`routeOnce`/`setTabFlag`/`focusIn`、reveals（1）；`#hidden-title` 显隐（2）；挪出 pair（3）；`#rules-body`（4） | 1–4 |
| `src/options/setup.js`（224） | 去 hashchange 与 `hashTarget`、`revealSetup` 先切 ①、`renderSetup` 返回 mode、导出 `requestReveal`（1）；“更换组合”与 `.step-links`（3） | 1、3 |
| `src/options/guide.js`（131） | `revealGuideSteps` 先切 ①、`#guide-other`（1）；`urlBox` 插 `<wbr>`（2）；`revealGenerator`、`revealTriggers`（3） | 1–3 |
| `src/options/reorder.js`（95） | 导出 `leaveReorder` | 1 |
| `src/options/actions.js`（220） | `undoHide` 用 `focusIn`（1）；模板提示带按钮（3） | 1、3 |
| `src/lib/url-break.js`（新，约 12 行） | `urlBreakParts` | 2 |
| `src/options/engine-list.js`（250） | `renderHiddenList` 空时返回 `null` | 2 |
| `src/options/pair.js`（新，约 115 行） | 默认组合卡：窗格、`#pair-changed`、开关行、`#pair-grant`、末行指引、按 mode 的保存提示 | 3 |
| `src/options/edits.js`（225） | `notePairChange`、`pairChangedView`、`pairSavedKey` | 3 |
| `src/options/locale-ui.js`（28） | RICH_TEXT 加 `guide-step-grant` | 3 |
| `src/options/rules.js`（169） | 规则卡：去折叠区、`#rule-list` 的 `aria-labelledby`、`#rule-add` 改小按钮 | 4 |
| `src/_locales/*/messages.json` ×4 | 设计稿第 4 节、3.11 | 1–5 |
| `test/options-route.test.js`、`test/url-break.test.js`、`test/e2e-b21.test.js`（新）；`test/options-wiring.test.js`、`test/i18n-catalog.test.js`、`test/options-edits.test.js`、`test/e2e-i18n.test.js` | 单测 | 1–4 |
| `scripts/e2e/steps/optpage.mjs`（163） | `openOptions({ tab })`、`withOptions(…, opts)`、`showTab` | 1 |
| `scripts/e2e/steps/b21.mjs`（新，约 260）、`b21-width.mjs`（新，约 150）、`b21-links.mjs`（新，约 200） | B21 | 1、2、3 |
| `scripts/e2e/steps/i18n-audit.mjs`（91）、`i18n.mjs`（269） | `OPEN_ALL` 挪过来、`auditTabs`、截图改名、600 宽审计 | 1、2 |
| 现有步骤（options-b、options-b2、options-b3、b4、b14、b19、b19-popup、v03-options、v04-options、v04-i18n、v05-options、v05-i18n、index） | 设计稿 5.2、5.3 | 1、3、4 |
| `docs/acceptance-v0.6.md`（新）、CLAUDE.md、README×4、`docs/_config.yml`、验收表 v0.4/v0.5、截图与模板、CHANGELOG、版本号 | 收尾 | 6 |

## 任务总览（与设计稿第 7 节的对应）

| 计划 | 设计稿 | 调整 |
|---|---|---|
| Task 1 tab 骨架与路由 | T1 | 多了 B21 的 (a)(b)(c)(d)(e)(i)(j) 与新增的 (m)(n)（出入第 1 条、Review Focus 第 3、5 条）；I18N 只做 1280 宽（出入第 4 条） |
| Task 2 宽度与页头 | T2 | 只含 B21(l)；I18N 的 600 宽审计挪到这里 |
| Task 3 跨 tab 依赖 | T3 | 只含 B21 的 (f)(g)(h)(k)；“改了组合”的判定抽成 edits.js 的纯函数先写测试 |
| Task 4 规则卡 | T4 | 无 |
| Task 5 四语文案定稿 | T5 | 无 |
| Task 6 收尾与发布 | T6 | 不含 rebase、合并、打标签（出入第 5、6 条） |

---

### Task 1: tab 骨架与路由

设计稿 3.1、3.2、3.3（样式、键盘、标记）、3.6、3.7 中 reveal-setup 与“详细步骤”两行、3.8 的 `focusIn` 与离开 ③、5.1、5.2、5.4 (a)(b)(c)(d)(e)(i)(j)，第 4 节新增表的前 7 个 key。

**Files:**
- Create: `src/lib/options-route.js`、`test/options-route.test.js`
- Create: `src/options/tabs.js`
- Create: `scripts/e2e/steps/b21.mjs`、`test/e2e-b21.test.js`
- Modify: `src/options/options.html:13-98`（骨架）
- Modify: `src/options/options.css:19`（`body.loading .page`），文件末尾加设计稿 3.3 的整段
- Modify: `src/options/options.js:14`（import）、`:34-42`（`FOCUS_FALLBACK`、`focusAfterRender`）、`:91-140`（`render`）、`:195-211`（启动）
- Modify: `src/options/setup.js:58-70`（`initSetup` 去掉 hashchange）、`:182-197`（`hashTarget`、`revealPending`、`requestReveal`、`revealSetup`）、`:199-224`（`renderSetup` 返回值）
- Modify: `src/options/guide.js:73-74`（`withId(…, "guide-other")`）、`:122-131`（`revealGuideSteps`）
- Modify: `src/options/reorder.js:38-45`（`leave` → 导出 `leaveReorder`）
- Modify: `src/options/actions.js:197-200`（`undoHide`）
- Modify: `src/_locales/{zh_CN,en,zh_TW,es}/messages.json`（7 个新 key）
- Modify: `test/options-wiring.test.js`、`test/e2e-i18n.test.js`
- Modify: `scripts/e2e/steps/optpage.mjs:27,72`、`options-b.mjs:19,104,125,237,274`、`options-b2.mjs:45,85,134`、`options-b3.mjs:31,100`、`b4.mjs:55`、`v03-options.mjs:82`、`v04-options.mjs:188`、`v04-i18n.mjs:57`、`v05-options.mjs:270`、`v05-i18n.mjs:30`、`b14.mjs:184`、`b19-popup.mjs:24-47,121-130`、`i18n.mjs:22,128-150`、`i18n-audit.mjs`、`index.mjs`

**Interfaces:**
- Consumes: `setupView` 的四个 mode（`lib/setup-state.js`，不改）；`keepSetupDone`、`setDone`（b19.mjs）；`plainTab`、`popupPage`、`POPUP_URL`（v03-popup.mjs）；`sub`、`verdict`（v03-lib.mjs）；`summarize`（util.mjs）。
- Produces:
  - `lib/options-route.js`：`TAB_KEYS: string[]`（值见 Global Constraints）；`tabHash(key: string): string`；`routeFromHash(hash: string|null|undefined): { tab: string } | { reveal: "setup"|"guide-steps" } | {}`；`initialTab(hash, { mode }): string`；`stepTab(keys: string[], current: string, key: string): string|null`。
  - `options/tabs.js`：`initTabs({ onReveal: (target: "setup"|"guide-steps") => void, onLeave: (fromKey: string) => void, reveals: Record<string, () => void> }): void`；`showTab(key: string, { focusTab = false } = {}): void`；`activeTab(): string|null`；`routeOnce(mode: string): void`（只第一次生效）；`setTabFlag(mode: string): void`；`focusIn(el: Element|null): void`。
  - `options/setup.js`：`renderSetup(el, ctx): "steps"|"regrant"|"done"|"hidden"`；`requestReveal(target: "setup"|"guide-steps"): void`（新导出）。
  - `options/reorder.js`：`leaveReorder({ focus = true } = {}): void`（不在模式中时什么都不做；`focus: false` 时不把焦点给 `#engines-reorder`，其余与原 `leave` 相同：退出、`flush`、`render`）。
  - `options/guide.js`：“其他组合”的 `<details>` 有 id `guide-other`。
  - `optpage.mjs`：`openOptions(browser, { newWindow = false, hash = "", tab = null } = {})`（给了 `tab` 且没给 `hash` 时网址后接 `#tab-<tab>`）；`withOptions(browser, fn, opts)`（opts 透传）；`showTab(page, key): Promise<void>`（`focus()`+`click()` `#tabbtn-<key>`，等 `#panel-<key>` 的 `checkVisibility()` 为 true）。
  - `i18n-audit.mjs`：`OPEN_ALL`（从 i18n.mjs:22 挪来，原样）；`tabAuditProblems(key: string, s: { visible: number }): string[]`；`auditTabs(ctx, opt, locale): Promise<{ problems: string[], shots: string[] }>`。
  - `b21.mjs`（超过 300 行时 (m)(n) 拆到 `b21-links.mjs` 的 `hashLocaleChecks`，见 Step 12）：`B21`（`{ id: "B21", title: "设置页 tab 与宽度", kind: "auto", needs: [], restores: true, timeoutFactor: 2, timeoutExtraMs: GRANT_TIMEOUT_MS }`）；`tabStateProblems(s, key: string): string[]`，`s = { tabs: [{ id, selected, tabindex, controls }], panels: [{ id, labelledby, hidden, visible }] }`。
  - `options-b.mjs`：`export async function openOptionsFromPopup(ctx, page, made)`（只加 `export`）。

- [ ] **Step 1: 写 `test/options-route.test.js`（先失败）**

```js
import { TAB_KEYS, tabHash, routeFromHash, initialTab, stepTab } from "../src/lib/options-route.js";

test("TAB_KEYS 与 tabHash", () => {
  assert.deepEqual(TAB_KEYS, ["add", "pair", "engines", "lookup"]);
  assert.equal(tabHash("engines"), "#tab-engines");
});
test("routeFromHash：认得出的三类", () => {
  for (const k of TAB_KEYS) assert.deepEqual(routeFromHash(`#tab-${k}`), { tab: k });
  assert.deepEqual(routeFromHash("#setup"), { reveal: "setup" });
  assert.deepEqual(routeFromHash("#guide-steps"), { reveal: "guide-steps" });
});
test("routeFromHash：认不出的一律 {}（含元素 id 与 Review Focus 1 的怪 hash）", () => {
  for (const h of ["#tab-foo", "#guide", "#engines", "#triggers", "#cycle", "#rules-card", "#shortcut",
    "", "#", null, undefined, "#TAB-pair", "#tab-pair/", "#tab-%70air", "tab-pair", "#Setup"]) {
    assert.deepEqual(routeFromHash(h), {}, String(h));
  }
});
test("initialTab：有效 #tab-* 优先", () => {
  for (const mode of ["steps", "regrant", "done", "hidden"]) assert.equal(initialTab("#tab-lookup", { mode }), "lookup");
});
test("initialTab：#setup 按卡片是否显示；#guide-steps 总是 ①", () => {
  assert.equal(initialTab("#setup", { mode: "steps" }), "add");
  assert.equal(initialTab("#setup", { mode: "regrant" }), "add");
  assert.equal(initialTab("#setup", { mode: "done" }), "pair");
  assert.equal(initialTab("#setup", { mode: "hidden" }), "pair");
  for (const mode of ["steps", "hidden"]) assert.equal(initialTab("#guide-steps", { mode }), "add");
});
test("initialTab：无 hash 或认不出时 steps/regrant 进 ①，其余进 ②", () => {
  for (const h of ["", "#tab-foo", "#engines", "#guide", undefined, "#"]) {
    assert.equal(initialTab(h, { mode: "steps" }), "add", String(h));
    assert.equal(initialTab(h, { mode: "regrant" }), "add", String(h));
    assert.equal(initialTab(h, { mode: "done" }), "pair", String(h));
    assert.equal(initialTab(h, { mode: "hidden" }), "pair", String(h));
  }
  assert.equal(initialTab("", { mode: undefined }), "pair");
  assert.equal(initialTab("", {}), "pair");
});
test("stepTab：←/→ 循环，Home/End 到首尾，其他键 null（Review Focus 2）", () => {
  assert.equal(stepTab(TAB_KEYS, "add", "ArrowRight"), "pair");
  assert.equal(stepTab(TAB_KEYS, "lookup", "ArrowRight"), "add");
  assert.equal(stepTab(TAB_KEYS, "add", "ArrowLeft"), "lookup");
  assert.equal(stepTab(TAB_KEYS, "engines", "Home"), "add");
  assert.equal(stepTab(TAB_KEYS, "pair", "End"), "lookup");
  for (const k of ["ArrowUp", "ArrowDown", "Enter", " ", "PageUp", "Tab"]) assert.equal(stepTab(TAB_KEYS, "pair", k), null, k);
  assert.equal(stepTab(TAB_KEYS, "nope", "ArrowRight"), null);
  assert.equal(stepTab(TAB_KEYS, "nope", "Home"), "add");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/options-route.test.js`
Expected: FAIL，`Cannot find module '.../src/lib/options-route.js'`。

- [ ] **Step 3: 实现 `src/lib/options-route.js`（导出见 Interfaces）**

不 import 任何模块，不碰 `chrome`。`initialTab` 的 `shown = mode === "steps" || mode === "regrant"`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/options-route.test.js`
Expected: PASS。

- [ ] **Step 5: 写 `test/options-wiring.test.js` 的新检查（先失败）**

原有一条（去掉 loading 后紧接 `revealSetup()`）保持不动；import 行补上 `readdirSync`，新增：

```js
test("src/options/ 里只有 tabs.js 注册 hashchange", () => {
  const dir = new URL("../src/options/", import.meta.url);
  const hits = readdirSync(dir).filter(f => f.endsWith(".js") && readFileSync(new URL(f, dir), "utf8").includes('"hashchange"'));
  assert.deepEqual(hits, ["tabs.js"]);
});
const opt = name => readFileSync(new URL(`../src/options/${name}`, import.meta.url), "utf8");
// 每处 remove("loading") 与它前一处（第一处则从 async function render 起）之间要有 routeOnce(：
// 失败分支（options.js:101）段里是 routeOnce("hidden")，成功分支（:138）段里是 routeOnce(mode)，互不顶替
test("options.js：每处去掉 loading 之前有 routeOnce(", () => {
  const s = opt("options.js");
  const start = s.indexOf("async function render");
  assert.ok(start >= 0, "找不到 async function render");
  const marks = [...s.matchAll(/remove\("loading"\)/g)].map(m => m.index).filter(i => i > start);
  assert.ok(marks.length >= 2, `render 里 remove("loading") 应至少 2 处（实际 ${marks.length}）`);
  marks.forEach((at, i) => {
    const seg = s.slice(i === 0 ? start : marks[i - 1], at);
    assert.ok(seg.includes("routeOnce("), `第 ${i + 1} 处 remove("loading") 之前没有 routeOnce(`);
  });
});
const fnBody = (s, sig) => { const i = s.indexOf(sig); assert.ok(i >= 0, sig); return s.slice(i, s.indexOf("\n}\n", i)); };
test("revealSetup、revealGuideSteps 的函数体都先 showTab(\"add\")", () => {
  const rs = fnBody(opt("setup.js"), "export function revealSetup(");
  const a = rs.indexOf('showTab("add")'), b = rs.indexOf("scrollIntoView(");
  assert.ok(a >= 0 && b >= 0 && a < b, "revealSetup 应在 scrollIntoView 之前 showTab(\"add\")");
  assert.match(fnBody(opt("guide.js"), "export function revealGuideSteps("), /^export function revealGuideSteps\([^)]*\)\s*\{\s*showTab\("add"\);/);
});
```

Run: `node --test test/options-wiring.test.js`
Expected: FAIL（三条新检查失败，原有一条通过）。

- [ ] **Step 6: 写 e2e 纯判定的失败测试**

`test/e2e-b21.test.js`：

```js
import { tabStateProblems } from "../scripts/e2e/steps/b21.mjs";
const KEYS = ["add", "pair", "engines", "lookup"];
const ok = sel => ({
  tabs: KEYS.map(k => ({ id: `tabbtn-${k}`, selected: String(k === sel), tabindex: k === sel ? "0" : "-1", controls: `panel-${k}` })),
  panels: KEYS.map(k => ({ id: `panel-${k}`, labelledby: `tabname-${k}`, hidden: k !== sel, visible: k === sel })),
});
test("tabStateProblems：正确时为空", () => assert.deepEqual(tabStateProblems(ok("engines"), "engines"), []));
test("tabStateProblems：逐条报出", () => {
  const two = ok("pair"); two.tabs[0].selected = "true";
  assert.ok(tabStateProblems(two, "pair").length > 0);                                    // 两个选中
  const idx = ok("pair"); idx.tabs[2].tabindex = "0";
  assert.ok(tabStateProblems(idx, "pair").length > 0);                                    // 未选中的 tabindex 0
  const lab = ok("pair"); lab.panels[1].labelledby = "tabbtn-pair";
  assert.ok(tabStateProblems(lab, "pair").length > 0);                                    // 面板名指向按钮（设计稿 3.2，#19）
  const vis = ok("pair"); vis.panels[3].visible = true;
  assert.ok(tabStateProblems(vis, "pair").length > 0);                                    // 隐藏面板 checkVisibility 为 true
  assert.ok(tabStateProblems({ ...ok("add"), tabs: ok("add").tabs.slice(0, 3) }, "add").length > 0); // 不是 4 个
  assert.ok(tabStateProblems(ok("add"), "pair").length > 0);                              // 选中的不是期望的
});
```

`test/e2e-i18n.test.js` 新增：

```js
test("tabAuditProblems：面板里没有看得见的后代时判失败（隐藏面板的溢出检查会静默通过）", async () => {
  const { tabAuditProblems } = await import("../scripts/e2e/steps/i18n-audit.mjs");
  assert.ok(tabAuditProblems("lookup", { visible: 0 }).length === 1);
  assert.deepEqual(tabAuditProblems("lookup", { visible: 3 }), []);
});
```

Run: `npm test`
Expected: FAIL，只有上面新加的用例失败（找不到 `b21.mjs`、`tabAuditProblems` 未定义）。

- [ ] **Step 7: 改 `options.html` 骨架**

按设计稿 3.2：`<main class="page">` 改成 `<div class="page">`，`header.page-head` 与 `footer.page-foot` 移出 `main`；`div.tabbar > div#tabs.tablist[role=tablist][data-i18n-attr="aria-label:options_tabs_label"]` 里四个 `button.tab`（只有 `#tabbtn-add` 带空的 `span.tab-flag#tab-flag-add`），名称 `span#tabname-<key>[data-i18n=options_tab_<key>]`；`main` 里四个 `div[role=tabpanel]`（`tabindex="0"`、`hidden`、`aria-labelledby="tabname-<key>"`），各卡按设计稿 3.1 的表放：`#panel-add` 放 `section#setup`、`section#guide`；`#panel-pair` 放默认组合卡；`#panel-engines` 放搜索引擎卡和快捷键卡；`#panel-lookup` 放右键查询卡。卡片内部不动（`#hidden-title`、`#guide-step-grant`、`#rules-card` 在后面的任务加）。`#notices` 与 5 个 `<dialog>` 位置不变。

- [ ] **Step 8: 实现 `src/options/tabs.js`**

依赖 `../lib/options-route.js`、`./ui.js`（`ht`）、`../ui/icons.js`（`icon`）；模块顶层只有常量和 `let` 状态。要点：
- `initTabs`：在 `#tabs` 上挂 click（按钮 id 去掉 `tabbtn-` 得 key → `showTab(key)`）与 keydown（修饰键直接返回；`stepTab` 非 null 才 `preventDefault` 并 `showTab(next, { focusTab: true })`）；在 `window` 上挂 `hashchange`（`routeFromHash(location.hash)`：`tab` → `showTab`，`reveal` → `onReveal`）；在 `document` 上挂委托 click（左键、无修饰键、`ev.defaultPrevented` 为 false、`closest('a[href^="#tab-"]')` 且 `routeFromHash` 认得出：`preventDefault` → `showTab` → `reveals[a.dataset.reveal]?.()`）。
- `showTab`：已选中就返回；否则切 `aria-selected`/`tabindex`/面板 `hidden`，`history.replaceState(null, "", tabHash(key))`，对原 tab 调 `onLeave(from)`，`focusTab` 时 focus 新按钮，选中按钮 `scrollIntoView({ inline: "nearest", block: "nearest" })`，`.tabbar` 的 `getBoundingClientRect().top < 0` 时 `scrollTo({ top: <tabbar 的文档 y>, behavior: "instant" })`。
- `routeOnce(mode)`：第一次调用时按 `initialTab(location.hash, { mode })` 做同样的切换，但不写 hash、不滚动、不调 `onLeave`；之后的调用直接返回。
- `setTabFlag(mode)`：按设计稿 3.3“标记”三条写 `#tab-flag-add` 的类与内容（`ht("span", { class: "sr-only" }, "options_tab_todo")`；regrant 是 `icon("alert-circle", { size: 14 })` 加 `ht("span", { class: "sr-only" }, "options_tab_regrant")`）；flag 本身不加 `aria-hidden`。
- `focusIn(el)`：`el && el.checkVisibility() ? el.focus() : 当前选中按钮.focus()`。

- [ ] **Step 9: 改 setup.js、guide.js、reorder.js、actions.js、options.js**

- setup.js：删 `hashTarget`（:182）与 `initSetup` 里的 hashchange（:63–66）；`let revealPending = routeFromHash(location.hash).reveal ?? null;`；`requestReveal` 加 `export`；`revealSetup` 里卡片显示时先 `showTab("add")` 再滚动、给焦点（卡片隐藏时仍什么都不做、不切 tab）；`renderSetup` 末行改成 `return v.mode;`。约 224 行。
- guide.js：import `showTab`；`revealGuideSteps` 第一条语句 `showTab("add");`；“其他组合”的 `disclosure(...)` 包成 `withId(disclosure("guide-other", …), "guide-other")`。
- reorder.js：`leave()` 改成导出的 `leaveReorder({ focus = true } = {})`，卡头按钮与 Esc 仍调它（默认 `focus: true`，行为不变）。
- actions.js：import `focusIn`；`undoHide` 末行改成 ``if (result.ok) focusIn(document.getElementById(`edit-${e.id}`) ?? (isReordering() ? document.getElementById("engines-reorder") : null));``。
- options.js：import `initTabs, routeOnce, setTabFlag, focusIn` 与 `leaveReorder`、`requestReveal`；`focusAfterRender` 删掉 `?? (id.startsWith("setup-") ? $("pair-left") : null)`，末行 `el?.focus()` 改 `focusIn(el)`；`render` 里 `const mode = renderSetup(...)`、`const setupShown = mode === "steps" || mode === "regrant"`，紧接 `routeOnce(mode); setTabFlag(mode);`；读配置失败分支在 `remove("loading")` 之前加 `routeOnce("hidden");`；模块顶层在 `render()` 之前调 `initTabs({ onReveal: requestReveal, onLeave: from => { if (from === "engines") leaveReorder({ focus: false }); }, reveals: {} })`（`pair-left`、`left-grant`、`generator` 三个 reveal 在 Task 3 加）。约 225 行。

- [ ] **Step 10: CSS 与文案**

- options.css：:19 改成 `body.loading .page { visibility: hidden; }`；末尾加设计稿 3.3 的整段（`.tabbar` 到 `[role="tabpanel"]:focus-visible`），只用已有变量。
- 四种语言加 7 个 key：`options_tabs_label`、`options_tab_add`、`options_tab_pair`、`options_tab_engines`、`options_tab_lookup`、`options_tab_todo`、`options_tab_regrant`，文字照设计稿第 4 节“新增”表的草稿，`description` 写清用途（tablist 的 aria-label、tab 名、只给读屏的标记）。

- [ ] **Step 11: 跑单测**

Run: `npm test`
Expected: 只有 `test/e2e-b21.test.js` 与 `test/e2e-i18n.test.js` 里 Step 6 新加的用例失败（`b21.mjs`、`tabAuditProblems` 在 Step 12 才写），其余全部 PASS。

- [ ] **Step 12: e2e 适配与 B21 前半**

- optpage.mjs：`openOptions` 加 `tab`；`withOptions(browser, fn, opts)`；新增 `showTab(page, key)`。READY 不变。
- 设计稿 5.2 表逐行加 `tab`：B4（b4.mjs:55，打开后加一条断言 `#tabbtn-add[aria-selected=true]`）、B6/B7/B11（`{ tab: "engines" }`）、B8（`{ tab: "add" }`）、B10/B12 与 B12 的 p2（options-b2.mjs:45、:85、:134）、B13 的 p1/p2（options-b3.mjs:31、:100）、B16/B17（v03-options.mjs:82）都是 `engines`，B18（v04-options.mjs:188）与 v04-i18n（:57）是 `lookup`；B20（v05-options.mjs:270）与 v05-i18n（v05-i18n.mjs:30）是 `pair`（设计稿 5.2“一律带上 tab”）——I18N 每种语言先 `setDone(ctx, null)`（i18n.mjs:126），默认 tab 是 ①，不带的话 v05-i18n 的 `rulesArea`（i18n.mjs:172 经 `v05I18nChecks` 调用，早于 `withRulePopup` 写回 `setupDone`）量规则区时 ② 是隐藏的，`cardClip` 量出 0×0、`shoot` 报错；B20 第 4 步对 `#rule-edit-r1` 的焦点断言同样要 ② 可见。B14 :184 的 `waitFor` 里先 `document.getElementById("tabbtn-pair").click();`，否则 `b14-options-rules-dark.png` 拍的是默认 tab（规则区只在 ②）。只在已有调用的参数或收尾 `})` 上加，不加行（options-b.mjs 现 294 行）。options-b.mjs:19 只加 `export`。
- b19-popup.mjs：`PAGE_STATE` 多读 `tab`（`[role=tab][aria-selected=true]` 的 id）与 `hash`；`cardProblems` 加“`tab` 应为 `tabbtn-add`，`hash` 应为 `#tab-add` 或 `#setup`”（覆盖 (a′)(d)）；`readyTier` 加“`tab` 应为 `tabbtn-pair`”（焦点 BODY 已有）。b19.mjs:188 的 `pairCallouts` 期望本任务不动（Task 3 改）。
- i18n-audit.mjs：收下 `OPEN_ALL`；新增 `tabAuditProblems` 与 `auditTabs`（1280 宽部分）：对每个 key `showTab` → 数 `#panel-<key>` 里 `checkVisibility()` 为 true 的后代交给 `tabAuditProblems` → `audit({ scope: "#panel-<key> " })` → `OPEN_ALL` → 再审 → 截 `<locale>-options-<key>.png`、`<locale>-options-<key>-open.png`；页头与 tab 栏用 `audit({ scope: ".page-head " })`、`audit({ scope: ".tabbar " })` 各审一次。i18n.mjs 的 `perLocale` 把两段 AUDIT 和两张截图换成一行 `auditTabs` 调用；`auditTabs` 按 `TAB_KEYS` 顺序走完停在 ④，之后先 `await showTab(opt, "add")` 再做 `SETUP_AUDIT`（卡片在 ①），`catalogDialog`、`engineDialog`、`reorderMode` 放在 `showTab(opt, "engines")` 之后。i18n.mjs 约 259 行，i18n-audit.mjs 约 125 行。
- b21.mjs：`B21` 整步包在 `keepSetupDone(ctx, () => guarded(ctx, ["defaultPair", "uiLocale", "customEngines", "presetOverrides", "order"], …))` 里，撤销过的授权在收尾用 `requestGrant` 恢复（同 B19 的 `regrant`）。子项用 `sub(name, fn)` 收集、`summarize(items)` 汇总。本任务实现：
  - (a)–(e)、(i)、(j)：做法与判定照设计稿 5.4 表。(a) 的读数交给 `tabStateProblems`。(j) 先关掉其余设置页目标（ours 以外的 `OPTIONS_URL` 目标），在 ready 档（`setupDone: true`、已授权）用 `popupPage(ctx, { url: \`${POPUP_URL}?tabId=<plainTab>\` })` 打开弹窗，交给 `openOptionsFromPopup`，结束关掉 `made` 里的标签。
  - (b) 末尾加 Review Focus 第 2 条：在选中的 tab 上派发 `new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true })`、同样带 `ctrlKey` 的一次、不带修饰键的 `ArrowDown` 一次，每次核对选中项不变、`defaultPrevented === false`。
  - (m) 语言切换（Review Focus 第 3 条）：steps 档（清掉 `setupDone`）打开、`showTab(page, "engines")`，写 `uiLocale: "en"`，等 `document.documentElement.lang === "en"`；判定 `#tabbtn-engines` 仍选中、`location.hash === "#tab-engines"`、`#tabname-engines` 文字等于 `msgIn("en", "options_tab_engines")`、`#tab-flag-add.todo .sr-only` 文字等于 `msgIn("en", "options_tab_todo")`。
  - (n) 手改 hash（Review Focus 第 5 条）：`setupDone: true`、已授权，`openOptions({ tab: "engines" })`，先 `document.activeElement.blur()`，依次 `location.hash = …` 并等 100 ms：`#setup` → 仍 ③、焦点 BODY；`#tab-foo` → 仍 ③；`#tab-lookup` → ④、hash `#tab-lookup`；`#guide-steps` → ①、hash `#tab-add`、焦点 `#guide-steps-title`。
- 行数：b21.mjs 写完若超过 300 行，就在本任务新建 `b21-links.mjs`，把 (m)(n) 挪进去，导出 `hashLocaleChecks(ctx): Promise<Array<{ name, status, detail }>>`，b21.mjs `items.push(...await hashLocaleChecks(ctx))`；Task 3 再往同一个文件追加 `linkChecks`。两种情况下 index.mjs 都只登记 `B21` 一个步骤，`--only B21` 照常选中全部子项。
- index.mjs：`import { B21 } from "./b21.mjs";` 并加进 `STEPS` 的那一行（`B19,` 之后）。

- [ ] **Step 13: 跑单测与行数**

Run: `npm test && wc -l src/options/*.js src/lib/*.js scripts/e2e/steps/*.mjs | awk '$2 != "total" && $1 > 300'`
Expected: `npm test` PASS；`awk` 没有输出。

- [ ] **Step 14: 跑 e2e（设计稿 5.7，出入第 2 条加 B15）**

Run: `npm run e2e -- --auto-only --only B4,B6,B7,B8,B10,B11,B12,B13,B16,B17,B18,B19,B20,B21,B14,I18N,B15`
Expected: 17 步全部 pass，退出码 0；`.e2e/report-*.md` 里 B21 的 (a)(b)(c)(d)(e)(i)(j)(m)(n) 都是通过；`.e2e/i18n/` 下四种语言各有 `-options-add.png`、`-options-pair.png`、`-options-engines.png`、`-options-lookup.png` 及其 `-open.png`。B20、B14 此时仍按折叠区的规则区跑（Task 4 才改）。

- [ ] **Step 15: 提交**

```bash
git add src/lib/options-route.js src/options src/_locales test/options-route.test.js test/options-wiring.test.js test/e2e-b21.test.js test/e2e-i18n.test.js scripts/e2e/steps
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -F - <<'EOF'
feat(options): split the settings page into four tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9
EOF
```

---

### Task 2: 宽度、页头与顺带的小修

设计稿 3.4、3.5、3.10（分隔线、P2-6 网址切段、禁用按钮与步骤圆圈、P3-5 已隐藏空态、P3-7 已随 Task 1 完成、600 宽引擎行）、3.3 末条（600 宽 tab 栏）、5.2 的 I18N 600 宽审计、5.4 (l)。

**Files:**
- Create: `src/lib/url-break.js`、`test/url-break.test.js`
- Create: `scripts/e2e/steps/b21-width.mjs`
- Modify: `src/options/options.css:2-4`（`:root` 加 `--page-max`）、`:21-36`（`.page`、页头、语言、页脚）、`:44-47`（删 60ch 与注释）、`:71`、`:87`、`:107-114`（`.step-mark`）、`:147-151`（`.pair-pickers`、`.lookup-pickers`）、`:210`，并加设计稿 3.4 的 `@media (max-width: 600px)` 与 3.10 的 `#guide` 分隔线
- Modify: `src/options/guide.js:30-34`（`urlBox`）
- Modify: `src/options/options.html`（静态网址 `chrome://settings/<wbr>searchEngines`；`<h3 id="hidden-title" …>`）
- Modify: `src/options/engine-list.js:74`
- Modify: `src/options/options.js:134`（`#hidden-engines` 与 `#hidden-title` 显隐）
- Modify: `src/_locales/*/messages.json`（删 `engine_hidden_empty`）
- Modify: `scripts/e2e/steps/b21.mjs`（编排 (l)）、`i18n-audit.mjs`（600 宽）
- Test: `test/url-break.test.js`、`test/e2e-b21.test.js`、`test/e2e-i18n.test.js`

**Interfaces:**
- Consumes: `showTab`（optpage.mjs）、`OPEN_ALL`、`auditTabs`（Task 1）；`mockEngineU`、`addCustom`。
- Produces:
  - `lib/url-break.js`：`urlBreakParts(url: unknown): string[]`。
  - `guide.js`：`urlBox(url, label, ariaKey)` 签名不变，`code.url-box` 里各段之间插 `<wbr>`；复制的仍是原字符串。
  - `engine-list.js`：`renderHiddenList(ctx): Element|null`（没有隐藏引擎时 `null`）。
  - `b21-width.mjs`：`widthProblems(m): string[]`；`widthCheck(ctx): Promise<{ status, detail }>`。`m = { maxWidths: [{ sel, value }], ratios: [{ sel, ratio }], urlLineDiff: number|null, lookupSelects: [{ w, inner }], genDiffs: number[], scrollWidth, innerWidth, tablist: { sh, ch }, rows: [{ id, mainTop, sideTop }] }`。
  - `i18n-audit.mjs`：`tabAuditProblems(key, { visible, tabs?: [{ id, sw, cw }], selectedInView? })`（多两个可选字段）。

- [ ] **Step 1: 写 `test/url-break.test.js`（先失败）**

```js
import { urlBreakParts } from "../src/lib/url-break.js";
const cases = {
  "chrome://settings/searchEngines": ["chrome://settings/", "searchEngines"],
  "https://www.google.com/search?q=%s&_ss=google,bing": ["https://www.google.com/", "search?", "q=", "%s&", "_ss=", "google,", "bing"],
  "https://x.test/wiki/%s": ["https://x.test/", "wiki/", "%s"],
  "https://kagi.com/search?q=%s&_ss=kagi%2Cbing": ["https://kagi.com/", "search?", "q=", "%s&", "_ss=", "kagi%2Cbing"],
  "a//b": ["a//", "b"],
  "abc": ["abc"],
  "a/": ["a/"],
};
test("在 / ? & = , 之后切段，连续分隔符算一处，开头的 scheme:// 不单独成段", () => {
  for (const [url, want] of Object.entries(cases)) assert.deepEqual(urlBreakParts(url), want, url);
});
test("各段拼回原串", () => { for (const url of Object.keys(cases)) assert.equal(urlBreakParts(url).join(""), url); });
test("空串与非字符串返回 []", () => { for (const v of ["", null, undefined, 42]) assert.deepEqual(urlBreakParts(v), []); });
```

Run: `node --test test/url-break.test.js`
Expected: FAIL，找不到模块。

- [ ] **Step 2: 实现 `src/lib/url-break.js`，跑测试**

Run: `node --test test/url-break.test.js`
Expected: PASS。

- [ ] **Step 3: 写 `widthProblems` 与 600 宽 tab 栏判定的失败测试**

`test/e2e-b21.test.js` 新增（夹具 `good` 是全部合格的读数，逐项改坏一处）：

```js
// 动态导入（同 e2e-i18n.test.js）：b21-width.mjs 还不存在时只让这几条失败，同文件里 Task 1 的 tabStateProblems 用例照常跑
const widthProblems = async m => (await import("../scripts/e2e/steps/b21-width.mjs")).widthProblems(m);
const good = { maxWidths: [{ sel: ".hint", value: "none" }], ratios: [{ sel: ".hint", ratio: 0.93 }], urlLineDiff: 1,
  lookupSelects: [{ w: 638, inner: 638.5 }], genDiffs: [0.5, 0], scrollWidth: 1280, innerWidth: 1280,
  tablist: { sh: 44, ch: 44 }, rows: [{ id: "ea", mainTop: 100, sideTop: 100.5 }] };
test("widthProblems：全部合格为空", async () => assert.deepEqual(await widthProblems(good), []));
test("widthProblems：每类越界各报一条", async () => {
  const bad = [
    { maxWidths: [{ sel: ".hint", value: "446px" }] }, { ratios: [{ sel: ".hint", ratio: 0.89 }] }, { urlLineDiff: 2.5 },
    { lookupSelects: [{ w: 316, inner: 638 }] }, { genDiffs: [1.5, 0] }, { scrollWidth: 1281 },
    { tablist: { sh: 45, ch: 44 } }, { rows: [{ id: "eu", mainTop: 100, sideTop: 124 }] },
  ];
  for (const patch of bad) assert.equal((await widthProblems({ ...good, ...patch })).length, 1, JSON.stringify(patch));
});
test("widthProblems：urlLineDiff 为 null（没量到）报一条，rows 为空不报", async () => {
  assert.equal((await widthProblems({ ...good, urlLineDiff: null })).length, 1);
  assert.deepEqual(await widthProblems({ ...good, rows: [] }), []);
});
```

阈值：`value === "none"`；`ratio >= 0.9`；`urlLineDiff <= 2`；`|w − inner| <= 1`；每个 `genDiffs <= 1`；`scrollWidth <= innerWidth`；`sh <= ch`；`|mainTop − sideTop| <= 1`。

`test/e2e-i18n.test.js` 新增（截字的判据与 i18n-audit.mjs:23 相同：`sw > cw + 1`）：`tabAuditProblems("pair", { visible: 2, tabs: [{ id: "tabbtn-pair", sw: 121, cw: 119 }], selectedInView: false })` 报 2 条（截字、选中的 tab 不在可视范围）；`tabs: [{ id: "tabbtn-pair", sw: 120, cw: 119 }], selectedInView: true` 报 0 条（差 1px 不算截字）。

Run: `npm test`
Expected: FAIL，只有本步新加的用例失败：`test/e2e-b21.test.js` 的三条 `widthProblems`（动态导入找不到 `b21-width.mjs`）与 `test/e2e-i18n.test.js` 的 600 宽 `tabAuditProblems` 一条；`tabStateProblems` 等原有用例 PASS。

- [ ] **Step 4: CSS（设计稿 3.4、3.5、3.10）**

照设计稿 3.4、3.5 的代码块改 options.css：`:root` 加 `--page-max: 680px`；`.page` 用它；删 :44–47 的 60ch 和注释，改为设计稿那行 `text-wrap: pretty`；页脚去掉 65ch；`.pair-pickers` 去掉 480px；`.lookup-pickers` 改成 grid 并加 `.lookup-pickers select`、`.lookup-card .lookup-pickers`；`.section-head` 加 wrap；`.engine-main, .rule-main` 改 180px；加 `@media (max-width: 600px)`（原有 `@media (max-width: 560px)` 保留）；页头改成设计稿 3.5 的网格（`.page-title { display: contents }`，HTML 不改）；3.10 的 `#guide` 分隔线三条、`.btn:disabled, .btn[aria-disabled="true"]`、`.step-mark` 边框改 `var(--muted)`。不加任何颜色变量。

- [ ] **Step 5: 网址切段、已隐藏空态**

- guide.js：import `urlBreakParts`；`urlBox` 的 `code.url-box` 子节点改成各段之间插 `h("wbr")`；复制按钮仍 `copyButton(() => url, …)`。guide.js 约 133 行。
- options.html：`.steps` 第 1 条里静态网址写成 `chrome://settings/<wbr>searchEngines`；已隐藏小标题改成 `<h3 id="hidden-title" data-i18n="options_hidden_title"></h3>`。
- engine-list.js:74：没有隐藏引擎时 `return null`。
- options.js:134：`const hiddenList = renderHiddenList(ctx); $("hidden-engines").replaceChildren(...[hiddenList].filter(Boolean)); $("hidden-engines").hidden = $("hidden-title").hidden = !hiddenList;`。
- 四种语言删 `engine_hidden_empty`。

- [ ] **Step 6: B21(l) 与 I18N 600 宽**

- b21-width.mjs：`widthCheck(ctx)` 按设计稿 5.4 (l) 的状态与做法（`setupDone: true`、默认组合两侧已授权、`addCustom(ctx.ext, mockEngineU(ctx.port))` 构造一行“未授权（可选）”），1280 与 600 两档（`Emulation.setDeviceMetricsOverride`，用完 `clearDeviceMetricsOverride`），四种语言逐一（写 `uiLocale`，等 `lang`），每个 tab `showTab` 后执行 `OPEN_ALL` 再量，读数拼成 `m` 交给 `widthProblems`；量哪些元素、排除 `.step-actions > .hint`、`#gen-left`/`#gen-right` 的 label 与默认组合两窗格分别比左缘，都照设计稿 5.4 (l) 判定列。`rows` 只在 600 档填（`#engines .engine-row` 每行的 `.engine-main`、`.engine-side` 的 `getBoundingClientRect().top`）。
- b21.mjs：`items.push(await sub("(l) 宽度：四语同一条右边界、600 宽不溢出、引擎行不折", () => widthCheck(ctx)))`。
- i18n-audit.mjs 的 `auditTabs` 末尾：`setDeviceMetricsOverride` 宽 600 → 每个 tab `showTab` + `OPEN_ALL` + `audit({ scope: "#panel-<key> " })`（不截图）+ 读每个 `.tab` 的 `scrollWidth`/`clientWidth`（`scrollWidth > clientWidth + 1` 判截字，同 i18n-audit.mjs:23）与选中 tab 是否完全落在 `.tablist` 的可视范围，交给 `tabAuditProblems` → `clearDeviceMetricsOverride`。

- [ ] **Step 7: 跑单测与行数**

Run: `npm test && wc -l src/options/*.js src/lib/*.js scripts/e2e/steps/*.mjs | awk '$2 != "total" && $1 > 300'`
Expected: PASS；`awk` 没有输出。

- [ ] **Step 8: 跑 e2e**

Run: `npm run e2e -- --auto-only --only B4,B6,B7,B8,B10,B11,B12,B13,B16,B17,B18,B19,B20,B21,B14,I18N,B15`
Expected: 17 步全部 pass，退出码 0；B21 的 (l) 通过，detail 写明四种语言两档都量过；I18N 每种语言的说明里没有 600 宽的溢出与截字。

- [ ] **Step 9: 提交**

```bash
git add src/lib/url-break.js src/options src/_locales test/url-break.test.js test/e2e-b21.test.js test/e2e-i18n.test.js scripts/e2e/steps
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -F - <<'EOF'
feat(options): align settings content to one 680px column

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9
EOF
```

---

### Task 3: 跨 tab 依赖

设计稿 3.7（除 Task 1 已做的两行）、3.8 的 `#pair-grant`、3.9 全部、3.10 的窄窗口开关行、第 4 节新增表其余 9 个 key 与修改表前 7 条、5.2 B19 的 `pairCallouts`、5.4 (f)(g)(h)(k)、5.5 的区名一致检查。

**Files:**
- Create: `src/options/pair.js`
- Create: `scripts/e2e/steps/b21-links.mjs`
- Modify: `src/options/options.js:160-193`（`pickerPanes`、`pairSection` 挪走）、`:34`（`FOCUS_FALLBACK`）、`:129`、`initTabs` 的 `reveals`
- Modify: `src/options/edits.js`（三个纯函数）
- Modify: `src/options/setup.js:129-140`（`addBody`：`.step-links`、“更换组合”）
- Modify: `src/options/guide.js`（`revealGenerator`、`revealTriggers`）
- Modify: `src/options/locale-ui.js:7-9`
- Modify: `src/options/actions.js:96-98`（模板提示带按钮）
- Modify: `src/options/options.html:48`（`<li id="guide-step-grant"></li>`）
- Modify: `src/options/options.css`（设计稿 3.7 的 `.step-links`、3.10 的开关行整段）
- Modify: `src/_locales/*/messages.json`
- Modify: `test/options-edits.test.js`、`test/i18n-catalog.test.js`
- Modify: `scripts/e2e/steps/b19.mjs:188`、`b4.mjs:38`（`trustedClick` 加 `export`）、`b21.mjs`
- Test: 上面三个测试文件

**Interfaces:**
- Consumes: `showTab`、`focusIn`（tabs.js）；`requestReveal`（setup.js）；`revealGuideSteps`、`urlBox`（guide.js）；`act`、`actions`（actions.js；`act` 的 `ok` 已接受函数，actions.js:70）；`buildTriggerTemplate`（lib/trigger.js）。
- Produces:
  - `edits.js`：`notePairChange(rec, { from: string[], mode: string }): { from: string[], mode: string }`（`rec` 非空时原样返回同一对象）；`pairChangedView(rec, { pair: string[], mode: string }): { rec: object|null, show: null|"setup"|"replace" }`；`pairSavedKey(rec, pair: string[], mode: string): "notice_pair_saved_back"|"notice_pair_saved_setup"|"notice_pair_saved"`。
  - `pair.js`：`pairSection({ cfg, byId, granted, mode, render, actions }): Node[]`，按顺序是窗格、`#pair-changed`（显示时）、开关行、左侧未授权提示框（`left && !granted`）、末行指引，最后是 `renderRules(cfg, actions)`（现在 options.js:191 的最后一项，Task 4 移走）。pair.js import `renderRules`（./rules.js）；`actions` 与 `render` 一样由 options.js 传入（options.js 已从 actions.js import `actions`）。左侧未授权提示框的授权按钮 `id="pair-grant"`。
  - `guide.js`：`revealGenerator(): void`（`showTab("add")`，`#guide-other` 设 `open`，滚过去，焦点给它的 summary）；`revealTriggers(): void`（`showTab("add")`，`#guide-default` 存在就 `open`，`#triggers` `scrollIntoView({ block: "start" })`，`focusIn(document.querySelector("#triggers .trigger-default .url-line button"))`）。
  - `setup.js`：第 2 步正文末尾 `div.step-links`，“详细步骤”在前，`<a href="#tab-pair" id="setup-change-pair" class="step-link" data-reveal="pair-left">`。
  - options.js 的 `reveals`：`{ "pair-left": () => focusIn($("pair-left")), "left-grant": () => { const l = current?.defaultPair[0]; focusIn(document.querySelector(\`#engines [data-id="${CSS.escape(l)}"] .perm-line button\`) ?? $(\`edit-${l}\`)); }, generator: revealGenerator }`；`FOCUS_FALLBACK` 加 `"pair-grant": "pair-left"`。
  - `b21-links.mjs`：`linkChecks(ctx): Promise<Array<{ name, status, detail }>>`，返回 (f)(g)(h)(k) 四项。

- [ ] **Step 1: 写 edits.js 三个纯函数的失败测试**

`test/options-edits.test.js` 新增：

```js
const R = (from, mode) => ({ from, mode });
test("notePairChange：没有记录时记下 from 与 mode，已记过不覆盖", () => {
  assert.deepEqual(notePairChange(null, { from: ["ea", "eb"], mode: "done" }), R(["ea", "eb"], "done"));
  const rec = R(["ea", "eb"], "steps");
  assert.equal(notePairChange(rec, { from: ["ea", "ec"], mode: "done" }), rec);
});
test("pairChangedView：按当前 mode 选文案", () => {
  assert.deepEqual(pairChangedView(R(["ea", "eb"], "done"), { pair: ["ea", "ec"], mode: "done" }).show, "replace");
  for (const mode of ["regrant", "hidden"]) assert.equal(pairChangedView(R(["ea", "eb"], "done"), { pair: ["ea", "ec"], mode }).show, "replace");
  assert.equal(pairChangedView(R(["ea", "eb"], "steps"), { pair: ["ea", "ec"], mode: "steps" }).show, "setup");
  assert.equal(pairChangedView(R(["ea", "eb"], "done"), { pair: ["eb", "ea"], mode: "done" }).show, "replace"); // 左右对调也算改了
});
test("pairChangedView：三种清掉的情况（Review Focus 4 的“改回原组合”与“没保存过的页”）", () => {
  assert.deepEqual(pairChangedView(null, { pair: ["ea", "ec"], mode: "done" }), { rec: null, show: null });
  assert.deepEqual(pairChangedView(R(["ea", "eb"], "done"), { pair: ["ea", "eb"], mode: "done" }), { rec: null, show: null });
  for (const mode of ["done", "hidden", "regrant"]) {
    assert.deepEqual(pairChangedView(R(["ea", "eb"], "steps"), { pair: ["ea", "ec"], mode }), { rec: null, show: null });
  }
});
test("pairSavedKey：改回原组合 → back；否则按 mode", () => {
  assert.equal(pairSavedKey(R(["ea", "eb"], "done"), ["ea", "eb"], "done"), "notice_pair_saved_back");
  assert.equal(pairSavedKey(null, ["ea", "ec"], "steps"), "notice_pair_saved_setup");
  for (const mode of ["regrant", "done", "hidden"]) assert.equal(pairSavedKey(null, ["ea", "ec"], mode), "notice_pair_saved");
  assert.equal(pairSavedKey(R(["ea", "eb"], "steps"), ["ea", "ec"], "steps"), "notice_pair_saved_setup");
});
```

Run: `node --test test/options-edits.test.js`
Expected: FAIL，整个 `test/options-edits.test.js` 导入失败（`SyntaxError: The requested module '../src/options/edits.js' does not provide an export named 'notePairChange'`），该文件里原有用例也不会跑——三个名字直接加进文件顶部现有的静态 import 列表，这是预期的失败形态；其他测试文件不受影响。

- [ ] **Step 2: 写区名一致的失败测试**

`test/i18n-catalog.test.js` 新增：

```js
test("跨 tab 引用的区名一致（设计稿 4、5.5）", () => {
  for (const l of langs) {
    const m = k => catalogs[l][k].message;
    for (const k of ["engine_in_pair_hide", "engine_in_pair_delete"]) assert.ok(m(k).includes(m("options_tab_pair")), `${l} ${k}`);
    assert.ok(m("notice_template_changed").includes(m("options_tab_add")), `${l} notice_template_changed`);
    for (const k of ["options_pair_changed_setup", "notice_pair_saved_setup"]) assert.ok(m(k).includes(m("setup_title")), `${l} ${k}`);
  }
});
```

Run: `node --test test/i18n-catalog.test.js`
Expected: FAIL（新 key 还不存在，`engine_in_pair_*` 还是旧句子）。

- [ ] **Step 3: 实现 edits.js 三个函数，跑 Step 1 的测试**

`pairSavedKey`：`rec && 同组合(pair, rec.from)` → back；否则 `mode === "steps"` → setup；否则普通。`pairChangedView`：`rec` 为空、当前组合等于 `rec.from`、`rec.mode === "steps" && mode !== "steps"` 三种返回 `{ rec: null, show: null }`，否则 `{ rec, show: mode === "steps" ? "setup" : "replace" }`。

Run: `node --test test/options-edits.test.js`
Expected: PASS。

- [ ] **Step 4: pair.js 与 options.js**

- pair.js（新）：从 options.js 挪来 `pickerPanes`、`pairSection`；模块变量 `let pairChanged = null`。每次 `pairSection` 先 `({ rec: pairChanged, show } = pairChangedView(pairChanged, { pair: cfg.defaultPair, mode }))`。保存：`act(raw => setDefaultPair(raw, l, r), result => { const key = pairSavedKey(pairChanged, result.patch.defaultPair, mode); pairChanged = notePairChange(pairChanged, { from: cfg.defaultPair, mode }); return [key]; })`。`#pair-changed` 是 `div.callout#pair-changed`（不带 `callout-warn`、不设 `role`）：`show === "setup"` 时 `options_pair_changed_setup` + `a[href="#setup"]`“`options_pair_changed_continue`”（onclick `preventDefault` 后 `requestReveal("setup")`）；`"replace"` 时 `options_pair_changed`（`$PAIR$` = `t("guide_pair_label", 左名, 右名)`）+ 新触发网址的 `urlBox`（拼不出时 `guide_no_trigger`）+ `a[href="#guide-steps"]`“`options_pair_changed_steps`”（onclick `preventDefault` 后 `revealGuideSteps()`）。开关行照设计稿 3.10 的 DOM（`#narrow-label`、`#narrow-hint`、`input#narrow-fallback.switch[role=switch][aria-describedby=narrow-hint]`）。左侧未授权提示框条件改成 `left && !granted.get(left.id)`；`authButton` 不收 id，拿到按钮后 `btn.id = "pair-grant"`。`render` 由 options.js 传入（pair.js 不 import options.js，避免循环）。末行 `p.hint`（文字与链接按 locale-ui.js 的富文本做法拼）：`...tNodes("options_pair_other", [h("a", { href: "#tab-add", "data-reveal": "generator" }, t("options_tab_add"))])`。约 115 行。
- options.js：删 `pickerPanes`、`pairSection`；:129 改成 `$("pair-body").replaceChildren(...pairSection({ cfg, byId, granted, mode, render, actions }))`；`FOCUS_FALLBACK` 加一项；`initTabs` 的 `reveals` 按 Interfaces 填。约 185 行。

- [ ] **Step 5: 链接、按钮与第 5 步**

- setup.js `addBody`：把原来的 `ht("a", { href: "#guide-steps", … })` 与新的“更换组合”链接（`setup_change_pair`）一起包进 `h("div", { class: "step-links" }, …)`，放在 `ol.setup-substeps` 之后。约 226 行。
- guide.js：加 `revealGenerator`、`revealTriggers`（Interfaces）。约 147 行。
- locale-ui.js：RICH_TEXT 加 `["guide-step-grant", "guide_step_grant", () => [h("a", { href: "#tab-engines", "data-reveal": "left-grant" }, t("options_tab_engines"))]]`；options.html:48 改 `<li id="guide-step-grant"></li>`。
- actions.js:97：`notify(t("notice_template_changed", result.engine.name), "warn", { sticky: true, action: { key: "notice_template_changed_go", run: revealTriggers } })`，import `revealTriggers`。约 222 行。
- options.css：加 `.step-links` 两条（设计稿 3.7）与开关行整段（设计稿 3.10 的 `.switch-row` 到 forced-colors）。

- [ ] **Step 6: 文案草稿**

四种语言加 9 个 key：`setup_change_pair`、`options_pair_other`（`$LINK$`）、`options_pair_changed`（`$PAIR$`）、`options_pair_changed_setup`、`options_pair_changed_steps`、`options_pair_changed_continue`、`notice_pair_saved_setup`、`notice_pair_saved_back`、`notice_template_changed_go`，文字照设计稿第 4 节“新增”表。改写 7 个：`options_pair_hint`、`guide_step_grant`（`$LINK$`）、`options_narrow_hint`、`engine_in_pair_hide`、`engine_in_pair_delete`、`notice_template_changed`、`notice_pair_saved`：zh_CN 与 en 照“修改”表；zh_TW、es 由 zh_CN 草稿临时转写（`options_narrow_hint` 的 zh_TW「勾選後」→「開啟後」、es 与 en 不改），区名逐字等于各自的 `options_tab_pair`/`options_tab_add`/`setup_title`。Task 5 定稿。

- [ ] **Step 7: 跑单测**

Run: `npm test`
Expected: PASS（含 Step 1、2 的新用例、`test/options-actions.test.js` 照常通过）。

- [ ] **Step 8: e2e：B19 与 B21 后半**

- b19.mjs:188：改成 `if (c.pairCallouts !== 1) problems.push(\`左侧未授权时默认组合卡应有 1 个提示框（实际 ${c.pairCallouts} 个）\`);`。
- b21-links.mjs（Task 1 已为 (m)(n) 建过就在里面追加，否则新建）：`linkChecks(ctx)` 实现 (f)(g)(h)(k)，做法与判定照设计稿 5.4 表；(f) steps 档里第 5 步的“搜索引擎”链接在默认收起的 `#guide-steps-details` 里，回 ① 后先把它设成 `open` 再点；(k) 的两次点击用 CDP 可信点击：给 b4.mjs:38 的 `trustedClick(browser, sid, { x, y })` 加 `export` 后从 b4.mjs import 复用（不复制一份），在 ① 点之前先 `showTab(page, "add")`。(g) 末尾加 Review Focus 第 4 条：hidden 档 p1 改右侧出现 `#pair-changed` 后，`openOptions(ctx.browser, { tab: "pair" })` 开 p2，判 p2 没有 `#pair-changed`；在 p2 把右侧改回 p1 记下的原组合，等 p1 重渲染后判 p1 的 `#pair-changed` 消失。
- b21.mjs：`items.push(...await linkChecks(ctx))`，放在 (j) 之后、(l) 之前。

- [ ] **Step 9: 行数与 e2e**

Run: `npm test && wc -l src/options/*.js src/lib/*.js scripts/e2e/steps/*.mjs | awk '$2 != "total" && $1 > 300'`
Expected: PASS；`awk` 没有输出。

Run: `npm run e2e -- --auto-only --only B4,B6,B7,B8,B10,B11,B12,B13,B16,B17,B18,B19,B20,B21,B14,I18N,B15`
Expected: 17 步全部 pass，退出码 0；B21 的 (f)(g)(h)(k) 通过；B19 (d) 的说明里默认组合卡提示框是 1 个；B10 的 `#dlg-remove-reason` 期望文字是新句子（`msg()` 取）。

- [ ] **Step 10: 提交**

```bash
git add src/options src/_locales test/options-edits.test.js test/i18n-catalog.test.js scripts/e2e/steps
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -F - <<'EOF'
feat(options): connect settings that depend on other tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9
EOF
```

---

### Task 4: 规则卡

设计稿 3.11、第 4 节修改表 `options_rules_intro` 与删除表 `options_rules_summary`、5.3。单独一个提交（设计稿 10 节第 2 条）。

**Files:**
- Modify: `src/options/options.html`（`#panel-pair` 里默认组合卡之后加 `section#rules-card`）
- Modify: `src/options/rules.js:1-28`
- Modify: `src/options/options.js`（`#rules-body`）、`src/options/pair.js`（不再 push 规则区）
- Modify: `src/_locales/*/messages.json`
- Modify: `scripts/e2e/steps/v05-options.mjs`、`v05-i18n.mjs`、`b14.mjs`

**Interfaces:**
- Consumes: `pairSection`（Task 3）；`showTab`（optpage.mjs）。
- Produces: `renderRules(cfg, actions): Node[]`（已 `.filter(Boolean)`，依次是两段 `.hint`、`ol#rule-list[aria-labelledby=rules-title]` 或 `p#rule-empty`、`button#rule-add.btn.btn-small`）；静态 `section#rules-card.card[aria-labelledby=rules-title] > h2#rules-title[data-i18n=options_rules_title] + div#rules-body`。

- [ ] **Step 1: 改 B20、v05-i18n、B14（先让它们按新结构判，先失败）**

逐行照设计稿 5.3 的三张表改选择器与断言：v05-options.mjs（:1 注释、:4 import 加 `showTab`、:15–16 的 `box()` 换成 `card()`、第 1 步 :77–88、第 4 步 :120–133、第 10 步 `openEdit` 前 `await showTab(page, "engines")`、第 11 步开头 `await showTab(page, "pair")`、:265 title），v05-i18n.mjs（:1、:19–20、:24、:32–36、:66），b14.mjs（:3、:182、:184–187、:196；:184 的 `tabbtn-pair` 点击 Task 1 已加，这里只换成设计稿 5.3 的整句）。v05-options.mjs:270、v05-i18n.mjs:30 的 `{ tab: "pair" }` 已在 Task 1 加好，不再改。v05-options.mjs ≤ 280 行。

Run: `npm run e2e -- --auto-only --only B20,B15`
Expected: B20 FAIL，第 1 步报“#panel-pair 里找不到 #rules-card”。

- [ ] **Step 2: 实现规则卡**

- options.html：设计稿 3.11“DOM”一行的静态 section。
- rules.js：去掉 `disclosure` 的 import 与包装、:19 注释；`renderRules` 返回节点数组并 `.filter(Boolean)`；`ol#rule-list` 加 `"aria-labelledby": "rules-title"`；`#rule-add` 的 class 改 `btn btn-small`；文件头注释改成“搜索组合”tab 的规则卡。约 168 行。
- pair.js 去掉末项 `renderRules(cfg, actions)` 与它的 import、参数里的 `actions`；options.js 的 `pairSection({ … })` 调用去掉 `actions`，在 `pair-body` 那行后加 `$("rules-body").replaceChildren(...renderRules(cfg, actions));`。
- 四种语言删 `options_rules_summary`；`options_rules_intro` 四语照设计稿 3.11 表“改写”一行的草稿改最后一句。

- [ ] **Step 3: 跑单测与行数**

Run: `npm test && wc -l src/options/*.js scripts/e2e/steps/*.mjs | awk '$2 != "total" && $1 > 300'`
Expected: PASS（`i18n-catalog` 的“没有未被引用的 key”通过）；`awk` 没有输出。

- [ ] **Step 4: 跑 e2e**

Run: `npm run e2e -- --auto-only --only B4,B6,B7,B8,B10,B11,B12,B13,B16,B17,B18,B19,B20,B21,B14,I18N,B15`
Expected: 17 步全部 pass，退出码 0；`.e2e/i18n/<locale>-options-rules.png` 是规则卡的裁切；`.e2e/b14-options-rules-dark.png` 是整个 ②。

- [ ] **Step 5: 提交**

```bash
git add src/options src/_locales scripts/e2e/steps
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -F - <<'EOF'
feat(options): move keyword rules into their own card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9
EOF
```

---

### Task 5: 四语文案定稿

设计稿第 4 节、3.11 文案表、10 节第 3 条（不涉及行长）。

**Files:**
- Modify: `src/_locales/{zh_CN,en,zh_TW,es}/messages.json`（只改 `message`，必要时改 `description`；不增删 key）

**Interfaces:**
- Consumes: Task 1–4 落定的 key 集合。
- Produces: 定稿文案；key 集合与占位符不变。

范围（26 条）：新增 16 个（`options_tabs_label`、`options_tab_add`、`options_tab_pair`、`options_tab_engines`、`options_tab_lookup`、`options_tab_todo`、`options_tab_regrant`、`setup_change_pair`、`options_pair_other`、`options_pair_changed`、`options_pair_changed_setup`、`options_pair_changed_steps`、`options_pair_changed_continue`、`notice_pair_saved_setup`、`notice_pair_saved_back`、`notice_template_changed_go`）；修改 8 个（`options_pair_hint`、`guide_step_grant`、`options_narrow_hint`、`engine_in_pair_hide`、`engine_in_pair_delete`、`notice_template_changed`、`notice_pair_saved`、`options_rules_intro`）；再看一遍语气的 2 个（`options_rules_title` 从折叠标题改作卡片标题；`options_narrow_label` 现在是开关的名称）。

- [ ] **Step 1: zh_CN 定稿**

先过 lieflat-less-ai-tone，再过 humanizer-zh。约束：tab 名短（zh 四个合计约 415px 宽，设计稿 3.3）；“搜索引擎”与 Chrome 一字不差；`options_tab_*` 改字时 `engine_in_pair_*`、`notice_template_changed` 里的区名同步改（区名一致单测守着）。

- [ ] **Step 2: 三语按市场转写并各自润色**

- en：按 zh_CN 定稿转写（不逐字直译），过 humanizer。
- zh_TW：转写后过 humanizer-zh，再按台湾用语审校（不得有简体字和大陆用语；“拆分视图”是「分割畫面」，“快捷键”是「快速鍵」）。
- es：转写后用 content-l10n 做本地化质检（翻译腔、机器腔），再按母语标准审校（中性国际西语，用 tú；“快捷键” «Acceso directo»，“快捷字词” «Atajo»）。tab 名在 600 宽下要放得下（设计稿 3.3：es 约 480px）。

- [ ] **Step 3: 跑单测**

Run: `npm test`
Expected: PASS（`i18n-catalog`：四语 key 对齐、占位符一致、区名一致、description 无 `[needs-translation]`）。

- [ ] **Step 4: 跑 e2e**

Run: `npm run e2e -- --auto-only --only B10,B19,B20,B21,I18N,B15`
Expected: 6 步全部 pass，退出码 0；I18N 四种语言没有原样 key、没有溢出与截字（含 600 宽 tab 栏）。

- [ ] **Step 5: 提交**

```bash
git add src/_locales
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -F - <<'EOF'
chore(i18n): finalize the settings tab copy in four languages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9
EOF
```

---

### Task 6: 收尾与发布 v0.6.0

设计稿 5.6、6 节、7 节 T6（第 3、4 步除外，见出入第 5、6 条）。

**Files:**
- Create: `docs/acceptance-v0.6.md`
- Modify: `docs/_config.yml`（`exclude` 加 `- acceptance-v0.6.md`）
- Modify: `docs/acceptance-v0.4.md`、`docs/acceptance-v0.5.md`（B4、B10、B14、B17、B19、B20、I18N 条目加“见 v0.6”）
- Modify: `CLAUDE.md`
- Modify: `README.md`、`README.zh-CN.md`、`README.zh-TW.md`、`README.es.md`（第 34、36、37、42 行一带）
- Modify: `docs/superpowers/specs/2026-10-27-options-tabs-design.md:3`（状态改为已实施）
- Modify: `assets/raw/en/options-top.png`、`options-engines.png`、`options-fullpage.png`、`assets/raw/captions.md`、`assets/templates-v2/store-4-engines.html:25`、`promo-marquee.html:38`、`assets/templates-v2/README.md`（裁切说明）与重新渲染出的 `assets/store/`、`assets/readme/` 的 en 图
- Modify: `src/manifest.json:4`、`package.json`（`"version"`）、`CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1–5 全部提交。
- Produces: `dist/split-search-0.6.0.zip`（不进 git）；`dist/split-search-0.5.0.zip` 在 Step 3 前后 sha256 不变。

- [ ] **Step 1: 设计复评**

在测试配置里打开设置页的四个 tab（1280 与 600 宽），跑 `/impeccable critique` 与 `impeccable detect --cdp`。line-length 按设计稿 5.6 不算失败（en/es 每行约 95–105 字符是用户 2026-10-27 选定的取舍）；其余新问题：属于本批改动的就修（每处修复单独一个 `fix(options): …` 提交，并重跑受影响任务的 e2e 清单），不属于的记进 `docs/acceptance-v0.6.md` 的“下一轮”小节。

- [ ] **Step 2: 完整测试（版本仍是 0.5.0）**

Run: `git status --porcelain src && npm test && npm run e2e -- --auto-only`
Expected: `git status` 无输出；`npm test` PASS；e2e 报告 `.e2e/report-*.md` 里没有 fail，退出码 0（T9、T12 未登录 Kagi 时跳过、T14 预期降级不算失败）。

- [ ] **Step 3: 安装冒烟（版本仍是 0.5.0）**

这次 pack 产出的文件名仍是 `dist/split-search-0.5.0.zip`，pack 先删再写（scripts/pack.mjs:90、:99），会覆盖待上传的商店公钥版。先备份，冒烟后放回（与 v0.5 发布时相同）。`$SCRATCH` 是本会话的 scratchpad 目录。

Run: `cp -p dist/split-search-0.5.0.zip "$SCRATCH/split-search-0.5.0.store.zip" && sha256sum dist/split-search-0.5.0.zip | tee "$SCRATCH/split-search-0.5.0.sha256"`
Expected: 打印一行 sha256，记下。

Run: `npm run pack -- --smoke`
Expected: 打印 ZIP 大小与 sha256，冒烟全部通过：权限警告只有 DNR 一条，设置页英文渲染、没有显示成 key 的文字，弹窗是 setup 档，没有 `[split-search]` 控制台错误，装出的 ID 不是开发 ID。

Run: `cp -p "$SCRATCH/split-search-0.5.0.store.zip" dist/split-search-0.5.0.zip && sha256sum -c "$SCRATCH/split-search-0.5.0.sha256"`
Expected: `dist/split-search-0.5.0.zip: OK`（与备份前一致）。

- [ ] **Step 4: 实测 Tab 停靠点**

在测试配置的设置页里用 CDP `Input.dispatchKeyEvent` 从 `body` 起连按 Tab，记下不重复的 `activeElement` 直到回到起点，按设计稿 3.1 表的五种状态（① steps、① 设置完成、② 全新 0 条规则、③ 全新、④）各数一次（zh_CN，1280 宽）。脚本放 scratchpad，不进仓库。结果写进 `docs/acceptance-v0.6.md`，与改前 33 个对比。

- [ ] **Step 5: 验收表与站点排除**

`docs/acceptance-v0.6.md` 照设计稿 5.6 写：B21 全部子项（含本计划加的 (m)(n) 与 (b)、(g) 的补充判定）；改写的 B4、B10、B14、B17、B19、B20、I18N、v05-i18n 描述与截图清单（`<locale>-options-<tab>.png`、`-open.png`，`b14-options-dark.png` 拍的是默认 tab）；B12(4) 期望不变；“默认 tab 只在首次 render 判一次”与“读配置失败时停在 ②”两条；上一步的 Tab 停靠点；`impeccable detect` 的 line-length 不算失败及原因；手测项（Windows Chrome + NVDA 的 tab 栏与开关行播报、Ctrl+F 搜不到隐藏 tab 是已知限制）。`docs/_config.yml` 的 `exclude` 加 `- acceptance-v0.6.md`；v0.4、v0.5 验收表被改写的条目加“见 v0.6”。

- [ ] **Step 6: CLAUDE.md、README、设计稿状态**

- CLAUDE.md 照设计稿 6 节逐条：目录与职责加新文件并改写 `options.html`、`options.js`、`setup.js`、`guide.js`、`rules.js`、`reorder.js`、`options.css` 的说明，另加 `pair.js` 与 edits.js 的三个函数；机制速览弹窗“完成设置”那段补一句；e2e 小节（`openOptions({ tab })`、`withOptions(…, opts)`、`showTab`，B21 三个文件与子项，I18N 按 tab 审计、截图改名、600 宽审计，B19 `pairCallouts` 期望 1，B20、v05-i18n、B14 的规则卡选择器）；路线图加 v0.6（已实现、日期、设计稿路径、不加权限）。
- README 四语照设计稿 6 节改第 34、36、37、42 行的意思；四份同结构同改，标题下的语言切换行不动；zh-CN 过 lieflat-less-ai-tone + humanizer-zh，en 过 humanizer，zh-TW 过 humanizer-zh 加台湾用语审校，es 过 content-l10n 加母语审校。
- 设计稿第 3 行状态改成“已实施（v0.6.0）”。

Run: `grep -c '^## ' README.md README.zh-CN.md README.zh-TW.md README.es.md && npm test`
Expected: 四个数相同；PASS。

- [ ] **Step 7: 提交文档**

```bash
git add CLAUDE.md README.md README.zh-CN.md README.zh-TW.md README.es.md docs/acceptance-v0.6.md docs/acceptance-v0.4.md docs/acceptance-v0.5.md docs/_config.yml docs/superpowers/specs/2026-10-27-options-tabs-design.md
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -F - <<'EOF'
docs: describe the tabbed settings page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9
EOF
```

- [ ] **Step 8: 截图重拍与商店图重渲**

照 `assets/raw/captions.md`“设置页三张的重拍”的环境（私有 Xvfb 2400×1500、`/opt/google/chrome/google-chrome` 缩放 1.5、`--lang=en-US`、`LANGUAGE=en_US:en`、`--disable-features=Translate`、一次性临时配置并在拍完删除、字体配置同 e2e 的 `launch()`、CDP `Extensions.loadUnpacked` 装本检出的 `src/`、`uiLocale: "en"`、默认组合 DuckDuckGo ｜ Bing、引擎排序 DuckDuckGo、Bing、Google、Kagi、Perplexity、五个预置引擎在授权框里点“允许”）拍三张，不碰 `~/.config/google-chrome` 和 e2e 测试配置。状态改为写 `storage.local` 的 `setupDone: true`（计划开放项）：`options-top.png` 开 `options.html#tab-pair`（② 顶部，含规则卡开头），`options-engines.png` 开 `#tab-engines`，`options-fullpage.png` 开 `#tab-add` 用 `Page.captureScreenshot` 拍整页。重量 `store-4-engines.html:25`、`promo-marquee.html:38` 的 `data-crop`（内容列变窄、行变短），同步 `assets/templates-v2/README.md` 的裁切说明；captions.md 的 en 表和“设置页三张的重拍”下加 v0.6 一段（日期、Chrome 版本、扩展提交、状态、各图尺寸、裁切变化）。

Run: `node scripts/store/render-assets.mjs --locale en`
Expected: 渲染器没有溢出和超行报告；商店截图 4 与顶部宣传图里的引擎行完整、没有被裁掉一半。

- [ ] **Step 9: 提交图片**

```bash
git add assets
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -F - <<'EOF'
docs(assets): reshoot the en settings captures for the tabbed page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9
EOF
```

- [ ] **Step 10: 版本号与 CHANGELOG**

`src/manifest.json:4`、`package.json` 的 `version` 都改成 `0.6.0`。CHANGELOG 用 changelog-zh skill 在 `## [0.5.0]` 之上加 `## [0.6.0] - <完成日期>`：开头一段说本版做了什么（没有新增权限）；“新增”：设置页分成四个 tab（添加到 Chrome、搜索组合、搜索引擎、右键查询）与 ① 的未完成/需要授权标记、tab 名可经网址直达、改默认组合后就地提示替换 Chrome 里的旧网址、改引擎网址后的“查看触发网址”按钮、第 2 步“更换组合”；“变更”：内容列收到 680px 且说明、网址框、下拉框顶到同一条右边界、关键词规则改成“搜索组合”里默认展开的卡片、窄窗口选项改成开关、没有隐藏引擎时不再显示空的“已隐藏”一段、网址只在 `/ ? & = ,` 后折行；“已知限制”：Ctrl+F 搜不到其他 tab 里的文字。0.5.0 条目不改。

Run: `npm test`
Expected: PASS。

- [ ] **Step 11: release 提交**

```bash
git add src/manifest.json package.json CHANGELOG.md
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -F - <<'EOF'
chore: release v0.6.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9
EOF
```

- [ ] **Step 12: 发布包冒烟（商店公钥）**

Run: `npm run pack -- --store-key ~/.config/split-search/cws-public-key.pem --smoke`
Expected: 生成 `dist/split-search-0.6.0.zip`，打印大小、sha256 与 key 情况；冒烟全部通过，装出的 ID 等于商店 ID `ebefmgpipceocigodihbbbhdiagmjdak`；发布前检查通过（manifest 与 package.json 都是 0.6.0、`src/` 无未提交改动）。

---

## 设计稿对照

| 设计稿 | 任务 |
|---|---|
| 1 不变的东西 | Global Constraints |
| 2 现状 | 背景，无任务 |
| 3.1、3.2、3.3、3.6 | 1（3.3 末条 600 宽在 2） |
| 3.4、3.5 | 2 |
| 3.7 | 1（reveal-setup、“详细步骤”、中键、已开页、hashchange）、3（其余入口） |
| 3.8 | 1（`focusIn`、离开 ③、`undoHide`）、3（`#pair-grant`） |
| 3.9 | 3 |
| 3.10 | 2（分隔线、`<wbr>`、禁用按钮、步骤圆圈、已隐藏空态、600 宽行、卡头）、3（开关行）、4（`#rule-add` 小按钮） |
| 3.11 | 4 |
| 3.12 本批不做 | 不做；Task 6 Step 1 发现的同类问题记入验收表“下一轮” |
| 3.13 文件与行数 | 各任务 Files 与行数检查步骤 |
| 4 文案 | 1、2、3、4 草稿，5 定稿 |
| 5.1、5.2 | 1（B19 `pairCallouts` 在 3） |
| 5.3 | 4 |
| 5.4 | 1（a–e、i、j）、2（l）、3（f、g、h、k） |
| 5.5 | 1（options-route、wiring）、2（url-break）、3（i18n-catalog 区名） |
| 5.6 | 6 |
| 5.7 | 每个任务的 e2e 步骤（出入第 1、2 条） |
| 6 文档同步 | 6 |
| 7 实施顺序 | 任务总览 |
| 8–11 | 取舍与审读记录，已体现在上面各任务 |
