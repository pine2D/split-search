# 设置页分 tab 与宽度统一设计（2026-10-27）

状态：定稿（已含用户 2026-10-27 的四项决定），待实施
基线：main 1ce8561（v0.5.0）。发在 v0.6.0（第 10 节第 4 条）。模式：Operate（impeccable SKILL.md 的 Modes）；质量门槛：craft-floor.md。

## 0. 来源

用户 2026-10-27 原话：

> 同步再系统优化设置的UI/UX：
> 1. 现在在一个页面摆了太多内容，分tab
> 2. [截图 10] [截图 11] 宽度有问题
> 3. 其他优化请你自己排查

截图 10：“右键查询”卡的说明只占卡片约 60% 宽，两个下拉框加起来只到一半。截图 11：“添加到 Chrome”卡里，`chrome://settings/searchEngines` 网址框和“复制地址”停在卡片中间，上方默认组合的触发网址框却通栏。

依据：
- 侦察三份：`opt-tabs/recon-visual.md`（测量与截图）、`opt-tabs/recon-structure.md`（区块、入口、e2e 影响、行数余量）、`opt-tabs/recon-audit.md`（P1–P3）。

> 注：本稿里所有 `opt-tabs/…` 路径（侦察三份、三份候选稿、`opt-tabs/mockups/` 线框与截图、`opt-tabs/builder-check.md`）都是起草会话 scratchpad 里的临时材料，**不入库、不作规范**，之后的实施会话打不开它们。凡需要的结论都已写进正文，一切以正文为准；引用它们只为说明出处。
- 三份候选稿：task（顶部 4 个 tab，APG Tabs）、minimal（3 个分区链接，列宽 620）、native（贴 chrome://settings 的侧栏）。两位评审都选 task（23 分），本稿以它为底，修掉评审指出的硬伤，再嫁接 minimal 和 native 被点名的做法。逐条见第 8 节。
- 实施者审读（builder check，20 条）：照代码逐条核实后改进本稿，处理记录见第 11 节。
- 用户对草稿第 10 节四个问题的回答（2026-10-27），见第 10 节。
- 线框：`opt-tabs/mockups/`（第 9 节；画在用户决定之前，规则区和西文行长两处以正文为准）。

一句话：顶部 4 个 tab（添加到 Chrome｜搜索组合｜搜索引擎｜右键查询）；内容列收到 680px，所有说明、网址框、下拉框、列表行顶到同一条右边界，四种语言都不设行长上限；关键词规则提成“搜索组合”里默认展开的独立卡；跨 tab 依赖用就地提示框、带按钮的提示、tab 标记和页内链接接上。

## 1. 不变的东西

- 权限、存储键与写法、DNR、分屏判定、所有硬约束。tab 状态只放在网址 hash 里，不进 `chrome.storage`（`storage.local` 只许 `setupDone`，`storage.session` 只多 `setupTryTabs`），也不用 `sessionStorage`。
- 弹窗、`background.js`、`go.js`、`lib/messages.js` 不改：`reveal-setup` 协议、`pickOptionsTab` 只比路径（任何 hash 都算设置页）、找不到时新开 `options.html#setup`，都照旧。
- `render()` 仍是整页重建；四个面板都渲染，只切显隐。e2e 的 READY（`#engines .engine-row` 存在）不受影响（隐藏面板里的节点照样在 DOM 里）。切 tab 不触发 render。
- 所有现有 `section.card` 的 `aria-labelledby` 和 h2 的 id、所有现有控件 id（`#setup-*`、`#pair-left`、`#gen-left`、`#lookup-engine`、`#engines-reorder`、`#edit-<id>`、`#cycle-<id>`、`#rule-*` 等）不变。e2e 的 `[aria-labelledby="lookup-title"]` 之类选择器照用。
- `disclosure` 的展开状态（`ui.js` 的 `openIds`）、`renderGuideSteps` 的两种外壳、`setupView` 的四档、`#setup` 卡片隐藏时“什么都不做”（B19(e) 断言焦点仍是 BODY）、“详细步骤”左键不改 hash（B19 detailsLink）。
- 规则对话框（`#rule-dialog`）、规则行的 DOM 与 id、上移/下移的 `aria-disabled` 做法都不变；只换外壳（第 3.11 节）。
- reorder.js 的 Esc 监听仍挂在 `#engines-reorder` 的 `closest("section")` 上。
- 不加颜色变量（只用 `tokens.css` 现有变量），不加图标（标记用 `ui/icons.js` 已有的 `alert-circle`），不加依赖。JS 单文件 ≤300 行（含 `scripts/e2e/`）。

## 2. 现状（recon-visual 实测，1280 宽，zh / en）

| 项 | 数值 |
|---|---|
| 页面总高 | 全新安装 2615 / 2802px（2.9 / 3.1 屏）；设置完成 2328 / 2539；全展开最长 4507px（en，600 宽） |
| Tab 停靠点 | 27–44 个 |
| 内容列 | `.page` 780px，卡片内宽 707px；900 与 1280 宽下布局完全相同 |
| 说明文字 | `.hint`、`.steps li`、`.caveats li`、`.step-body p` 被 `options.css:47` 限到 60ch：13px 下 446px（内宽的 0.63），中文约 33 字折行 |
| 同卡右边界 | 说明 0.61–0.71；`.steps li` 里的网址框 0.52–0.56；触发网址框 0.92；列表行与分隔线 1.00 |
| 下拉框 | 默认组合窗格 480px 上限（0.68）；右键查询 231 + 150px（0.55）；其他组合生成器 177 + 150px（0.48）。三套宽度规则 |
| 600 宽 | 引擎行全部折成两行，“搜索引擎”卡 +24% 到 +43% |

## 3. 改成

### 3.1 四个 tab

| # | tab（zh_CN） | key | 按钮 / 名称 / 面板 | 内容 |
|---|---|---|---|---|
| ① | 添加到 Chrome | `add` | `#tabbtn-add` / `#tabname-add` / `#panel-add` | `section#setup`（开始使用卡，条件显示）；`section#guide`（`#triggers`：默认组合一段、其他组合生成器；`#guide-steps` 5 步；注意事项） |
| ② | 搜索组合 | `pair` | `#tabbtn-pair` / `#tabname-pair` / `#panel-pair` | 默认组合卡（`#pair-body`：窗格、`#pair-changed`、窄窗口开关行、左侧未授权提示框、“其他组合”指引句）；其后是新的规则卡 `section#rules-card`（3.11） |
| ③ | 搜索引擎 | `engines` | `#tabbtn-engines` / `#tabname-engines` / `#panel-engines` | 搜索引擎卡（列表、已隐藏、引擎库、新增、调整顺序）；快捷键卡（`#shortcut`、`#cycle` 轮换清单） |
| ④ | 右键查询 | `lookup` | `#tabbtn-lookup` / `#tabname-lookup` / `#panel-lookup` | 右键查询卡（`#lookup-body`） |

tab 栏之外：页头（h1、标语、语言下拉框，对所有 tab 生效）、页脚 `lang_note`、`#notices`、5 个 `<dialog>`。

为什么这样分：
- 按用户来设置页要办的事分：第一次装好或再加一条组合到 Chrome；换左右引擎、按关键词换右侧、窄窗口；管理引擎和快捷键轮换；右键用哪个引擎。
- 快捷键卡放进 ③（第 10 节第 1 条，用户选定）：轮换顺序就是引擎列表的顺序，轮换清单是逐个引擎勾选。放在一起，`options_cycle_hint`“按引擎列表的顺序”这句跨区引用自然消失；第 4 个 tab 只剩右键查询，四语都短。
- 开始使用卡放在 ① 顶部，不常驻在 tab 栏上方：卡片约 600px，常驻会让设置期间每个 tab 都先滚过它；它的第 2 步和“添加到 Chrome”的 5 步是同一件事，同在 ①，“详细步骤”就是 tab 内跳转。
- 不设“通用”tab：语言本来在页头；窄窗口只有一项，决定拆分视图怎么开，归“搜索组合”。

各 tab 的高度与 Tab 停靠点（估算，T6 实测；高度含页头和 tab 栏约 165px，zh，1280）：

| tab | 状态 | 高度 | Tab 停靠点（含语言框 1、tab 栏 1、面板 1） |
|---|---|---|---|
| ① | 设置中（steps） | 约 970px（约 1.1 屏） | 3 + 开始使用 5（授权、2 个复制、详细步骤、更换组合）+ 4 个 summary = 12 |
| ① | 设置完成 | 约 700px | 3 + 默认网址复制 1 + 其他组合 1 + 5 步复制 1 + 第 5 步链接 1 + 注意事项 1 = 8 |
| ② | 全新安装（0 条规则） | 约 860px（默认组合卡约 440 + 规则卡约 250） | 3 + 2 下拉 + 开关 1 + 未授权提示框授权 1 + 指引链接 1 + 新增规则 1 = 9；每多一条规则 +3（编辑、上移、下移） |
| ③ | 全新安装 | 约 880px | 3 + 卡头 3 + 引擎行 10 + 设置快捷键 1 + 轮换 summary 1 = 18 |
| ④ | 默认 | 约 530px | 3 + 5 = 8 |

整页现在 2.4–5 屏、27–44 个停靠点；改后每个 tab 在一屏左右，单个 tab 最多约 18 个（② 有 3 条以上规则时会超过，规则本来就要逐条操作）。

### 3.2 页面骨架（`options.html`）

```html
<body class="loading">
<div class="page">
  <header class="page-head">            <!-- 移出 main：banner 地标 -->
    <div class="page-title"> h1 · p.muted（标语） </div>
    <div class="lang-box"><div id="lang-picker"></div></div>
  </header>
  <div class="tabbar">
    <div role="tablist" id="tabs" class="tablist" data-i18n-attr="aria-label:options_tabs_label">
      <button type="button" role="tab" class="tab" id="tabbtn-add" aria-controls="panel-add" aria-selected="false" tabindex="-1">
        <span id="tabname-add" data-i18n="options_tab_add"></span>
        <span class="tab-flag" id="tab-flag-add"></span>   <!-- 平时空、不显示；tabs.js 按档加类并放内容，见 3.3 -->
      </button>
      … tabbtn-pair / tabbtn-engines / tabbtn-lookup：同样结构，没有 .tab-flag
    </div>
  </div>
  <main>
    <div role="tabpanel" id="panel-add" aria-labelledby="tabname-add" tabindex="0" hidden> section#setup · section#guide </div>
    <div role="tabpanel" id="panel-pair" aria-labelledby="tabname-pair" tabindex="0" hidden> section[aria-labelledby=pair-title] · section#rules-card </div>
    <div role="tabpanel" id="panel-engines" aria-labelledby="tabname-engines" tabindex="0" hidden> 搜索引擎卡 · 快捷键卡 </div>
    <div role="tabpanel" id="panel-lookup" aria-labelledby="tabname-lookup" tabindex="0" hidden> section[aria-labelledby=lookup-title] </div>
  </main>
  <footer class="page-foot"> lang_note </footer>   <!-- 移出 main：contentinfo -->
</div>
<div id="notices" …> · 5 个 <dialog>（位置不变）
```

- **静态 HTML 里四个按钮都 `aria-selected="false" tabindex="-1"`、四个面板都 `hidden`**，由首次 render 里的 `routeOnce`（3.6）选中一个、打开一个。这样载入时网址带 `#guide`、`#triggers`、`#engines` 这类元素 id，浏览器也找不到可滚动的目标（元素在 `display: none` 的面板里），不会在路由之前就按 fragment 滚动（builder check #17）。页面在 `body.loading` 期间整体不可见，看不到“全隐藏”的那一瞬。
- 面板的可访问名称指向只包 tab 名的 `#tabname-<key>`，不指向按钮：按钮的名称里还拼着“未完成”“需要授权”，读屏进面板时不该读成“添加到 Chrome 未完成，标签面板”（#19）。
- 面板一律用普通 `hidden`（`el.hidden = true/false`），不用 `hidden="until-found"`。until-found 走 `content-visibility: hidden`，面板元素自己的盒子还在、仍能聚焦，三个隐藏面板会留下看不见的 Tab 停靠点，`checkVisibility()` 对面板本身也返回 true。代价是 Ctrl+F 搜不到隐藏 tab 里的文字（第 8 节第 3 条）。
- 面板不写任何 `display` 样式：作者样式的 `display` 会盖过 `hidden`（CLAUDE.md 引擎行精简那节踩过）。同理，`.tab-flag` 不用 `hidden` 属性切换，用类（3.3）。
- 面板 `tabindex="0"`（APG：面板第一个内容不可聚焦时面板应可聚焦）。隐藏面板是 `display: none`，不进 Tab 序列，所以只有当前面板占一个停靠点。
- 已隐藏引擎的 h3 加 id `hidden-title`；没有隐藏引擎时 `#hidden-title` 和 `#hidden-engines` 都 `hidden`（P3-5），`renderHiddenList` 这时返回 `null`，`engine_hidden_empty` 随之删除（第 4 节，#6）。options.js:134 相应改成 `$("hidden-engines").replaceChildren(...[renderHiddenList(ctx)].filter(Boolean))`：`replaceChildren(null)` 会插入文字节点“null”。
- 规则卡（3.11）是静态的 `section#rules-card.card[aria-labelledby=rules-title]`，内含 `h2#rules-title` 和 `div#rules-body`。

### 3.3 tab 栏：样式、键盘、标记

样式（`options.css`，只用已有变量）：

```css
.tabbar { border-bottom: 1px solid var(--border); margin: 0 0 16px; }
/* overflow-x: auto 会把 overflow-y 也算成 auto：显式 hidden，经典滚动条下不冒竖向滚动条（#9） */
.tablist { display: flex; gap: 2px; padding-inline: 7px; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
/* 7 + tab 内边距 14 = 21px：第一个 tab 的文字和卡片正文左边对齐（卡片边框 1 + 内边距 20） */
.tab {
  flex: none; position: relative; display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: 14px; font-weight: 500; line-height: 1.4; white-space: nowrap;
  color: var(--muted); background: none; border: 0; border-radius: 6px 6px 0 0;
  padding: 12px 14px 11px; cursor: pointer;
}
.tab:hover { color: var(--text); background: var(--code-bg); }
.tab[aria-selected="true"] { color: var(--accent); }          /* 不改字重，切换时标签不变宽 */
/* 下划线落在 tablist 内边距盒底边上、紧贴 .tabbar 的分隔线之上，不超出 tablist（#9） */
.tab[aria-selected="true"]::after {
  content: ""; position: absolute; left: 10px; right: 10px; bottom: 0; height: 3px;
  border-radius: 3px 3px 0 0; background: var(--accent);
}
.tab:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
/* 空的 flag 不占 flex 项，① 不会因为 gap 比别的 tab 宽 6px、切档时也不跳（#4） */
.tab-flag { display: none; }
.tab-flag.todo, .tab-flag.regrant { display: inline-flex; align-items: center; }
.tab-flag.todo::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.tab-flag.regrant { color: var(--warn); }
@media (forced-colors: active) { .tab[aria-selected="true"]::after, .tab-flag.todo::before { background: Highlight; } }
[role="tabpanel"]:focus-visible { outline: 2px solid var(--focus); outline-offset: 4px; border-radius: var(--radius); }
```

- 类名定为 `.tablist`（`div[role=tablist]#tabs` 上）和 `.tab`（按钮上），HTML、CSS、B21 一致（#5）。
- 外观照 Chrome 的 `cr-tabs`：纯文字加主色下划线，不用药丸或分段按钮。切换没有动画。
- **不吸顶**。每个 tab 在一屏左右，回到 tab 栏的路很短；吸顶要给所有滚动定位目标（`revealSetup`、`revealGuideSteps`、B4 的坐标点击、e2e 的 `scrollIntoView`）加 `scroll-margin-top`，还要处理矮窗口，回归面不值。
- 键盘（WAI-ARIA APG Tabs，自动激活）：←/→ 选上一个/下一个（循环），Home/End 到首尾，焦点和选中一起移动；只有选中的 tab `tabindex=0`。不处理 ↑/↓，不占用 Ctrl+PageUp/PageDown（Chrome 切浏览器标签用）。Tab 键从 tab 栏进当前面板。
- 标记（只在 ① 上，`setTabFlag(mode)` 按 `setupView` 的 mode 写）：
  - steps：`#tab-flag-add` 加类 `todo`，内容是 `<span class="sr-only">未完成</span>`（`options_tab_todo`），圆点由 `::before` 画，不是字符。
  - regrant：加类 `regrant`，内容是 14px `alert-circle`（icons.js 的 SVG 本身带 `aria-hidden`）加 `<span class="sr-only">需要授权</span>`（`options_tab_regrant`）。
  - done、hidden：去掉两个类、清空内容。
  - `.sr-only` 文字放在 flag 里面：flag 不显示时它跟着不在可访问树里（#5）。flag 本身不加 `aria-hidden`。文字放进可访问名称，不用 aria-describedby：有的读屏在 tab 间移动时不读 description。sr-only 用 `data-i18n`，换语言时由 `applyI18n` 一起重写。
- 600px 视口：zh 四个标签约 415px，en 实测在 558px 栏宽里放得下（线框 3），es 估算约 480px。放不下时横向滚动，不折行；切换后对选中的 tab 调 `scrollIntoView({ inline: "nearest", block: "nearest" })`。

### 3.4 宽度（用户第 2 点）

原则：先定内容列，所有块顶到同一条右边界。四种语言都不设行长上限（第 10 节第 3 条，用户选定）。不再逐元素截宽，逐元素截宽正是右边界参差的原因。

```css
:root { --page-max: 680px; }   /* 680 = chrome://settings 主列宽 */

body.loading .page { visibility: hidden; }      /* 原来是 main；页头和 tab 栏移出 main 后一起藏 */
.page { max-width: calc(var(--page-max) + 32px); margin: 0 auto; padding: 28px 16px 64px; }
/* 卡片内宽 = 680 − 2 − 40 = 638px（原 707px） */

/* 删掉 :44–47 的 60ch 和注释，改成（不设 max-width，四种语言同一条右边界）： */
.hint, .steps li, .caveats li, .step-body p { text-wrap: pretty; }
.page-foot .hint { font-size: 12px; margin: 0; }   /* 删掉原来的 65ch */

/* 默认组合窗格：删掉 max-width: 480px，两格各约 316px */
.pair-pickers { margin-top: 8px; }
/* 其他组合生成器：与默认组合窗格同一套列线（panes.css：gap 6px，flex-basis 180px） */
.lookup-pickers {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  gap: 8px 6px; align-items: end; margin-top: 8px;
}
.lookup-pickers label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); min-width: 0; overflow-wrap: break-word; }
.lookup-pickers select { width: 100%; min-width: 0; }
/* 右键查询卡（lookup.js 的 div.lookup-card）：两个下拉框各占整行（es 的“跟随默认组合的右侧（当前：X）”有 67 个字符，半宽会截断；截图 10） */
.lookup-card .lookup-pickers { grid-template-columns: minmax(0, 1fr); gap: 10px; }

.section-head { flex-wrap: wrap; gap: 8px 12px; }               /* es 卡头按钮放不下时换行，不挤 h2 */
.engine-main, .rule-main { flex: 1 1 180px; min-width: 0; }     /* 原 300px：600 宽时引擎行不再折行，算术见下 */

@media (max-width: 600px) {
  .page { padding: 20px 12px 48px; }
  .card { padding: 16px; }
  .tablist { padding-inline: 3px; }     /* 3 + 12 = 15 ≈ 卡片边框 1 + 内边距 16 */
  .tab { padding-inline: 12px; }
}
```

结果（1280 宽，卡片内宽 638px；线框实测卡片外宽 679）：

| 块 | 现在 | 改后（四种语言相同） |
|---|---|---|
| `.hint` | 446px（0.63） | 638px（1.00）；zh 13px 约 49 字一行，en/es 约 95–105 个字符一行 |
| `.steps li` 与其中的网址框 | 480 / 369–399px | 616px（扣 22px 缩进），网址框到右边界 |
| 默认组合窗格 | 480px（0.68） | 每格约 316px，撑满 |
| `#gen-left` / `#gen-right` | 177 / 150px | 每个约 316px，与窗格同列线 |
| `#lookup-engine` / `#image-engine` | 231 / 150px | 都是 638px |

**600px 视口的引擎行算术（#7，重算并实测）**。可用宽度 = 卡片内宽 − 行内边距 8（`.engine-row { padding: 12px 4px }`）：没有经典滚动条时 542 − 8 = 534，经典滚动条（Linux 带界面 Chrome、Windows，约 15px）时 527 − 8 = 519。扣掉行内间距 16，左块 basis 加右侧控件组的上限是 518 / 503。右侧控件组（`.engine-side`：状态 + 授权按钮 + “编辑”）的自然宽度，2026-10-27 用 Chrome 156.0.8078.47 无头、e2e 的字体配置（`~/.cache/split-search-e2e/fonts.conf`，Noto Sans CJK）、真实的 `options.css` 和四语文案实测：

| 语言 | 已授权 | 未授权（必需，带授权按钮） | 未授权（可选，带授权按钮） |
|---|---|---|---|
| zh_CN | 113 | 217 | 217 |
| zh_TW | 113 | 217 | 229 |
| en | 162 | 259 | 296 |
| es | 152 | 310 | 301 |

草稿的 basis 220 在经典滚动条下只给右侧留 283px，en、es 的未授权行都会折（builder check 说得对）。改成 180：右侧上限 323px，最宽的 es 310 也放得下，留 13px 余量（Windows 字体略有差别，余量够用；不够时再降，B21(l) 会报出来）。左块 180px 放得下“名称 + 一个标签”，标签多时在左块里自己换行（`.engine-title` 本来就 `flex-wrap`），网址是 `overflow-wrap: anywhere`。1280 宽下左块照样长满，看不出差别。规则行 `.rule-main` 同用 180（右侧是三个小按钮，更窄）。

下拉网格在内宽小于 366px 时变单列。对话框的 `40ch`（`options.css:281`）不动。

西文不设上限的代价：en/es 说明每行约 95–105 个字符，超过 craft-floor 的 65–75ch，`impeccable detect` 会报 line-length（上一轮报过 4 条，含“设置第 4 步”的 `.steps li`）。用户 2026-10-27 接受这个取舍，换四语同一条右边界；验收不以 line-length 为失败（5.6）。

### 3.5 页头

标语现在被语言框挤成 zh 两行、en 三行，en 的“Language”还会掉到下拉框上面（recon-visual 问题 6）。改成网格，`.page-title` 用 `display: contents`，HTML 不改：

```css
.page-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 16px; margin-bottom: 16px; }
.page-title { display: contents; }
.page-head h1 { grid-column: 1; grid-row: 1; margin: 0; font-size: 22px; }
.lang-box { grid-column: 2; grid-row: 1; }
.page-title p { grid-column: 1 / -1; grid-row: 2; margin: 0; text-wrap: pretty; }   /* 不设行长上限 */
.lang-picker { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; font-size: 13px; color: var(--muted); }
@media (max-width: 480px) { .page-head { grid-template-columns: minmax(0, 1fr); } .lang-box { grid-column: 1; grid-row: auto; } }
```

en 最宽时 h1 约 140 + 16 + “Language” 68 + 下拉框 255 = 479px，600 宽下一行放得下（线框 3 已验证）。

### 3.6 默认 tab 与路由

纯函数放新文件 `src/lib/options-route.js`（先写 `test/options-route.test.js`）：

- `TAB_KEYS = ["add", "pair", "engines", "lookup"]`；`tabHash(key)` → `#tab-<key>`。
- `routeFromHash(hash)`：`#tab-<key>` 且 key 在 `TAB_KEYS` 里 → `{ tab: key }`；`#setup` → `{ reveal: "setup" }`；`#guide-steps` → `{ reveal: "guide-steps" }`；其他（含 `#tab-foo` 这种 key 不认识的、`#guide`、`#engines` 这类元素 id）→ `{}`（#17）。原 setup.js 的 `hashTarget` 并进来。
- `initialTab(hash, { mode })`：`mode` 是 `setupView` 的 mode（steps / regrant / done / hidden），`shown = mode === "steps" || mode === "regrant"`。hash 是有效的 `#tab-*` 就用它；`#setup` 且 shown → `add`；`#guide-steps` → `add`（5 步说明本来就在 ①，卡片显不显示都一样）；`#setup` 且卡片不显示、无 hash、认不出 → `shown ? "add" : "pair"`。
- `stepTab(keys, current, key)`：←/→ 循环、Home/End。

hash 规则：

| 情况 | 选中的 tab | hash |
|---|---|---|
| 首次载入 | `initialTab` | 不改写（`#setup`、`#guide-steps` 刷新后照旧再定位一次，与现状相同） |
| 用户点 tab、方向键 | 新 tab | `history.replaceState` 写 `#tab-<key>`，不产生历史；后退直接离开设置页 |
| 页内链接、reveal 把用户带到别的 tab | 目标 tab | 同上 |
| 在当前 tab 内的 reveal（如 ① 里点“详细步骤”） | 不变 | **不动**（B19 detailsLink 断言 hash 不变） |
| 用户在地址栏手改成 `#tab-*`、`#setup`、`#guide-steps` | 见 `routeFromHash` | 由浏览器写入；认不出的 hash 什么都不做 |

- tab hash 用 `#tab-<key>`，不和任何元素 id 撞名（`#setup`、`#guide`、`#engines`、`#cycle`、`#shortcut`、`#rules-card` 都已占用或新占），载入时浏览器不会自己滚。
- 默认 tab 只在首次 render 判一次。之后授权成功、`setupDone` 变成 true、卡片换成完成确认，都不自动换 tab，不把用户从正在看的地方带走（写进验收表）。
- 读配置失败的分支调 `routeOnce("hidden")`（进 ②，没有卡片可显示）；之后某次渲染成功、卡片应该显示时，因为“只判一次”，用户仍停在 ②，① 的标记会亮起提示。这是有意接受的边界，写进验收表（#17）。
- 整个 `src/options/` 只有 `tabs.js` 注册 `hashchange`：它调 `routeFromHash`，`#tab-*` 交给 `showTab`（不写 hash），`#setup`/`#guide-steps` 交给注入的 `onReveal`（options.js 把 setup.js 的 `requestReveal` 传进来）。setup.js 删掉自己的 `hashchange` 监听（setup.js:63–66）。`options-wiring.test.js` 加静态检查：`src/options/` 里只有 tabs.js 出现 `"hashchange"`。
- 首次路由的位置：render 里 `applyStatic()` 之后、`classList.remove("loading")` 之前调 `routeOnce(mode)`，不会闪一下错误的 tab。`options-wiring.test.js` 原有的“去掉 loading 后紧接着 `revealSetup()`”保持，再加一条“每处去掉 loading 之前有 `routeOnce(`”。
- `renderSetup` 改为返回 `v.mode`（字符串），options.js 自己算 `setupShown = mode === "steps" || mode === "regrant"` 交给 guide.js（语义与现在的布尔返回值相同），`mode` 交给 `routeOnce`、`setTabFlag` 和 pair.js（3.9，#11）。

`showTab(key, { focusTab = false } = {})`（tabs.js）：已选中就什么都不做；否则改 `aria-selected`/`tabindex`、切面板 `hidden`、`replaceState` 写 hash、离开 ③ 时调 `onLeave`（options.js 注入 `leaveReorder({ focus: false })`）；tab 栏顶边已滚出视口（`getBoundingClientRect().top < 0`）就 `scrollTo` 到 tab 栏顶（instant），否则不滚。`routeOnce` 用同一套切换逻辑，但不写 hash、不滚动。

### 3.7 全部入口

页内跨 tab 链接统一写真实 `href`：中键、Ctrl+点能在新标签打开对应 tab。左键的处理分两类：

- `href="#tab-<key>"` 的链接：由 tabs.js 在 `document` 上**委托**处理 click（左键、无修饰键）：`preventDefault` → `showTab(key)` → 按链接的 `data-reveal` 调 options.js 注入的 `reveals[name]?.()`。所以 setup.js、pair.js、locale-ui.js 只建 `<a>`，不 import tabs.js 处理点击（#16 的依赖问题）。
- `href="#setup"`、`href="#guide-steps"` 的链接：各自的 onclick 直接调 `requestReveal("setup")` / `revealGuideSteps()`（同现有 `a.step-link` 的做法），这两个函数开头先 `showTab("add")`。

`reveals`（options.js 传给 `initTabs`）：

| 名 | 做什么 |
|---|---|
| `pair-left` | `focusIn($("pair-left"))` |
| `left-grant` | 默认左侧 id = `current.defaultPair[0]`；`focusIn(document.querySelector('#engines [data-id="<左>"] .perm-line button') ?? $("edit-<左>"))`，不给授权按钮加 id（#16） |
| `generator` | guide.js 的 `revealGenerator()` |

| 入口 | 改后行为 | 代码 |
|---|---|---|
| 安装后 `openOptionsPage()`（background.js:60） | 无 hash → 默认 tab；全新安装是 ① | 不改 |
| 弹窗页脚“打开设置”、go.html 出错页“打开设置” | 已开的页保持当前 tab（按 Chromium 的打开逻辑只是切到前台；B21(j) 实测，#18）；新开的页进默认 tab | 不改。go.html 按错误码深链到 ③ 要把 `openOptionsPage` 换成找已开页那一套，收益小，不做 |
| 弹窗“完成设置”“查看第 2 步”，找到已开的设置页 → `reveal-setup` | `revealSetup()`：卡片显示时先 `showTab("add")`（从别的 tab 过来就写 `#tab-add`，刷新不会回到错的 tab），再滚动、焦点给 `#setup-title`；卡片隐藏时什么都不做，不切 tab | setup.js +2 行 |
| 没找到 → 新开 `options.html#setup` | `initialTab` 选 ①，`revealSetup` 照旧定位 | — |
| 第 2 步“详细步骤”左键 | 已在 ①，`revealGuideSteps()` 开头的 `showTab("add")` 什么都不做，之后与现状相同；hash 不变 | guide.js +1 行 |
| 中键 / Ctrl+点“详细步骤” → `#guide-steps` | `initialTab` 选 ①，之后同现状 | — |
| 新：第 2 步“更换组合” | 位置与写法见下；左键 → `showTab("pair")` → `reveals["pair-left"]` | setup.js |
| 新：② 的 `#pair-changed` 里“查看设置步骤”（`href="#guide-steps"`）/“继续设置”（`href="#setup"`） | 前者 `revealGuideSteps()`，后者 `requestReveal("setup")`；都切到 ① 并写 `#tab-add` | pair.js 调 guide.js、setup.js 的导出 |
| 新：② 末行“到‘添加到 Chrome’生成它的触发网址”（`<a href="#tab-add" data-reveal="generator">`） | 切到 ①，展开“其他组合”，焦点给它的 summary | pair.js；guide.js 导出 `revealGenerator()`（约 5 行） |
| 改：① 第 5 步 `guide_step_grant` 里的“搜索引擎” | `<a href="#tab-engines" data-reveal="left-grant">` → 切到 ③，焦点见上表 | locale-ui.js 的 RICH_TEXT 加一项；options.html 的 li 改成 `<li id="guide-step-grant">`、去掉 `data-i18n`（参照 `guide-step-fields`，#16） |
| 新：③ 编辑对话框改了引擎网址后的提示（`notice_template_changed`）里的按钮“查看触发网址” | 切到 ①（`showTab("add")`），`#guide-default` 存在就展开，滚到 `#triggers`，焦点给 `#triggers .trigger-default .url-line button`（默认组合那条的复制按钮；不能只写 `#triggers .url-line button`：默认组合拼不出网址、“其他组合”又展开时，第一个匹配的是生成器的复制按钮），没有就 `focusIn(null)`（3.9 第 5 条，#13） | actions.js；guide.js 导出 `revealTriggers()`（约 7 行） |
| `#notices` 里的“撤销”（undoHide） | 引擎恢复；焦点经 ``focusIn($(`edit-${e.id}`) ?? (isReordering() ? $("engines-reorder") : null))``：保留现有“调整顺序”模式中交给“完成”的兜底（actions.js:200，模式中的行没有 `#edit-<id>`）；用户还在 ③ 就给目标，已切走就给当前 tab 按钮，不替用户切回 | actions.js 改 1 行 |
| 用户在地址栏改 hash | 见 3.6 | tabs.js |

“更换组合”的位置与写法（#10）：放在第 2 步正文最后，`ol.setup-substeps` 之后；和“详细步骤”一起包进新的 `div.step-links`，**“详细步骤”在前**，“更换组合”在后：

```html
<div class="step-links">
  <a href="#guide-steps" class="step-link">详细步骤</a>                                  <!-- 原样，b19-guide 的 querySelector 仍取到它 -->
  <a href="#tab-pair" id="setup-change-pair" class="step-link" data-reveal="pair-left">更换组合</a>
</div>
```

```css
.step-links { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 8px; }
.step-links .step-link { margin-top: 0; }   /* 原 .step-link 的 inline-block + margin-top: 8px 保留给别处 */
```

b19-guide.mjs:38 的 `#setup [data-step="add"] a.step-link` 取第一个，仍是“详细步骤”；B19 的 `substepProblems` 只数三个小步 `li` 里的按钮，链接在 `ol` 外面，不受影响。tab 本身是 `<button>`，不能中键新开（task 稿这条说法删掉）。

### 3.8 焦点

- 点 tab：焦点留在 tab 按钮上。按 hash 进入：不动焦点（`#setup`、`#guide-steps` 沿用现有规则）。页内链接切 tab：焦点给目标控件（3.7）。
- 通用兜底 `focusIn(el)`（tabs.js 导出）：`el && el.checkVisibility() ? el.focus() : 当前选中的 tab 按钮.focus()`；`el` 为 null 时同样落到 tab 按钮。
  - `focusAfterRender`（options.js:35–42）最后一行 `el?.focus()` 改成 `focusIn(el)`。原来的 `id.startsWith("setup-") ? $("pair-left")`（重新授权成功、卡片隐藏后给左侧下拉框）删掉，交给兜底：`#pair-left` 已在另一个 tab，用户这时在 ①，焦点落到 `#tabbtn-add`，读屏读“添加到 Chrome，标签，已选中，第 1 个，共 4 个”。
  - ② 的“左侧未授权”提示框里的授权按钮补 `id="pair-grant"`，`FOCUS_FALLBACK` 加 `"pair-grant": "pair-left"`：授权成功、提示框消失后焦点给同 tab 的左侧下拉框（#15）。`focusAfterRender` 只在原焦点元素有 id 时才执行，这个 id 是必需的。
  - ① 生成器里的授权按钮（`genOutput` 的提示框）一直没有 id，授权成功后焦点掉回 BODY，是现状就有的问题，与分 tab 无关，本批不改（第 3.12 节）。
  - actions.js `undoHide` 同样改用 `focusIn`，并保留模式中的兜底：``focusIn($(`edit-${e.id}`) ?? (isReordering() ? $("engines-reorder") : null))``（actions.js:200 现有写法只把末尾的 `?.focus()` 换成 `focusIn(…)`）。B12(4)（options-b2.mjs:80“模式中点‘撤销’后焦点应交给‘完成’”）的期望不变。
- 离开 ③ 时若在“调整顺序”模式：`leaveReorder({ focus: false })` 退出并立即 `flushOrderNow`，不抢焦点。回来看到的是平时的列表，不会停在一张只有上移/下移的列表上。
- 对话框是模态的，开着时点不到 tab 栏，opener 和焦点归还都在同一个面板。
- `confirmStep`：点 tab 会让“确认删除？”按钮失焦，按现有逻辑复原，正确。

### 3.9 跨 tab 依赖的提示

依据 recon-structure §1.9 的数据流，凡是“在 A tab 改了、B tab 跟着变，用户又需要知道”的：

1. **改默认组合 → Chrome 里的网站搜索还是旧网址**（recon-audit P1-3）。`#pair-left`/`#pair-right` 保存成功后，pair.js 在模块变量记 `pairChanged = { from: [l, r], mode }`（`from` 是保存前的组合，`mode` 是保存时 `setupView` 的 mode；只在本页内存，不写存储；已记过就不覆盖 `from` 和 `mode`）。之后每次渲染先按下面两条判断要不要清掉，再按当前 **`setupView` 的 mode**（不按 setupShown，#11）选文案：
   - `steps`（还在首次设置，卡片里的网址就是新组合的）：`#pair-changed` 显示 `options_pair_changed_setup`“‘开始使用’里的网址已换成新组合。”加链接 `options_pair_changed_continue`“继续设置”（`href="#setup"`）。
   - `regrant`、`done`、`hidden`（设置过，Chrome 里存的是旧网址；regrant 档的卡片只有授权一步、没有网址，done 档 setupShown 为 false 但卡片看得见）：显示 `options_pair_changed`“默认组合已改成 X ｜ Y。Chrome 里的网站搜索还在用旧网址，复制下面的新网址替换它。”，加 `urlBox(新触发网址)`（拼不出网址时换成 `guide_no_trigger`）和链接 `options_pair_changed_steps`“查看设置步骤”（`href="#guide-steps"`）。
   - 清掉 `pairChanged`、提示框消失的三种情况：当前组合等于 `from`（改回原组合）；记录是 steps 档写下的（`pairChanged.mode === "steps"`）而当前 mode 已离开 steps（用户按卡片里的新网址完成了设置，`setupDone` 变成 true，Chrome 里存的就是新组合，再说“还在用旧网址”是错的）；刷新。清掉之后再改组合，按当时的组合重新记 `from` 和 `mode`。
   - `#pair-changed` 是 `div.callout`（不带 `callout-warn`，B19 的 `pairCallouts` 只数 `.callout-warn`），**不设 `role="status"`**：它在 `#pair-body` 里，每次 render 都被整个重建，无关的重渲染（另一页改 sync、授权变化）会让读屏重读（#14）。播报交给保存时的提示：pair.js 传给 `act` 的成功提示改成函数，依次判断：新组合等于 `pairChanged.from`（改回原组合，提示框随之消失）→ `notice_pair_saved_back`“默认组合已保存。”（新 key，第 4 节）；否则按当时的 mode 选 `notice_pair_saved_setup`（steps）或改写后的 `notice_pair_saved`（其他）。经 `#notices`（`aria-live="polite"`）只播一次，不会出现“提示框已消失、保存提示还说旧网址”的矛盾。`act` 本来就接受返回 LabelSpec 的函数（actions.js:70），不用改。
   - 原 `options_pair_hint` 第二句由它接手；第一句是边缘规则（左侧下拉框本来就不列“只能作右侧”的引擎），一并删掉。新 `options_pair_hint` 只说用途。
2. **左侧未授权**。pairSection 原条件 `left && !setupShown && !granted`（同页不重复）改成 `left && !granted`：分 tab 后卡片在 ①，用户在 ② 换成未授权的左侧时，② 自己也要说。授权按钮补 `id="pair-grant"`（3.8）。① 生成器里的 `inSetupCard` 条件保留（生成器和卡片同在 ①）。B19 `pairCallouts` 的期望随之改（第 5 节）。
3. **① 的标记**（3.3）：用户在别的 tab 也能看到“这里还有事”。
4. **文案里的跨区引用**（#12，全部进第 4 节）：
   - `guide_step_grant`：改成链接到 ③（3.7）。
   - `engine_in_pair_hide` / `engine_in_pair_delete`（③ 编辑对话框的 `#dlg-remove-reason`）：“先在‘默认组合’里换成别的引擎”指向的是 ②，而 tab 叫“搜索组合”。改成句中直接写 tab 名：“先到‘搜索组合’里把默认组合换成别的引擎。”。不用占位符：`setI18nText` 会把参数按当时语言存进 `data-i18n-args`，另一页切语言时会留下旧语言的 tab 名；逐字写进各语言句子，由单测守住与 `options_tab_pair` 一致（5.5）。
   - `notice_template_changed`：“在本页重新复制”改成“到‘添加到 Chrome’重新复制”，并带按钮（第 5 条）。
   - `notice_pair_saved`：与 `#pair-changed` 说同一件事，留作唯一的播报（第 1 条），文字改成与提示框一致；新增 `notice_pair_saved_setup` 给 steps 档。
   - `options_rules_intro` 里的“‘其他组合’不受影响”：带引号指的是 ① 的折叠区名，规则卡在 ②。改成不带引号的说法“用其他组合的触发网址搜索时，规则不起作用”。
   - `options_cycle_hint`（与引擎列表同在 ③）、`engine_reorder_hint`（只说影响范围）、`options_engines_hint`（“编辑”“调整顺序”同卡）、`guide_default_hint`（“下方步骤”同在 ①）：不改。
5. **改引擎网址模板**（③ 编辑对话框，#13）。以它为左侧的网站搜索（默认组合和“其他组合”都算）同样过期，和第 1 条是同一类问题。这次覆盖，但不并进 `#pair-changed`：`#pair-changed` 的文字是“默认组合已改成 X ｜ Y”，说不清模板变化，而且用户此刻在 ③。做法：actions.js 现有的 sticky 提示 `notice_template_changed` 带上 `action: { key: "notice_template_changed_go", run: revealTriggers }`（`notify` 已支持 action），按钮“查看触发网址”把用户带到 ① 的触发网址（3.7）。文字改成指向 ①（第 4 条）。

不需要提示的：④ 的“跟随默认组合的右侧（当前：X）”每次渲染自动更新；引擎增删隐藏 → 规则行 `off`、下拉框选项，都是数据驱动；规则卡与默认组合卡同在 ②；语言切换由 `applyI18n` 统一重写 tab 文字。

### 3.10 顺带处理（“其他优化请你自己排查”）

| 来源 | 改法 |
|---|---|
| recon-visual 8 / audit P2-1：“添加到 Chrome”四个 summary 只有第一个下面有线 | 卡内顶层各段之间一律一条 1px 线、上下 12px：`#guide > :is(.triggers, #guide-steps, .disclosure) + :is(#guide-steps, .disclosure) { border-top: 1px solid var(--border); margin-top: 12px; padding-top: 12px; }`，`#guide > .disclosure { margin-bottom: 0 }`，`#guide-steps > h3:first-child { margin-top: 0 }` |
| audit P2-2：关键词规则藏在折叠区里 | 提成 ② 里默认展开的独立卡（第 10 节第 2 条，用户选定），见 3.11 |
| audit P2-6：`overflow-wrap: anywhere` 把 `searchEngines` 从单词中间断开 | 新纯函数 `src/lib/url-break.js` 的 `urlBreakParts(url)`：在 `/ ? & = ,` 之后切段，返回字符串数组（先写 `test/url-break.test.js`）。guide.js 的 `urlBox`（guide.js:30，setup.js 从 guide.js 引入；不在 ui.js，#1）把各段之间插 `<wbr>`；`options.html` 静态的 `chrome://settings/<wbr>searchEngines` 手写；`anywhere` 只作最后兜底。`<wbr>` 不进 `textContent`，复制用的是原字符串，e2e 读 `.url-box` 文本不受影响。guide.js 131 → 约 145（连同 3.7 的两个 reveal） |
| audit P2-7（只做一项）：窄窗口降级是复选框、说明压在下面 | 改成 Chrome 式开关行，DOM 见下（#20）。e2e 读 `#narrow-fallback` 的 `.checked` 不受影响。`options_narrow_hint` 的“勾选后”改成“打开后” |
| visual 9 / audit P3-4：禁用的“试一下”看不出是按钮；未激活步骤圆圈边框约 1.3:1 | `.btn:disabled, .btn[aria-disabled="true"] { color: var(--muted); background: var(--code-bg); border-color: var(--border); opacity: 1; }`；`.step-mark` 边框改 `--muted`。不加新 token |
| audit P3-5：没有隐藏引擎时仍显示 h3 加空态 | 空时 `#hidden-title` 和 `#hidden-engines` 都 `hidden`，`renderHiddenList` 返回 `null`；`engine_hidden_empty` 四语删除（#6）。B12 的 `!document.querySelector("#hidden-engines .hidden-row")`（options-b2.mjs:162）照样成立 |
| audit P3-7：header/footer 在 main 里，没有 banner/contentinfo | 3.2 的骨架 |
| recon-visual 7：600 宽引擎行折行；卡头挤 | 3.4 的 `.engine-main` 180px、`.section-head` wrap |
| audit P2-4（一半）：规则的“新增”是正常尺寸按钮 | `#rule-add` 改成 `btn btn-small`，和以图搜图的添加按钮一致 |

开关行的 DOM 与样式（pair.js 建；mockup 02 的 `.switch` 正式写进来）：

```html
<div class="switch-row">
  <div class="switch-text">
    <label for="narrow-fallback" id="narrow-label">窗口较窄时，右侧改在后台标签页打开</label>   <!-- options_narrow_label -->
    <p class="hint" id="narrow-hint">……打开后，左侧结果留在……</p>                                  <!-- options_narrow_hint -->
  </div>
  <input type="checkbox" role="switch" id="narrow-fallback" class="switch" aria-describedby="narrow-hint">
</div>
```

可访问名称来自 `<label for>`，说明经 `aria-describedby`；读屏读“窗口较窄时……，开关，开”。

```css
.switch-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; margin-top: 14px; }
.switch-text { flex: 1 1 260px; min-width: 0; }
.switch-text label { font-size: 14px; }
.switch-text .hint { margin: 2px 0 0; }
.switch {
  appearance: none; flex: none; position: relative; width: 34px; height: 20px; margin: 2px 0 0; padding: 0;
  border-radius: 10px; background: var(--muted); cursor: pointer;   /* 轨道关：--muted 对白底约 6:1 */
}
.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--surface); }
.switch:checked { background: var(--accent); }
.switch:checked::after { left: 17px; }
.switch:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (forced-colors: active) { .switch { border: 1px solid CanvasText; } .switch::after { background: CanvasText; } .switch:checked { background: Highlight; } }
```

放不下时开关换到说明下面（flex-wrap）。没有动画（与 tab 切换一致）。

### 3.11 规则卡（第 10 节第 2 条）

| 项 | 定法 |
|---|---|
| 位置 | `#panel-pair` 里，默认组合卡之后：规则改的是默认组合的右侧，先看到组合再看到例外 |
| DOM | 静态 `<section id="rules-card" class="card" aria-labelledby="rules-title"><h2 id="rules-title" data-i18n="options_rules_title"></h2><div id="rules-body"></div></section>`。id 与现有的 `rule-*`（`rule-list`、`rule-empty`、`rule-add`、`rule-dialog`、`rule-dlg-*`、`rule-edit-*` 等）、对话框的 `dlg-rules-hint`、弹窗的 `rule-note` 都不冲突 |
| 渲染 | `renderRules(cfg, actions)` 不再包 `disclosure("rules", …)`，返回节点数组，返回前 `.filter(Boolean)`（现有子节点里 `list` 在 0 条时是 `false`、`!n && …` 在有规则时是 `false`，展开进 `replaceChildren` 会插入文字“false”）：`options_rules_intro`、`options_rules_privacy` 两段 `.hint`，列表 `ol#rule-list`（加 `aria-labelledby="rules-title"`，原来因为 summary 没有 id 才不加），0 条时 `p#rule-empty.muted`，最后 `#rule-add`（`btn btn-small`）。options.js：`$("rules-body").replaceChildren(...renderRules(cfg, actions))`；pairSection 不再 push 规则区 |
| 条数 | 卡片默认展开、列表直接可见，不再在标题上写条数。`options_rules_summary` 四语删除；`options_rules_title` 从 summary 文字改作 h2 |
| 空状态 | 沿用 `#rule-empty`“还没有规则，右侧总是默认组合的右侧。”，下面紧跟“新增规则”。不加插图或额外说明 |
| 焦点 | 规则行和对话框的焦点规则都按 id，不变（新增后给新行的 `#rule-edit-<id>`，删除后给相邻行，上移到头留在按钮上） |
| 键盘 | 卡片里没有 summary，② 的停靠点 −1（summary）+1（`#rule-add` 原来在收起的折叠区里不可达）= 不变 |
| rules.js | 169 → 约 168；`disclosure` 不再从 ui.js 引入 |

文案（卡片里没有新 key；改一条，删一条）：

| key | 用途 | zh_CN（源） | en | zh_TW | es | 状态 |
|---|---|---|---|---|---|---|
| `options_rules_title` | h2 | 按关键词换右侧 | Keyword rules for the right side | 依關鍵字換右側 | Reglas de palabras clave para la derecha | 文字沿用；从折叠标题改作卡片标题，T5 按文案节各语言再看一遍语气（不改则保留） |
| `options_rules_intro` | 说明第一段 | 搜索命中规则时，默认组合的右侧换成规则里的引擎，左侧不变。从上往下比，用第一条命中的。用其他组合的触发网址搜索时，规则不起作用。 | When a search matches a rule, the default pair’s right side switches to that rule’s engine. The left side stays the same. Rules are checked from top to bottom, and the first match is used. Searches made with another pair’s trigger URL ignore the rules. | 搜尋符合規則時，預設組合的右側會換成規則指定的引擎，左側不變。規則由上往下比對，採用第一條符合的。用其他組合的觸發網址搜尋時，規則不會生效。 | Cuando una búsqueda coincide con una regla, el lado derecho de la combinación predeterminada cambia al buscador de esa regla y el izquierdo se mantiene. Las reglas se revisan de arriba abajo y se aplica la primera que coincida. Las búsquedas con la URL de activación de otra combinación no usan las reglas. | **改写，需润色**（只改最后一句，去掉指向 ① 的带引号区名） |
| `options_rules_privacy` | 说明第二段 | 在本机判断，搜索词不会发到别处。规则里的词是你自己写的，和其他设置一样随 Chrome 同步。 | （现文） | （现文） | （现文） | 沿用 |
| `options_rules_empty` | 空状态 | 还没有规则，右侧总是默认组合的右侧。 | No rules yet. The right side always uses the default pair’s right engine. | 還沒有規則，右側一律是預設組合的右側。 | Aún no hay reglas. A la derecha siempre se usa el buscador derecho de la combinación predeterminada. | 沿用 |
| `options_rules_add` | 按钮 | 新增规则 | Add rule | 新增規則 | Añadir regla | 沿用 |
| `options_rules_summary` | — | — | — | — | — | **删除**（`test/i18n-catalog.test.js`“没有未被引用的 key”要求） |

### 3.12 本批不做

| 编号 | 理由 |
|---|---|
| recon-visual 5：宽窗口两侧留白 / native 的侧栏 | 用户要的是 tab；两套导航布局会让截图和 I18N 组合翻倍；Chrome 设置页本身也是居中列加留白 |
| Ctrl+F 搜到隐藏 tab（`hidden="until-found"` + `beforematch`） | 3.2 已说明 until-found 的问题；要做得配套焦点与可见性断言，下一轮单独做 |
| audit P2-3：以图搜图下拉框与列表合成单选列表 | 交互重做，B18 要重写，与分 tab 无关 |
| audit P2-4 余项：两套排序交互统一 | 改 B20 整套流程，下一轮 |
| audit P2-5：解释界面本身的 meta 文案瘦身 | 四语要整批重走润色流程；本批只改第 4 节列出的跨 tab 引用和两三处措辞 |
| audit P2-7 余项：查词、以图搜图、快捷键都改成“设置行” | 每张卡结构和 e2e 选择器都要动，等分 tab 稳定后 |
| audit P3-1 字号收档、P3-2 summary 与 h3 区分、P3-3 弹窗样式统一 | 与本批无关；tab 只用 14px，不增加字号档 |
| audit P3-6：文案里的“⋮” | 指的是 Chrome 界面上那个按钮的字形；换 SVG 要给四语加富文本占位，牵动 B19 小步核对 |
| audit P3-8：sync 变化整页重建会关掉打开的下拉框 | 与分 tab 无关 |
| ① 生成器里授权按钮没有 id，授权成功后焦点掉回 BODY | 现状就有；要给生成器的授权按钮编 id 并定去向，单独做 |

### 3.13 文件与行数（JS ≤300；括号里是现行数）

| 文件 | 改动 | 预计 |
|---|---|---|
| 新 `src/lib/options-route.js` | `TAB_KEYS`、`tabHash`、`routeFromHash`、`initialTab`、`stepTab` | 约 45 |
| 新 `src/lib/url-break.js` | `urlBreakParts` | 约 12 |
| 新 `test/options-route.test.js`、`test/url-break.test.js` | 先写：各种 hash（含 `#tab-foo`、元素 id）、四个 mode、键位循环、非法输入；网址切段 | — |
| 新 `src/options/tabs.js` | `initTabs({ onReveal, onLeave, reveals })`：点击、keydown、唯一的 `hashchange`、`a[href^="#tab-"]` 的委托 click；`showTab`、`activeTab`、`setTabFlag(mode)`、`focusIn`、`routeOnce(mode)` | 约 125 |
| 新 `scripts/e2e/steps/b21.mjs`、`b21-links.mjs`、`b21-width.mjs` | B21 拆成三个文件（5.4） | 约 220 / 200 / 150 |
| 新 `src/options/pair.js` | 从 options.js 挪出 `pairSection`/`pickerPanes`，加 `#pair-changed`（按 mode）、开关行、`#pair-grant`、末行指引、保存提示按 mode | 约 115 |
| `src/options/options.js`（211） | −40（挪出 pair）+14（initTabs 与 reveals、routeOnce、setTabFlag、focusIn、`#rules-body`、`#hidden-title` 显隐、`FOCUS_FALLBACK` 加一项） | 约 185 |
| `src/options/setup.js`（224） | 删 `hashchange` 与 `hashTarget`（改用 lib）；`revealSetup` 先 `showTab`；`.step-links` 与“更换组合”；导出 `requestReveal`；`renderSetup` 返回 mode | 约 226 |
| `src/options/guide.js`（131） | `urlBox` 插 `<wbr>`；`revealGuideSteps` 先 `showTab`；“其他组合”`withId(…, "guide-other")`（#2）；导出 `revealGenerator`、`revealTriggers` | 约 145 |
| `src/options/rules.js`（169） | 去掉 disclosure、列表 `aria-labelledby`、`#rule-add` 改 `btn-small` | 约 168 |
| `src/options/reorder.js`（95） | 导出 `leaveReorder({ focus })` | 约 100 |
| `src/options/actions.js`（220） | `undoHide` 用 `focusIn`（保留 `isReordering()` 兜底）；`notice_template_changed` 带按钮 | 约 223 |
| `src/options/engine-list.js`（250） | `renderHiddenList` 空时返回 `null`（options.js 用 `...[x].filter(Boolean)` 接） | 约 250 |
| `src/options/locale-ui.js`（28） | RICH_TEXT 加 `guide-step-grant`（链接节点） | 约 33 |
| `src/options/options.html` | 3.2 的骨架、`#rules-card`、`#hidden-title`、`#guide-step-grant`、静态网址的 `<wbr>` | — |
| `src/options/options.css`（352） | 3.3–3.5、3.10、`.step-links` | 约 420（CSS 不受行数限制） |
| `src/_locales/*/messages.json` ×4 | 第 4 节 | — |

依赖方向：`tabs.js` 只依赖 `lib/options-route.js`；`setup.js`、`guide.js`、`actions.js`、`pair.js`、`options.js` 依赖 `tabs.js`；`pair.js` 依赖 `guide.js`、`setup.js`（setup.js 已依赖 guide.js）；`locale-ui.js` 不依赖 tabs.js（链接点击由 tabs.js 委托处理）。没有循环。`tabs.js` 不 import setup.js（`onReveal`、`reveals` 由 options.js 注入）。

**模块顶层不碰浏览器全局**：`tabs.js`、`guide.js` 不得在模块顶层访问 `window`、`location` 或 `document`（不读 hash、不注册监听、不查 DOM）；所有监听和读 hash 都放进 `initTabs`、`routeOnce`、`showTab` 等函数里，由 options.js 在 init/render 时调用。原因：改后 actions.js 会传递导入 `guide.js`（`revealTriggers`）和 `tabs.js`（`focusIn`），而 `test/options-actions.test.js` 在 Node 里只给了一个极简的假 `document`（只有 `getElementById`、`createElement` 等几个方法），没有 `window`、`location`，顶层访问会让它在导入时崩溃。setup.js 顶层读 `location.hash`（setup.js:183）可以保留：actions.js 不导入 setup.js（pair.js 导入它，但 actions.js 不导入 pair.js）。

## 4. 文案键表

流程按 CLAUDE.md“## 文案”：zh_CN 源文案先定稿（lieflat-less-ai-tone + humanizer-zh）→ en（humanizer）、zh_TW（humanizer-zh + 台湾用语）、es（content-l10n + 母语审校，用 tú）按市场转写 → 各自再润一轮。术语以 `docs/i18n/chrome-terms.md` 为准：“搜索引擎”与 Chrome 一字不差；“拆分视图”zh_TW 是「分割畫面」；“快捷键”指键盘快捷键（zh_TW「快速鍵」，es «Acceso directo»），不和“快捷字词”（es «Atajo»、en “Shortcut”）混用。下表全部是草稿（标“需润色”），T1、T3 用它跑通 `i18n-catalog.test.js`，T5 定稿。

**新增（16 个，全部需润色）**

| key | zh_CN（源） | en | zh_TW | es | 说明 |
|---|---|---|---|---|---|
| `options_tabs_label` | 设置分区 | Settings sections | 設定分區 | Secciones de la configuración | tablist 的 aria-label，不可见 |
| `options_tab_add` | 添加到 Chrome | Add to Chrome | 新增到 Chrome | Añadir a Chrome | 与 `options_guide_title` 同文字，另起 key 以后可分开改 |
| `options_tab_pair` | 搜索组合 | Search pairs | 搜尋組合 | Combinaciones | es 的卡片标题“Combinación predeterminada”26 字符，tab 用短名 |
| `options_tab_engines` | 搜索引擎 | Search engines | 搜尋引擎 | Buscadores | Chrome 术语 |
| `options_tab_lookup` | 右键查询 | Right-click lookup | 右鍵查詢 | Clic derecho | es 卡片标题 25 字符，tab 用短名 |
| `options_tab_todo` | 未完成 | not finished | 尚未完成 | sin terminar | 只给读屏，拼在 ① 的名称后 |
| `options_tab_regrant` | 需要授权 | access needed | 需要授權 | falta dar acceso | 同上，regrant 档；与 `setup_regrant_title` 用词一致 |
| `setup_change_pair` | 更换组合 | Change pair | 更換組合 | Cambiar combinación | 开始使用卡第 2 步的链接 |
| `options_pair_other` | 想用别的组合？到“$LINK$”生成它的触发网址。 | Want a different pair? Create its trigger URL in “$LINK$”. | 想用別的組合？到「$LINK$」產生它的觸發網址。 | ¿Quieres otra combinación? Crea su URL de activación en «$LINK$». | `$LINK$` 是链接节点，文字取 `options_tab_add`（tNodes，每次渲染新建） |
| `options_pair_changed` | 默认组合已改成 $PAIR$。Chrome 里的网站搜索还在用旧网址，复制下面的新网址替换它。 | Your default pair is now $PAIR$. Chrome’s site search still uses the old URL. Copy the new one below and replace it. | 預設組合已改成 $PAIR$。Chrome 的網站搜尋仍在使用舊網址，請複製下方的新網址取代它。 | Tu combinación predeterminada ahora es $PAIR$. La búsqueda de sitios de Chrome sigue usando la URL anterior: copia la nueva y reemplázala. | `$PAIR$` 如“Google ｜ Bing”；regrant / done / hidden 档 |
| `options_pair_changed_setup` | “开始使用”里的网址已换成新组合。 | The URL in “Get started” now uses the new pair. | 「開始使用」中的網址已換成新組合。 | La URL de «Primeros pasos» ya usa la nueva combinación. | steps 档；卡片名与 `setup_title` 逐字一致（单测） |
| `options_pair_changed_steps` | 查看设置步骤 | See setup steps | 查看設定步驟 | Ver los pasos | 链接 |
| `options_pair_changed_continue` | 继续设置 | Continue setup | 繼續設定 | Seguir configurando | 链接 |
| `notice_pair_saved_setup` | 默认组合已保存，“开始使用”里的网址已换成新组合。 | Default pair saved. The URL in “Get started” now uses the new pair. | 預設組合已儲存，「開始使用」中的網址已換成新組合。 | Combinación predeterminada guardada. La URL de «Primeros pasos» ya usa la nueva combinación. | 保存提示，steps 档（3.9 第 1 条）；卡片名与 `setup_title` 一致（单测） |
| `notice_pair_saved_back` | 默认组合已保存。 | Default pair saved. | 預設組合已儲存。 | Combinación predeterminada guardada. | 保存提示，改回原组合时（`#pair-changed` 同时消失，3.9 第 1 条） |
| `notice_template_changed_go` | 查看触发网址 | View trigger URL | 查看觸發網址 | Ver la URL de activación | `notice_template_changed` 提示里的按钮 |

`options_pair_other` 和改写后的 `guide_step_grant` 里的 tab 名由链接节点填入（每次 `applyRichText`/渲染按当前语言新建），tab 改名时句子跟着变。

**修改（8 个，全部需润色）**

| key | 现在（zh_CN） | 改为（zh_CN 源；en 供 T1/T3 临时用，zh_TW、es 照流程转写） |
|---|---|---|
| `options_pair_hint` | 左侧不能选标了“只能作右侧”的引擎。改了默认组合后，要把新的触发网址重新添加到 Chrome 并设为默认，旧的那条才会被替换。 | 在地址栏搜索、把文字拖到标签栏时，用这两个引擎打开拆分视图。（en：Searching from the address bar or dragging text to the tab strip opens these two engines in a split view.） |
| `guide_step_grant` | 确认左侧引擎已授权（引擎列表里显示“已授权”）。 | 在“$LINK$”里确认左侧引擎显示“已授权”。（`$LINK$` 文字取 `options_tab_engines`；en：In “$LINK$”, make sure the left engine shows “Access granted”.） |
| `options_narrow_hint` | ……勾选后，左侧结果留在…… | ……打开后，左侧结果留在……（复选框改开关；en 原文已是 “With this on”，不改；zh_TW「勾選後」→「開啟後」；es «Al activar esta opción» 已合适，不改） |
| `engine_in_pair_hide` | 默认组合在用，不能隐藏。先在“默认组合”里换成别的引擎。 | 默认组合在用，不能隐藏。先到“搜索组合”里把默认组合换成别的引擎。（en：Used by the default pair, so it can’t be hidden. First choose another engine for the default pair in “Search pairs”.） |
| `engine_in_pair_delete` | 默认组合在用，不能删除。先在“默认组合”里换成别的引擎。 | 默认组合在用，不能删除。先到“搜索组合”里把默认组合换成别的引擎。（en 同上，hidden → deleted） |
| `notice_template_changed` | “$NAME$”的网址已修改：以该引擎为左侧的网站搜索，需要在本页重新复制触发网址，并替换 Chrome 设置里对应网站搜索的网址。 | “$NAME$”的网址已修改。以它为左侧的网站搜索要换成新的触发网址：到“添加到 Chrome”重新复制，再替换 Chrome 设置里那条网站搜索的网址。（en：“$NAME$” has a new URL. Site searches that use it on the left need a new trigger URL: copy it again in “Add to Chrome”, then replace the URL of that site search in Chrome’s settings.） |
| `notice_pair_saved` | 默认组合已保存。记得把新的触发网址复制到 Chrome 并设为默认。 | 默认组合已保存。Chrome 里的网站搜索还在用旧网址，用下方的新网址替换它。（en：Default pair saved. Chrome’s site search still uses the old URL. Replace it with the new one below.） |
| `options_rules_intro` | ……“其他组合”不受影响。 | 见 3.11 的表 |

`engine_in_pair_*` 和 `notice_template_changed` 里的 tab 名逐字写进句子（理由见 3.9 第 4 条），各语言必须与 `options_tab_pair` / `options_tab_add` 的文字完全一致，`options_pair_changed_setup`、`notice_pair_saved_setup` 必须含 `setup_title`；由 5.5 的单测守住。

**删除（2 个）**：`options_rules_summary`（规则卡不再写条数，3.11）、`engine_hidden_empty`（空时整段不显示，3.10）。四语同删。

## 5. e2e 与验收

### 5.1 公共辅助（`scripts/e2e/steps/optpage.mjs`，163 行）

- `openOptions(browser, { newWindow, hash, tab })`：给了 `tab` 且没给 `hash` 时，网址后接 `#tab-<tab>`。走的是真实用户也会用的深链，不是测试后门。
- `withOptions(browser, fn, opts)`：第三个参数透传给 `openOptions`。各步骤只在已有调用的收尾 `})` 上加参数，不加行（options-b.mjs 294 行，只剩 6 行余量）。
- `showTab(page, key)`：点 `#tabbtn-<key>`，等 `#panel-<key>` 的 `checkVisibility()` 为 true。用于已打开的页面中途换 tab。
- READY 不变。约 +12 行。

### 5.2 现有步骤

规律：做 `focus()`/`activeElement`、`checkVisibility()`、坐标、截图、`lineCount`、溢出检查的，目标 tab 必须可见；纯 DOM 读写（`click()`、`textContent`、`dataset`、`.open`）不受影响。但凡在某个 tab 里操作，一律带上 `tab`，不靠“纯 DOM 恰好能过”。

| 步骤（文件:行） | tab | 改法 | 行数 |
|---|---|---|---|
| B4（b4.mjs:55） | ① | 先清 `setupDone`、撤销授权再打开，默认就是 ①；加断言 `#tabbtn-add[aria-selected=true]` | +1 |
| B2（options-b.mjs:19 `openOptionsFromPopup`） | — | 核对它比较网址时只比路径（已开的页 hash 可能是 `#tab-*`）；把这个函数 `export` 给 B21(j) 用 | 0 |
| B6（options-b.mjs:104）、B7（:125） | ③ | `withOptions(…, { tab: "engines" })` | 0 |
| B8（options-b.mjs:237） | ① | `{ tab: "add" }` | 0 |
| B11（options-b.mjs:274） | ③ | `{ tab: "engines" }`：它点 `row("ea")` 的“编辑”、在引擎对话框里把默认左侧模板改坏，整个过程在搜索引擎卡里（草稿误写成 ②，#3） | 0 |
| B10（options-b2.mjs:45）、B12（:134 与第二个页面 :85 `p2 = await openOptions(browser)`） | ③ | 三处都带 `{ tab: "engines" }`；p2 不带的话 `hideViaDialog` 是在隐藏面板里点按钮（#3）。`engine_in_pair_*` 文字变了，B10 用 `msg()` 取期望，代码不改 | 0 |
| B13（options-b3.mjs:31 的 p1、:100 的 p2） | ③ | 都 `{ tab: "engines" }` | 0 |
| B16、B17（v03-options.mjs:82 `withPage`） | ③ | `openOptions(ctx.browser, { tab: "engines" })`；快捷键卡也在 ③；`#cycle details` 仍是 disclosure | 0 |
| B18（v04-options.mjs:188） | ④ | `{ tab: "lookup" }` | 0 |
| B19（b19*.mjs） | ① | b19.mjs:188 `pairCallouts` 改为期望 1（regrant 时 ② 的提示框常驻，3.9 第 2 条），文案改成“左侧未授权时默认组合卡应有 1 个提示框（实际 N 个）”；b19.mjs:66 的计数只数 `.callout-warn`，`#pair-changed` 不算；detailsLink、keepsFocus、hashOpen 都在 ① 内，b19-guide.mjs:38 的选择器仍取到“详细步骤”（3.7），不改；弹窗三档 (a′)(d) 加断言 ① 选中且 hash 是 `#tab-add` 或原值，(e) 加断言 ② 选中、焦点 BODY | 约 +4 |
| B20（v05-options.mjs） | ② | 见 5.3 | 约 +4 |
| B14（b14.mjs） | ②、默认 | 见 5.3；`b14-options-dark.png`（:162 `openOptions` 默认 tab）在验收表写明拍的是默认 tab | 约 +1 |
| v04-i18n（v04-i18n.mjs:57） | ④ | `openOptions(ctx.browser, { tab: "lookup" })`，否则 `cardClip`、`lineCount` 量到的矩形为 0 | 0 |
| v05-i18n（v05-i18n.mjs） | ② | 见 5.3 | 约 −1 |
| I18N（i18n.mjs:128 等） | 全部 | 见下 | i18n.mjs 约 −10；i18n-audit.mjs 91 → 约 135 |

I18N：`i18n-audit.mjs` 新增 `auditTabs(ctx, opt, locale)`，对每个 key：`showTab` → 断言 `#panel-<key>` 里至少有一个 `checkVisibility()` 为 true 的后代（不只看宽度，否则隐藏面板里的溢出检查会静默通过，判失败）→ `audit({ scope: "#panel-<key> " })`，页头和 tab 栏另审一次 → `OPEN_ALL` → 再审 → 截图。`perLocale` 里原来两段 AUDIT 和截图换成一行调用；`reorderMode`、`engineDialog`、`catalogDialog` 放在 ③ 可见时执行。之后 `Emulation.setDeviceMetricsOverride` 宽 600 对四个 tab 各审一次溢出（不截图），并核对每个 `.tab` 的 `scrollWidth <= clientWidth`（不截字）、选中的 tab 完全在 `.tablist` 可视范围内，再 `clearDeviceMetricsOverride`。② 的审计自然包括展开的规则卡（0 条规则，空状态）；带 4 条样例规则的规则卡仍由 v05-i18n 单独审。

截图改名：`<locale>-options-<tab>.png`、`<locale>-options-<tab>-open.png`（替代原来的 `-options.png`、`-options-open.png`）；`-options-reorder.png` 在 ③ 拍，名字不变；其余（`catalog`、`engine-dialog*`、`popup*`、`go-error`、`options-lookup`、`options-rules`）不变，`options-rules` 改为规则卡的裁切。

### 5.3 规则卡带来的 e2e 改法（逐行）

**B20（v05-options.mjs，275 行 → 约 279）**

| 行 | 现在 | 改为 |
|---|---|---|
| :1 注释 | “默认组合”卡里的“按关键词换右侧”规则区与规则对话框 | “搜索组合”tab 的规则卡（`#rules-card`）与规则对话框 |
| :4 import | `guarded, openOptions, addCustom, openEdit, readKeys, sleep` | 加 `showTab` |
| :15–16 `box()` | 在 `#pair-body details.disclosure` 里按 summary 的 key 找 | `const card = () => document.getElementById("rules-card");` |
| :77 第 1 步名 | 没有规则：默认组合卡里有收起的规则区，summary 没有条数，展开后有空状态 | 没有规则：“搜索组合”tab 里紧跟默认组合卡有独立的规则卡，默认展开，没有折叠区，有空状态 |
| :78–81 读取 | `d.open`、summary 文字，再 `d.open = true` | `const c = card(); if (!c) return null; const e = document.getElementById("rule-empty"); return { shown: c.checkVisibility(), prev: c.previousElementSibling?.getAttribute("aria-labelledby"), title: document.getElementById("rules-title").textContent, folded: !!c.querySelector("details"), empty: e && e.checkVisibility() ? e.textContent : null, list: !!document.getElementById("rule-list") };` |
| :82 | `#pair-body 里找不到规则区（details.disclosure）` | `#panel-pair 里找不到 #rules-card` |
| :84–85 | “规则区应默认收起”；summary 应为 `options_rules_title` | `!s.shown` → “规则卡应看得见”；`s.prev !== "pair-title"` → “规则卡应紧跟在默认组合卡后面”；`s.folded` → “规则卡里不该有折叠区”；`s.title !== msg("options_rules_title")` → “标题应为…” |
| :86–88 | 空状态、没有列表、detail | 不变；detail 改成 `展开，标题“${s.title}”；“${s.empty}”` |
| :120 第 4 步名 | “…行文字、焦点、summary（1 条）” | 去掉“summary（1 条）”，改为“…行文字、焦点、列表 aria-labelledby 与行数” |
| :126–127 | 读 `summary: box().querySelector("summary")…` | 读 `labelled: document.getElementById("rule-list")?.getAttribute("aria-labelledby"), rows: document.querySelectorAll("#rule-list > li").length` |
| :132 | summary 应为 `options_rules_summary` 1 | `s.labelled !== "rules-title" \|\| s.rows !== 1` → “#rule-list 应 aria-labelledby="rules-title" 且只有 1 行” |
| :133 detail | `summary“${s.summary}”` | 改用 `labelled`/`rows`：`列表 aria-labelledby=${s.labelled}，${s.rows} 行`（`s.summary` 已不再读取，不改会打印 undefined） |
| 第 10 步（:~232 `openEdit(page, "ed")` 前） | — | `await showTab(page, "engines");`（关对话框后焦点要还给看得见的 `#edit-ed`） |
| 第 11 步开头 | — | `await showTab(page, "pair");`（之后的 `openDialog(page, "rule-add")` 要聚焦看得见的按钮） |
| :265 title | 规则区 | 规则卡 |
| :270 | `openOptions(ctx.browser)` | `openOptions(ctx.browser, { tab: "pair" })` |

**v05-i18n（v05-i18n.mjs，75 行 → 约 74）**

| 行 | 现在 | 改为 |
|---|---|---|
| :1 注释 | 规则区（展开、几种行） | 规则卡（几种行） |
| :19 `BOX` | `#pair-body details.disclosure` 里按 summary 找 | `const CARD = 'document.getElementById("rules-card")';` |
| :20 `AREA_AUDIT` | `scope: "#pair-body ", items: "button, label, summary", box: "#pair-body"` | `scope: "#rules-card ", items: "button, label", box: "#rules-card"` |
| :24 `cardClip` | `document.getElementById("pair-body").closest("section")` | `document.getElementById("rules-card")` |
| :30 | `openOptions(ctx.browser)` | `openOptions(ctx.browser, { tab: "pair" })` |
| :32–34 等待 | summary 文字等于 `options_rules_summary`(4) 且 4 行 | `${CARD}?.checkVisibility() && document.getElementById("rules-title").textContent === msgIn(locale, "options_rules_title") && 4 行`；说明改成“规则卡按 ${locale} 渲染出 4 条” |
| :35 | `${BOX}.open = true` | 删掉 |
| :36 前缀 | “规则区：” | “规则卡：” |
| :66 标签 | `["规则区", rulesArea]` | `["规则卡", rulesArea]` |

截图名 `<locale>-options-rules.png` 不变。

**B14（b14.mjs）**

| 行 | 现在 | 改为 |
|---|---|---|
| :3、:182 注释 | 规则区展开的设置页 | “搜索组合”tab（规则卡） |
| :184–185 | 找 `#pair-body details.disclosure` 并 `open = true` | `page.ev('(() => { document.getElementById("tabbtn-pair").click(); return document.getElementById("rules-card").checkVisibility() && !!document.querySelector("#rule-list > li"); })()')` |
| :187 | 名称“设置页规则区” | “设置页‘搜索组合’tab”；文件名 `b14-options-rules-dark.png` 不变（`full: true`，拍整个 ②） |
| :196 | 尾注“规则区” | “规则卡” |

**I18N（i18n.mjs）**：没有规则专用的行；② 由 `auditTabs` 审（5.2）。CLAUDE.md I18N 那节列的折叠区（“默认组合的触发网址”“其他组合”“设置步骤”“参与快捷键轮换”）本来就不含规则区，不改。

**v05-lib.mjs `withRulePopup`（:81–104）**：不改。它只写 `rightRules`、建一对、打开 `popup.html?tabId=`，从不碰设置页；设置页上的操作在调用方的回调里（B14 :184–187，见上）。:81 的注释“B14 与 v05I18nChecks 共用”仍准确。

**T25（v05-rules.mjs、v05-rules-popup.mjs）**：不打开设置页，不改。

### 5.4 新增 B21“设置页 tab 与宽度”（auto，登记进 `steps/index.mjs`）

文件预先拆成三个（B19 拆成三个文件共 448 行，B21 子项更多，一个文件必超 300 行）：

| 文件 | 子项 | 预计 |
|---|---|---|
| `steps/b21.mjs` | 步骤入口（`B21` 导出、子项编排、guarded 与授权恢复）；(a)(b)(c)(d)(e)(i)(j) | 约 220 |
| `steps/b21-links.mjs` | (f)(g)(h)(k) | 约 200 |
| `steps/b21-width.mjs` | (l) | 约 150 |

guarded 键（`optpage.mjs` 的 `guarded` 包住整个步骤）：`defaultPair`、`uiLocale`、`customEngines`、`presetOverrides`、`order`；另加 b19.mjs 的 `keepSetupDone`（`setupDone` 不在 storage 快照里）和授权恢复（撤销过的 origin 收尾时 `permissions.request` 恢复，同 B19：`permissions.remove` 后再申请不弹框）。

| 子项 | 做法 | 判定 |
|---|---|---|
| (a) ARIA | 打开设置页 | 恰好 4 个 `.tab[role=tab]`，只有一个 `aria-selected=true` 且 `tabindex=0`，其余 −1；`aria-controls` 与面板一一对应，面板 `aria-labelledby` 指向对应的 `#tabname-<key>`；未选中面板 `hidden` 为 true、`checkVisibility()` 为 false |
| (b) 键盘 | CDP `Input.dispatchKeyEvent` 在 tab 上依次按 →、End、Home、←（从第一个按会循环到最后一个） | 每次核对选中项、`activeElement.id`、对应面板可见 |
| (c) hash | 点 `#tabbtn-engines` | `location.hash === "#tab-engines"`，`history.length` 不变；`Page.reload` 后仍是 ③ |
| (d) 默认 tab | 依次：`keepSetupDone` 清掉 `setupDone` 后无 hash；`#tab-lookup`；写 `setupDone: true` 且已授权后无 hash、`#setup`（卡片隐藏）、`#foo`、`#tab-foo`、`#engines`、`#guide` | ①、④、②、②（焦点 BODY）、②、②、②、②；最后两个 `scrollY === 0`（静态面板全 hidden，3.2） |
| (e) 默认 tab 不跟状态跳 | 停在 ① 时写 `setupDone: true` | 卡片换成完成确认，仍在 ① |
| (f) 跨 tab 链接（按状态分两段） | **steps 档**（`keepSetupDone` 清掉 `setupDone`、两侧已授权）：点 ① 第 2 步“更换组合”；回 ① 点第 5 步“搜索引擎”链接；在 ② 点末行指引。**hidden 档**（写 `setupDone: true`）：在 ② 改右侧，使 `#pair-changed` 出现，点其中“查看设置步骤” | “更换组合”→ ② 选中、焦点 `#pair-left`；第 5 步链接 → ③ 选中、焦点在默认左侧的 `.perm-line button`（已授权时没有，落到 `#edit-<左>`）；末行指引 → ① 选中、hash `#tab-add`、`#guide-other` 展开、焦点在它的 summary；“查看设置步骤”→ ① 选中、hash `#tab-add`，hidden 档外壳不是 details，焦点在 `#guide-steps-title`（steps 档的“两段展开、焦点在 summary”已由 B19 detailsLink 覆盖，这里不重复）。steps 档 `#pair-changed` 里的是“继续设置”，不是“查看设置步骤”（3.9 第 1 条），所以后者只能在 hidden 档测 |
| (g) `#pair-changed` 按 mode | 依次：steps 档改右侧；写 `setupDone: true`（不刷新）；再改右侧；撤销左侧授权（regrant）；改回上一步记下的 `from` | steps：`options_pair_changed_setup` 加“继续设置”，没有网址框，保存提示是 `notice_pair_saved_setup`；写 `setupDone: true` 后 `#pair-changed` 消失（steps 档写下的记录离开 steps 即清掉）；hidden 再改：`options_pair_changed`，网址框等于新组合的触发网址，提示是 `notice_pair_saved`；regrant：仍是替换文案（不是“开始使用”那句）；改回 `from` 后提示框消失、保存提示是 `notice_pair_saved_back`；`#pair-changed` 没有 `role` |
| (h) 模板变化 | 在 ③ 编辑默认左侧，改网址模板（仍合法）后保存 | 出现 sticky 的 `notice_template_changed`，带“查看触发网址”；点它后 ① 选中、焦点在 `#triggers` 的复制按钮 |
| (i) 排序模式 | 进调整顺序，移动一次，切到 ② | `storage.onChanged` 在 1 秒内写入 order；切回 ③ 时不在排序模式；焦点留在 `#tabbtn-pair` |
| (j) 已开页与“打开设置” | 已开的设置页切到 `#tab-engines`、写页面标记；用 B2 的 `openOptionsFromPopup` 从弹窗点“打开设置” | 没有新标签，原页标记还在（没重载），仍是 ③（#18） |
| (k) 焦点兜底 | regrant 状态在 ① 点 `#setup-grant`，授权成功、卡片隐藏；再撤销一次，在 ② 点 `#pair-grant`，授权成功。两次点击都用 CDP `Input.dispatchMouseEvent` 可信点击（同 B4，带用户激活；`element.click()` 触发的 `permissions.request` 会被拒） | 前者焦点在 `#tabbtn-add`，后者在 `#pair-left`，都不是 BODY（撤销与恢复沿用 B19 的工具：`permissions.remove` 后再 `request` 不弹框） |
| (l) 宽度（1280 与 600 两档，`setDeviceMetricsOverride`；四种语言逐一，`guarded` 写回 `uiLocale`）。**状态**：`setupDone: true` 且默认组合两侧已授权（卡片隐藏，5 步说明和默认组合一段不包 details）；每个 tab 切过去后先执行 OPEN_ALL（展开所有 `details.disclosure`，含 `#guide-other`，否则 `#gen-left`/`#gen-right` 量到 0；i18n.mjs 的 `OPEN_ALL` 挪进 i18n-audit.mjs 导出共用）；用 `addCustom` 加一个模板在 `UNGRANTED_HOSTS.u`（engine-u.localhost）上的自定义引擎，构造一行“未授权（可选）”，`customEngines` 在 guarded 键里。“未授权（必需）”行不另量：它与“可选”行只差状态文字，3.4 实测两者宽度相差 ≤ 37px、都在 323px 以内 | 每个 tab 里可见的 `.hint, .steps li, .caveats li, .step-body p` 与页头标语 | 计算出的 `max-width` 都是 `none`（四语）；折行块（多于一行的）文字右缘 ÷ 该元素父节点内容盒宽度 ≥ 0.9（四语；排除 `.step-actions > .hint`，它和按钮同行，卡片隐藏时本来也不在）；`.steps .url-line` 右缘与 `.trigger-card .url-line` 右缘相差 ≤ 2px（比整行，不比 `.url-box`：两处复制按钮文字不同，网址框宽度必然不同）；`.lookup-card select` 宽等于卡片内宽 ±1px；`#gen-left`、`#gen-right` 两个 label 的左缘分别与默认组合两个窗格的左缘对齐 ±1px（两个 tab 分别量，内容列相同）；`documentElement.scrollWidth <= innerWidth`；`.tablist` 的 `scrollHeight <= clientHeight`（没有竖向溢出，#9）；600 档每个引擎行（含未授权的行）`.engine-main` 与 `.engine-side` 顶边相同（四语） |

### 5.5 单元测试

- 新 `test/options-route.test.js`、`test/url-break.test.js`（先写）。
- `test/options-wiring.test.js`：加“`src/options/` 里只有 tabs.js 注册 `hashchange`”“每处去掉 loading 之前有 `routeOnce(`”“`revealSetup`、`revealGuideSteps` 都先 `showTab`”。原有“去掉 loading 后紧接 `revealSetup()`”保持。
- `test/i18n-catalog.test.js`：自动核对新 key、删掉的两个 key 不再被引用；带链接的两条（`options_pair_other`、`guide_step_grant`）的占位符四语一致；新增“跨 tab 引用的区名一致”：每种语言里 `engine_in_pair_hide`、`engine_in_pair_delete` 含 `options_tab_pair` 的文字，`notice_template_changed` 含 `options_tab_add`，`options_pair_changed_setup`、`notice_pair_saved_setup` 含 `setup_title`。
- `test/options-actions.test.js`：不改，照跑，作为“tabs.js、guide.js 模块顶层不碰 `window`/`location`/`document`”（3.13）的守门：actions.js 改后传递导入这两个文件，顶层访问会让它在导入时失败。
- `test/popup-css.test.js`、`test/ui-icons.test.js`、`test/log-wiring.test.js`：不改，照跑（没有新颜色变量；标记用 `alert-circle` 和 CSS 圆点，开关用 CSS 画）。

### 5.6 验收表

写进 `docs/acceptance-v0.6.md`（新建）：
- B21 全部子项。
- 改写 B4、B10（`#dlg-remove-reason` 新文字）、B14、B17、B19、B20、I18N、v05-i18n 的描述和截图清单。
- B12(4)“‘调整顺序’模式中点‘撤销’后焦点交给‘完成’”期望不变（undoHide 保留 `isReordering()` 兜底，3.8）。
- “默认 tab 只在首次 render 判一次，之后状态变化不自动换 tab；授权成功、`setupDone` 变成 true 都不把用户从当前 tab 带走”；“读配置失败时停在 ②，之后渲染成功也不换”。
- 每个 tab 的 Tab 停靠点（3.1 的算法，T6 用 CDP 实测一次写进表里，不做常驻断言），与改前 33 个对比。
- **`impeccable detect` 的 line-length 不算失败**：用户 2026-10-27 选了四语同一条右边界（第 10 节第 3 条），en/es 说明每行约 95–105 个字符，detect 预计报 line-length；验收表写明原因，其余检测项照常判。
- 手测项：Windows Chrome + NVDA 下 tab 栏方向键与面板名播报（面板名不带“未完成”）、开关行播报；Ctrl+F 搜不到隐藏 tab 里的文字（已知限制）。

### 5.7 跑什么

- T1–T4 各自：`npm test`；`npm run e2e -- --auto-only --only B4,B6,B7,B8,B10,B11,B12,B13,B16,B17,B18,B19,B20,B21,B14,I18N`。
- T6：完整 `npm run e2e -- --auto-only`、`npm run pack -- --smoke`（它核对设置页以英文渲染、没有原样 key，不受 tab 影响；版本号 0.6.0 要与 package.json 一致才过发布前检查）。

## 6. 文档同步

- 本稿：`docs/superpowers/specs/2026-10-27-options-tabs-design.md`。
- **CLAUDE.md**：
  - 目录与职责：加 `src/lib/options-route.js`、`src/lib/url-break.js`、`src/options/tabs.js`、`src/options/pair.js`、`test/options-route.test.js`、`test/url-break.test.js`、`steps/b21.mjs`、`steps/b21-links.mjs`、`steps/b21-width.mjs`、`docs/acceptance-v0.6.md`；改写 `options.html`（四个 tab 面板、规则卡）、`options.js`（首次路由、`focusIn`、reveals）、`setup.js`（`#setup` 与 reveal-setup 先切 ①；不再注册 hashchange；“更换组合”）、`guide.js`（`urlBox` 插 `<wbr>`、`revealGuideSteps` 先切 ①、`revealGenerator`、`revealTriggers`）、`rules.js`（规则卡，不再是折叠区）、`reorder.js`（`leaveReorder`）、`options.css` 的说明。
  - 机制速览：弹窗“完成设置”那段补一句“设置页收到 reveal-setup 且卡片显示时先切到‘添加到 Chrome’tab”。
  - e2e 小节：`optpage.mjs` 的 `openOptions({ tab })`、`withOptions(…, opts)`、`showTab`；B21；I18N 按 tab 审计与截图改名、600 宽溢出审计；B19 `pairCallouts` 的新期望；B20、v05-i18n、B14 的规则卡选择器。
  - 路线图：加 v0.6（设置页分 tab、宽度统一、规则卡；不加权限）。
- **`docs/_config.yml`**：`exclude` 加 `acceptance-v0.6.md`（新验收表在 GitHub Pages 根目录 `docs/` 下，不加会被当成公开页发布；CLAUDE.md 要求新增内部文档加进 exclude）。
- **验收表**：5.6；`docs/acceptance-v0.4.md`、`acceptance-v0.5.md` 里被改写的条目（B4、B10、B14、B17、B19、B20、I18N）加“见 v0.6”指向。
- **README ×4**（en、zh-CN、zh-TW、es，同结构同改，标题下语言切换行不动）：
  - 第 34 行 “the ‘Get started’ card at the top” → “on the ‘Add to Chrome’ tab”。
  - 第 36 行（第 1 步“on the settings page, click ‘Grant access’ for each engine”）：授权按钮现在在“Search engines”tab，改成 “on the ‘Search engines’ tab of the settings page, click ‘Grant access’ for each engine you want to use.”（第一次设置时开始使用卡第 1 步也能授权，句子不必提它）。zh-CN“在设置页的‘搜索引擎’里给要用的搜索引擎点‘授权’”，zh-TW、es 按同义转写。
  - 第 37 行：默认组合在 “Search pairs” tab 里选，网址在 “Add to Chrome” tab 复制。
  - 第 42 行：“On the settings page, open the ‘Search pairs’ tab and add a rule under ‘Keyword rules for the right side’.”
  - 改完各语言单独润色。
- **截图**（只维护 en）：重拍 `assets/raw/en/options-top.png`（② 顶部，含规则卡开头）、`options-engines.png`（③）、`options-fullpage.png`（改为 ① 设置完成的整页，一张图只能拍一个 tab）；更新 `assets/raw/captions.md`。en 商店图走 `assets/templates-v2/`：重量 `store-4-engines.html`、`promo-marquee.html` 的裁切坐标（内容列变窄，行变短），`node scripts/store/render-assets.mjs --locale en` 重出图并核对没有溢出报告。
- **版本与 CHANGELOG**（第 10 节第 4 条）：`src/manifest.json`、`package.json` 改成 `0.6.0`；`CHANGELOG.md` 按 changelog-zh 流程新增 `## [0.6.0] - <完成日期>`（设置页分成四个 tab、宽度统一、规则改成独立卡片、窄窗口开关、跨 tab 提示），0.5.0 条目里“在‘默认组合’卡里展开”是当时的事实，不改；打本地标签 `v0.6.0`，**不推送**；标签的时机与位置见 T6（打在合进 main 之后 main 的 HEAD 上，不打在 worktree 分支的提交上）。
- 商店详情（`docs/store/listing.*`）、隐私政策不写卡片位置，不改。

## 7. 实施顺序

前提：起草时另一个文档工作流在 main 上提交，现已结束（v0.5.0 标签在 1ce8561）。在 main 上直接做还是在 worktree 分支上做，由用户在计划阶段选；文档（CLAUDE.md、README）放在最后。每个任务完成后由另一个子代理审查再提交。

**T1 tab 骨架与路由**
1. 先写 `test/options-route.test.js`，再写 `lib/options-route.js`。
2. `options.html` 骨架（3.2，四个面板都 hidden）；`tabs.js`（含委托 click）；options.js 接 `initTabs`、`routeOnce`、`setTabFlag`、`focusIn`；`renderSetup` 返回 mode；setup.js 去掉 hashchange、`revealSetup` 先切 tab；guide.js `revealGuideSteps` 先切 tab、`withId("guide-other")`；reorder.js `leaveReorder`；actions.js `undoHide`。
3. `options-wiring.test.js` 的新检查。
4. tab 栏 CSS（3.3）、`body.loading .page`。
5. 新 key 的 zh_CN 草稿和三语临时译文（只 tab 名、标记两条、`options_tabs_label`）。
6. e2e：`optpage.mjs`；B4、B6–B20 的 `tab` 参数（5.2 表）；B19 的新断言；I18N 的 `auditTabs`。跑 5.7 的清单。

**T2 宽度与页头**
1. 3.4、3.5 的 CSS；`.lookup-card` 单列；删掉所有逐元素 ch 上限（四语都不设）和 `.pair-pickers` 480px；`.engine-main` 180px。
2. `lib/url-break.js` 与 `urlBox` 的 `<wbr>`（先写 `test/url-break.test.js`）。
3. 3.10 里的分隔线、禁用按钮、步骤圆圈、`#hidden-title`（删 `engine_hidden_empty`）、`.section-head`。
4. B21 的 (a)(b)(c)(d)(e)(l)。跑 5.7。

**T3 跨 tab 依赖**
1. pair.js（从 options.js 挪出）、`#pair-changed`（按 mode）、保存提示按 mode、左侧未授权提示框常驻与 `#pair-grant`、末行指引、开关行。
2. “更换组合”与 `.step-links`、`revealGenerator`、`guide_step_grant` 链接、`revealTriggers` 与模板提示的按钮。
3. 余下新 key 与改写的条目（zh_CN 草稿 + 三语临时译文）；`i18n-catalog` 的区名一致检查。
4. B19 `pairCallouts`；B21 的 (f)(g)(h)(i)(j)(k)。跑 5.7。

**T4 规则卡**（单独提交，第 10 节第 2 条）
1. options.html 的 `#rules-card`；rules.js 去掉折叠区、列表 `aria-labelledby`、`#rule-add` 改 `btn-small`；options.js 渲染 `#rules-body`、pairSection 不再带规则；删 `options_rules_summary`、改 `options_rules_intro`。
2. 5.3 的 B20、v05-i18n、B14 改法。跑 5.7。

**T5 四语文案定稿**：本批全部新增与改写的 key（第 4 节、3.11）按文案流程定稿；`i18n-catalog`、I18N 重跑。

**T6 收尾**：完整 e2e 与 `pack --smoke`；CDP 实测各 tab 的 Tab 停靠点；截图重拍与商店图重出；文档（第 6 节）；再跑一次 `/impeccable critique` 和 `impeccable detect --cdp`（line-length 按 5.6 处理，其余新问题按常规修或记入下一轮）；版本号改 0.6.0、CHANGELOG。收尾顺序固定：
   1. 版本号、CHANGELOG、文档全部提交，`src/` 没有未提交改动（`pack` 的发布前检查要求；`--allow-dirty` 不用）。
   2. 完整 `npm run e2e -- --auto-only` 与 `npm run pack -- --store-key ~/.config/split-search/cws-public-key.pem --smoke` 通过。
   3. 只在 worktree 分支上做时：rebase 到最新 main（rebase 后 `src/` 有变化就重跑第 2 步），再 `git merge --ff-only` 快进合并进 main；直接在 main 上做时跳过。
   4. 在 main 的 HEAD 上打本地标签 `v0.6.0`，不推送。先打标签再 rebase 或合并，标签会指向一个不在 main 上的旧提交，pack 取的时间戳（最近一次改动 `src/` 的提交）也会和标签对不上。

## 8. 我们的判断（替用户做的取舍）

1. **以 task 稿为骨架**：两位评审都给它最高分。顶部 4 个 tab 字面上就是用户要的“分 tab”；每个 tab 一屏左右；首次设置的路径最清楚。
2. **面板用普通 `hidden`，不用 `until-found`**：两位评审都指出 until-found 的面板元素仍可聚焦、`checkVisibility()` 对它返回 true。可访问性和测试可信度优先于 Ctrl+F 自动切 tab。
3. **放弃 Ctrl+F 跨 tab 搜索**：上一条的代价。写进验收表的已知限制，下一轮可以单独做。
4. **tab 栏不吸顶**（评审给了“可选”）：每个 tab 在一屏左右，吸顶的收益小，却要给所有滚动目标加 `scroll-margin` 并处理矮窗口。
5. **内容列 680px，不用 minimal 的 620px**：620 在 1280 宽下内容只占视口约 48%，用户说“宽度有问题”时多半会觉得整页更窄了；680 与 chrome://settings 主列一致。
6. **右键查询的下拉框各占整行，其他组合生成器保持两列并与默认组合窗格同列线**（嫁接 minimal）：前者修截图 10 并避开 es 截断；后者和窗格对齐，页面只剩“半宽”“整宽”两种下拉框宽度。
7. **引擎行左块 basis 180px**：按实测的右侧控件组宽度（es 最宽 310）重算，经典滚动条下 600 宽也不折行；草稿的 220 只对 zh 成立。
8. **hash 用 replaceState，切 tab 不进历史**：后退直接离开设置页，不会出现“后退一下只换一个 tab”或后退回到 `#setup` 重新定位、移动焦点的情况。只有跨 tab 的切换才写 hash，tab 内的 reveal 不动 hash，保住 B19 detailsLink。
9. **静态 HTML 里四个面板都先 hidden，由首次路由打开一个**：带元素 id 的 hash 不会在路由前就滚动，B21(d) 的 `scrollY === 0` 才站得住。
10. **reveal-setup 从别的 tab 过来时写 `#tab-add`**（评审 2 指出的 task 硬伤）：否则 hash 停在 `#tab-engines`，刷新回到错的 tab。
11. **只有 tabs.js 监听 hashchange，`#tab-*` 链接也由它委托处理**（嫁接 native）：两个监听今天不重叠，以后容易重复处理；链接焦点去向由 options.js 注入，setup.js、pair.js、locale-ui.js 不必为点击 import tabs.js。加静态测试守住。
12. **焦点兜底用通用的 `focusIn`**（嫁接 minimal）：取代 task 的 `isInHiddenPanel` 分支和 `setup-* → #tabbtn-add` 特例。撤销隐藏不替用户切回 ③。② 的授权按钮补 id，焦点回到同 tab 的左侧下拉框。
13. **离开 ③ 自动退出“调整顺序”并立即保存，不抢焦点**（task + native 的 `focus: false`）：回来看到平时的列表。
14. **① 的标记分两档**（嫁接 native）：steps 是主色圆点加“未完成”，regrant 是警示图标加“需要授权”，读屏用户也能分清“没设置完”和“授权被撤销”。面板名不带这两个词。
15. **默认 tab 只在首次 render 判一次**：设置完成、授权成功都不把用户带走。
16. **改默认组合后就地出现 `#pair-changed`，按 setupView 的 mode 选文案**：分 tab 后最容易出现“以为改好了，Chrome 里其实还是旧组合”。只在 steps 档说“‘开始使用’里的网址已换”，regrant 档虽然卡片也显示，但用户已经设置过，要说“替换旧网址”。只存在本页内存，不写存储。
17. **`#pair-changed` 不做 live region，保存提示作唯一播报**：提示框随每次 render 重建，挂 `role="status"` 会被无关的重渲染反复读出；保存提示本来就有，文字改成与提示框一致即可。
18. **改引擎网址模板走“提示 + 按钮”，不并进 `#pair-changed`**：用户此刻在 ③，提示里一个按钮直接带到 ① 的触发网址；`#pair-changed` 只管组合本身变了。
19. **跨 tab 句子里的区名逐字写进各语言，用单测守一致**：`setI18nText` 的参数会按旧语言存下来，占位符反而容易错；链接文字（`options_pair_other`、`guide_step_grant`）是每次新建的节点，仍用占位符。
20. **左侧未授权提示框在 ② 常驻**：卡片和它不再同屏，不会重复；B19 的期望跟着改。
21. **窄窗口降级改成开关行**（嫁接 native）：本页唯一的布尔设置，做成 Chrome 设置页的样子；其余“设置行”改造不在本批。
22. **网址插 `<wbr>`，切段逻辑放 `lib/`**（嫁接 native）：`searchEngines` 不再从单词中间断开；纯函数好测，不用给 guide.js 搭假 DOM。
23. **没有隐藏引擎时整段不显示，删掉 `engine_hidden_empty`**：空态那句话不提供任何操作；留着不用的 key 会让目录检查失败。
24. **规则卡放在默认组合卡之后、标题不写条数**：规则是默认组合右侧的例外，先组合后例外；卡片展开后列表一眼可见，条数多余。
25. **不加颜色变量**：步骤圆圈边框用现有 `--muted`（task 稿要新加 `--border-strong`，没必要）。
26. **以图搜图不改单选列表、meta 文案不瘦身**：都会改写刚上线的 B18 或要四语整批重润，和分 tab 无关，下一轮。
27. **e2e 一律用 `openOptions/withOptions({ tab })` 改参数**（嫁接 minimal）：options-b.mjs 只剩 6 行余量；I18N 的逐 tab 循环挪进 i18n-audit.mjs。
28. **B21 的宽度断言照 minimal 的写法**：计算出的 `max-width`、右缘比例、列线对齐、横向溢出、600 宽引擎行不折行，都能直接量；四种语言都量。
29. **`options-fullpage.png` 改拍 ① 整页**：一张图只能拍一个 tab，商店图本来只用引擎卡裁切。
30. **go.html 出错页不按错误码深链到 ③**：要改 `openOptionsPage` 的打开方式，收益小。

## 9. 线框

线框在起草会话的 scratchpad（`opt-tabs/mockups/`），不入库，实施时打不开（第 0 节注）；下表只记录它们画了什么、和正文有哪些出入，供追溯。当时可在浏览器里打开（引用仓库的 `src/styles/tokens.css`、`src/styles/panes.css` 绝对路径；标注是黄字竖线的 `wf-note`，不是设计的一部分）。PNG 由一次性配置的无头 Chrome 156 经 CDP 截全页，配置用完已删。

| 文件 | 内容 | 截图 |
|---|---|---|
| `mockups/01-add-setup.html` | ① 设置中（steps 档）：tab 标记、开始使用卡、“更换组合”、四段等距分隔，5 步说明展开后网址框到右边界（截图 11 的修法） | `01-add-setup-1280.png`、`01-add-setup-600.png` |
| `mockups/02-pair.html` | ② 设置完成后改了右侧：窗格撑满、`#pair-changed`、开关行、规则折叠区、末行指引 | `02-pair-1280.png`、`02-pair-600.png` |
| `mockups/03-lookup-en.html` | ④ 英文、regrant 档（① 带警示图标）：下拉框整行（截图 10 的修法）、西文 68ch | `03-lookup-en-1280.png`、`03-lookup-en-600.png` |

线框实测：1280 宽卡片外宽 679px；600 宽有经典滚动条时布局宽 585、卡片外宽 559，没有时 575；三张的 tab 栏在 600 宽下都不溢出（en 566/566）。

线框画在用户决定之前，与正文不一致的地方以正文为准：
- 02 的规则区是折叠区；正文是默认组合卡下面默认展开的独立规则卡（3.11）。
- 03 的西文说明限 68ch；正文四语都不设上限，说明到卡片右边界（3.4）。
- 01、03 的 `.sr-only` 在 `.tab-flag` 外面、flag 带 `aria-hidden`；正文 sr-only 在 flag 里面、flag 不带 `aria-hidden`（3.3）。
- 01 的 `.step-links` 与正文一致（“详细步骤”在前）。

## 10. 已定（2026-10-27 用户）

1. **快捷键卡放在哪个 tab**：用户选“并入‘搜索引擎’ (Recommended)”。含义：快捷键卡（`#shortcut`、`#cycle`）和搜索引擎卡同在 ③；第 4 个 tab 只有右键查询。本稿正文按此写。
2. **关键词规则（v0.5 新功能）在 ② 里怎么放**：用户选“提成默认展开的独立卡”（不是推荐项）。含义：规则从默认组合卡里的折叠区提成 ② 里紧跟默认组合卡的 `section#rules-card`，默认展开、标题不带条数（3.11）；`options_rules_summary` 删除、`options_rules_intro` 改一句；B20、v05-i18n、B14 的选择器和断言按 5.3 逐行改写，T4 单独提交。
3. **英文、西班牙文说明的行长**：用户选“不限，和中文一样铺满”（不是推荐项）。含义：去掉所有 ch 上限（含草稿的 `--measure: 68ch` 和页脚的 65ch），四种语言说明都到卡片右边界（3.4）；en/es 每行约 95–105 个字符，`impeccable detect` 会报 line-length，这是用户接受的取舍，验收不以它为失败（5.6）；B21(l) 断言四种语言计算出的 `max-width` 都是 `none`、折行块右缘比都 ≥ 0.9。
4. **这批改动发在哪个版本**：用户选“v0.6.0 (Recommended)”。含义：v0.5.0 照原计划先上传；本批完成后 `manifest.json`、`package.json` 改成 0.6.0，CHANGELOG 用 changelog-zh 新增 0.6.0 一条，打本地标签 `v0.6.0`、不推送；验收表是 `docs/acceptance-v0.6.md`（第 6 节、T6）。

## 11. builder check 处理记录

审读意见 20 条（`opt-tabs/builder-check.md`），逐条对照基线代码核实后处理：

| # | 意见 | 核实 | 处理 |
|---|---|---|---|
| 1 | `urlBox` 在 guide.js 不在 ui.js | 成立：guide.js:30，setup.js:11 从 guide.js 引入 | 改稿：切段逻辑抽成 `lib/url-break.js` 纯函数，单测 `test/url-break.test.js`；guide.js 插 `<wbr>`；ui.js 不动（3.10、3.13） |
| 2 | `#guide-other` 没有 DOM id | 成立：guide.js:74 的 `disclosure("guide-other", …)` 只是 `openIds` 的键，ui.js 的 `disclosure()` 不设 id | 改稿：guide.js 补 `withId(…, "guide-other")`（3.13、T1）。规则区不再是折叠区；`shortcut-cycle` 暂时没有链接指向，不补 |
| 3 | B11 在 ③；B10/B12 的 p2、B13 的 p2 要带 tab | 成立：options-b.mjs:274 编辑 `ea`；options-b2.mjs:85、options-b3.mjs:31/:100 都是裸 `openOptions` | 改稿：5.2 表逐行写明 |
| 4 | `.tab-flag { display: inline-flex }` 会盖过 `hidden` | 成立 | 改稿：flag 不用 `hidden`，默认 `display: none`，按 `todo`/`regrant` 类显示（3.3） |
| 5 | HTML 与 CSS 类名、sr-only 位置不一致 | 成立 | 改稿：定为 `div.tablist[role=tablist]#tabs`、`button.tab`；sr-only 在 flag 里面，flag 不带 `aria-hidden`（3.2、3.3；线框差异见第 9 节） |
| 6 | `engine_hidden_empty` 会变成未引用 key | 成立：test/i18n-catalog.test.js:112 | 改稿：空时整段不显示，四语删除该 key（3.10、第 4 节） |
| 7 | 600 宽引擎行算术漏了行内边距，en 断言会挂 | 成立，而且 es 更宽：实测右侧控件组最宽 es 310、en 296，basis 220 时经典滚动条下只剩 283 | 改稿：重算并实测（3.4 的表），basis 改 180，上限 323；B21(l) 四语都断言（3.4、5.4） |
| 8 | en 的 `.steps li` 不设上限，“68ch 后不报 line-length”站不住 | 结论成立，但随第 10 节第 3 条作废：四语都不设上限，line-length 一定会报 | 不再追求 detect 不报；验收写明 line-length 不算失败（3.4、5.6） |
| 9 | 下划线 `bottom: -1px` 让 tablist 纵向溢出 | 成立：`overflow-x: auto` 使 overflow-y 计算为 auto | 改稿：`.tablist { overflow-y: hidden }`，下划线 `bottom: 0`；B21(l) 加 `.tablist` 无竖向溢出（3.3、5.4） |
| 10 | “更换组合”位置与写法未定，会撞 B19 | 成立：b19-guide.mjs:38 取第一个 `a.step-link` | 改稿：放在 `ol.setup-substeps` 之后的 `div.step-links` 里、“详细步骤”之后，`#setup-change-pair`，给出 CSS（3.7） |
| 11 | regrant 档时 `#pair-changed` 说错话，应按 mode 分支 | 成立：setup.js:223 regrant 也返回 true，而 regrant 卡片没有网址；done 档 setupShown 为 false | 改稿：`renderSetup` 返回 mode，pair.js 按 mode 分支（steps 用“开始使用”文案，其他用替换文案）；保存提示同样按 mode；B21(g) 三档都测（3.6、3.9、5.4） |
| 12 | 漏了 `engine_in_pair_*`、`notice_template_changed`、`notice_pair_saved` 三处跨 tab 文案 | 成立（另查出 `options_rules_intro` 的“‘其他组合’”也是跨 tab 引用） | 改稿：四条都进第 4 节“修改”表；区名逐字写入、单测守一致；`notice_pair_saved` 保留作唯一播报并改写、新增 steps 档的 `notice_pair_saved_setup`（3.9 第 4 条） |
| 13 | 改默认左侧的网址模板同样让网站搜索过期 | 成立（不止默认左侧：以该引擎为左侧的“其他组合”也过期） | 这次覆盖：`notice_template_changed` 指向 ① 并带“查看触发网址”按钮，`revealTriggers` 带到 ①；不并进 `#pair-changed`（3.9 第 5 条、B21(h)） |
| 14 | `#pair-changed` 带 `role="status"` 却每次重建 | 成立：`#pair-body` 每次 render `replaceChildren` | 改稿：`#pair-changed` 不设 role，播报交给保存提示（`#notices` 只播一次）（3.9 第 1 条、第 8 节第 17 条） |
| 15 | ② 授权按钮没有 id，焦点兜底管不到 | 成立：options.js:126/136 只在有 id 时执行 `focusAfterRender` | 改稿：补 `id="pair-grant"`，`FOCUS_FALLBACK` 指到 `#pair-left`；不改成“activeElement 为 body 就无条件兜底”，那样会在无关重渲染时抢焦点（3.8、B21(k)）。① 生成器同类问题是现状，记入 3.12 |
| 16 | 第 5 步链接的焦点目标没有选择器；li 没有 id；locale-ui 会 import tabs.js | 成立：engine-list.js 的 `authButton` 无 id；options.html:48 是 `data-i18n` 的 li | 改稿：用 `#engines [data-id="<左>"] .perm-line button` 选择器，不加 id（不多出焦点路径）；li 改 `id="guide-step-grant"`、去 `data-i18n`；`#tab-*` 链接由 tabs.js 委托处理、焦点去向由 options.js 注入，locale-ui.js 不依赖 tabs.js（3.7、3.13） |
| 17 | hash 边界：`#tab-foo`、带 ① 元素 id 的 hash 先滚动、读配置失败停在 ② | 三点都成立 | 改稿：`#tab-foo` 按认不出处理；静态 HTML 四个面板都 hidden，由 `routeOnce` 打开一个；读配置失败停在 ② 写进验收表；B21(d) 加 `#tab-foo`、`#guide`（3.2、3.6、5.4、5.6） |
| 18 | 已开的 `#tab-engines` 页遇到 `openOptionsPage()` 是推断 | 成立：B2 的已开页都不带 hash | 改稿：加 B21(j)，复用 B2 的 `openOptionsFromPopup`，核对没重载、仍在 ③（3.7、5.4） |
| 19 | 面板名会带上“未完成” | 成立 | 改稿：tab 名包进 `#tabname-<key>`，面板 `aria-labelledby` 指向它；B21(a) 核对（3.2、5.4） |
| 20 | 窄窗口开关行 DOM 没定 | 成立 | 改稿：`label[for]` + `input[role=switch]` + `aria-describedby` 指向说明，正式写出 `.switch` 的轨道、圆钮、焦点和 forced-colors 样式（3.10） |

### 第二轮审读（11 条）

照基线代码逐条核实，全部成立，均已改进正文，没有判不成立的条目。核实依据：actions.js:200 的 `isReordering()` 兜底与 options-b2.mjs:80；options.js:134 的 `replaceChildren(renderHiddenList(ctx))` 与 rules.js:20/:26 的 `false` 子节点；test/options-actions.test.js 只有假 `document`、setup.js:183 顶层读 `location`；v05-options.mjs:120/:133/:265 与 v05-i18n.mjs:66；docs/_config.yml 的 exclude 只到 acceptance-v0.5.md；README 第 36 行；`opt-tabs/` 不在仓库里。现有 key 里没有单独的“默认组合已保存。”，所以新增 `notice_pair_saved_back`，不复用。
