# 设置页引擎行精简设计（2026-10-27，草稿）

来源：第三轮 `/impeccable critique`（存档 `.impeccable/critique/2026-10-26T16-46-05Z__src.md`，不进 git）P2 第 2 条“引擎行控件过密”。原文：每行有状态+授权、↑、↓、编辑、隐藏、轮换复选框 6–7 个控件，全新安装整页 62 个 Tab 停靠点；被默认组合占用时禁用的“隐藏”下面还单独一行原因。三个候选方案（minimal / mode / menu）经评审选 minimal，并从另外两个方案移植了 6 点；和 minimal 冲突的移植点放在第 10 节。

方向：只做删减和归并，不引入新的交互模式。不加 ⋮ 菜单、拖拽、“调整顺序”模式、roving tabindex、自定义快捷键。用到的都是页面上已有的东西：`<dialog>`、`<select>`、`confirmStep`、`disclosure`、带“撤销”的提示。

## 1. 不变的东西

- 权限、存储键（`order`、`cycleExclude`、`presetOverrides`、`customEngines`）的含义与写法、DNR、分屏判定、所有硬约束。
- 不加运行时依赖，不加图标，不加颜色变量（只用 `tokens.css` 现有变量）。
- 授权规则不变（polish §1）：默认左侧没授权是警示样式、授权按钮高亮；其余没授权的是中性样式；`attention` 里的引擎授权按钮仍高亮。
- 行上保留“授权”按钮（`docs/acceptance-v0.3.md:26` B16 要求“引擎行上保留授权按钮”）。
- 行的定位方式不变：`#engines li.engine-row[data-id]` > `.engine-main` + `.engine-side`；`.perm-line` 里是 `.perm` 和授权按钮。
- 新增引擎照旧排到末尾；隐藏的预置引擎照旧进“已隐藏的预置引擎”列表，在那里恢复。
- 删除仍要点两次（`confirmStep`，不限时，失焦或 Esc 复原，polish §5）；隐藏仍不确认、提示带“撤销”。
- `edits.js` 的 `hideEngine`/`deleteEngine` 对默认组合的拒绝（`pair_uses_hide`/`pair_uses_delete`）保留，作第二道防线。

## 2. 现状

`src/options/engine-list.js` 的 `engineRow`（202 行的文件）每行渲染：

```
Google  [默认左侧]                        ⚠ 未授权（必需） [授权]
[x] 参与快捷键轮换                         [↑] [↓] [编辑] [隐藏(禁用)]
                                            默认组合在用，不能隐藏
```

- `.engine-main`：名称、标签、自定义引擎的网址、`leftDiscouraged` 提示、`label.cycle-row` 里的 `#cycle-<id>` 复选框。
- `.engine-side`（纵排）：`.perm-line`（状态 + 授权）、`.row-actions`（`button[data-move=up|down]` 图标按钮、编辑、`#remove-<id>`）、组合在用时的 `p.row-reason#reason-<id>`。
- 排序：`actions.move` 改本地 `pendingOrder`，500 ms 防抖后 `flushOrder` 写 `order`；`options.js:95` 渲染时把 `getPendingOrder()` 合并进配置。
- 已知缺陷：↑↓ 按钮没有 `id`，`options.js` 的重渲染只按 `activeElement.id` 还焦点（`focusAfterRender`），所以每移一格焦点都掉回 `body`，键盘用户要从页首重新 Tab。
- 编辑按钮没有 `aria-label`，5 个“编辑”的可访问名称完全相同。
- 全新安装时引擎卡 28 个 Tab 停靠点（标题栏 2 + 行内 26），整页 46 个（算法见第 6 节）。
- 截图：`assets/raw/en/options-engines.png`；商店图 4、顶部宣传图按行裁切它（`assets/templates-v2/store-4-engines.html:27-29`、`promo-marquee.html:39-40`）。

## 3. 改成

### 3.1 引擎行

每行最多 2 个控件：没授权时有“授权”，每行都有“编辑”。

```
Google  [默认左侧]                 ⚠ 未授权（必需）  [授权]  [编辑]
Bing  [默认右侧]                   ○ 未授权（可选）  [授权]  [编辑]
DuckDuckGo                         ✓ 已授权                  [编辑]
Perplexity  [不参与轮换]           ✓ 已授权                  [编辑]
建议只作右侧：……
百度                               ○ 未授权（可选）  [授权★] [编辑]   ← attention 仍高亮
https://www.baidu.com/s?wd=%s
```

- 删掉：`button[data-move]`、`#remove-<id>`、`#reason-<id>`、`.row-reason`、`label.cycle-row` 和 `#cycle-<id>`（复选框搬到快捷键卡，id 不变，见 3.4）。
- 编辑按钮：`ht("button", { type: "button", id: "edit-<id>", class: "btn btn-small", "aria-label": t("engine_edit_label", e.name), onclick }, "engine_edit")`。
  - `id` 让 `focusAfterRender` 在重渲染后还焦点；撤销隐藏、对话框保存后焦点都落在这里。
  - `aria-label`“编辑 $NAME$”以可见文字开头（WCAG 2.5.3）。`data-i18n` 仍是 `engine_edit`，I18N 的 rapidSwitch（`scripts/e2e/steps/i18n.mjs:167`）照旧能找到按钮。切换语言会经 `storage.onChanged` 重渲染整行，`aria-label` 跟着换。
- 新标签：`cfg.cycleExclude` 含这个引擎时，标签区加中性 `ht("span", { class: "tag" }, "engine_tag_no_cycle")`“不参与轮换”。全新安装没有 `cycleExclude`，不出现；从引擎库加入的 AI 条目（`edits.js` 的 `addFromCatalog` 会把它们写进 `cycleExclude`）一眼能看出来。
- `.engine-side` 从纵排改成横排单行：`.perm` → 授权 → 编辑。`.row-actions` 保留（只剩编辑按钮），`actions.js` 的 `ENGINE_LIST.actions` 和 `deleteWithFocus` 照旧按它找相邻行的按钮。
- `engineRow` 的 `index`、`total` 参数不再需要，`renderEngineList` 跟着简化。

### 3.2 编辑对话框：位置

`#engine-dialog` 是静态 DOM（`options.html`）。字段顺序：名称 → 网址（含批次 A 的 `#dlg-url-hint`）→ **位置**（只在编辑时显示）→ 只读 id → 底栏。

```html
<div class="field" id="dlg-position-field" hidden>
  <label for="dlg-position" data-i18n="options_dlg_position_label"></label>
  <select id="dlg-position" aria-describedby="dlg-position-hint"></select>
  <p id="dlg-position-hint" class="hint" data-i18n="options_dlg_position_hint"></p>
</div>
```

- 标签“位置”。选项：`:first`“放在最前面”，其余每个可见文字引擎（排除自己）一项，值是它的 id，文字“放在 Google 之后”。当前位置预先选中（第一行选 `:first`，否则选前一行的 id）。`:first` 不可能和引擎 id 冲突（id 只允许 `[a-z0-9-]`）。
- 选项文字用 `setI18nText(opt, "options_dlg_position_after", name)` 写，对话框开着时切换语言也会被 `applyI18n` 重写。
- 读屏：“位置，放在 Google 之后，2/5”。
- 提交：编辑模式下 `input.after = field("position").value`，和名称、网址一起交给 `actions.edit`，一次写入。
- `edits.js` 新增纯函数 `placeAfter(ids, id, afterId)`（`afterId` 为 `null` 表示最前面；`id` 不在、`afterId` 是自己或不在 `ids` 里、结果与原顺序相同时都返回原数组）。`editEngine(raw, id, input)` 在校验通过后：`input.after` 存在时按 `mergeConfig(raw).engines` 的 id 算新顺序，有变化就往 `patch` 里加 `order`。顺序在写入链里按最新的 `raw` 算，所以另一页刚改过顺序也不会被旧快照覆盖；“放在 X 之后”是相对位置，对话框打开期间别处改了顺序，意思也不变。X 期间被隐藏或删除时不改顺序。
- 新增引擎时 `#dlg-position-field` 隐藏，不传 `after`。
- 删掉防抖整套：`actions.js` 的 `move`、`pendingOrder`、`orderTimer`、`flushOrder`、`getPendingOrder`、`ORDER_DEBOUNCE_MS`；`options.js` 去掉 `getPendingOrder` 的导入（第 6 行）和第 95–96 行的合并；`edits.js` 的 `moveId` 没人用了，删掉。

### 3.3 编辑对话框：隐藏 / 删除与禁用原因

底栏左边加危险区，右边照旧“取消”“保存”：

```html
<div class="dialog-actions">
  <div id="dlg-danger" class="dlg-danger" hidden>
    <button type="button" id="dlg-hide" class="btn" data-i18n="engine_hide" hidden></button>
    <button type="button" id="dlg-delete" class="btn btn-danger" data-i18n="engine_delete" hidden></button>
    <p id="dlg-remove-reason" class="hint" hidden></p>
  </div>
  <button type="button" id="dlg-cancel" ...></button>
  <button type="submit" id="dlg-save" ...></button>
</div>
```

- 两个静态按钮而不是一个 `#dlg-remove`：`confirmStep` 在包装时就定死了 `labelKey`，同一个按钮没法在“隐藏”和“删除”之间切换。预置引擎只显示 `#dlg-hide`，自定义引擎只显示 `#dlg-delete`；新增模式下整个 `#dlg-danger` 隐藏。
- `dialogState` 多记一个 `engine`，两个按钮的处理函数从它取当前引擎。
- `#dlg-hide`：`setupEngineDialog` 里绑一次 `click`：被禁用（见下）就直接返回；否则 `dlg.close()`，再 `actions.hide(engine)`。
- `#dlg-delete`：`setupEngineDialog` 里用 `confirmStep(btn, "engine_delete", "engine_delete_confirm", onConfirm, { armNotice: () => t("engine_delete_confirm_hint", dialogState.engine.name) })` 包一次。`onConfirm`：`dlg.close()`，再 `actions.remove(engine)`。对话框关闭时按钮失焦，`confirmStep` 自动复原，下次打开是原样。
- Esc：确认态下第一次 Esc 由 `confirmStep` 的 `keydown` 处理（`preventDefault`，只撤确认），第二次 Esc 才关对话框。实施时在 Chrome 156 上实测这个顺序，不成立就在 `cancel` 事件里判断确认态。

**默认组合在用时**（移植自 mode 方案，替换 minimal 原来的“不渲染按钮”，见 10.3）：

- 按钮照常显示，不加 `disabled`，改加 `aria-disabled="true"`。它能拿到焦点，读屏会读“隐藏，不可用”。
- 按钮的 `aria-describedby="dlg-remove-reason"`；`#dlg-remove-reason` 可见，紧贴在按钮下方，文案沿用 `engine_in_pair_hide` / `engine_in_pair_delete`，句子补上出路（见第 5 节），例如“默认组合在用，不能隐藏。先在‘默认组合’里换成别的引擎。”
- 拦截点：`#dlg-hide` 的处理函数开头判断 `aria-disabled`；`confirmStep` 的 `click` 监听开头加一行 `if (btn.getAttribute("aria-disabled") === "true") return;`（`ui.js` +1 行）。键盘的 Enter / Space 激活按钮时浏览器派发的也是 `click`，所以这两处就够了。对话框打开期间别的页面改了默认组合，按钮状态可能过期，这时 `edits.js` 的校验会拒绝，并经 `#notices` 提示原因。
- 不在默认组合里时去掉 `aria-disabled` 和 `aria-describedby`，`#dlg-remove-reason` 隐藏并清空文字（`clearI18nText`）。
- 行上不再重复原因：行上已有“默认左侧/默认右侧”标签说明占用关系，行上也没有隐藏/删除按钮，不存在“禁用按钮拿不到焦点”的问题。
- 全是可见文字，不靠 `title` 和悬停，满足 ui-refresh §5 的初衷。

**焦点**：

- 隐藏：`dlg.close()` 把焦点还给 `#edit-<id>`，随后这一行消失。`actions.hide` 去掉 `onRow` 判断，一律把焦点交给提示里的“撤销”。`undoHide` 的焦点目标从 `remove-<id>` 改成 `edit-<id>`。
- 删除：`deleteWithFocus` 在 `run()` 之前读行列表（这时行还在），删完把焦点交给相邻行 `.row-actions` 里第一个可用按钮，也就是相邻行的“编辑”；没有相邻行就交给 `#add-engine`。逻辑不用改。
- 保存：`dlg.close()` 还焦点给 `#edit-<id>`，重渲染后 `focusAfterRender("edit-<id>")` 再还一次。

### 3.4 轮换开关搬到快捷键卡

`options.html` 的快捷键卡在 `#shortcut` 之后加 `<div id="cycle"></div>`。放在 `#shortcut` 之外，`refreshShortcut` 重画那一行时不会冲掉它。

```
快捷键
在 Split Search 打开的拆分视图里按快捷键，右侧会换成下一个参与轮换的引擎……
当前快捷键  未设置                                   [设置快捷键]
▸ 参与快捷键轮换：已选 5 个，共 5 个                  ← summary，默认收起
  ┌ 勾选的引擎参与轮换；取消勾选，按快捷键时跳过它。   ← legend
  [x] Google  [x] Bing  [x] DuckDuckGo  [x] Perplexity  [x] Kagi
```

- `shortcut.js` 新增 `renderCycleList(ctx)`（从 engine-list.js 搬来复选框代码），整个快捷键卡的内容都归这个文件。`options.js` 的 `render()` 在 `renderEngineList` 之后加一行 `$("cycle").replaceChildren(renderCycleList(ctx))`，在 `focusAfterRender` 之前，所以改了开关后焦点仍回到 `#cycle-<id>`。
- 结构：`disclosure("shortcut-cycle", ["options_cycle_title", on, all], h("fieldset", { class: "cycle-list" }, ht("legend", { class: "hint" }, "options_cycle_hint"), …))`。每一项是 `label.check-row` 包住 `input#cycle-<id>` 和引擎名。可见文字就是可访问名称，`engine_cycle_aria` 不再需要。
- 只列 `cfg.engines`（可见的文字引擎），与 `lib/cycle.js` 的 `cycleCandidates` 一致；顺序跟随引擎顺序，也就是轮换顺序。
- summary 带计数（`on` = 不在 `cycleExclude` 里的可见引擎数，`all` = 可见引擎数），不用复数形式。收起时状态也看得到；行上的“不参与轮换”标签是第二个入口。
- `disclosure()` 的 `titleKey` 改为也接受 `[key, ...subs]`：`ht("span", null, ...[].concat(titleKey))`（`ui.js` 改 1 行）。展开状态按 id 记在 `openIds`，跨重渲染保留。
- 写入不变：`change` 时 `actions.setCycle(id, checked)`，立即写 `cycleExclude`，成功不提示。
- 快捷键默认不绑定，绑之前这些开关不起作用，默认收起不损失信息。

### 3.5 样式（`src/options/options.css`）

- 删除：`.btn-icon`（只有 ↑↓ 用）、`.row-reason` 及 560px 下的 `.row-reason`、`.cycle-row`。
- `.engine-side { flex-direction: row; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px 10px; }`；560px 下 `justify-content: flex-start`（原来的 `align-items: flex-start` 改成这个）。
- 禁用外观统一：`.btn:disabled, .btn[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }`；`.btn:hover:not(:disabled)` 等三处 hover 选择器补 `:not([aria-disabled="true"])`。
- `.dialog-actions` 加 `flex-wrap: wrap; align-items: flex-start;`；`.dlg-danger { margin-inline-end: auto; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; flex: 1 1 220px; }`；`#dlg-remove-reason { margin: 0; font-size: 12px; max-width: 40ch; }`。es 下原因换行可以，按钮不溢出（I18N 守着）。
- `.cycle-list { border: 0; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 4px 18px; }`；`.cycle-list legend { padding: 0; margin-bottom: 4px; }`；`.cycle-list .check-row { margin-top: 0; }`。

### 3.6 文件与行数

| 文件 | 改动 | 改后估计 |
|---|---|---|
| `src/options/engine-list.js`（202） | 删 ↑↓、隐藏/删除、原因、复选框（约 −35）；编辑按钮加 id、aria-label，“不参与轮换”标签（+3）；`openEngineDialog` 填位置下拉框、危险区与原因（+25）；`setupEngineDialog` 绑 `#dlg-hide`、`#dlg-delete`，提交带 `after`（+15） | 约 210 |
| `src/options/shortcut.js`（16） | 新增 `renderCycleList`（+25） | 约 41 |
| `src/options/actions.js`（188） | 删排序防抖整套（约 −30）；`hide` 去掉 `onRow`，`undoHide` 焦点改 `edit-<id>`（±3） | 约 160 |
| `src/options/edits.js`（200） | 新增 `placeAfter`（+8）；`editEngine` 处理 `input.after`（+4）；删 `moveId`（−8） | 约 204 |
| `src/options/options.js`（197） | 去掉 `getPendingOrder`（−2）；`render()` 加一行 `#cycle` | 约 196 |
| `src/options/ui.js`（260） | `confirmStep` 判断 `aria-disabled`（+1）；`disclosure` 接受 `[key, ...subs]`（±1） | 约 261 |
| `src/options/options.html` | 快捷键卡 `#cycle`；对话框位置字段（+5）与危险区（+5） | +11 |
| `src/options/options.css` | 见 3.5 | ±16 |
| `src/ui/icons.js` | 删 `arrow-up`、`arrow-down`（`test/ui-icons.test.js` 没有点名它们） | −2 |

不加存储键，不加权限，不加图标。

## 4. 无障碍

- 引擎卡的 Tab 停靠点从 28 降到 12，这也是对 critique 中“引擎区没有跳过手段”的主要回应。
- 排序：编辑 → Tab 到“位置” → 方向键选 → Tab 到“保存”回车，焦点回到这一行的“编辑”。不再有每移一格焦点掉回 `body` 的问题。
- 删除：编辑 → Tab 到“删除” → 回车，`#notices` 播报“再点一次才删……” → 再回车。失焦或 Esc 复原。
- 隐藏：编辑 → “隐藏” → 焦点落在提示的“撤销”上，回车撤回，焦点回到这一行的“编辑”。
- 默认组合在用：Tab 能停在“隐藏/删除”上，读屏读出“不可用”和原因；视觉上是变灰按钮，下面一行可见原因，原因里写了出路。
- 五个“编辑”的可访问名称各不相同（“编辑 Google”……）。
- 轮换：Tab 到 summary → 回车展开 → 逐个复选框按空格；`fieldset` + `legend` 给出分组名。
- 对话框（编辑模式）内 Tab 顺序：名称、网址、位置、隐藏/删除、取消、保存，共 6 个。
- 状态仍靠图标加文字，不只靠颜色；新标签“不参与轮换”是文字。

## 5. 文案

四种语言同时改，按 CLAUDE.md“文案”流程：zh_CN 源文案先定稿（lieflat-less-ai-tone + humanizer-zh），再按市场转写 en（humanizer）、zh_TW（humanizer-zh + 台湾用语）、es（content-l10n + 母语审校，用 tú）。术语以 `docs/i18n/chrome-terms.md` 为准。下面只给 zh_CN 草稿。

**删除（7 个）**：`engine_move_up`、`engine_move_up_label`、`engine_move_down`、`engine_move_down_label`、`notice_order_save_failed`、`engine_cycle_label`、`engine_cycle_aria`。

**新增（8 个）**：

| key | zh_CN 草稿 | 说明 |
|---|---|---|
| `engine_edit_label` | 编辑 $NAME$ | 编辑按钮的 aria-label，必须以 `engine_edit` 的文字开头 |
| `engine_tag_no_cycle` | 不参与轮换 | 行上的中性标签 |
| `options_dlg_position_label` | 位置 | |
| `options_dlg_position_first` | 放在最前面 | |
| `options_dlg_position_after` | 放在 $NAME$ 之后 | |
| `options_dlg_position_hint` | 顺序决定各处下拉框里引擎的先后，也是快捷键轮换的顺序。 | 从 `options_engines_hint` 挪来并补上轮换 |
| `options_cycle_title` | 参与快捷键轮换：已选 $ON$ 个，共 $ALL$ 个 | summary；各语言避开复数变化（en 可写 “Shortcut rotation: $ON$ of $ALL$ selected”） |
| `options_cycle_hint` | 勾选的引擎参与轮换；取消勾选，按快捷键时跳过它。 | legend |

**修改（4 个）**：

- `options_engines_hint`：去掉“排序决定下拉框里的顺序”，改成“左侧引擎的网站必须授权，右侧建议授权。排序、隐藏和删除都在‘编辑’里。”批次 A 已去掉 `%s` 那句，以 A 的定稿为底。
- `options_shortcut_hint`：不再引用行内复选框的文字，改成“……右侧会换成下一个参与轮换的引擎（在下面选）。快捷键默认未设置，点‘设置快捷键’到 Chrome 的‘键盘快捷键’页面设置。”description 同步。保留 Chrome“键盘快捷键”页名，`test/i18n-pak.test.js:63` 检查它。
- `engine_in_pair_hide`：“默认组合在用，不能隐藏。先在‘默认组合’里换成别的引擎。”
- `engine_in_pair_delete`：“默认组合在用，不能删除。先在‘默认组合’里换成别的引擎。”“默认组合”与卡片标题 `options_pair_title` 一致。

**沿用**：`engine_edit`、`engine_hide`、`engine_delete`、`engine_delete_confirm`、`engine_delete_confirm_hint`、`notice_hidden`、`common_undo`、`options_dlg_title_edit`。

## 6. 全新安装的 Tab 停靠点

**算法**：全新安装（没有 `setupDone`、没有任何 host 授权、默认组合 google｜bing、五个预置引擎、快捷键未绑定、`cycleExclude` 为空、界面英文），所有 `<details>` 保持默认（收起），对话框和提示都没打开。数顺序焦点导航能停的元素：可见、没有 `disabled`、`tabindex ≥ 0` 的 `a[href]`、`button`、`input`、`select`、`summary`；收起的 `<details>` 只算 summary；`tabindex="-1"` 的标题不算。批次 A 合入后 5 步说明收进 `<details>`：少了“复制设置地址”按钮，多了 1 个 summary，数量不变。

| 区块 | 改前 | 改后 |
|---|---|---|
| 语言下拉框 | 1 | 1 |
| 开始使用卡（第 1 步授权、两个复制、“详细步骤”链接；“试一下”禁用不算） | 4 | 4 |
| 默认组合卡（2 个下拉框 + 窄窗口复选框） | 3 | 3 |
| 添加到 Chrome（默认组合、其他组合、5 步说明、注意事项四个 summary） | 4 | 4 |
| 右键查询卡（2 个下拉框 + 2 个按钮 + 说明 summary；Lens 内置，没有删除按钮） | 5 | 5 |
| 引擎卡标题栏（引擎库、新增） | 2 | 2 |
| 引擎行 | 26 | 10 |
| 快捷键卡（设置快捷键；改后多一个轮换 summary） | 1 | 2 |
| **合计** | **46** | **31** |

引擎行改前逐行：Google 授权、↓、编辑、轮换 = 4（↑ 和隐藏禁用）；Bing 授权、↑、↓、编辑、轮换 = 5（隐藏禁用）；DuckDuckGo、Perplexity 各 6；Kagi 授权、↑、编辑、隐藏、轮换 = 5（↓ 禁用）；合计 26。改后每行授权 + 编辑 = 2，合计 10。

公式：改后合计 = 非引擎行 20 + 轮换 summary 1 + Σ每行（未授权 ? 1 : 0）+ 引擎数 = 21 + 5 + 5 = 31。完成第 1 步授权后（google、bing 已授权，卡里的授权按钮也消失）是 28。

整页 46 → 31（−33%），引擎卡 28 → 12（−57%）。critique 记的 62 按这个算法复算不出来：把禁用元素和收起内容里的控件也算上是 55，仍不到 62，推测当时口径或配置不同。所以这里只报同一算法下的前后对比。实施后用 CDP 在全新临时配置里实际按 Tab 走一遍（`Input.dispatchKeyEvent` 发 Tab，记 `document.activeElement`，回到起点为止），改前改后各一次，结果和算法一起写进 `docs/acceptance-v0.4.md`。

## 7. e2e 与测试

grep 命中（`scripts/e2e/`：`data-move`、`remove-`、`cycle-`、`reason-`、`data-id`、`engine-row`）：`optpage.mjs` 的 PRELUDE、`options-b.mjs`（B7、B10）、`options-b2.mjs`（B12、B13）、`v03-options.mjs`（B17(c)）。另有只读 `.perm` / `engine_grant` / `engine_edit` 的 `b4.mjs`、`v03-options.mjs`（B16）、`options-b.mjs`（B11）、`i18n.mjs`，以及只看右键查询卡的 `v04-options.mjs`、`v04-i18n.mjs`（`.engine-row` 是以图搜图列表，`remove-image-<id>` 不受影响）。

### 7.1 要改的步骤

- **`optpage.mjs`**：PRELUDE 去掉 `moveBtn`（第 14 行），注释第 11 行跟着改。新增 Node 侧帮手 `openEdit(page, id)`：点 `#edit-<id>`，等 `#engine-dialog` 的 `open` 为真。`row`、`ids`、`READY` 不变。
- **B7**（`options-b.mjs:153-159`）：删除改成 `openEdit("baidu")` → 点 `#dlg-delete` 一次，断言文字是 `engine_delete_confirm`、行还在、对话框还开着 → 再点一次 → 行消失、对话框关闭、焦点在相邻行的 `#edit-<id>` 上。顺带断言新增模式下 `#dlg-position-field` 与 `#dlg-danger` 都隐藏。授权按钮高亮和 `perm-optional` 的断言不变。约 +6 行。
- **B10**（`options-b.mjs:205-230`）：probe 改为逐个 `openEdit`，读 `#dlg-hide`/`#dlg-delete` 中可见那个的 `aria-disabled`、`disabled`、`aria-describedby`，以及 `#dlg-remove-reason` 是否可见和文字，然后点“取消”。断言：默认组合里的引擎按钮可见、没有 `disabled`、`aria-disabled="true"`、`aria-describedby="dlg-remove-reason"`、原因文字等于 `engine_in_pair_hide`/`engine_in_pair_delete`；点一下没有效果（行还在、删除按钮没进入确认态、存储没变）。其余引擎没有 `aria-disabled`、原因隐藏。第 226 行的等待条件改成等 `row("google")` 带上默认左侧标签。`options-b.mjs` 现在 262 行，改完若超过 300 就把 B10 搬到 `options-b2.mjs`（105 行）。约 +18 行。
- **B12**（`options-b2.mjs:16、26、30`）：隐藏改成 `openEdit("ddg")` → 聚焦并点 `#dlg-hide`；撤销后的焦点断言从 `remove-ddg` 改成 `edit-ddg`；第 (3) 段同样经对话框隐藏。约 6 行。
- **B13**（`options-b2.mjs:41-80`）：整段重写。帮手 `place(page, id, after)`：`openEdit` → 给 `#dlg-position` 赋值并派发 `change` → 点 `#dlg-save` → 等对话框关闭。流程：`x = start[0]`，放在 `start[2]` 之后，期望 `[start[1], start[2], x, …]`；断言保存后焦点在 `#edit-<x>`（移植自 mode）；刷新后核对顺序。另开一页把 x 放在 `want[0]` 之后，第一页 4 秒内自动刷新，阈值从 2.5 秒改成 2 秒（没有 0.5 秒防抖了）。标题改成“排序（编辑对话框里的位置）保存、刷新后保持、另一页自动刷新”。约 25 行。
- **B17(c)**（`v03-options.mjs:220-232`）：标题改成“快捷键卡的轮换开关写入 cycleExclude”。点开关前先展开 `#cycle details`；关掉 ec 后另外断言 summary 计数少 1、`row("ec")` 出现 `engine_tag_no_cycle` 标签、重渲染后 `<details>` 仍展开；`cycle-ec` 的 id 和写入断言不变。约 +6 行。
- **I18N**（`i18n.mjs`）：本来就会展开所有 `details.disclosure`，轮换清单自动纳入溢出检查。新增：每种语言打开 google 行（默认组合，显示原因）和 ddg 行（显示隐藏按钮）的编辑对话框各一次，对 `#engine-dialog` 做 `audit`，核对底栏不溢出、“隐藏”“删除”按钮不换行（`lineProblems`），es 最长。约 +12 行（现 230 行）。

### 7.2 不用改

B4（`.engine-row[data-id] .perm` 不变）、B8、B11（照旧按 `engine_edit` 点编辑）、B16（行上的授权按钮保留）、B18 与 v04-i18n（只看右键查询卡）、I18N 的 rapidSwitch（`data-i18n="engine_edit"` 还在）、B14（对话框与卡片配色不变）。

### 7.3 单元测试

- `test/options-edits.test.js`：`placeAfter`（移到最前、移到末尾、移到中间、`afterId` 是自己或不存在、顺序不变时返回原数组）；`editEngine` 带 `after`（写 `order`；只改位置也成功；同时改名和位置一次写入；无效 `after` 不写 `order`）。约 +35 行。
- `test/options-ui.test.js`：`confirmStep` 遇到 `aria-disabled="true"` 时点击不进入确认态、不调用 `onConfirm`；`disclosure` 接受 `[key, ...subs]`。约 +15 行。
- `test/i18n-catalog.test.js:186`：带名 aria 对照表去掉 `["engine_cycle_aria", "engine_cycle_label"]`，加 `["engine_edit_label", "engine_edit"]`。
- `test/i18n-pak.test.js:63`：不改，新的 `options_shortcut_hint` 仍要含 Chrome“键盘快捷键”页名。
- `test/ui-icons.test.js`：删两个箭头图标后照跑。

### 7.4 跑什么

`npm test`；`npm run e2e -- --auto-only --only B4,B7,B10,B11,B12,B13,B16,B17,I18N`；再跑完整 `npm run e2e -- --auto-only` 与 `npm run pack -- --smoke`。

## 8. 文档

- `docs/acceptance-v0.4.md`：B7、B10、B12、B13、B17 的新口径（删除和隐藏在编辑对话框里、组合在用时 `aria-disabled` 加可见原因、排序用“位置”、轮换在快捷键卡）；加一节 Tab 停靠点（第 6 节的算法与 CDP 实测数）。
- `docs/acceptance-v0.1.md:65、68` 的 B10、B13 描述，`docs/acceptance-v0.3.md:27` 的 B17 描述。
- CLAUDE.md“目录与职责”：`engine-list.js`（去掉“每个引擎的参与快捷键轮换开关”，写明编辑对话框里有位置、隐藏/删除）、`shortcut.js`（快捷键卡：绑定状态与轮换清单）、`ui.js`（`confirmStep` 认 `aria-disabled`）。
- 截图：重拍 `assets/raw/en/options-engines.png`（行变矮、没有复选框和原因行），更新 `assets/raw/captions.md` 的说明和行分隔线坐标；重算 `assets/templates-v2/store-4-engines.html:27-29` 和 `promo-marquee.html:39-40` 的裁切坐标，`node scripts/store/render-assets.mjs --locale en` 重出图。captions 第 106 行记的“两行下面各留一行空白”的问题随之消失，那段注释一并更新。
- `docs/store/` 的商店详情与隐私政策：存储键和语义不变，不用改（隐私政策只说“哪些引擎参与快捷键轮换”，不涉及界面位置）。

## 9. 实施顺序

前提：批次 A 已提交（82ccf8f..c579369，本地标签 v0.4.0 = c579369），本批以 A 的定稿为底。

1. 纯逻辑与测试：`edits.js` 的 `placeAfter`、`editEngine` 的 `after`；`ui.js` 的 `confirmStep` 判断和 `disclosure` 参数；先写测试。
2. 编辑对话框：位置字段、危险区、原因与 `aria-disabled`、焦点（`engine-list.js`、`options.html`、`actions.js`）。
3. 引擎行精简：删 ↑↓、隐藏/删除、原因、复选框；编辑按钮 id 与 aria-label；“不参与轮换”标签；删防抖整套（`engine-list.js`、`actions.js`、`options.js`、`edits.js`）。
4. 快捷键卡轮换清单（`shortcut.js`、`options.js`、`options.html`）。
5. 样式（`options.css`）与图标清理（`icons.js`）。
6. 四种语言文案定稿（第 5 节，按 CLAUDE.md 文案流程）。
7. e2e 更新（第 7 节），跑受影响步骤，再跑完整 `--auto-only` 和 `pack --smoke`。
8. CDP 实测 Tab 停靠点（第 6 节），截图重拍与重渲，文档。
9. 整体审查，再跑一次 `/impeccable critique` 对比。

每一步由子代理实施、另一个子代理审查，在 main 上做，不推送（同 polish 的做法）。

## 10. 待用户决定

1. **排序放在哪**：(a) 编辑对话框里的“位置”下拉框（本稿）；(b) mode 方案的“调整顺序”模式；(c) menu 方案 ⋮ 菜单里的上移/下移。**推荐 (a)**：顺序只影响下拉框和轮换的先后，不常调；代码净减，还能删掉防抖整套和 ↑↓ 焦点丢失的缺陷。代价是每次移动要开对话框、选位置、保存。operate.md 提醒过“别第一个想到模态框”，但这里复用的是已有的编辑对话框，没有新开模态框。如果之后发现用户常排序，再单独加“调整顺序”模式，这一批不做。
2. **隐藏/删除离开行内**：推翻 `docs/acceptance-v0.4.md` B7“删除是行内按钮”的口径和 ui-refresh §5“原因写成行内小字”的做法，多一步“编辑 → 隐藏/删除”。**推荐接受**：同时在 `options_engines_hint` 写明“排序、隐藏和删除都在‘编辑’里”，补可发现性。如果更看重可发现性，退而选 menu 方案的 ⋮ 菜单（贴近 Chrome“搜索引擎”页），但要接受新写 APG 菜单按钮组件（约 140 行加 `lib/menu-keys.js`）、`popover` 与锚点定位、新增 B20 键盘测试的成本。
3. **默认组合在用时的按钮**（与 minimal 原稿冲突的移植点）：(a) 可聚焦的 `aria-disabled` 按钮加下方可见原因、`aria-describedby` 关联（本稿，移植自 mode）；(b) minimal 原稿：不渲染按钮，只在原位置显示原因文字，靠对话框的 `aria-describedby` 播报。**推荐 (a)**：键盘用户有落点，读屏读到“不可用”和原因，不依赖各家读屏对 dialog `aria-describedby` 不一致的播报；代价是 `confirmStep` 和 `#dlg-hide` 要多判断一处，漏判时由 `edits.js` 兜底拒绝。
4. **轮换清单默认收起还是展开**：(a) 一律默认收起，summary 带计数，行上显示“不参与轮换”标签（本稿）；(b) 绑定快捷键后默认展开。**推荐 (a)**：没绑快捷键时开关不起作用；按绑定与否改变默认展开状态，会让同一页面在不同用户那里不一样。顺带：“不参与轮换”标签在没绑快捷键时也显示，推荐保留，它说的是真实设置，全新安装不会出现。
5. **是否突破 polish spec“不加文案以外的新界面元素种类”**：⋮ 菜单、排序模式都算新种类。**推荐不突破**，选本稿，只用现有的 dialog、select、disclosure、confirmStep、tag。
6. **Tab 停靠点要不要做成常驻 e2e 断言**：**推荐不做**，只在实施时用 CDP 实测一次，写进验收文档。计数会随别的批次的界面改动变化，做成断言容易误报；回归靠 B7、B10、B12、B13 对行结构的断言就够了。
7. **实施时机**：批次 A 已提交，本稿以它为底；动手前重新核对 Tab 计数和商店图 4、顶部宣传图的裁切坐标（A 已把裁切 y 加了 29）。
