# 设置页引擎行精简设计（2026-10-27）

来源：第三轮 `/impeccable critique`（存档 `.impeccable/critique/2026-10-26T16-46-05Z__src.md`，不进 git）P2 第 2 条“引擎行控件过密”。原文：每行有状态+授权、↑、↓、编辑、隐藏、轮换复选框 6–7 个控件，全新安装整页 62 个 Tab 停靠点；被默认组合占用时禁用的“隐藏”下面还单独一行原因。三个候选方案（minimal / mode / menu）评审后，用户 2026-10-27 定稿（第 10 节）：以 minimal 为底，排序改用 mode 方案的“调整顺序”模式，隐藏/删除并入编辑对话框，默认组合在用时用可聚焦的 `aria-disabled` 按钮加可见原因。

方向：以删减和归并为主。用到的都是页面上已有的东西：`<dialog>`、`confirmStep`、`disclosure`、带“撤销”的提示、现有的 ↑↓ 图标按钮。唯一新加的交互是“调整顺序”模式（用户明确选的，第 10 节第 1 条）。不加 ⋮ 菜单、拖拽、roving tabindex、自定义快捷键。

## 1. 不变的东西

- 权限、存储键（`order`、`cycleExclude`、`presetOverrides`、`customEngines`）的含义与写法、DNR、分屏判定、所有硬约束。
- 排序的写入方式：`actions.move` 改本地 `pendingOrder`，500 ms 防抖后 `flushOrder` 写 `order`；`options.js` 渲染时把 `getPendingOrder()` 合并进配置；`edits.js` 的 `moveId` 照用。只多两处：退出排序模式时立即写；`move` 的 `base` 先经 `reconcileOrder` 补齐防抖期内恢复的引擎（都见 3.2）。
- 不加运行时依赖，不加图标（↑↓ 继续用 `arrow-up`/`arrow-down`），不加颜色变量（只用 `tokens.css` 现有变量）。
- 授权规则不变（polish §1）：默认左侧没授权是警示样式、授权按钮高亮；其余没授权的是中性样式；`attention` 里的引擎授权按钮仍高亮。
- 行上保留“授权”按钮（`docs/acceptance-v0.3.md:26` B16 要求“引擎行上保留授权按钮”）。
- 行的定位方式不变：`#engines li.engine-row[data-id]` > `.engine-main` + `.engine-side`；`.perm-line` 里是 `.perm` 和授权按钮。
- 新增引擎照旧排到末尾；隐藏的预置引擎照旧进“已隐藏的预置引擎”列表，在那里恢复。
- 删除仍要点两次（`confirmStep`，不限时，失焦或 Esc 复原，polish §5）；隐藏仍不确认、提示带“撤销”。
- `edits.js` 的 `hideEngine`/`deleteEngine` 对默认组合的拒绝（`pair_uses_hide`/`pair_uses_delete`）保留，作第二道防线。
- 右键查询卡的以图搜图列表（`lookup.js`）也用 `.engine-row`/`.engine-side`，它的结构和样式不动：本批新写或改写的引擎行样式一律限定在 `#engines` 下。

## 2. 现状

`src/options/engine-list.js` 的 `engineRow`（202 行的文件）每行渲染：

```
Google  [默认左侧]                        ⚠ 未授权（必需） [授权]
[x] 参与快捷键轮换                         [↑] [↓] [编辑] [隐藏(禁用)]
                                            默认组合在用，不能隐藏
```

- `.engine-main`：名称、标签、自定义引擎的网址、`leftDiscouraged` 提示、`label.cycle-row` 里的 `#cycle-<id>` 复选框。
- `.engine-side`（纵排）：`.perm-line`（状态 + 授权）、`.row-actions`（`button[data-move=up|down]` 图标按钮、编辑、`#remove-<id>`）、组合在用时的 `p.row-reason#reason-<id>`。
- 排序：见第 1 节。`flushOrder` 只由防抖定时器调用，页面没有别的地方立即写。
- 已知缺陷：↑↓ 按钮没有 `id`，`options.js` 的重渲染只按 `activeElement.id` 还焦点（`focusAfterRender`，第 29 行；只在焦点落回 `body` 时调用，第 125 行），所以每移一格焦点都掉回 `body`，键盘用户要从页首重新 Tab。
- 编辑按钮没有 `aria-label`，5 个“编辑”的可访问名称完全相同。
- 全新安装时引擎卡 28 个 Tab 停靠点（标题栏 2 + 行内 26），整页 46 个（算法见第 6 节）。
- 截图：`assets/raw/en/options-engines.png`；商店图 4、顶部宣传图按行分段裁切它（`assets/templates-v2/store-4-engines.html:27-29`、`promo-marquee.html:39-40`，坐标另记在 `assets/templates-v2/README.md:37-38`）。分段是因为 DuckDuckGo、Bing 两行多一行原因（`assets/raw/captions.md:106`）。

## 3. 改成

### 3.1 引擎行（平时）

每行最多 2 个控件：没授权时有“授权”，每行都有“编辑”。

```
┌ 搜索引擎 ─────────────────────── [调整顺序] [从引擎库添加] [新增引擎] ┐
│ 左侧引擎的网站必须授权，右侧建议授权。隐藏和删除在“编辑”里，排序在“调整顺序”里。│
├──────────────────────────────────────────────────────────────────────┤
│ Google  [默认左侧]                 ⚠ 未授权（必需）  [授权]  [编辑]   │
│ Bing  [默认右侧]                   ○ 未授权（可选）  [授权]  [编辑]   │
│ DuckDuckGo                         ✓ 已授权                  [编辑]   │
│ Perplexity  [不参与轮换]           ✓ 已授权                  [编辑]   │
│ 建议只作右侧：……                                                       │
│ 百度                               ○ 未授权（可选）  [授权★] [编辑]   │ ← attention 仍高亮
│ https://www.baidu.com/s?wd=%s                                          │
└──────────────────────────────────────────────────────────────────────┘
```

- 删掉：行内的隐藏/删除（`#remove-<id>`）、`#reason-<id>`、`.row-reason`、`label.cycle-row` 和 `#cycle-<id>`（复选框搬到快捷键卡，id 不变，见 3.4）。↑↓ 平时不渲染，只在排序模式里出现（3.2）。
- ↑↓ 不放在 `.row-actions` 里，放在 `.engine-side` 里单独的 `div.row-move`。T1 里 ↑↓ 还留在平时的行上（T2 才搬进排序模式），从 T1 起就放进 `.row-move`，`.row-actions` 里只有“编辑”。这样 `deleteWithFocus` 交出的焦点从 T1 起就是相邻行的 `#edit-<id>`，B7 在 T1、T2 用同一条断言。
- 编辑按钮：`ht("button", { type: "button", id: "edit-<id>", class: "btn btn-small", "aria-label": t("engine_edit_label", e.name), onclick }, "engine_edit")`。
  - `id` 让 `focusAfterRender` 在重渲染后还焦点；撤销隐藏、对话框保存后焦点都落在这里。
  - `aria-label`“编辑 $NAME$”以可见文字开头（WCAG 2.5.3）。`data-i18n` 仍是 `engine_edit`，I18N 的 rapidSwitch（`scripts/e2e/steps/i18n.mjs:164-168`）照旧能找到按钮。切换语言会写 `uiLocale`，经 `storage.onChanged` 重渲染整行，`aria-label` 跟着换。
- 新标签：`cfg.cycleExclude` 含这个引擎时，标签区加中性 `ht("span", { class: "tag" }, "engine_tag_no_cycle")`“不参与轮换”。全新安装没有 `cycleExclude`，不出现；从引擎库加入的 AI 条目（`edits.js:126` 的 `addFromCatalog` 会把它们写进 `cycleExclude`）一眼能看出来。没绑快捷键时也显示：它说的是真实设置。
- `#engines .engine-side` 从纵排改成横排单行：`.perm` → 授权 → 编辑（T1 里编辑前面还有 `.row-move` 的 ↑↓）。`.row-actions` 保留，平时只有编辑；排序模式里的行不渲染 `.row-actions`，只有 `.row-move`。`actions.js` 的 `ENGINE_LIST.actions` 仍是 `.row-actions`，不能改成 `.engine-side`：那样 `deleteWithFocus` 会把焦点交给相邻行的“授权”（T1 里是 ↑）而不是“编辑”。注释（`actions.js:152`）改成“文字引擎是 .row-actions，只有编辑按钮”。

### 3.2 “调整顺序”模式

**入口与外观**：

```
┌ 搜索引擎 ───────────────────────────────────────────────── [完成] ┐
│ 用每行的“上移”“下移”调整顺序，改动会自动保存。……                   │
├────────────────────────────────────────────────────────────────────┤
│ Google  [默认左侧]                                     [↑̸]  [↓]   │
│ Bing  [默认右侧]                                       [↑]  [↓]    │
│ DuckDuckGo                                             [↑]  [↓]    │
│ Perplexity  [不参与轮换]                               [↑]  [↓]    │
│ Kagi                                                   [↑]  [↓̸]   │
└────────────────────────────────────────────────────────────────────┘
```

- 卡头 `.section-actions` 最前面加静态按钮 `<button type="button" id="engines-reorder" class="btn btn-small" aria-controls="engines" data-i18n="engine_reorder">`。可见引擎少于 2 个时 `hidden`；模式中可见引擎掉到 2 个以下（另一页隐藏或删除了引擎）就自动退出模式（判定顺序见下面“渲染顺序”）。
- 进入模式：按钮文字经 `setI18nText` 换成 `engine_reorder_done`“完成”，类换成 `btn btn-small btn-primary`；`#catalog-open`、`#add-engine` 设 `hidden`（模式只管排序，也避免排序途中新增一行）；`#engines-hint` 隐藏、`#engines-reorder-hint`（静态 `<p class="hint" hidden data-i18n="engine_reorder_hint">`）显示；列表 `ol.engine-list` 带类 `reordering`（给 e2e 判断状态，也是样式钩子）。
- 静态 DOM 的位置：`#engines-reorder-hint` 和 `#engines-status`（见“键盘与读屏”）都写在 `options.html` 里、`#engines` 之外（紧跟 `#engines-hint`，在 `<div id="engines">` 之前）。`#engines` 每次渲染都被 `replaceChildren` 整个换掉，放在里面会被清掉。
- 模式中的行：只渲染名称、标签和 `.engine-side > .row-move` 里的 ↑↓。状态、授权、编辑（连同 `.row-actions`）、网址、`leftDiscouraged` 提示都不渲染（JS 分支，不用 CSS 藏，所以藏起来的控件不会留在 Tab 顺序里）。↑↓ 沿用现有写法（`btn btn-small btn-icon`、`title: t("engine_move_up")`、`aria-label: t("engine_move_up_label", name)`、边缘的那个 `disabled`），新增 `id="move-up-<id>"`、`id="move-down-<id>"`，`data-move` 保留。
- “已隐藏的预置引擎”一节在模式中照常显示，“恢复”可用：恢复的引擎不在 `pendingOrder` 里，`mergeConfig` 把它排在末尾，带着 ↑↓ 出现。防抖期内（`pendingOrder` 还没写出）也能马上排它：`actions.move` 的 `base` 不再直接用 `pendingOrder`，改用 `edits.js` 新增的纯函数 `reconcileOrder(pendingOrder, ids)`（`ids` = `current.engines` 的 id）：按 `pendingOrder` 的先后保留仍在 `ids` 里的，`ids` 里缺的按原顺序补到末尾；没有 `pendingOrder` 时就是 `ids`。不这样做的话，刚恢复的引擎不在 `pendingOrder` 里，`moveId` 的 `indexOf` 得 −1、返回原数组，500 ms 内点它的 ↑↓ 没有反应、也没有播报。顺带去掉另一页已隐藏或删除、却还留在 `pendingOrder` 里的 id，播报的“共 N 个”就只数可见引擎。

**渲染顺序**（谁判定、先后）：

1. `renderEngineList(ctx)` 开头调用 `reorder.js` 的 `syncReorder(cfg.engines.length)`：先做退出判断（模式中且可见引擎少于 2 个 → 清掉模式状态、`flushOrderNow()`），再按当前状态更新卡头（按钮文字与类、按钮本身的 `hidden`、`#catalog-open`/`#add-engine`、两段说明、退出时清空 `#engines-status`）。
2. 然后 `renderEngineList` 按 `isReordering()` 建 `ol.engine-list`：模式中加类 `reordering`，每行由 `engineRow` 按 `isReordering()` 分两支。退出判断已经先做，所以自动退出的这次渲染直接就是平时的行和平时的卡头，不会出现“状态已退出、行仍是模式样式”。
3. 自动退出发生在渲染里面，本次渲染已经反映了退出，不再调用 `render()`（否则递归）。焦点若原在被移除的 ↑↓ 上，`focusAfterRender` 找不到 `move-` 的 id 和它的兄弟时交给 `#add-engine`（这时“调整顺序”按钮已隐藏）。
4. 点“完成”和 Esc 这两种主动退出：清掉模式状态 → `flushOrderNow()` → 显式调用 `setupReorder` 传入的 `render()`。不依赖 `flushOrder` 末尾的 `render()`：没有 `pendingOrder` 时它直接 `return`（`actions.js:180`），行会停在模式样式。
- 模式状态记在新文件 `reorder.js` 的模块变量里，跨重渲染保留（另一页改了顺序、`storage.onChanged` 触发重渲染时不退出）；刷新页面回到平时。
- 不做拖拽。

**键盘与读屏**：

- 文字会变的按钮不加 `aria-pressed`（APG）。焦点在进入、退出时都留在这个按钮上（它是静态 DOM，不随列表重建）。
- 卡内加视觉隐藏的 `<p id="engines-status" class="sr-only" role="status"></p>`（新 `.sr-only` 类，不涉及颜色；写在 `#engines` 之外，见上文“静态 DOM 的位置”）。进入模式时写入 `engine_reorder_hint` 的文字；每次移动写一句 `engine_moved`，例如“Google：第 2 位，共 5 个”；退出时清空。这些文字是一次性的播报，不带 `data-i18n`。
- 移动：`actions.move(id, delta)` 改为返回新顺序（不变时返回 `null`），`reorder.js` 的 `announceMove(order, id, name)` 据此写播报。位置和总数由 `edits.js` 新增的纯函数 `movePosition(order, id) → { pos, total }` 算（`pos` 从 1 起，找不到时返回 `null`），`announceMove` 只负责调 `t("engine_moved", …)` 写 `#engines-status`。重渲染后 `focusAfterRender` 按 id 把焦点还给同一个按钮；它刚好变成禁用（移到顶或底）时交给同一行另一个方向的按钮。注意 `$(id)` 找得到禁用的按钮、`focus()` 却悄悄不生效，所以回退要判断 `disabled`，不能只判断元素在不在（`edits.js` 导出纯函数 `siblingMoveId(id)`：`move-up-x` ↔ `move-down-x`，其他 id 返回 `null`；`options.js` 的 `focusAfterRender` 加 3 行，含上文找不到时交给 `#add-engine`）。这同时修掉第 2 节的“焦点掉回 body”缺陷。
- 三个纯函数（`reconcileOrder`、`movePosition`、`siblingMoveId`）放 `edits.js` 而不放 `reorder.js`：`reorder.js` 要碰 DOM、导入 `ui.js` 和 `chrome/i18n.js`，node 测试导入它得先准备替身。
- 退出：点“完成”，或焦点在整张引擎卡里时按 Esc。`keydown` 监听挂在引擎卡的 `<section>` 上（`#engines-reorder.closest("section")`），所以焦点停在卡头的“完成”上、在 ↑↓ 上、在“已隐藏的预置引擎”的“恢复”上按 Esc 都会退出；模式外不处理。编辑、引擎库对话框和 `#notices` 都不在这张卡里，它们的 Esc 不受影响（模式中也打不开这两个对话框）。退出时 `actions.js` 新导出的 `flushOrderNow()` 清掉防抖定时器、立刻 `flushOrder()`，“完成”之后马上就是已保存状态；然后显式 `render()`（见“渲染顺序”第 4 条），焦点回到 `#engines-reorder`（文字已换回“调整顺序”）。
- 剩余风险：模式中移动后 500 ms 内直接关页面，这次移动可能丢（现状如此），不另做 `pagehide` 写入。
- 模式中整张引擎卡的 Tab 停靠点：完成 1 + 每行两个 ↑↓ 去掉两个边缘 = 1 + 5×2 − 2 = 9。

**代码位置**：新文件 `src/options/reorder.js`（约 70 行）：模式状态 `isReordering()`、`setupReorder({ render, flush })`（绑按钮和卡上的 Esc，`options.js` 在 `i18nReady.then` 里调用）、`syncReorder(count)`（`renderEngineList` 每次渲染开头、建行之前调用：先退出判断，再更新按钮文字、卡头按钮、两段说明）、`moveButtons(e, index, total, actions)`（T1 时在 `engine-list.js` 里建 `.row-move`，T2 搬到这里）、`announceMove(order, id, name)`（只写 DOM）。`engine-list.js` 的 `renderEngineList` 开头调 `syncReorder`、按 `isReordering()` 给列表加 `reordering`，`engineRow` 按 `isReordering()` 分两支。纯函数 `reconcileOrder`、`movePosition`、`siblingMoveId` 在 `edits.js`。

### 3.3 编辑对话框：隐藏 / 删除与禁用原因

`#engine-dialog` 是静态 DOM（`options.html:137`）。字段照旧：名称 → 网址（含 `#dlg-url-hint`）→ 新增时的“高级”/编辑时的只读 id → 底栏。底栏左边加危险区，右边照旧“取消”“保存”：

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

```
┌ 编辑引擎：Google ────────────────────────────────────┐
│ 名称 [Google            ]                           │
│ 网址 [https://www.google.com/search?q=%s]           │
│ ……（原有提示不变）                                    │
│ [隐藏(不可用)]                         [取消] [保存] │
│ 默认组合在用，不能隐藏。先在“默认组合”里换成别的引擎。 │
└──────────────────────────────────────────────────────┘
```

- 两个静态按钮而不是一个：`confirmStep` 在包装时就定死了 `labelKey`，同一个按钮没法在“隐藏”和“删除”之间切换。预置引擎只显示 `#dlg-hide`，自定义引擎只显示 `#dlg-delete`。
- 新增模式：`openEngineDialog` 把 `#dlg-danger`、`#dlg-hide`、`#dlg-delete`、`#dlg-remove-reason` 四个都设 `hidden`，去掉两个按钮的 `aria-disabled`、`aria-describedby`，清空原因文字。只藏外层不够：先编辑过一个自定义引擎（`#dlg-delete` 已去掉 `hidden`），再打开“新增引擎”，外层的 `hidden` 一旦失效（见 3.5 的 `display` 规则），“删除”就会露出来。
- `dialogState` 多记一个 `engine`（新增模式下是 `null`），两个按钮的处理函数从它取当前引擎，开头先判断 `if (!dialogState.engine) return;`；`armNotice` 也写成 `dialogState.engine?.name`。这是第二道防线，第一道是上面的 `hidden`。
- `#dlg-hide`：`setupEngineDialog` 里绑一次 `click`：`aria-disabled="true"` 就直接返回；否则 `dlg.close()`，再 `actions.hide(engine)`。
- `#dlg-delete`：`setupEngineDialog` 里用 `confirmStep(btn, "engine_delete", "engine_delete_confirm", onConfirm, { armNotice: () => t("engine_delete_confirm_hint", dialogState.engine.name) })` 包一次。`onConfirm`：`dlg.close()`，再 `actions.remove(engine)`。对话框关闭时按钮失焦，`confirmStep` 自动复原，下次打开是原样。
- Esc：确认态下第一次 Esc 由 `confirmStep` 的 `keydown` 处理（`preventDefault`，只撤确认），第二次 Esc 才关对话框。实施时在 Chrome 156 上实测这个顺序，不成立就在 `cancel` 事件里判断确认态。

**默认组合在用时**（第 10 节第 3 条）：

- 按钮照常显示，不加 `disabled`，改加 `aria-disabled="true"`。它能拿到焦点，读屏会读“隐藏，不可用”。
- 按钮的 `aria-describedby="dlg-remove-reason"`；`#dlg-remove-reason` 可见，紧贴在按钮下方，文案沿用 `engine_in_pair_hide` / `engine_in_pair_delete`，句子补上出路（见第 5 节），例如“默认组合在用，不能隐藏。先在‘默认组合’里换成别的引擎。”
- 拦截点：`#dlg-hide` 的处理函数开头判断 `aria-disabled`；`confirmStep` 的 `click` 监听开头加一行 `if (btn.getAttribute("aria-disabled") === "true") return;`（`ui.js` +1 行）。键盘的 Enter / Space 激活按钮时浏览器派发的也是 `click`，所以这两处就够了。对话框打开期间别的页面改了默认组合，按钮状态可能过期，这时 `edits.js` 的校验会拒绝，并经 `#notices` 提示原因。
- 不在默认组合里时去掉 `aria-disabled` 和 `aria-describedby`，`#dlg-remove-reason` 隐藏并清空文字（`engine-list.js` 里现有的 `clearI18nText`）。
- 行上不再重复原因：行上已有“默认左侧/默认右侧”标签说明占用关系，行上也没有隐藏/删除按钮。
- 全是可见文字，不靠 `title` 和悬停，满足 ui-refresh §5 的初衷。

**焦点**：

- 隐藏：`dlg.close()` 把焦点还给 `#edit-<id>`，随后这一行消失。`actions.hide` 去掉 `onRow` 判断，一律把焦点交给提示里的“撤销”（隐藏现在只能从对话框发起；而对话框开着时这一行若被重渲染过，Chrome 还焦点的目标已经脱离文档，`onRow` 会误判为假）。`undoHide` 的焦点目标从 `remove-<id>` 改成 `edit-<id>`。
- 删除：`deleteWithFocus` 在 `run()` 之前读行列表（这时行还在），删完把焦点交给相邻行 `.row-actions` 里第一个可用按钮，也就是相邻行的“编辑”；没有相邻行就交给 `#add-engine`。逻辑不用改，前提是 ↑↓ 从 T1 起就不在 `.row-actions` 里（3.1，放在 `.row-move`）：否则 T1 里焦点会落到相邻行的 ↑ 上。
- 保存：`dlg.close()` 还焦点给 `#edit-<id>`，重渲染后 `focusAfterRender("edit-<id>")` 再还一次。

### 3.4 轮换开关搬到快捷键卡

`options.html` 的快捷键卡在 `#shortcut` 之后加 `<div id="cycle"></div>`。放在 `#shortcut` 之外，`refreshShortcut` 重画那一行时不会冲掉它。

```
快捷键
在 Split Search 打开的拆分视图里按快捷键，右侧会换成下一个参与轮换的引擎（在下面选）……
当前快捷键  未设置                                   [设置快捷键]
▸ 参与快捷键轮换：已选 5 个，共 5 个                  ← summary，默认收起
  ┌ 按引擎列表的顺序轮换，跳过没勾选的引擎和当前左侧引擎。 ← legend
  [x] Google  [x] Bing  [x] DuckDuckGo  [x] Perplexity  [x] Kagi
```

- `shortcut.js` 新增 `renderCycleList(ctx)`（从 engine-list.js 搬来复选框代码），整个快捷键卡的内容都归这个文件。`options.js` 的 `render()` 在 `renderEngineList` 之后加一行 `$("cycle").replaceChildren(renderCycleList(ctx))`，在 `focusAfterRender` 之前，所以改了开关后焦点仍回到 `#cycle-<id>`。
- 结构：`disclosure("shortcut-cycle", ["options_cycle_title", on, all], h("fieldset", { class: "cycle-list" }, ht("legend", { class: "hint" }, "options_cycle_hint"), …))`。每一项是 `label.check-row` 包住 `input#cycle-<id>` 和引擎名。可见文字就是可访问名称，`engine_cycle_aria` 不再需要。
- 只列 `cfg.engines`（可见的文字引擎），与 `lib/cycle.js` 的 `cycleCandidates` 一致；顺序跟随引擎顺序，也就是轮换顺序。以图搜图引擎不在里面（图片查询对的轮换不看 `cycleExclude`）。
- summary 带计数（`on` = 不在 `cycleExclude` 里的可见引擎数，`all` = 可见引擎数），不用复数形式。一律默认收起（第 10 节第 4 条），收起时状态也看得到；行上的“不参与轮换”标签是第二个入口。
- `disclosure()` 的 `titleKey` 改为也接受 `[key, ...subs]`：`ht("span", null, ...[].concat(titleKey))`（`ui.js` 改 1 行）。展开状态按 id 记在 `openIds`，跨重渲染保留。
- 写入不变：`change` 时 `actions.setCycle(id, checked)`，立即写 `cycleExclude`，成功不提示。
- 快捷键默认不绑定，绑之前这些开关不起作用，默认收起不损失信息。

### 3.5 样式（`src/options/options.css`）

- `hidden` 与 `display`：`options.css`、`tokens.css` 都没有全局的 `[hidden] { display: none }`，作者样式里的 `display` 会盖过 UA 的 `hidden`。本批会切换 `hidden` 的元素（`#dlg-danger` 及其中三个、`#engines-reorder`、`#catalog-open`、`#add-engine`、两段说明）里，只有 `.dlg-danger` 写了 `display`，所以它的规则一律写成 `:not([hidden])`。不加全局 `[hidden]` 规则：影响面是整页，超出本批。以后给会切换 `hidden` 的元素写 `display` 同样加 `:not([hidden])`。
- 删除：`.row-reason` 及 560px 下的 `.row-reason`、`.cycle-row`。`.btn-icon` 保留（排序模式的 ↑↓ 还用）。
- 引擎行单行（限定 `#engines`，以图搜图列表不受影响）：`#engines .engine-side { flex-direction: row; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px 10px; }`；560px 下 `#engines .engine-side { justify-content: flex-start; }`。共用的 `.engine-side` 规则不改。`.row-move` 并进现有的 `.perm-line, .row-actions` 两条规则（平时与 560px 下）。
- 排序模式：`#engines .engine-list.reordering .engine-row { align-items: center; }`（行里没有第二行内容，按钮与名称对齐）。其余显隐由 JS 处理，不写隐藏规则。
- `.sr-only`：标准的视觉隐藏写法（`position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;`），不涉及颜色。
- 禁用外观统一：`.btn:disabled, .btn[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }`；`.btn:hover:not(:disabled)`、`.btn-primary:hover:not(:disabled)`、`.btn-confirm:hover:not(:disabled)` 三处补 `:not([aria-disabled="true"])`。
- 对话框：`.dialog-actions` 加 `flex-wrap: wrap; align-items: flex-start;`；`.dlg-danger:not([hidden]) { margin-inline-end: auto; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; flex: 1 1 220px; }`；`#dlg-remove-reason { margin: 0; font-size: 12px; max-width: 40ch; }`。es 下原因换行可以，按钮不溢出（I18N 守着）。
- 轮换清单：`.cycle-list { border: 0; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 4px 18px; }`；`.cycle-list legend { padding: 0; margin-bottom: 4px; }`；`.cycle-list .check-row { margin-top: 0; }`。

### 3.6 文件与行数

| 文件 | 改动 | 改后估计 |
|---|---|---|
| `src/options/engine-list.js`（202） | 删行内隐藏/删除、原因、复选框（约 −25）；↑↓ 改进 `.row-move`（T1，±1），T2 搬到 reorder.js（约 −7）；`renderEngineList` 开头调 `syncReorder`、加 `reordering` 类（+2）；按模式分支、编辑按钮 id 与 aria-label、“不参与轮换”标签（+8）；`openEngineDialog` 设危险区与原因、新增模式全藏（+22）；`setupEngineDialog` 绑 `#dlg-hide`、`#dlg-delete`，含 `engine` 为空的判断（+16） | 约 218 |
| `src/options/reorder.js`（新） | 模式状态、`setupReorder`、`syncReorder`、`moveButtons`、`announceMove`、卡上的 Esc 退出 | 约 70 |
| `src/options/edits.js`（200） | 新增纯函数 `reconcileOrder`、`movePosition`、`siblingMoveId`（+14） | 约 214 |
| `src/options/shortcut.js`（16） | 新增 `renderCycleList`（+25） | 约 41 |
| `src/options/actions.js`（188） | `move` 的 `base` 经 `reconcileOrder`、返回新顺序（+2）；新增 `flushOrderNow`（+4）；`hide` 去掉 `onRow`（−2）；`undoHide` 焦点改 `edit-<id>`（±0） | 约 192 |
| `src/options/options.js`（197） | `focusAfterRender` 加 `move-` 回退与 `#add-engine` 兜底（+3）；`i18nReady.then` 里调 `setupReorder`（+1）；`render()` 加一行 `#cycle`（+1）；导入（+1） | 约 203 |
| `src/options/ui.js`（260） | `confirmStep` 判断 `aria-disabled`（+1）；`disclosure` 接受 `[key, ...subs]`（±1） | 约 261 |
| `src/options/options.html`（176） | 卡头 `#engines-reorder`、`#engines-reorder-hint`、`#engines-status`（+3）；快捷键卡 `#cycle`（+1）；对话框危险区（+5） | 约 185 |
| `src/options/options.css`（320） | 见 3.5（删约 5，加约 18） | 约 333 |
| `src/_locales/*/messages.json` ×4 | 见第 5 节 | — |

`src/ui/icons.js` 不动。不加存储键，不加权限，不加图标，`src/lib/` 不变。

## 4. 无障碍

- 平时引擎卡的 Tab 停靠点从 28 降到 13（卡头 3 + 行内 10），这也是对 critique 中“引擎区没有跳过手段”的主要回应。
- 排序：Tab 到“调整顺序”→ 回车，读屏读出操作说明 → Tab 到某一行的“下移 Google”→ 连按回车，每次播报“Google：第 N 位，共 5 个”，焦点一直在同一个按钮上，到底后自动换到“上移 Google”→ Esc（焦点在引擎卡里任何地方都行，包括“完成”本身）或回到“完成”回车，焦点回到“调整顺序”，顺序已保存。
- 删除：编辑 → Tab 到“删除” → 回车，对话框里删除按钮下方的 `#dlg-delete-hint`（`role="status"`，按钮的 `aria-describedby` 指向它）播报“再点一次就会删除……” → 再回车。不经 `#notices`：模态对话框打开时对话框外的内容是 inert，`#notices` 不进无障碍树、也压在 `::backdrop` 下面（T1 审查第 1 轮）。失焦或 Esc 复原。
- 隐藏：编辑 → “隐藏” → 焦点落在提示的“撤销”上，回车撤回，焦点回到这一行的“编辑”。
- 默认组合在用：Tab 能停在“隐藏/删除”上，读屏读出“不可用”和原因；视觉上是变灰按钮，下面一行可见原因，原因里写了出路。
- 五个“编辑”的可访问名称各不相同（“编辑 Google”……）；↑↓ 的名称照旧带引擎名。
- 轮换：Tab 到 summary → 回车展开 → 逐个复选框按空格；`fieldset` + `legend` 给出分组名。部分读屏快速 Tab 时不读 legend，单个复选框只读到引擎名，实施时用 ChromeVox 抽查一次。
- 对话框（编辑模式）内 Tab 顺序：名称、网址、隐藏/删除、取消、保存，共 5 个，DOM 顺序与视觉顺序一致。
- 状态仍靠图标加文字，不只靠颜色；“不参与轮换”是文字标签；排序模式的状态靠按钮文字（调整顺序/完成）和说明文字，不只靠按钮颜色。

## 5. 文案

四种语言同时改，按 CLAUDE.md“文案”流程：zh_CN 源文案先定稿（lieflat-less-ai-tone + humanizer-zh），再按市场转写 en（humanizer）、zh_TW（humanizer-zh + 台湾用语）、es（content-l10n + 母语审校，用 tú）。术语以 `docs/i18n/chrome-terms.md` 为准。下面只给 zh_CN 草稿。T1 先给其他三种语言写可用的临时译文（`test/i18n-catalog.test.js` 要求 key 对齐），T2 统一定稿。

**删除（2 个）**：`engine_cycle_label`、`engine_cycle_aria`（复选框不在引擎行了，分组名由 legend 给出）。

**新增（8 个）**：

| key | zh_CN 草稿 | 说明 |
|---|---|---|
| `engine_edit_label` | 编辑 $NAME$ | 编辑按钮的 aria-label，必须以 `engine_edit` 的文字开头 |
| `engine_tag_no_cycle` | 不参与轮换 | 行上的中性标签 |
| `engine_reorder` | 调整顺序 | 引擎卡头的按钮 |
| `engine_reorder_done` | 完成 | 排序模式中同一个按钮的文字 |
| `engine_reorder_hint` | 用每行的“上移”“下移”调整顺序，改动会自动保存。下拉框里引擎的先后和快捷键轮换都按这个顺序。 | 模式中的卡头说明，也在进入模式时播报。description 写明：引号里的“上移”“下移”必须与 `engine_move_up`、`engine_move_down` 逐字一致 |
| `engine_moved` | $NAME$：第 $POS$ 位，共 $TOTAL$ 个 | 只给读屏（`#engines-status`）；不用复数形式 |
| `options_cycle_title` | 参与快捷键轮换：已选 $ON$ 个，共 $ALL$ 个 | summary；各语言避开复数变化（en 可写 “Shortcut rotation: $ON$ of $ALL$ selected”） |
| `options_cycle_hint` | 按引擎列表的顺序轮换，跳过没勾选的引擎和当前左侧引擎。 | legend |

**修改（4 个，文字变）**：

- `options_engines_hint`：去掉“排序决定下拉框里的顺序”（挪进 `engine_reorder_hint`），改成“左侧引擎的网站必须授权，右侧建议授权。隐藏和删除在‘编辑’里，排序在‘调整顺序’里。”以批次 A 的定稿为底。description 写明：引号里的“编辑”“调整顺序”必须与 `engine_edit`、`engine_reorder` 逐字一致（仿现有 `options_shortcut_hint` 对按钮文字的说明）。T1 时还没有“调整顺序”按钮（`engine_reorder` 是 T2 加的），T1 先写成“……隐藏和删除在‘编辑’里。排序决定下拉框里的顺序。”，description 只对 `engine_edit`；T2 改成上面的终稿并补上对 `engine_reorder` 的说明。
- 这两条引用按钮文字的说明（`options_engines_hint`、`engine_reorder_hint`），T2 四语定稿时逐语言核对引号里的文字与对应 key 一致；T1 的临时译文同样照对应 key 的当前译文写。
- `options_shortcut_hint`：不再引用行内复选框的文字，改成“……右侧会换成下一个参与轮换的引擎（在下面选）。快捷键默认未设置，点‘设置快捷键’到 Chrome 的‘键盘快捷键’页面设置。”description 去掉“必须与 engine_cycle_label 一致”。保留 Chrome“键盘快捷键”页名，`test/i18n-pak.test.js:63` 检查它。
- `engine_in_pair_hide`：“默认组合在用，不能隐藏。先在‘默认组合’里换成别的引擎。”
- `engine_in_pair_delete`：“默认组合在用，不能删除。先在‘默认组合’里换成别的引擎。”“默认组合”与卡片标题 `options_pair_title` 一致。两条 description 改成“编辑对话框里不可用的隐藏/删除按钮下方”。

**只改 description（文字不变）**：`engine_hide`、`engine_delete`、`engine_delete_confirm`（按钮在编辑对话框里）；`engine_move_up`、`engine_move_down`、`engine_move_up_label`、`engine_move_down_label`（只在“调整顺序”模式里出现）。

**沿用**：`engine_edit`、`engine_delete_confirm_hint`、`notice_hidden`、`notice_order_save_failed`、`common_undo`、`options_dlg_title_edit`。

## 6. 全新安装的 Tab 停靠点

**算法**：全新安装（没有 `setupDone`、没有任何 host 授权、默认组合 google｜bing、五个预置引擎、快捷键未绑定、`cycleExclude` 为空、界面英文），不在排序模式，所有 `<details>` 保持默认（收起），对话框和提示都没打开。按 DOM 顺序数顺序焦点导航能停的元素：可见、没有 `disabled`、`tabindex ≥ 0` 的 `a[href]`、`button`、`input`、`select`、`summary`；`hidden` 的、收起的 `<details>` 里的（只算 summary）、关着的 `<dialog>` 里的都不算；`tabindex="-1"` 的标题和状态行不算；`aria-disabled` 的按钮算（它能聚焦，但全新安装时没有）。

| 区块 | 改前 | 改后 |
|---|---|---|
| 语言下拉框 | 1 | 1 |
| 开始使用卡（第 1 步授权、两个复制、“详细步骤”链接；“试一下”禁用不算） | 4 | 4 |
| 默认组合卡（2 个下拉框 + 窄窗口复选框） | 3 | 3 |
| 添加到 Chrome（默认组合、其他组合、5 步说明、注意事项四个 summary） | 4 | 4 |
| 右键查询卡（2 个下拉框 + 2 个按钮 + 说明 summary；Lens 内置，没有删除按钮） | 5 | 5 |
| 引擎卡头（引擎库、新增；改后多“调整顺序”） | 2 | 3 |
| 引擎行 | 26 | 10 |
| 已隐藏列表（空） | 0 | 0 |
| 快捷键卡（设置快捷键；改后多一个轮换 summary） | 1 | 2 |
| **合计** | **46** | **32** |

引擎行改前逐行：Google 授权、↓、编辑、轮换 = 4（↑ 和隐藏禁用）；Bing 授权、↑、↓、编辑、轮换 = 5（隐藏禁用）；DuckDuckGo、Perplexity 各 6；Kagi 授权、↑、编辑、隐藏、轮换 = 5（↓ 禁用）；合计 26。改后每行授权 + 编辑 = 2，合计 10。

公式：改后合计 = 其他卡片 17 + 引擎卡头 3 + 快捷键卡 2 + Σ每行（未授权 ? 1 : 0）+ 引擎数 = 22 + 5 + 5 = 32。完成第 1 步授权后（google、bing 已授权）：卡里的授权按钮消失（−1）、“试一下”变成可用（+1）、两行的授权按钮消失（−2），是 30。

整页 46 → 32（−30%），引擎卡 28 → 13（−54%），引擎卡加快捷键卡 29 → 15。排序模式中整页是 28（卡头只剩“完成”，行内 8）。critique 记的 62 按这个算法复算不出来：把禁用元素和关着的对话框里的控件也算上约 63，推测当时是这个口径。所以这里只报同一算法下的前后对比。

实测（T3）：用 CDP 在一次性临时配置（同 `pack --smoke` 的做法：无头、`--disable-sync`、用完即删，不碰 e2e 测试配置和真实配置，只关自己起的浏览器）里按上面的状态打开设置页，`Input.dispatchKeyEvent` 发 Tab，记 `document.activeElement`，回到起点为止。改前装 `git archive c579369 src` 导出到草稿目录的 `src/`，改后装当前 `src/`，各走一次；再在改后版本里进排序模式走一次。结果和算法一起写进 `docs/acceptance-v0.4.md`。不做常驻 e2e 断言（第 10 节第 6 条）。

## 7. e2e 与测试

grep 命中（`scripts/e2e/`：`data-move`、`moveBtn`、`remove-`、`cycle-`、`engine_hide`、`engine_delete`）：`optpage.mjs` 的 PRELUDE、`options-b.mjs`（B7、B10）、`options-b2.mjs`（B12、B13）、`v03-options.mjs`（B17(c)）。另有只读 `.perm` / `engine_grant` / `engine_edit` 的 `b4.mjs`、`v03-options.mjs`（B16）、`options-b.mjs`（B11）、`i18n.mjs`，以及只看右键查询卡的 `v04-options.mjs`、`v04-i18n.mjs`（`.engine-row` 是以图搜图列表，`remove-image-<id>` 不受影响）。`test/e2e-*.test.js` 没有命中。

注意 e2e 的存储基线（`test/e2e-ext.test.js:86`）：默认组合是 `ea｜eb`（模拟引擎，自定义），不是 google｜bing；没有 `cycleExclude`。

### 7.1 要改的步骤

**T1 改**：

- **`optpage.mjs`**：新增 Node 侧帮手 `openEdit(page, id)`：点 `#edit-<id>`，等 `#engine-dialog` 的 `open` 为真。`row`、`ids`、`READY` 不变。
- **B7**（`options-b.mjs:121-166`）：删除改成 `openEdit("baidu")` → 点 `#dlg-delete` 一次，断言文字是 `engine_delete_confirm`、行还在、对话框还开着 → 再点一次 → 行消失、对话框关闭、焦点在相邻行（baidu 在末尾，即前一行）的 `#edit-<id>` 上（T1 里前一行还有 ↑↓，但它们在 `.row-move` 里，不在 `.row-actions` 里，见 3.1；T1、T2 同一条断言）。顺带断言：先打开一次自定义引擎的编辑对话框、取消，再打开“新增引擎”，这时 `#dlg-danger`、`#dlg-hide`、`#dlg-delete`、`#dlg-remove-reason` 都不可见；行内没有 `engine_delete` 按钮。可见性一律用 `el.checkVisibility()` 判断，不读 `.hidden`（属性在、作者样式盖掉它时 `.hidden` 会假通过，见 3.5）。授权按钮高亮和 `perm-optional` 的断言不变；字段顺序断言（`#engine-form input`）不受危险区影响。约 +6 行。
- **B10**（`options-b.mjs:206-235`）：probe 改为逐个 `openEdit`，读 `#dlg-hide`/`#dlg-delete` 中可见那个（按 `checkVisibility()` 挑，`#dlg-remove-reason` 是否可见同样这样判断）的 `aria-disabled`、`disabled`、`aria-describedby`，以及 `#dlg-remove-reason` 是否可见和文字，然后点“取消”。断言：当前默认组合 ea｜eb 的删除按钮可见、没有 `disabled`、`aria-disabled="true"`、`aria-describedby="dlg-remove-reason"`、原因等于 `engine_in_pair_delete`；点一下没有效果（文字没变成 `engine_delete_confirm`、行还在、`customEngines` 没变）；ec、ddg 没有 `aria-disabled`、原因隐藏。切到 Google｜Bing 后，google、bing 的隐藏按钮同样 `aria-disabled`、原因等于 `engine_in_pair_hide`，点一下行还在。第 226 行的等待条件改成等 `row("google")` 出现 `engine_tag_default_left` 标签。另断言列表里没有 `.row-reason`。`options-b.mjs` 现在 262 行，改完若超过 300 就把 B10 搬到 `options-b2.mjs`。约 +18 行。
- **B12**（`options-b2.mjs:8-39`）：隐藏改成 `openEdit("ddg")` → 聚焦并点 `#dlg-hide`；撤销后的焦点断言从 `remove-ddg` 改成 `edit-ddg`（第 26 行）；第 (3) 段（第 30 行）同样经对话框隐藏。新增断言：`#edit-ddg` 的 `aria-label` 等于 `msg("engine_edit_label", name)`，行内没有 `engine_hide` 按钮。约 +6 行。
- **B17(c)**（`v03-options.mjs:220-233`）：子项名改成“(c) 快捷键卡的轮换开关写入 cycleExclude”。点开关前先展开 `#cycle details`；新增断言 `#cycle-ec` 在快捷键卡（`[aria-labelledby=shortcut-title]`）的 `fieldset` 里、label 文字是引擎名；关掉 ec 后 summary 计数少 1、`row("ec")` 出现 `engine_tag_no_cycle` 标签、重渲染后 `<details>` 仍展开；`cycle-ec` 的 id 和写入断言不变。约 +8 行。
- **I18N**（`i18n.mjs`，230 行）：本来就会展开所有 `details.disclosure`（`OPEN_ALL`），轮换清单自动纳入溢出检查。新增 `engineDialog(ctx, opt, locale)`（仿 `catalogDialog`，`audit({ scope: "#engine-dialog ", … })`）：每种语言打开 ea 行（默认组合里的自定义引擎：删除按钮 `aria-disabled` 加原因）和 ddg 行（预置引擎：可用的隐藏按钮）的编辑对话框各一次，核对没有原样 key、底栏不溢出、“隐藏”“删除”按钮不换行（`lineProblems`），es 最长；截图 `<locale>-engine-dialog.png`。约 +15 行。

**T2 改**：

- **`optpage.mjs`**：PRELUDE 的 `moveBtn` 改成按 id 找：`moveBtn = (id, dir) => document.getElementById("move-" + dir + "-" + id)`，注释第 11 行跟着改。新增 Node 侧帮手 `setReorder(page, on)`：按 `#engines .engine-list.reordering` 判断状态，不符就点 `#engines-reorder`，等状态翻过来。
- **B13**（`options-b2.mjs:41-85`）：整段重写，标题改成“调整顺序模式：移动后焦点与播报、完成时立即保存、刷新后保持、另一页自动刷新且不退出模式”。流程：
  1. p1 `setReorder(true)`：断言 `#engines-reorder` 文字是 `engine_reorder_done`、`#add-engine`/`#catalog-open` 不可见、`#engines-reorder-hint` 可见（可见性都用 `checkVisibility()`）、行里没有 `.perm`、`.row-actions` 和 `#edit-<id>`、`#engines-status` 文字等于 `engine_reorder_hint`。
  2. `x = start[1]`，`total = start.length`：聚焦并点 `#move-up-<x>` → 等 `ids()[0] === x`，断言焦点落在 `#move-down-<x>`（↑ 已禁用，回退）、`#engines-status` 等于 `msg("engine_moved", name, 1, total)`；再点一次 `#move-down-<x>`（第一次下移）→ 等 `ids()[1] === x`，断言焦点仍在它上面、播报是第 2 位。
  3. 第二次下移和点“完成”在同一段页内脚本里连着做：脚本点 `#move-down-<x>`，等页内 `ids()[2] === x`（最多 2 秒），读出此刻的 `document.activeElement.id` 和 `#engines-status` 文字，再点 `#engines-reorder`，把读到的两项和点击时刻一起返回。Node 侧断言：点“完成”前焦点在 `#move-down-<x>`、播报是第 3 位；点击后 400 ms 内（短于 500 ms 防抖）`storage.sync.order` 已等于 `want = [start[0], start[2], x, ...start.slice(3)]`（验证立即写）；焦点在 `#engines-reorder`，文字是 `engine_reorder`，列表没有 `.reordering`。
  4. `p1.reload()` 后顺序等于 `want`、不在排序模式。
  5. p1 再 `setReorder(true)`；p2 打开，`setReorder(true)`，把 x 上移一位，焦点放在 ↑ 上按 Esc（派发 `keydown`）退出；从 Esc 起计时，p1 在 4 秒内自动刷新成 `want2`，阈值 2 秒（Esc 退出时立即写，不含防抖），且 p1 仍在排序模式（`.reordering` 还在）。
  6. p1 焦点放在“完成”（`#engines-reorder`）上按 Esc：退出模式，焦点仍在 `#engines-reorder`（监听挂在整张卡上，见 3.2）。
  约 +36 行（现 105 行）。
- **I18N**：每种语言再进一次排序模式（`#engines-reorder`），查一次页面溢出和原样 key，再退出。约 +5 行。

### 7.2 不用改

B4（`.engine-row[data-id] .perm` 不变，且不在排序模式）、B8、B11（照旧按 `engine_edit` 点编辑）、B16（行上的授权按钮保留）、B18 与 v04-i18n（只看右键查询卡，新样式限定在 `#engines` 下）、B19、I18N 的 rapidSwitch（`data-i18n="engine_edit"` 还在）、B14（对话框与卡片配色不变，深色截图会变）。改完都回归跑。

### 7.3 单元测试

- `test/options-ui.test.js`：`confirmStep` 遇到 `aria-disabled="true"` 时点击不进入确认态、不调用 `onConfirm`，去掉后照常（T1）；`disclosure` 接受 `[key, ...subs]`，summary 文字带参数（T1，测试替身支持 `details` 时）。约 +15 行。
- `test/options-edits.test.js`（T2）：`moveId` 现在没有测试，补上（上移、下移、越界和找不到时返回同一个数组）；新的纯函数一起测：`reconcileOrder`（没有 pending 时返回 ids；pending 的先后保留；ids 里缺的按原顺序补到末尾，即防抖期内刚恢复的引擎；pending 里已不可见的 id 去掉）、`movePosition`（位置从 1 起、总数、找不到返回 null）、`siblingMoveId`（up ↔ down，非 `move-` 的 id 返回 null）。约 +35 行。不另建 `options-reorder.test.js`：`reorder.js` 只剩带 DOM 的部分（`announceMove` 只写 `#engines-status`），由 B13 覆盖。
- `test/i18n-catalog.test.js:186`：带名 aria 对照表去掉 `["engine_cycle_aria", "engine_cycle_label"]`，加 `["engine_edit_label", "engine_edit"]`（T1）。
- `test/i18n-pak.test.js:63`：不改，新的 `options_shortcut_hint` 仍要含 Chrome“键盘快捷键”页名。
- `test/ui-icons.test.js`、`test/popup-css.test.js`：不改，照跑（`.sr-only` 不用颜色）。

### 7.4 跑什么

- T1：`npm test`；`npm run e2e -- --auto-only --only B4,B7,B10,B11,B12,B16,B17,B18,I18N`。
- T2：`npm test`；`npm run e2e -- --auto-only --only B4,B7,B12,B13,B18,I18N`。
- T3：完整 `npm run e2e -- --auto-only` 与 `npm run pack -- --smoke`。

## 8. 文档

- `docs/acceptance-v0.4.md`：B7、B10、B12、B13、B17 的新口径（删除和隐藏在编辑对话框里、组合在用时 `aria-disabled` 加可见原因、排序在“调整顺序”模式里、轮换在快捷键卡）；第 12 行“只跑……”加本批的步骤清单；加一节 Tab 停靠点（第 6 节的算法与 CDP 实测数）。
- `docs/acceptance-v0.1.md:65、68` 的 B10、B13 描述，`docs/acceptance-v0.3.md:27` 的 B17 描述。
- CLAUDE.md“目录与职责”：`engine-list.js`（去掉“每个引擎的参与快捷键轮换开关”，写明编辑对话框里有隐藏/删除）、新增 `reorder.js`（“调整顺序”模式）、`shortcut.js`（快捷键卡：绑定状态与轮换清单）、`ui.js`（`confirmStep` 认 `aria-disabled`）、`edits.js`（加排序的纯函数 `reconcileOrder`、`movePosition`、`siblingMoveId`）。
- 截图：重拍 `assets/raw/en/options-engines.png`（同 captions 里的环境与状态：私有 Xvfb、Chrome 156、全新临时配置、五个预置引擎都授权、没有 `setupDone`；行变矮、没有复选框和原因行，卡头多“调整顺序”，说明换成新句子），视情况重拍 `options-fullpage.png`（快捷键卡多一个收起的 summary）。更新 `assets/raw/captions.md` 的说明、行分隔线坐标，加“第六次重拍”一段；第 106 行“多一行空白”的问题随之消失，那段注释一并更新。
- 裁切：各行等高后，分段裁切可能不再需要。重新量行分隔线，重算 `assets/templates-v2/store-4-engines.html:27-29` 和 `promo-marquee.html:39-40` 的坐标（能合并成整块就合并），同步改两份模板里的注释和 `assets/templates-v2/README.md:37-38` 的表格；`node scripts/store/render-assets.mjs --locale en` 重出图，核对渲染器没报溢出。`assets/templates/store-4-engines.html` 的 `data-crop-en` 不用改：en 商店图走 v2 模板（`scripts/store/template-sets.mjs`），其他语言的图有意停在旧版（CLAUDE.md“文案”末条）。
- `docs/store/` 的商店详情与隐私政策：存储键和语义不变，不用改（隐私政策只说“哪些引擎参与快捷键轮换”，不涉及界面位置）。

## 9. 实施顺序

前提：批次 A 已提交（本地标签 v0.4.0 = c579369），本批以当前 HEAD 为底。在 main 上做，不推送；每个任务完成后由另一个子代理审查再提交。T1、T2 各自更新并跑自己改到的 e2e 步骤。

**T1 编辑对话框隐藏/删除 + 引擎行精简 + 轮换清单搬快捷键卡**

1. 先写测试：`confirmStep` 的 `aria-disabled`、`disclosure` 的参数、`i18n-catalog` 对照表。
2. `ui.js`：`confirmStep` 判断、`disclosure` 接受 `[key, ...subs]`。
3. 编辑对话框：`options.html` 危险区；`engine-list.js` 的 `openEngineDialog`（新增模式四个元素全藏）/`setupEngineDialog`（`engine` 为空时直接返回）；`actions.js` 的 `hide`、`undoHide`；`options.css` 的对话框（`.dlg-danger:not([hidden])`）与 `aria-disabled` 样式。
4. 引擎行：删行内隐藏/删除、原因、复选框；编辑按钮 id 与 aria-label；“不参与轮换”标签；`#engines .engine-side` 单行样式。↑↓ 这时仍留在行上（T2 再搬进模式），但从 `.row-actions` 挪进 `.engine-side` 里单独的 `.row-move`（3.1），`.row-actions` 只剩编辑；`actions.js:152` 的注释跟着改。
5. 快捷键卡轮换清单：`shortcut.js`、`options.js`、`options.html`、`.cycle-list` 样式。
6. 文案：删 2 个、新增 `engine_edit_label`、`engine_tag_no_cycle`、`options_cycle_title`、`options_cycle_hint`，改 4 个；zh_CN 草稿，其他三种语言临时译文。
7. e2e：`optpage.mjs` 的 `openEdit`，B7、B10、B12、B17(c)、I18N 的对话框检查；跑 7.4 的 T1 清单。

**T2 “调整顺序”模式 + 样式与图标清理 + 四语文案定稿**

1. 先写测试：`moveId`、`reconcileOrder`、`movePosition`、`siblingMoveId`（都在 `options-edits.test.js`）。
2. `reorder.js`；`engine-list.js` 的 `renderEngineList` 开头调 `syncReorder`、加 `reordering` 类，`engineRow` 按模式分支，↑↓（`.row-move`）搬过去并加 id；`edits.js` 的三个纯函数；`actions.js` 的 `move`（`base` 经 `reconcileOrder`、返回新顺序）与 `flushOrderNow`；`options.js` 的 `setupReorder` 和焦点回退；`options.html` 的卡头按钮、两段说明、`#engines-status`（后两者在 `#engines` 之外）。
3. 样式与图标清理：删 `.row-reason`、`.cycle-row`；排序模式与 `.sr-only`；确认 `arrow-up`/`arrow-down`、`.btn-icon` 仍有人用、不删；检查以图搜图列表外观不变。
4. 文案：新增 `engine_reorder`、`engine_reorder_done`、`engine_reorder_hint`、`engine_moved`；全部本批文案按第 5 节流程四种语言定稿。
5. e2e：`optpage.mjs` 的 `moveBtn`、`setReorder`，B13 重写，I18N 的排序模式检查；跑 7.4 的 T2 清单。

**T3 e2e 收尾、完整 e2e 与冒烟、CDP 实测 Tab、截图、文档**

1. 完整 `npm run e2e -- --auto-only` 与 `npm run pack -- --smoke`，修掉回归。
2. CDP 实测 Tab 停靠点（第 6 节：改前、改后、排序模式各一次）。
3. 截图重拍、裁切坐标重算、重渲（第 8 节）。
4. 文档（第 8 节）。
5. 整体审查，再跑一次 `/impeccable critique` 对比。

## 10. 已定（2026-10-27 用户）

1. **排序**：用“调整顺序”模式（mode 方案），不用编辑对话框里的“位置”下拉框，也不用 ⋮ 菜单。平时行上没有 ↑↓；进入模式后每行只留 ↑↓，退出时立即保存（3.2）。
2. **隐藏/删除并入编辑对话框**：接受。推翻 `docs/acceptance-v0.4.md` B7“删除是行内按钮”的口径和 ui-refresh §5“原因写成行内小字”的做法，多一步“编辑 → 隐藏/删除”；引擎卡说明补上指引：“隐藏和删除在‘编辑’里，排序在‘调整顺序’里”（第 5 节 `options_engines_hint`）。
3. **默认组合在用时的按钮**：可聚焦的 `aria-disabled` 按钮，下方可见原因（含出路“先在‘默认组合’里换成别的引擎”），`aria-describedby` 关联（3.3）。
4. **轮换清单**：一律默认收起，summary 带计数，行上显示“不参与轮换”标签（没绑快捷键时也显示）（3.4）。
5. **新界面元素种类**：不加本稿以外的新种类；“调整顺序”模式是用户明确选的，算例外。
6. **Tab 停靠点**：只在 T3 用 CDP 实测一次，写进验收文档，不做常驻 e2e 断言（第 6 节）。
7. **实施时机**：批准后马上实施，按第 9 节的 T1、T2、T3 在 main 上做，不推送；改完重新核对商店图 4、顶部宣传图的裁切坐标（第 8 节）。
