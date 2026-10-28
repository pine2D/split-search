# Split Search

Chrome MV3 扩展：用户在地址栏搜索，或把文字拖到标签栏时，用两个自选搜索引擎打开 Chrome 拆分视图（Split view）。

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
- 模式 B：默认引擎保持单一，只有拖拽才分屏。（已取消，任何版本都不做，2026-10-24 用户决定）
- `chrome.omnibox` 关键词和地址栏实时联想。
- 右键菜单、多语言、上架 Chrome 网上应用店（多语言与上架见 v0.2，快捷键见 v0.3，右键菜单见 v0.4，均已实现）。

**反目标（即使能用也算失败）**
- 破坏 Chrome 原生的拖拽搜索或地址栏行为，包括同步到的其他设备和无痕窗口。
- 劫持与本扩展无关的标签或新标签页。
- 使用 iframe，或修改任何网站的响应头。
- 申请 `<all_urls>` 或宽泛 host 权限、申请 `tabs` 权限、为以图搜图引擎申请 host 权限，或把查询词、选中文字、图片网址发给用户所选引擎以外的任何一方、写进 `storage.sync`（它们只进 `storage.session`）。（`web_accessible_resources` 的 `matches` 写 `<all_urls>` 不算权限申请。）
- 读取或保存页面网址、注入内容脚本。按功能分开：② 边读边查、⑧ 以图搜图不读、不存、不发 `pageUrl`/`frameUrl`；⑦ 补成分屏只在用户点工具栏图标时经 activeTab 读当前标签网址（识别结果页和关键词），不保存网址本身。不读页面里除选区和被右键图片网址以外的任何内容，不改动 Chrome 原生右键菜单项。
- 未经允许覆盖用户手动建的分屏里的页面，或用户正在读的网页（② ⑧ 的左侧是任意网页：只有记录确认是本扩展打开的那一侧才允许改写）。
- 任何界面都不提供把一次查询存成规则（“以后这类搜索都用 X”之类）：关键词规则里的词只来自用户在设置页亲手写的输入，弹窗只提供“换回”。

**路线图（方向，不承诺）**
- v0.2 多语言（en/zh_CN/zh_TW/es，页内切换，见 `docs/superpowers/specs/2026-10-24-i18n-design.md`），已随 v0.2.0 首次提交 Chrome 网上应用店（2026-10-25）。
- 模式 B 已取消（2026-10-24 用户决定），不再列入任何版本，也不要再提议。
- 新功能落地顺序（2026-10-25 用户同意）：
  - v0.3（已实现，2026-10-25 代码完成，尚未上传商店；不加权限，设计见 `docs/superpowers/specs/2026-10-25-v0.3-split-tools-design.md`）：分屏状态加固（记录绑定 `splitViewId`，不监听 `onUpdated`）→ 右侧专用引擎库（设置页一键添加的模板清单）→ 窄窗口降级 → 工具栏弹窗（换右侧引擎）与快捷键（右侧换下一个引擎，默认不绑定）。互换左右、拆开分屏用 Chrome 原生菜单，不重复做（2026-10-25 用户决定）。
  - v0.4（已实现，2026-10-25 代码完成，尚未上传商店；加 `activeTab`、`contextMenus`，设计见 `docs/superpowers/specs/2026-10-25-v0.4-read-and-search-design.md`，验收见 `docs/acceptance-v0.4.md`）：把现有搜索补成分屏（⑦，并入弹窗）→ 边读边查（②，选中文字右键，当前页留左、右侧搜索并复用）→ 以图搜图分屏（⑧）。
  - v0.5（已实现，2026-10-27 代码完成，尚未上传商店；不加权限，设计见 `docs/superpowers/specs/2026-10-27-v0.5-keyword-routing-design.md`，验收见 `docs/acceptance-v0.5.md`）：按关键词换右侧（⑥）。设置页“默认组合”卡里一个有序规则列表（`storage.sync` 的 `rightRules`），条件是“搜索里有这些词”或“搜索里有某种文字”，右侧是一个文字引擎或“默认组合的右侧（不换）”；只作用于默认组合（`_ss` 两侧都等于 `defaultPair`），go.html 在本机比对，左侧与 DNR 不变；② 右键查词、弹窗换右侧、快捷键轮换不受规则影响，⑦ 只影响建议排序。（v0.6 起规则列表在“搜索组合”tab 的规则卡里。）
  - v0.6（已实现，2026-10-27 代码完成，尚未上传商店；不加权限，设计见 `docs/superpowers/specs/2026-10-27-options-tabs-design.md`，验收见 `docs/acceptance-v0.6.md`）：设置页分成四个 tab（添加到 Chrome｜搜索组合｜搜索引擎｜右键查询；tab 状态只在网址 hash `#tab-<key>` 里，不进存储）；内容列收到 680px，说明、网址框、下拉框顶到同一条右边界，四种语言都不设行长上限；关键词规则从默认组合卡里的折叠区提成“搜索组合”里默认展开的规则卡；窄窗口选项改成开关；跨 tab 的依赖用就地提示（改了默认组合后的 `#pair-changed`）、带按钮的提示（改了引擎网址后的“查看触发网址”）、① 的 tab 标记和页内链接接上。
  - v0.7（已实现，2026-10-28 代码完成，尚未上传商店；不加权限，设计见 `docs/superpowers/specs/2026-10-28-v0.7-design.md`，验收见 `docs/acceptance-v0.7.md`）：Windows 冒烟的反馈与“去掉命中的词”。“这些词”规则可勾选“搜索时去掉这些词”（规则多一个可选 `strip: true`，只在 words 规则上）：命中的那一条带 strip 时左右两侧都搜去词后的查询，查询里只有规则词时不去；0.5、0.6 读时丢掉 `strip`，在旧版本上编辑任何规则写回会把所有规则的 strip 丢掉（接受）。设置页五个对话框点外部关闭：两个引擎库直接关；新增/编辑引擎、新增以图搜图引擎、规则三个表单没改就关，改过先弹保存确认 `#discard-dialog`（保存｜不保存｜继续编辑）；Esc 与“取消”照旧。引擎库去掉百度和“中文网站”分类（用户已加的百度属于用户数据，不动），README 与商店详情的例子改成“视频”→ YouTube，中文截图换成 DuckDuckGo ｜ Bing 重拍；默认组合卡左侧下拉框给 `leftDiscouraged` 引擎加“（建议作右侧）”；开关滑块的大小和位置从轨道推出（`3f7d07d`）。右键菜单项加图标不做（`contextMenus` 没有图标参数，图标由 Chrome 自己加）。
- 无痕窗口内分屏，需要 `incognito: "split"` 并重新设计生命周期。
- 每个引擎可配置“附加 host”，应对跨 origin 跳转。

## 开发与安装

1. 运行 `bash scripts/sync-to-windows.sh`，把 `src/` 同步到 `/mnt/d/APP/Chrome-Extensions/split-search`。
2. 在 Windows Chrome 中“加载未打包的扩展程序”，选 `D:\APP\Chrome-Extensions\split-search`。
3. 之后只用 `chrome://extensions` 的“重新加载”，不要移除重装，否则授权会丢失。

## 机制速览

```
地址栏 / 拖拽 / 右键“使用X搜索“…””
  → Chrome 用默认引擎或网站搜索拼出触发网址
  → DNR 动态规则在请求发出前把它重定向到 chrome-extension://<静态id>/go.html?u=<原始网址>
  → go.html 依次执行：
      1. 防重入：导航类型是 back_forward 或 reload 时，不自动分屏，只显示“重新执行”按钮
      2. 解析：取 location.search 中 "u=" 之后的全部文本作为原始网址（\0 未经编码，不能用 URLSearchParams.get('u')）
              → 用 URL + URLSearchParams 读出 _ss（可兼容 %2C）和左侧模板里 %s 所在参数的值作为关键词（+ 会自动还原为空格）
      2.5 关键词规则：_ss 两侧都等于默认组合时，经 lib/right-rules.js 的 ruleRight 拿关键词（规范化后的前 1000 码点）从上往下比 cfg.rightRules（mergeConfig 读时经 cleanRules 清洗，
              暂不生效的 off 规则跳过），第一条命中的换掉右侧；命中的规则是 keep（“默认组合的右侧”）或引擎就是原右侧时即停、右侧不变。ruleRight 返回 null 或 { ruleId, engine, query }（engine 为 null 即右侧不换）。
              命中的那一条带 strip（v0.7，只在 words 规则上）时，不论换不换右侧，query 都是 lib/rule-text.js 的 stripWords 去掉这条规则每个词的全部出现（判定同 matchWord，删原文对应的那段，空白并一、去首尾；只在规则匹配看的那部分（规范化后前 1000 码点对应的原文）里删，后面原样保留；去完为空、规范化与原文对不上时用原查询）后的结果，
              两侧都用它：右侧 expandTemplate(右侧模板, 去词后的查询)；去词结果与原查询不同时，左侧网址是 stripMarker(lib/trigger.js 的 replaceQuery(original, 左侧模板的 leftParam, 去词后的查询))（只换左侧 %s 所在参数的值，其他参数、顺序和 # 之后逐字保留；
              参数缺失、出现不止一次或路径型模板时抛错）；其余情况左侧网址仍是 stripMarker(original)。规则不进 DNR。规则、去词、replaceQuery 都在同一个 try 里用临时变量算，全部成功才提交。两侧记录的 query 都是真正搜的（去词后的）查询
              换了右侧时把 auto = { rule, base }（规则 id、_ss 原来的右侧 id）交给 split-actions，只写在右侧那一条记录上（只去词、右侧没换时不写）。规则或去词出任何错都退回 _ss 原来的右侧、原查询和 stripMarker(original)
              （console.error "keyword rule skipped"，不记规则、词或查询），不落进“只开左侧”。在本扩展的一对里重新搜索按新关键词重新比
      3. 窗口检查：当前窗口不能分屏（popup/app，或 Document PiP：type 为 normal、alwaysOnTop 且只有一个标签，判定经 lib/split-decision.js 的 decideFor）时 → 在一个能分屏的 normal 窗口（lastSplitWindow()）里新建一对标签组成分屏；当前标签 location.replace(左侧网址)
      4. 分屏（“本扩展的分屏”按 storage.session 里的记录判定，不按网址猜；记录形状 {peer, splitViewId, mode: split|adjacent, role: search|page|lookup, input: text|image（只有 page/lookup 有）, engine, query, rule?, base?}（rule、base 只在搜索对的右侧记录上：右侧由哪条关键词规则选的、本来的右侧引擎 id；parseRecord 只在 role 为 search、rule 合 RULE_ID、base 合引擎 id 且不等于 engine 时保留，否则两个一起丢掉、记录照常返回；writeEngine 换右侧时去掉它们；归属判定不看它们），没有 role 按 search 解析；两侧 role 要配对（search↔search 或 page↔lookup）、查询对两侧 input 相同，否则判 stale；见 lib/split-owner.js、chrome/split-state.js）：
          ├─ 窄窗口（windows.get 的 width < 960，且 narrowFallback 不为 false）：不建分屏，右侧在紧邻的后台标签打开，记 adjacent 记录；同标签再触发复用右边那个
          │   窗口变宽或关掉开关后再触发：更新右边那个，再 tabs.createSplit([左, 右]) 拼成分屏、复核后改记 split（decideSplit 返回 join；拼不成退回复用）
          ├─ 当前标签不在分屏中：tabs.create({url: 右侧, splitWithTabId: 当前, index: 当前+1, windowId, active:false})
          │                   → 然后 location.replace(左侧网址)
          ├─ 当前标签在“本扩展的分屏”中（判定见 spec 5.3；当前标签是 page 一侧时整对改写成 search 对）：tabs.update(另一侧, 右侧) → location.replace(左侧)
          └─ 当前标签在其他分屏中（含查询对的 lookup 一侧、兜底判出的 fallback-own）：在该分屏右边新建一对，原分屏两侧不动，见 spec 5.3
      5. “开始使用”完成判定：动作确实写成一对 search 记录时（split-actions 的返回值带 pair：新建分屏、相邻对、在旁边或别的窗口新开一对，以及在本扩展的一对里重新搜索；退化成普通标签、记录没写成都不带），
         跳转前经 chrome/setup-store.js 的 noteSetupPair（最多等 500 ms、从不抛错）：storage.local 的 setupDone 还不是 true，且当前标签和这一对都不在 storage.session 的 setupTryTabs（设置页“试一下”打开的标签 id）里，
         就写 setupDone: true（判定 lib/setup-state.js 的 countsAsSetup）。读写失败只记 info 日志。⑦ 补成分屏、右键查询不写；设置页只监听 setupDone 的变化
  工具栏弹窗（popup/）与快捷键 cycle-right（默认不绑定，background.js 的 onCommand）：读记录，经 chrome/right-switch.js 把右侧换成指定/下一个引擎，关键词取自记录（只在 storage.session，不进 sync，不外发）。搜索对的候选与轮换都跳过当前左侧引擎（lib/cycle.js、lib/popup-view.js）；不在本扩展分屏里时弹窗按设置进度分三档（lib/popup-view.js 的 idleView，popup/idle.js 读 storage.local 的 setupDone 和默认组合左侧引擎的授权，origin 用 lib/engines.js 的 originPattern，与设置页共用；读不出来按 ready）：setup（左侧没授权）只显示“还没设置好”（setupDone 已是 true 时 idleView 带 regrant，换成“Split Search 已无权访问 <左侧引擎>”）和主按钮“完成设置”，不显示说明、默认组合和页脚；try（已授权、setupDone 不是 true）显示说明、怎么试、“搜索没分屏就回设置页完成第 2 步”和去第 2 步的入口、默认组合缩小版和快捷键状态；ready（setupDone 为 true）同 try 去掉那一句。“完成设置”和去第 2 步先经 runtime.getContexts（TAB，不需要 tabs 权限；不用 documentUrls 过滤，它要求网址连 hash 一字不差）找已开的设置页，lib/messages.js 的 pickOptionsTab 按路径认 options/options.html（任何 hash、查询串都算），优先弹窗所在窗口里的、其次第一个；找到就同步发出 tabs.update(active)、windows.update(focused) 和 runtime.sendMessage({ type: "reveal-setup", tabId })（同一窗口换活动标签时弹窗会被立即关掉，所以三个调用不逐个 await；不等回复，没有接收者等拒绝只记 info），设置页（options/setup.js）只接受发送方是本扩展 popup/popup.html、tabId 等于 tabs.getCurrent() 的那条（广播会送到所有设置页；监听在页面脚本加载时就注册（listenReveal），不等文案；还没读到自己的标签 id 时先等那次读取，只有这时返回 true 留着回复通道），做与 #setup 相同的 reveal 后回复 { ok: true }（首次渲染前到达时定位留到去掉 loading 之后），SW 对这个 type 不回复、不记日志；没找到或切换失败退回 tabs.create 打开 options/options.html#setup。设置页显示出来（或收到 reveal-setup）后若卡片在显示，先切到“添加到 Chrome”tab（从别的 tab 切过来时写 `#tab-add`），再滚到卡片、焦点给卡片标题；卡片不显示时什么都不做，也不切 tab。查询对换的永远是 role 为 lookup 的一侧（与标签顺序无关），图片查询对在以图搜图引擎里换、轮换不看 cycleExclude。
    规则选的右侧（v0.5）：搜索对 pair.right 的记录带 rule 时，lib/popup-view.js 的 popupView 给出 auto = { base, hit }：base 经 switchTarget 解析（已隐藏、已删除或成了左侧为 null），
    hit 由 lib/right-rules.js 的 explainRule 按规则 id 和记录里的 query 在本机重算（规则已删、已改解释不出为 null；v0.7 起规则带 strip 时记录里的 query 已没有命中的词，同样为 null，不为此多存原查询或命中的词，“换回”用记录里去词后的查询、只换右侧）；popup/rule-note.js 在左右窗格下显示 #rule-note
    （popup_rule_word / popup_rule_script / 解释不出时 popup_rule_generic）和 #rule-revert“换回 <base>”（base 为 null 不显示），#choices 里去掉 base（去掉后为空也不显示 #no-choices）。
    换回就是 onSwitch(base.id)，与手动换、快捷键轮换一样经 writeEngine 去掉 rule/base；不监听 session 变化，靠 onSwitch 的 finally 重绘
  补成分屏（⑦，popup/complete.js）：弹窗经 activeTab 读当前标签网址，lib/result-match.js 认出某个文字引擎的结果页和关键词，且标签不在分屏中、不是本扩展的一对、窗口能分屏、还有别的未隐藏文字引擎可放右侧时显示“补成分屏”区（回复 plain 后本次弹窗不再提供补成）；
    建议排序经 ruleRight（result-match.js 的 ruleSuggestion：识别出默认左侧、没有 _ss 或 _ss 等于默认组合时，规则命中的引擎排第一、带 .suggested），只影响排序，不自动建对，记录不写 rule
    → 点引擎：runtime.sendMessage({ type: "complete-split", tabId, engineId })（不带网址和关键词）
    → SW 的 runtime.onMessage（return true 后 sendResponse 异步回复）：lib/messages.js 校验发送方是本扩展的 popup/popup.html、字段合法
    → 在 SW 全局串行链上执行 chrome/complete-actions.js：重新 tabs.get、重新识别、windows.get（populate）必须能分屏、inspectTab 重新判定，条件仍满足才 openRight：
       当前标签不导航，右侧在它右边后台打开（窄窗口开相邻标签记 adjacent），两侧记 search；回 { ok: true, mode: split|adjacent|plain } 或 { ok: false, code }
  右键菜单（ss-lookup-text 选区、ss-lookup-image 图片，只在 http(s) 页面、图片只认 http(s) 网址；chrome/menus.js 每次 removeAll 后重建，标题经 t()，安装、启动和 sync 任何变化时重建）：
    contextMenus.onClicked → SW 全局串行链（lib/serial.js，与 complete-split 共用；每次在链上重新 tabs.get、inspectTab 再判定）→ chrome/lookup-actions.js：
       lib/lookup-input.js 只读 selectionText/editable/mediaType/srcUrl（选区规范化后截到 500 码点，editable 不处理）→ lib/lookup-decision.js 八行判定：
       1 ignore（没有 tab、输入无效）  2 other-window（窗口不能分屏：在 lastSplitWindow() 开普通标签，不写记录）
       3 reuse-split（分屏中、own、当前标签是 page 一侧：tabs.update 查询一侧，整对改写 engine/query/input）
       4 beside-split（分屏中的其他一切情况：在分屏右边开普通标签，不写记录）
       5 reuse-adjacent / 6 join（相邻查询对的 page 一侧：窄窗口更新并激活查询标签；否则更新后 createSplit 拼成分屏）
       7 beside-pair（相邻查询对的 lookup 一侧：在这一对右边开普通标签）  8 new（其他：createPaired，记 page ↔ lookup）
       只有当前标签是查询对的 page 一侧时才改写它的 lookup 一侧，用户的页面一律不导航。
  记录在 tabs.onRemoved 时清理。读到失效记录（stale，例如拆开后又拼回去）时，只有记录里的对侧已经关掉才顺手清理；对侧还在就保留两条，这一对一直判“不是本扩展的”，不会落到兜底被覆盖。当前标签没有记录、对侧却有记录时同样判“不是”；两侧都没有记录（如浏览器重启后）时兜底仍可能判出 fallback-own，但它不允许任何调用方改写标签：decideSplit 按 foreign 处理，在旁边新开一对，原来两侧都不动（v0.4 起，取消了 v0.3 的兜底复用）。相邻对（adjacent）失效且对侧还在时（拖开、中间夹进别的标签），两条记录改写成永久失效标记（mode "split" 配 splitViewId -1），之后拖回相邻或手动拼成分屏都不再算本扩展的。记录写入在同一页面/SW 里串行执行（split-state.js 的队列）。join 时 `createSplit` 成功但复核两次（间隔 150 ms）都不一致，不写 adjacent 记录，删掉旧记录，之后按实际状态判定。兜底的路径型模板 `%s` 前只有根路径 `/` 时不认。
```

触发网址 = 左侧引擎真实搜索网址 + 标记参数 `_ss=<左id>,<右id>`，例如 `https://www.google.com/search?q=%s&_ss=google,bing`。

## 目录与职责

```
split-search/
├── CLAUDE.md                     项目约定
├── README.md                     面向用户的简介与安装（英文，默认）；README.zh-CN.md / README.zh-TW.md / README.es.md 是同结构的其他语言版，改一份四份同改，标题下的语言切换行保持一致
├── CHANGELOG.md                  更新日志（中文，Keep a Changelog 2.0.0）：每次发版的 chore: release 提交用 changelog-zh skill 加一节，与 manifest、package.json 的版本同改
├── .gitignore
├── package.json                  "test": "node --test"、"e2e": "node scripts/e2e/run.mjs"、"pack": "node scripts/pack.mjs"
├── dist/                         发布 ZIP（npm run pack 生成，不进 git）
├── docs/acceptance-v0.7.md       v0.7 验收清单（新增 e2e 步骤 T26、B22、B23，扩充的 I18N；开关滑块 A1 的本机验证记录、Windows 手测项与完整 e2e 结果）
├── docs/acceptance-v0.6.md       v0.6 验收清单（设置页分 tab：新增 e2e 步骤 B21，改写的 B4、B10、B14、B17、B19、B20、I18N、v05-i18n；路由约定、Tab 停靠点实测、impeccable 复评、手测项与下一轮）
├── docs/acceptance-v0.5.md       v0.5 验收清单（对应 e2e 步骤 T25、B20，以及扩充的 I18N、B14；快捷键轮换清标记、窄窗口透传由单测覆盖）
├── docs/acceptance-v0.4.md       v0.4 验收清单（对应 e2e 步骤 T20–T24、B18、B19，以及扩充的 B14、I18N；T5 重启期望的改动；界面翻新改写的 B2、B4、B6、B7、B12、T18、T19；界面收尾改写的 B4、B7、B8、B18、B19、I18N；引擎行精简改写的 B7、B10、B12、B13、B17、I18N 与 Tab 停靠点实测）
├── docs/acceptance-v0.3.md       v0.3 验收清单（对应 e2e 步骤 T16–T19、B16、B17、B2）
├── docs/acceptance-v0.1.md       v0.1 验收：跑 e2e（Windows 冒烟 v0.1 不做，2026-10-24 用户决定）；B/T 表注明覆盖方式
├── docs/i18n/chrome-terms.md     Chrome 术语表：各语言功能术语以此为准（由 scripts/i18n/chrome-terms.mjs 生成）
├── docs/store/                   商店详情（各语言）、隐私做法与隐私政策、图片素材规格
├── docs/_config.yml _layouts/ index.md privacy.md privacy.zh-CN.md   GitHub Pages 站点（main:/docs，Jekyll；_config.yml 的 exclude 只放行这些公开页，新增内部文档要加进 exclude）
├── assets/                       商店与 README 图片：templates/ 模板、raw/ 真实截图、store/ 与 readme/ 成品、icon-proposals/ 图标提案
├── scripts/
│   ├── gen-key.sh                打印扩展 ID；manifest 无 key 时才生成公钥写入（不保留私钥）
│   ├── pack.mjs                  发布打包：检查 → 临时目录改写 manifest（去掉 key 或换商店公钥）→ dist/ 的 ZIP
│   ├── pack-lib.mjs              打包纯逻辑：manifest 改写、发布前检查、公钥校验与扩展 ID 计算
│   ├── pack-smoke.mjs            --smoke：一次性 Chrome 配置里装 ZIP 做安装冒烟（复用 e2e 的 browser/cdp/console/fonts）
│   ├── sync-to-windows.sh        rsync src/ → D 盘镜像目录
│   ├── i18n/chrome-terms.mjs     从 Chrome 的 locales/*.pak 取各语言界面原文，生成术语表
│   ├── store/render-assets.mjs   把 assets/templates 渲染成商店与 README 图片（无头 Chrome，无依赖）
│   └── e2e/                      引导式端到端验收（Node 24，无依赖）：run.mjs 入口、cdp/browser 管道 CDP、
│                                 server.mjs 模拟引擎与向导页、runner/report、steps/*.mjs 各步骤（setup.mjs 安装/授权/Kagi 登录/收尾）、
│                                 display.mjs 嵌套显示（Xephyr/Xvfb）起停与遗留清理、fonts.mjs 测试浏览器屏蔽 9P 挂载上的字体、
│                                 settings-se/settings-kagi.mjs 网站搜索、ext-webui.mjs chrome://extensions 详情页、
│                                 ext-source.mjs 让测试配置里的扩展装自本检出的 src/、
│                                 ext-shortcuts.mjs 快捷键（chrome://extensions/shortcuts）快照与恢复，steps/v03-*.mjs、xauto-t19.mjs 是 v0.3 步骤，
│                                 steps/v04-*.mjs 是 v0.4 步骤（v04-lib 页面标记/CDP 读网址/triggerAction 与 MENU_INDEX，v04-complete(-more) T20，
│                                 v04-lookup/-lookup-image/-lookup-lib T21、T22，v04-guard T23，v04-guard-x/-guard-more T24，v04-options B18，v04-i18n 供 I18N 与 B14；b4.mjs、b19.mjs（弹窗分档子项在 b19-popup.mjs，“详细步骤”子项 detailsLink/keepsFocus/hashOpen 在 b19-guide.mjs）是设置页“开始使用”卡（B19 的 keepSetupDone 也给 B4 用）；i18n-audit.mjs 是 i18n、v04-i18n、v05-i18n 共用的页面核对工具（shoot 的 beyond 让 clip 超出视口的部分也画出来）；options-b/-b2/-b3.mjs 是设置页 B 系列，B13“调整顺序”模式在 -b3，optpage.mjs 的 openEdit/setReorder 打开编辑对话框、切换排序模式，openOptions(browser, { tab }) 在网址后接 #tab-<key>、withOptions(browser, fn, opts) 把 opts 交给 openOptions、showTab(page, key) 在已打开的页面中途换 tab）
│                                 steps/v05-*.mjs 是 v0.5 步骤（v05-lib 模拟引擎 D、ruleTrigger/expectRight、记录与隐私核对、withRulePopup，v05-rules T25，v05-rules-popup T25 的弹窗与 ⑦ 子项，v05-options B20，v05-i18n 供 I18N）
│                                 steps/b21*.mjs 是 v0.6 的 B21 设置页 tab 与宽度（b21.mjs 入口与 (a)–(e)(i)(j)，b21-links.mjs 跨 tab 链接与焦点兜底 (f)(g)(h)(h′)(k)、换语言 (m)、手改 hash (n)，b21-width.mjs 宽度 (l)，b21-go.mjs 出错页深链 (o)）
│                                 steps/v07-*.mjs 是 v0.7 步骤（v07-strip T26 关键词规则去掉命中的词（导出 WORD、STRIP_RULE、extraTrigger 等供单测），v07-dialogs B22 设置页对话框点外部（导出 clickEl、clickBackdrop、pressEsc、pointOutside、BACKDROP 供 v07-i18n 用），v07-options B23 设置页 v0.7 小改动，v07-i18n 是 i18n.mjs 每种语言调用的 v07I18nChecks）
├── src/                          扩展根目录（加载这个目录）
│   ├── manifest.json
│   ├── _locales/                 界面文案：en、zh_CN（源文案）、zh_TW、es 各一份 messages.json
│   ├── icons/                    工具栏与扩展管理页图标，16/32/48/128，配色 c6 pine-fog；16/32/48 由按像素对齐的 icon-16|32|48.svg 导出
│   ├── background.js             SW：重建 DNR 规则与右键菜单、tabs.onRemoved 清理记录、onCommand（cycle-right）、contextMenus.onClicked 与 runtime.onMessage（complete-split，二者共用一条串行链；reveal-setup 不回复、不记日志）；无 action.onClicked
│   ├── popup/popup.html|css|js   工具栏弹窗（action.default_popup）：显示关键词与左右引擎（查询对按“网页”“查询”）、换右侧、进入设置页
│   ├── popup/rule-note.js        弹窗的“按关键词换右侧”说明（#rule-note）：右侧是规则换的时说因为哪个词或哪种文字换的，加“换回 <原右侧>”按钮（走 popup.js 的 onSwitch）；只显示，不写记录、不记日志
│   ├── popup/complete.js         弹窗的“补成分屏”区：显示识别结果与右侧候选，点一个就发 complete-split 给 SW（自己不建标签、不写记录）
│   ├── popup/idle.js             弹窗的左右窗格（ui/panes.js 建）、分屏外按设置进度分三档的引导（读 setupDone 与左侧授权；“完成设置”/去第 2 步先找已开的设置页切过去并发 reveal-setup，没有或失败才新开 options.html#setup）、默认组合缩小版、底部快捷键状态
│   ├── go.html / go.js / go.css  触发处理页（解析、关键词规则换右侧（ruleRight，只换默认组合的右侧）、判定、出错页与“只打开左侧搜索”兜底；写成一对后经 setup-store 判定“开始使用”是否完成）；出错页“打开设置”按错误码经 lib/options-route.js 的 errorTab 与 chrome/options-page.js 的 openOptionsTab 进 ①（要重新复制触发网址）或 ③（要检查或重新添加引擎），其余照旧 openOptionsPage；go.css 是出错页样式
│   ├── styles/tokens.css         全部颜色变量（浅色 :root 与 @media (prefers-color-scheme: dark) 两段），设置页、弹窗、go.html 都 <link> 这一份；各界面样式表不定义颜色、不写 prefers-color-scheme
│   ├── styles/panes.css          左右窗格样式（左松绿、右暖雾灰，镜像工具栏图标），设置页与弹窗共用
│   ├── ui/panes.js               左右窗格的 DOM 构造（pane/panes），设置页的组合下拉框与弹窗共用
│   ├── ui/icons.js               内联 SVG 图标（16×16 viewBox、统一线宽、currentColor、aria-hidden），不用 Unicode 字符当图标
│   ├── options/options.html|css  设置页静态结构、引导文字与样式。页头（h1、标语、语言框）、tab 栏（`div.tablist[role=tablist]#tabs`，按钮 `#tabbtn-<key>`、名称 `#tabname-<key>`、① 的标记 `#tab-flag-add`）、四个面板 `#panel-add|pair|engines|lookup`（`role=tabpanel`、`tabindex=0`，`aria-labelledby` 指向 `#tabname-<key>`；静态时按钮都不选中、面板都 `hidden`，由首次渲染的 routeOnce 选一个；面板只用普通 `hidden`，不写 display 样式）、规则卡 `section#rules-card`、已隐藏引擎小标题 `#hidden-title`（没有隐藏引擎时连同列表 hidden）、页脚、`#notices` 与对话框（v0.7 起 `</body>` 前有保存确认 `#discard-dialog`：标题 `#discard-title`，按钮按 DOM 顺序 `#discard-keep`“继续编辑”、`#discard-drop`“不保存”、`#discard-save`“保存”（主按钮，`common_save`））。样式：内容列 `--page-max: 680px`，说明、网址框、下拉框顶到同一条右边界，四种语言都不设行长上限；tab 栏照 Chrome 的 cr-tabs（纯文字加主色下划线），不吸顶、没有动画；窄窗口开关 `.switch`（`border: 0`，滑块 `::after` 用 `top/bottom/left: 3px` 加 `aspect-ratio: 1` 从轨道推出大小，开启时 `left: auto; right: 3px`，不写死像素）；`.field` 里的复选框行 `.field .check-row`（flex、不加粗，复选框不占满一行）；600px 视口收窄卡片与 tab 内边距（页面左右仍 16px）；481–600px 页头标题 20px 不折行、语言下拉框可变窄（480 以下语言框换行）
│   ├── options/setup.js          设置页顶部“开始使用”卡（#setup）：授权 → 在 Chrome 添加网站搜索并设默认（按操作顺序拆成三个编号小步：复制设置地址、粘贴触发网址、设为默认，每步只带自己的复制按钮）→ 试一下；网址带 #setup 时页面显示后滚到卡片、焦点给标题（revealSetup，卡片显示时先 showTab("add")），收到弹窗发给本标签的 reveal-setup（acceptRevealSetup 校验）时同样做；自己不注册 hashchange（之后 hash 变成 #setup / #guide-steps 由 tabs.js 经 requestReveal 转来）；第 2 步末尾除“详细步骤”外还有“更换组合”（href #tab-pair，切到“搜索组合”、焦点给 #pair-left）；只读 setupDone、监听它变成 true（换成完成确认并经 #notices 播报），不判定完成；“试一下”在 tabs.create 返回后把标签 id 追加进 storage.session 的 setupTryTabs；第 2 步的“详细步骤”（href #guide-steps）左键不改 hash（卡片本来就在 ①），经 guide.js 的 revealGuideSteps 展开默认组合一段和 5 步说明、滚过去、焦点给 5 步说明的 summary；网址带 #guide-steps（中键、Ctrl+点这个链接新开的页）时，revealSetup 在页面显示后同样调一次 revealGuideSteps
│   ├── options/options.js        设置页编排：读配置、查授权、渲染、串行写入；首次渲染经 tabs.js 的 routeOnce(mode) 选默认 tab（只判一次，之后授权成功、setupDone 变成 true 都不换 tab；读配置失败时 routeOnce("hidden") 停在“搜索组合”）、setTabFlag(mode)；各面板都渲染（#pair-body 交给 pair.js，#rules-body 交给 rules.js），只切显隐，切 tab 不触发 render；去掉 loading 之后才 revealSetup；重渲染后按 id 还焦点（focusAfterRender：上移/下移变禁用时交给同一行另一个方向，找不到时交给卡头看得见的按钮；目标在别的 tab 或已消失时经 focusIn 交给当前选中的 tab 按钮）
│   ├── options/tabs.js           设置页四个 tab（WAI-ARIA APG Tabs，自动激活）：initTabs（点击委托，←/→ 循环、Home/End，焦点和选中一起移动，不处理 ↑/↓ 和带修饰键的；整个 src/options/ 只有这里注册 hashchange：#tab-* 换 tab，#setup / #guide-steps 交给 onReveal；href="#tab-*" 的页内链接左键切过去后按 data-reveal 定位）、showTab（replaceState 写 #tab-<key>，不产生历史；离开“搜索引擎”时经 onLeave 让 reorder.js 的 leaveReorder 退出并写出排序）、routeOnce（首次渲染按 lib/options-route.js 的 initialTab 选一个、不写 hash，只判一次）、setTabFlag（① 的标记：steps 是圆点加读屏“未完成”，regrant 是警示图标加“需要授权”，用类切换、不用 hidden）、focusIn（目标看得见就给它，否则给当前选中的 tab 按钮）、plainLeft（只有不带修饰键的左键才走页内定位，中键、Ctrl+点照常按 href 新开；pair.js、setup.js 复用）；模块顶层不碰 window / location / document（test/options-actions.test.js 经 actions.js 传递导入它）
│   ├── options/pair.js           “搜索组合”tab 的默认组合卡（#pair-body）：左右两个窗格（pickerPanes，只有默认组合卡用窗格；左侧下拉框 `#pair-left` 里 leftDiscouraged 的引擎写成 `t("engine_left_discouraged_suffix", 名称)`“（建议作右侧）”，与“其他组合”生成器同一个 key，右侧下拉框不加）；改了默认组合后的就地提示 #pair-changed（不设 role；steps 档说“开始使用”里的网址已按新组合更新、带“继续设置”，其余档给新组合的触发网址和“查看设置步骤”；本页内存的 { from, mode } 与保存提示经 edits.js 的 notePairChange、pairChangedView、pairSavedKey）；窄窗口开关行（名称来自 label for，说明经 aria-describedby）；左侧未授权时常驻的提示框（带 #pair-grant）；末行指向“添加到 Chrome”生成其他组合的指引（guide.js 的 revealGenerator）
│   ├── options/edits.js          设置页纯逻辑：表单校验、算出写回存储的补丁、“其他组合”生成器的初值（generatorPick：左侧取默认左侧，右侧取第一个既不是默认右侧也不是左侧的引擎，没有就退回默认右侧；用户改过且仍有效的选择保留）；排序的纯函数 reconcileOrder（防抖期内的 pendingOrder 补齐刚恢复的引擎、去掉已不可见的）、movePosition（播报用的第几位、共几个）、siblingMoveId（move-up-x ↔ move-down-x）；改默认组合后提示的纯函数 notePairChange（只记第一次改之前的组合和当时的档位）、pairChangedView（没记录、改回原组合、steps 档记下的已离开 steps 时不显示）、pairSavedKey（保存提示按改回、首次设置、其余选文案）
│   ├── options/engine-list.js    引擎列表（行上只有授权状态、授权按钮和“编辑”，关掉轮换的引擎带“不参与轮换”标签；排序模式中每行只有上移/下移）、已隐藏列表、新增/编辑对话框（编辑时底栏左边是“隐藏”（预置）或“删除”（自定义，经 confirmStep 点两次），默认组合在用时按钮 `aria-disabled` 并由 `#dlg-remove-reason` 写出原因；新增时整个危险区隐藏；点外部经 dialogs.js 的 lightDismiss，危险区按钮是 type=button、不进快照）；没授权时只有默认组合左侧是警示样式（警示图标、“未授权（必需）”），其余是中性样式（空心圆图标、灰字“未授权（可选）”，`.perm-optional`），刚保存还没授权的引擎授权按钮仍高亮
│   ├── options/guide.js          “添加到 Chrome”卡：触发网址与组合生成器；“开始使用”卡显示时（setupShown）默认组合一段收进默认收起的 `<details>`（“默认组合的触发网址”，id guide-default），5 步说明（options.html 的 #guide-steps：小标题 + 静态的 ol.steps）同样收进 `<details id="guide-steps-details">`（renderGuideSteps 只在两种外壳之间移动 ol，复制按钮和富文本跟着走；外壳已对时直接返回、不重建，免得焦点掉回 body），不显示时都照常展开；“其他组合”整段收进默认收起的 `<details>`（生成器左侧未授权时提示框里的授权按钮 id 是 gen-grant，授权成功后焦点经 options.js 的 FOCUS_FALLBACK 给 #gen-left），生成器是两个带“左侧”“右侧”标签的普通下拉框（沿用 `.lookup-pickers` 排版），初值经 edits.js 的 generatorPick，只记用户改过的选择（userGen）；urlBox 经 lib/url-break.js 在网址的 / ? & = , 之后插 `<wbr>`（只在这些位置折行）；默认组合一条的复制按钮 id 是 trigger-default-copy；revealGuideSteps 先 showTab("add")；revealGenerator（“搜索组合”末行指引：切到 ①、展开 #guide-other、焦点给它的 summary）；revealTriggers（改了引擎网址后常驻提示里的“查看触发网址”：切到 ①、默认组合一段收着就展开、焦点给 #trigger-default-copy）；模块顶层不碰 window / location / document
│   ├── options/ui.js             DOM 小工具、提示、复制按钮、host 权限查询与申请（origin 模式用 lib/engines.js 的 originPattern）；折叠区 disclosure（展开状态按 id 记在模块变量里，跨重渲染保留）；删除确认 confirmStep（点一次变成“确认删除？”，不限时，再点才执行，失焦或 Esc 复原；按钮 `aria-disabled="true"` 时点击不处理）；disclosure 的标题键也接受 `[key, ...subs]`
│   ├── options/dialogs.js        设置页对话框点外部关闭（v0.7）：纯函数 formSnapshot（按顺序 JSON 序列化各字段，checkbox/radio 取 checked，button/submit/reset/fieldset 跳过）、isBackdropClick（主键的 pointerdown 与 click 都落在对话框矩形外才算，边上算里面；在输入框里按下拖到外面松开不算）；lightDismiss(dialog, { form?, onClose }) → { mark() }：没有 form 直接 onClose，快照等于打开时 mark() 记下的就 onClose，否则打开 `#discard-dialog`、焦点给“保存”（保存 → requestSubmit 走原提交流程，校验不过表单留着；不保存 → 两个都关；继续编辑、Esc、点确认框外部 → 只关确认框，焦点回到点外部前表单里有焦点的字段，没有就给第一个字段；确认框 close 事件晚到时 `dlg.open` 为真即忽略；保存进行中（表单的提交按钮被禁用）点外部和确认框的“保存”都忽略，`requestSubmit()` 不看按钮禁用；表单对话框关掉时，还在问它的确认框一起关）；不用 `closedby="any"`（分不开 Esc 和点外部），Esc 与“取消”照旧直接关；键盘产生的 click 不算；模块顶层不碰 document / window。catalog.js、lookup.js（两个引擎库、`#image-dialog`）、engine-list.js（`#engine-dialog`）、rules.js（`#rule-dialog`）各自接上，表单在填好初值、`showModal()` 后 `mark()`
│   ├── options/catalog.js        右侧引擎库对话框（添加时不申请权限；点外部经 dialogs.js 的 lightDismiss 直接关，同“关闭”）
│   ├── options/shortcut.js       快捷键卡：显示当前绑定、打开 Chrome 快捷键页（读取与打开在 chrome/shortcuts.js，弹窗共用）；轮换清单 renderCycleList（默认收起的“参与快捷键轮换：已选 N 个，共 M 个”折叠区，每个可见文字引擎一个 `#cycle-<id>` 复选框，写 cycleExclude）
│   ├── options/reorder.js        引擎卡的“调整顺序”模式：模式状态（模块变量，跨重渲染保留，刷新回到平时）、卡头按钮“调整顺序”/“完成”与两段说明的切换、上移/下移按钮（`#move-up|down-<id>`）、`#engines-status` 播报“第 N 位，共 M 个”；点“完成”或焦点在引擎卡里按 Esc 退出并立即写 order（actions.flushOrderNow），可见引擎少于 2 个时自动退出；切走“搜索引擎”tab 时 leaveReorder({ focus: false }) 退出并写出排序、不抢焦点
│   ├── options/locale-ui.js      设置页与语言相关的界面：带内联元素的句子、语言下拉框
│   ├── options/actions.js        设置页的写入与动作：串行写入（loadRaw → 改整键 → saveKeys / removeKeys）、提示（改了默认左侧引擎网址后常驻的 notice_template_changed 带“查看触发网址”，即 guide.js 的 revealTriggers；“撤销”隐藏后的焦点经 tabs.js 的 focusIn）、各区块的 actions
│   ├── options/lookup.js         “右键查询”卡片：查词引擎、以图搜图引擎的选择与列表（前有小标题 `#image-list-title`“以图搜图引擎列表”，列表 aria-labelledby 指向它；两个按钮写明对象：“从以图搜图引擎库添加”“新增以图搜图引擎”），以图搜图引擎库与新增对话框（没有授权按钮和轮换开关；点外部经 dialogs.js 的 lightDismiss：引擎库直接关，新增对话框改过先问）
│   ├── options/image-edits.js    以图搜图引擎的纯逻辑：新增、从引擎库添加、删除、选用
│   ├── options/rules.js          “搜索组合”tab 里紧跟默认组合卡的规则卡（静态的 `section#rules-card`、`h2#rules-title`，渲染填 `#rules-body`；默认展开、卡里没有折叠区，`#rule-list` 的 aria-labelledby 指向 rules-title，“新增规则” `#rule-add` 是小按钮）：规则列表（`#rule-list > li[data-id]`，行内“编辑”“上移”“下移”，暂不生效与被挡住的词各一行说明）与规则对话框（`#rule-dialog`：“这些词”/“某种文字”单选、`#rule-words`、`#rule-script`、`#rule-engine`，“这些词”下的复选框 `#rule-strip`“搜索时去掉这些词”与说明 `#rule-strip-hint`（都在 `#rule-words-field` 里，切到“某种文字”只隐藏、保留勾选；打开时回填、提交带 strip），编辑时底栏 `#rule-dlg-delete` 经 confirmStep 点两次）；带 strip 的规则行在目标引擎后追加 `.rule-strip`（`options_rules_strip_row`，文字说明、不只靠颜色）；点外部经 dialogs.js 的 lightDismiss（带 form，改过先问）；增删改移都调 actions.js 的 addRule/editRule/moveRule/removeRule
│   ├── options/rule-edits.js     规则的纯逻辑：buildRule（只在 words 规则且 strip === true 时写 `strip: true`，取消勾选或切到 script 时不写）、addRule/editRule/moveRule/removeRule（按最新存储重新校验，另一页已删报 rule_gone，规则删光时 remove rightRules）、dropRulesFor/countRulesFor（删除自定义引擎连带删规则、引擎对话框 `#dlg-rules-hint` 的条数）、engineChoices/targetLabel（右侧下拉与行文字，含 KEEP“默认组合的右侧”）
│   ├── lib/engines.js            预置引擎、模板校验、配置合并、引擎的精确 origin 与权限模式（engineOrigin、originPattern，设置页与弹窗共用）
│   ├── lib/trigger.js            触发网址生成与解析、模板展开、replaceQuery（v0.7，去词时改写左侧网址：只换左侧 %s 所在参数的值为 encodeURIComponent(查询)，其余段、顺序和 # 之后逐字保留；按原文比参数名，参数不是恰好出现一次或网址没有 ? 时抛错）
│   ├── lib/rules.js              DNR 规则构造
│   ├── lib/right-rules.js        关键词规则（v0.5；只 import lib/rule-text.js，并 re-export 它的 normalizeText、matchWord）：parseWords、cleanRules（mergeConfig 读时清洗，标 off：hidden/missing/left；只给 words 规则保留 `strip: true`，其他值和 script 规则上的都丢掉）、hasScript（han/kana/hangul/cyrillic）、ruleRight（go.html 与 ⑦ 共用的唯一入口，返回 null 或 { ruleId, engine: Engine|null, query }：engine 为 null 即命中但右侧不换（keep 或引擎就是当前右侧）；命中的规则带 strip 时 query 是 stripWords 去词后的，否则是入参）、explainRule（弹窗重算命中）、shadowedWords、nextRuleId、rulesBytes；常量 RULE_LIMITS、RULE_ID、SCRIPTS、SCRIPT_KEYS（句中用的文字名）、SCRIPT_OPTION_KEYS（规则对话框下拉选项，es 首字母大写）
│   ├── lib/rule-text.js          关键词规则的文本处理（v0.7，无 import）：normalizeText（NFKC、小写、拉丁去变音、空白合一）、findWord（规范化查询里某个词全部不重叠出现的 UTF-16 区间：英文等端点是连写字符时按整词，中日韩泰等按子串，词内空格匹配任意空白）、matchWord（findWord 非空）、stripWords(query, words)（去掉每个词的全部出现：前 4000 码点逐码点规范化建映射，与 normalizeText 对不上就返回原查询；只看规范化后前 1000 码点，长词优先、跳过与已删区间重叠的；删原文对应码点（并进字母的组合变音符跟着删，只切到某码点产出一部分的那处不删），后接未截部分，空白并一、去首尾；什么都没删或去完为空返回原查询）；常量 QUERY_CUT = 4000、QUERY_SCAN = 1000（right-rules.js 的 RULE_LIMITS.queryScan、scanQuery 用它们）
│   ├── lib/split-decision.js     分屏动作判定
│   ├── lib/options-route.js      设置页 tab 路由（纯逻辑）：TAB_KEYS、tabHash、routeFromHash（#tab-<key> → tab；#setup、#guide-steps → 定位请求；其余含元素 id 都认不出）、initialTab（#tab-* 优先，卡片显示（steps、regrant）进 ①，否则 ②）、stepTab（方向键、Home/End 换到哪个 tab）、errorTab（go.html 错误码 → add | engines | null）
│   ├── lib/url-break.js          网址的折行点：在 / ? & = , 之后切段（连续的分隔符算一处，开头的 scheme:// 不单独成段），设置页网址框在各段之间插 `<wbr>`
│   ├── lib/split-owner.js        “是否本扩展的分屏”按记录与 splitViewId 判定；parseRecord/makeRecords 处理 search 记录的 rule?/base?（RULE_ID 与 right-rules.js 各一份，test/right-rules.test.js 比对）
│   ├── lib/narrow.js             窄窗口判定（阈值 960，宽度非数字不判窄）
│   ├── lib/window-kind.js        窗口能否分屏（splitWindowType / canSplitIn：Document PiP 不算）、PiP 获得焦点时挑哪个窗口（pickSplitWindow）
│   ├── lib/engine-catalog.js     右侧引擎库数据（内置，不来自网络；v0.7 起没有百度，也没有“中文网站”分类，每个分类至少一个条目，test/engine-catalog.test.js 守着）
│   ├── lib/image-engines.js      以图搜图引擎：内置 lens 与引擎库（bing-img、yandex-img、tineye、saucenao），纯数据
│   ├── lib/result-match.js       识别搜索结果页（⑦）：带 _ss 时只按 _ss 声明的左侧引擎认；否则比 origin、pathname、固定参数与 %s 所在参数；suggestedId 先经 ruleSuggestion → ruleRight（只影响建议排序）
│   ├── lib/messages.js           complete-split 消息校验（发送方、字段、引擎 id）；reveal-setup 校验（isRevealSetup、acceptRevealSetup：发送方是弹窗、tabId 是本页）与 pickOptionsTab（从 getContexts 结果里挑已开的设置页）
│   ├── lib/lookup-input.js       右键输入处理：选区规范化与截断、editable、图片 srcUrl 只认 http(s)
│   ├── lib/lookup-decision.js    右键查询判定表（八行）与普通标签的位置
│   ├── lib/menu-spec.js          右键菜单两项的属性与标题（引擎名里 & 写成 &&、%s 拆成 % s）
│   ├── lib/serial.js             串行队列（SW 全局串行链、菜单重建各用一条）
│   ├── lib/cycle.js              快捷键轮换：下一个参与轮换的引擎（搜索对跳过当前左侧，查询对不受影响；弹窗候选同样不含搜索对的左侧）
│   ├── lib/setup-state.js        “开始使用”卡的纯逻辑：setupView（steps / regrant / done / hidden 与每步状态）、countsAsSetup（go.html 写成一对 search 记录后：setupDone 不是 true、涉及的标签都不在 setupTryTabs 里才算完成）、addTryTab（去重、只留最近 50 个）
│   ├── lib/engine-id.js          新增引擎时按名称自动生成 id（回退网址 host、再回退 engine，按 -2…-99 去重，两类引擎共用命名空间）
│   ├── lib/popup-view.js         弹窗视图状态、换右侧的目标（switchTarget：图片查询对只在以图搜图引擎里挑）、popupView 的 auto（右侧是规则选的：base 经 switchTarget、hit 经 explainRule；choices 去掉 base）与分屏外三档（idleView：setup / try / ready），纯逻辑
│   ├── lib/safe-error.js         日志里的错误先经 safeError/safeArgs：只留错误名和消息，引号内容与网址样文字换成 …，不带堆栈
│   ├── lib/i18n.js               语言选择、占位符替换等纯逻辑
│   ├── lib/errors.js             错误码：lib 和设置页逻辑只返回码，页面经 t("err_<code>") 显示
│   ├── chrome/i18n.js            页内文案加载器：t()，fetch 读包内 _locales，按 uiLocale 切换
│   ├── chrome/config-store.js    storage.sync 读写封装；顶层键 uiLocale（"auto"|"en"|"zh_CN"|"zh_TW"|"es"）、narrowFallback（缺省 true）、cycleExclude（不参与轮换的引擎 id 数组）、lookupEngine（查词引擎 id，缺省跟随默认组合右侧，不写默认值）、imageEngine（所选以图搜图引擎 id，缺省 lens）、imageEngines（自定义以图搜图引擎 { id, name, url }[]）、rightRules（关键词规则 { id, when: words|script, words?, script?, engine? | keep: true, strip?: true }[]，有序，键不存在即没有规则，删光时 removeKeys；strip 只在 words 规则上、不勾选时不写这个键）；自定义引擎可带 leftDiscouraged
│   ├── chrome/split-actions.js   分屏动作执行（tabs / windows 薄封装，记录经 split-state.js）
│   ├── chrome/split-state.js     记录读写与 inspectTab（对侧已关闭、storage 抛错都按“无记录”处理）；writePair 返回是否写成、透传 autoA/autoB；writeEngine 去掉 rule/base
│   ├── chrome/setup-store.js     “开始使用”卡的存储：storage.local 的 setupDone（readSetupDone、go.html 用的 noteSetupPair）与 storage.session 的 setupTryTabs（rememberTryTab）；失败只记 info 日志
│   ├── chrome/right-switch.js    换右侧：弹窗与快捷键共用（查询对换的是 lookup 一侧）
│   ├── chrome/options-page.js    已开的设置页（findOptionsTab：runtime.getContexts + pickOptionsTab，弹窗用）与 openOptionsTab(key)（go.html 出错页用：有已开的页就切成活动标签、窗口拿焦点，网址换成 #tab-<key>（同一文档内换 tab，不重载；已是这个网址不导航，getContexts 的 documentUrl 跟着 replaceState 变，B21(o) 实测），没有或找页、切页出错就新开；key 为 null 照旧 openOptionsPage）
│   ├── chrome/menus.js           右键菜单注册：removeAll 后重建两项，标题经 t()
│   ├── chrome/lookup-actions.js  右键查询执行（② ⑧）：按 lookup-decision 建对、复用或开普通标签，记录经 split-state.js
│   ├── chrome/shortcuts.js       快捷键 cycle-right 的当前绑定与打开 chrome://extensions/shortcuts（设置页、弹窗共用）
│   └── chrome/complete-actions.js  ⑦ 补成分屏执行：重新读标签、识别、判定后 openRight
└── test/                         node --test（每个 lib 一个文件，另有 manifest、config-store、split-actions、options-edits、options-ui；i18n.test.js、chrome-i18n.test.js、i18n-catalog.test.js（4 种语言 key 对齐与 fetch 守门、带引擎名的 aria 文案含可见文字；KEY_RE 认的前缀含 `script_`，文字类型名经 right-rules.js 的 SCRIPT_KEYS、SCRIPT_OPTION_KEYS 字面量引用）、popup-css.test.js（颜色变量只在 styles/tokens.css 定义，设置页、弹窗、go.html 都引用它，用到的每个变量浅深两段都有）、ui-icons.test.js（SVG 图标统一 viewBox、线宽、aria-hidden，界面源码里没有当图标用的 Unicode 字符）、errors.test.js、i18n-pak.test.js（Chrome 术语表脚本）、store-i18n.test.js（宣传图文案键对齐）；go-wiring.test.js（静态检查 go.js 的判定经 decideFor、读窗口带 populate；v0.5 起还检查关键词规则经 ruleRight、在展开右侧模板之前且单独 try，出错不跳转、不落进只开左侧，auto 传给 ACTIONS，日志不带 query/pick）；log-wiring.test.js（静态检查打印错误的日志都经 safe-error）；safe-error.test.js；options-actions.test.js（设置页写入：先写后删只成功一半时如实提示）；v0.4 的 menus、lookup-actions、complete-actions（chrome 替身）与 image-edits；v0.5 的 right-rules.test.js（匹配语义、清洗、上限、性能守门）与 rule-edits.test.js（规则增删改移与校验）；v0.6 的 options-route.test.js、url-break.test.js，options-wiring.test.js（静态守门：去掉 loading 后紧接 revealSetup()、之前有 routeOnce(；src/options/ 只有 tabs.js 注册 hashchange；revealSetup、revealGuideSteps 都先 showTab），i18n-catalog.test.js 另核对跨 tab 引用的区名一致（engine_in_pair_* 含 options_tab_pair 的文字等），e2e-b21.test.js 测 B21 的纯判定；e2e-*.test.js 测 e2e 脚本，其中 e2e-i18n.test.js 测 I18N 步骤，e2e-v04.test.js 测 v0.4 的模拟 host、弹窗状态读取、MENU_INDEX 与页面标记核对；e2e-v05.test.js 测 v0.5 的 ruleTrigger/expectRight 编码、记录与隐私核对函数、collectConsole 的 infos；v0.7 的 rule-text.test.js（findWord 边界、stripWords 去词语义：大小写变音只在比较时忽略、vd 不删 vdeo/avd、短语、中文子串、多次出现、去完为空、扫描范围外保留、NFKC 与组合字符）、options-dialogs.test.js（dialogs.js 的 formSnapshot、isBackdropClick 纯函数）、engine-catalog.test.js 的“没有百度、每个分类至少一个条目”，go-wiring.test.js 另守 replaceQuery 在规则 try 内、ruleRight 之后、展开右侧模板之前、出错不改 leftUrl 与 query；e2e-v07.test.js 测 v0.7 的 extraTrigger 编码、DNR 正则与 parseTrigger、去词后左侧与 go.js 的 replaceQuery + stripMarker 逐字比对、STRIP_RULE 经 ruleRight、wordLogProblems、makeToken、pointOutside、catalogProblems、步骤注册；pack.test.js 测发布打包）
```

纯逻辑放 `src/lib/`（不碰 `chrome.*`），`src/chrome/` 是对 `chrome.*` 的薄封装，页面脚本只负责编排。

## 硬约束（违反任一条视为缺陷）

- `manifest_version: 3`；`minimum_chrome_version: "155"`；`incognito: "not_allowed"`。
- `permissions` 只能是 `["activeTab", "contextMenus", "declarativeNetRequest", "storage"]`（字母序）。禁止 `tabs`，禁止必需的 `host_permissions`。
- `optional_host_permissions: ["https://*/*", "http://*/*"]`。运行时只为引擎的精确 origin（`<origin>/*`）申请。
- `web_accessible_resources: [{ "resources": ["go.html"], "matches": ["<all_urls>"], "use_dynamic_url": true }]`。
- manifest 里固定 `key`（公钥），不得修改：扩展 ID 只由它决定，改了 ID 就变，已有授权和 `storage.sync` 数据都会对不上。不保留私钥：私钥只在自签 `.crx` 时才用得上，本项目走“加载未打包的扩展程序”和 CWS 上传，都不需要。发布包里的 `key` 由 `npm run pack` 处理（去掉或换成商店公钥，见“命令”），源码里的不动。
- 无构建工具、无运行时依赖。`src/lib/` 不得引用 `chrome`。JS 单文件不超过 300 行（`test/` 下的测试文件不受此限）。
- 标记参数名为 `_ss`，值为 `<左id>,<右id>`，要兼容 `%2C`。引擎 id 必须匹配 `/^[a-z0-9-]{1,20}$/`，创建后不可修改；文字引擎与以图搜图引擎共用一个 id 命名空间。
- DNR 规则 id 固定为 `1`。`regexSubstitution` 写死为 `chrome-extension://<chrome.runtime.id>/go.html?u=\0`，不得使用 `runtime.getURL()`。
- 预置引擎（只写在代码里）：`google` Google `https://www.google.com/search?q=%s`；`bing` Bing `https://www.bing.com/search?q=%s`；`ddg` DuckDuckGo `https://duckduckgo.com/?q=%s`；`perplexity` Perplexity `https://www.perplexity.ai/search?q=%s`；`kagi` Kagi `https://kagi.com/search?q=%s`。默认组合为 `["google", "bing"]`。Perplexity 预置带 `leftDiscouraged: true`：它的 Service Worker（Workbox）接管所有 document 导航，DNR 的 main_frame 规则看不到，作左侧时退化为普通搜索（G5）；设置页的引擎列表、默认组合卡片和组合生成器都提示“建议只作右侧”。
- 以图搜图预置（只写在代码里，不能删除）：`lens` Google Lens `https://lens.google.com/uploadbyurl?url=%s`，缺省选用。以图搜图引擎不经过 DNR、不申请任何 host 权限，设置页不显示授权按钮。
- 用户界面文案一律写在 `src/_locales/<语言>/messages.json`（首期 `en`、`zh_CN`、`zh_TW`、`es`），代码和 HTML 里不得出现界面文字。页面经 `src/chrome/i18n.js` 的 `t()` 取文案（按设置页所选语言，默认跟随浏览器），SW 里的右键菜单标题同样经 `t()`；`chrome.i18n.getMessage` 只用于 manifest 的 `__MSG_…__`。`zh_CN` 是源文案，`default_locale` 是 `en`。新增或修改文案时 4 种语言的 key 必须同时补齐（`test/i18n-catalog.test.js` 检查）。唯一允许的 `fetch` 是读取扩展包内的 `_locales`。文案的术语、润色与翻译流程见“## 文案”。
- 日志（`console.info`/`console.error`）不得带标签网址、关键词、关键词规则命中的词、选中文字或图片网址；打印错误对象一律经 `lib/safe-error.js`（`test/log-wiring.test.js` 守着），不直接传 Chrome 的错误对象。
- `storage.local` 只存布尔值 `setupDone`（“开始使用”卡是否完成，只由 go.html 经 `chrome/setup-store.js` 写），不放查询词、网址或其他数据。`storage.session` 除分屏记录外只多一个 `setupTryTabs`（“试一下”打开的标签 id 数组，最多 50 个，不含网址或关键词）。
- 颜色只在 `src/styles/tokens.css` 定义（浅色、深色两段），各界面样式表只用 `var(--…)`（`test/popup-css.test.js` 守着）；图标用 `ui/icons.js` 的内联 SVG，不用 Unicode 字符或 emoji（`test/ui-icons.test.js` 守着）。
- 不使用 iframe，不修改响应头。只有经过用户确认的“本扩展分屏”才允许被覆盖，而且只改写记录确认属于本扩展的那一侧（查询对只改写 `lookup` 一侧；兜底判出的 `fallback-own` 不允许任何调用方改写标签）。调分屏 API 前窗口必须经 `splitWindowType` 判为 `normal`（读窗口带 `populate: true`）。
- 开发镜像目录：`/mnt/d/APP/Chrome-Extensions/split-search`。之后只用“重新加载”，不要移除后重装。

## 命令

- `npm test`：等价于 `node --test`，自动发现 `**/*.test.js`。Node 24 上不能写成 `node --test test/`（会报 MODULE_NOT_FOUND）。
- `npm run e2e`：引导式端到端验收（测试浏览器在一个独立的 Xephyr 窗口里，只在提示时需要人操作），见下节。`npm run e2e -- --auto-only` 只跑自动步骤（默认在不可见的 Xvfb 里、无人值守，xauto 照跑）；`--only B5,T7` 只跑指定步骤；`--timeout <毫秒>` 单步等待时长（默认 120000）；`--headed` 让 auto-only 改用可见的 Xephyr 窗口（退回 host 时则是不再无头）；`--no-xinput` 不用真实鼠标键盘，xauto 步骤改用人工协助版本；`--display <xephyr|xvfb|host>` 指定测试浏览器所在的显示（见下节“显示”）。
- `bash scripts/sync-to-windows.sh`：同步 `src/` 到 D 盘镜像目录。
- `bash scripts/gen-key.sh`：打印扩展 ID（`alngkkgnobglnfbhcplhpaflcgfiajnj`）。只有 manifest 里没有 `key` 时才会生成一把一次性密钥并写入公钥；已有 `key` 时绝不改动。源码始终保留这把开发公钥（开发 ID）。上架 CWS 的 ID 分层：首次上传用不带 key 的包（`npm run pack`），商店分配 ID；上传后在 CWS 后台“软件包 → 公钥”复制商店公钥，存到 git 以外的本地文件；之后的版本都用 `npm run pack -- --store-key <文件>` 打包，商店 ID 保持不变，开发版与商店版可并存。
- `npm run pack`：发布打包，生成 `dist/split-search-<版本>.zip`（`dist/` 不进 git），打印大小、sha256 和 key 情况；同一份源码打出的 ZIP 逐字节相同（时间戳取最近一次改动 `src/` 的提交）。不改动 `src/`：复制到临时目录，manifest 默认去掉 `key`；`--store-key <文件>` 改写成商店公钥（相对路径按执行命令的目录解析；PEM 或 base64，校验是 DER 编码的 RSA 公钥，打印对应扩展 ID；给的是开发公钥会中止）。发布前检查（不过即中止）：manifest 与 `package.json` 版本一致；硬约束里的 manifest 字段（版本、无痕、权限、可选 host 权限、`web_accessible_resources`）与上文一致，且没有 `host_permissions`；每种语言的 `messages.json` 能解析、有 manifest 引用的全部 `__MSG_…__`，`name` ≤75、`description` ≤132 字符；manifest 引用的图标、SW、设置页、go.html 存在；`src/` 里只有运行时文件（没有点文件、测试、`.DS_Store` 之类）；`src/` 在 git 里没有未提交改动（`--allow-dirty` 改为警告）。
- 商店信息（2026-10-25 首次提交 v0.2.0）：商店 ID `ebefmgpipceocigodihbbbhdiagmjdak`；商店公钥存在 `~/.config/split-search/cws-public-key.pem`（不进 git，丢了从 CWS 后台“软件包”页重新复制）。首次上传的包不带 key；之后每个版本都用 `npm run pack -- --store-key ~/.config/split-search/cws-public-key.pem --smoke`。
- `npm run pack -- --smoke`：打包后把 ZIP 解压到临时目录，在一次性 Chrome 配置（无头、`--disable-sync`、no-first-run、管道 CDP，参数与字体配置同 e2e 的 `launch()`）里用 `Extensions.loadUnpacked` 装上，核对：没有 manifest 错误、安装警告和运行时错误（chrome://extensions 的 `developerPrivate.getExtensionInfo`）、权限警告与 v0.3 相同（只有 DNR 一条 `Block content on any page`，`activeTab`、`contextMenus` 不带来新警告）、SW 起得来、SW 里菜单文案加载正常（切 `uiLocale` 让 SW 重建菜单后没有 `[split-search]` 错误）、设置页以英文渲染且没有显示成 key 的文字、工具栏弹窗以英文渲染且全新安装是分屏外的 setup 档（只有“还没设置好”和“完成设置”）、DNR 动态规则 1 的 `regexSubstitution` 指向本次装出的 ID、全程没有 `[split-search]` 控制台错误、go.html 收到格式不对的 `_ss` 显示出错页；带 `--store-key` 时核对装出的 ID 等于商店 ID，不带时核对它不是开发 ID（key 确实去掉了）。临时配置和解压目录用完即删（SIGINT/SIGTERM/SIGHUP 同样清理；被强杀留下的 `split-search-smoke-*`，下次冒烟开头在 Chrome 已退出且超过 10 分钟时删掉），只关自己起的浏览器，不碰 e2e 测试配置或真实配置。

## 测试纪律

- `src/lib/` 新增逻辑先写 node 测试，再写实现。
- 涉及分屏、DNR、权限的行为，先跑 `npm run e2e`。v0.1 不做 Windows 冒烟（2026-10-24 用户决定跳过；`docs/acceptance-v0.1.md` 第 2 节保留作以后的参考）。WSL 里的 Google Chrome（v0.1 时是 155.0.8059.84，v0.3 起是 156.0.8078.47；v0.3 的事实只在 156 上实测过）经 WSLg 可以验证除“从外部 Windows 应用拖入”（T3b）以外的全部项目，包括真实拖拽、地址栏、右键、授权框；涉及 Windows 环境本身的问题仍以 Windows Chrome 为准。

## 端到端验收（scripts/e2e）

- 设计：`docs/superpowers/specs/2026-10-23-e2e-and-default-pair-design.md`。步骤分 auto / xauto（真实鼠标键盘自动操作并判定，见下文 xinput）/ assist（向导指导用户操作、脚本判定）/ judge（用户点通过/不通过）。
- 目标（2026-10-24 用户决定）：整次运行除了偶尔重新登录 Kagi 不需要人。B4、B14、T8、T9 是 auto，T12 是 xauto（--auto-only 都会跑）；剩下需要人的只有首次安装（B1，一次性准备）、Kagi 登录，以及各步骤的回退路径：`--no-xinput`/xinput 不可用时 xauto 换回 assist/judge 版本；自动版本遇到测试设施问题（详情页打不开、结构认不出、找不到 Kagi 条目，错误 kind `infra`/`missing`）时，引导式运行回退到人工版本，`--auto-only` 判跳过并写明原因。
- 测试配置固定为 `~/.cache/split-search-e2e/profile`：全新、独立，`--disable-sync`、不登录 Chrome 账号；绝不读写 `~/.config/google-chrome`、`~/.chrome-debug-profile` 或任何 Windows 配置。运行前要关掉占用这个配置的 Chrome。
- 一次性准备（首次 `npm run e2e` 时由向导带着做，结果保存在测试配置里）：在 `chrome://extensions` 开发者模式下“加载未打包的扩展程序”加载仓库的 `src/`（CDP `Extensions.loadUnpacked` 单独装的是临时扩展、重启就没了，所以首次必须手动加载；这一步也验证 B1）；点一次授权框（`config.mjs` 的 `GRANT_ORIGINS`：四个模拟 host + 五个预置引擎）；需要 Kagi 的步骤前在 kagi.com 登录（只登录网站）。
- 测的是哪份代码（`ext-source.mjs`）：测试配置只能登记一个本扩展，可能装自另一个检出（主检出或别的 worktree）。每次启动后，登记路径不是本检出的 `src/` 时，先用 CDP `Extensions.loadUnpacked` 就地改装本检出的 `src/`（同一 id，授权、storage、Kagi 登录和网站搜索都保留），紧接着的 `chrome.runtime.reload()` 把这个临时装载转成持久登记，再经 `Extensions.getExtensions` 核对装载路径，不一致即中止；收尾时（恢复 storage 和网站搜索之后、关浏览器之前）用同样的办法改回运行前的目录。运行前的目录记在本检出的 `.e2e/ext-source.json`，改回后才删；没改回成的，下次从本检出运行时由收尾接着改回。所以从哪个检出运行就测哪个检出，别的检出（不论带不带这套逻辑）之后运行，测的仍是它自己。改装后 reload 抛错（loadUnpacked 已成功）时，收尾仍会再试一次改回运行前的目录并 reload。改装到 reload 完成之间约 1 秒，若此时被强制退出，扩展停在临时装载，下次启动会被 Chrome 移除；状态文件会记下这件事，启动时据此提示重新做一次性准备。
- `--auto-only` 的前提：上面的一次性准备已完成（扩展已安装、授权齐全），否则报“前置条件缺失”退出码 2。它不等 Kagi 登录：T9、T12 开头经 `kagiGate`（setup.mjs）探测一次，没登录就跳过并写明原因；引导式运行仍由向导带着登录。
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
- 向导页 `http://127.0.0.1:8765/guide`（端口固定，改端口要重新授权）。`chrome://settings` 扩展 API 写不了，但 CDP 可以：attach 到 `chrome://settings/searchEngines` 页面目标，经 WebUI 的 shadow DOM 点击、给 `cr-input` 赋值并派发 `input` 事件就能添加网站搜索、设默认、删除（实测可行，细节见 spike-xdotool.md §1.6）。xauto 步骤用这条路自动管理 `sse2e` 专用条目（`settings-se.mjs`，见下一条）；只有 assist 回退路径（无真实输入）里，向导仍给出可复制的网址和步骤让用户手动添加。回退路径里用户加的网站搜索（gb/bg/dg/px/kg），以及 T12 给 Kagi 条目追加的 `_ss`，只存在于隔离的测试配置里，收尾**不要求恢复**，保留供下次运行复用；默认引擎：脚本改过默认（sse2e 条目，或 xauto 的 T12 把 Kagi 条目设为默认）时，收尾的 `settings-se.restore` 恢复为运行前的默认；人工回退路径里用户自己设的默认保留；只有 T8(d) 在人工回退路径里改过“有权访问的网站”才提示改回。T8(a) 的人工回退让用户在无痕窗口粘贴触发网址，不依赖 gb（xauto 的 T1 不建 gb，全新配置里可能没有它）。
- xinput 真实输入（设计 `docs/superpowers/specs/2026-10-23-e2e-xinput-design.md`，代码 `xinput.mjs`、`gesture*.mjs`、`steps/xauto*.mjs`）：可用时默认开启，T1、T2、T3、T4、T5-DRAG、T6-NTP、T11、T12、T14 以 xauto 步骤用 XTEST 真实鼠标键盘执行并自动判定；`--no-xinput` 或不可用时换回对应的 assist/judge 版本，不算失败。可用 = DISPLAY 存在、`xdotool`、`import`、`xdpyinfo`、`xwininfo` 可执行（`xprop` 可选，只作叠放顺序的后备来源）、`xdpyinfo -queryExtensions` 含 XTEST、非 headless。嵌套模式下 DISPLAY 指向嵌套显示号，Chrome 总是带界面，所以 `--auto-only` 在 Xvfb 上就跑 xauto；只有 host 模式的 `--auto-only` 要加 `--headed` 才跑 xauto。`gx.nested` 在 host 模式下是 `false`，嵌套模式下是模式名 `"xephyr"` 或 `"xvfb"`，手势层和提示文案按它分支。
  - 光标规则按显示分开：
    - 嵌套模式（xephyr、xvfb）：嵌套服务器的指针不是用户的光标。脚本不读用户光标、不等待、不出提示，自己用 `getwindowgeometry` 读测试窗口位置（没有窗口管理器就没有装饰，Position 可信），把指针移到窗口中心并读回；读回不在测试窗口上就判 env，不按下。xvfb 下用户什么都不用管。xephyr 下用户只要别把光标停在 Xephyr 窗口上：光标在窗口上移动时，Xephyr 会把真实移动转发进嵌套显示。所以静止采样、“move 后读回不符 → 中止（env）”、“两次读回不符落在同一点”这几道防护都保留，同一点时的原因写成“指针被用户光标带走（请把光标移出测试窗口 Xephyr）”。xvfb 下两次落在同一点，原因写成“不是你的光标造成的，多半是坐标在屏幕外”，不叫用户做任何事。xauto 开始卡片同样按模式写：xephyr 写“自动操作中，请不要把光标停在 Xephyr 窗口上”，xvfb 写可以照常使用电脑。
    - host 模式：WSLg 下 XWayland 的指针焦点跟着真实的 Windows 光标走，真实鼠标只要有物理移动（手搭在鼠标上、触摸板误触），X 指针就被同步回真实光标位置。所以 xauto 期间真实光标必须停在测试窗口上**并且**手离开鼠标。移动前先读指针：在根窗口上 → 向导提示，最多等 30 秒，仍不在 → skip“光标不在测试窗口上”（绝不移动真实光标去“找”窗口）；手势前静止采样确认用户没在动鼠标；move 后读回不符 → 中止（env），10 分钟内两次读回不符都落在同一点（±3px，可以跨尝试）→ 单独原因“指针被拉回真实光标位置（请把手从鼠标/触摸板上拿开）”并在向导页提示。
  - 防误触：每次 down/up/按键前断言目标窗口（测试窗口 id 在手势前按页面标题 token 取好，手势中不再找）；拖拽中指针下可以是测试 Chrome 自己的 XDND 拖拽图像窗口（按下后才出现、同一 X 客户端或 pid、大小与选区相符）；松开前还要核对没有冒出别的应用的新窗口、前台没换成别的应用、`xwininfo -root -children` 的叠放顺序里没有别的应用被提到测试窗口上面并盖住落点（WSLg 没有 `_NET_CLIENT_LIST_STACKING`；读不出叠放顺序就不按下）；任一不满足 → 回到拖拽起点按同样规则核对后松开（取消拖拽），起点也不行 → stuck：停掉剩余 xauto 步骤、向导请用户在测试窗口里点一下；第二次 Ctrl+C 同步尽力松开；浏览器关掉后只有指针停在根窗口上才补发 mouseup（嵌套模式下按着的键只在嵌套显示里，随服务器一起停止，不影响用户桌面）。拖拽节奏：host 模式不变（按下后停 150ms，越过阈值每步 30ms）；嵌套模式用 `NESTED_DRAG`：按下后停 300ms，每步 60–100ms 随机，松开前停 800ms。这是 Xephyr 上实测的值，快节奏有一次没能开始拖拽。键盘手势只在 `Target.createTarget({newWindow:true})` 新开、经断言拿到前台的窗口里做，每个字符前都再断言一次。host 模式用 `getactivewindow` 断言（WSLg 下键盘只送给 X 焦点窗口，焦点只跟 Windows 前台走，`windowactivate` 无效）。嵌套模式没有 EWMH：只有 `getactivewindow` 报 `_NET_ACTIVE_WINDOW` 不支持时才改用 `getwindowfocus`，其他报错仍判 env；新窗口出现 500ms 后焦点还没过去，就在页面中心点一下（点之前断言指针在新窗口上，只点一次），之后仍拿不到焦点就关掉新窗口、判 env，不按任何键；xauto 只用 ASCII 关键词。失败每次完整重建现场，最多 3 次；任何一次真实失败（非环境原因）之后，再出现跳过、环境失败或预期降级都不能把它吞掉，该步判失败；之后某次尝试通过仍判通过，detail 写明之前的失败（作为不稳定信号）；没有真实失败时 T14 最终判为预期降级就按预期降级记。
  - 网站搜索：xauto 用 `sse2e`（模拟引擎 A ｜ B）与 `sse2e-<引擎 id>`（T14）专用条目，经 CDP 操作 `chrome://settings/searchEngines` 自动添加、设默认；改动前快照到 `.e2e/settings-snapshot.json`（只记默认引擎的 keyword/name、专用快捷字词和 `scriptDefaults`，不记网址），结束（含中断）删除专用条目，只在本次改过默认引擎时才改回；遗留快照下次启动先恢复。不动用户的其他条目，唯一例外是 T12（`settings-kagi.mjs`）：Chrome 自动发现的 Kagi 条目（快捷字词 `kagi.com`、网址 host 为 kagi.com）——在页面里给它的网址追加或改写 `_ss=kagi,bing`（网址带 Kagi 私有 token，读取和改写都在 chrome://settings 页面内完成，不传回 Node），并设为默认；设默认前把它记进快照的 `scriptDefaults`，收尾当前默认是它（且不是运行前的默认）时同样改回，之后 T14 把默认切到专用条目时也不会把它当成“要恢复的默认”。找不到这个条目（或它在“未使用的快捷字词”里）时 `--auto-only` 跳过，引导式运行回退到人工 T12。T12 用真实键盘在地址栏 (a) 直接输入、(b) 输入 `kagi.com 关键词` 进入快捷字词模式，都要 Kagi ｜ Bing 分屏；回车前截地址栏下拉框存 `.e2e/t12-suggest-default.png`、`t12-suggest-keyword.png`（嵌套显示截整屏；host 模式只截测试窗口、不截 :0 整屏，下拉框是单独的弹出窗口，截图里多半没有它；只供参考，联想有无不判通过/失败）。
  - 窗口：只有选中了 xauto 步骤时才把测试窗口固定为 normal 1600×1000（每个 xauto 尝试前再核对），没有 xauto 步骤时不动窗口尺寸。坐标一律由 CDP 页面坐标换算（`(screenX + outerWidth − innerWidth + clientX)·dpr`），不用 `getwindowgeometry` 的 Position（它把窗口装饰算进去）；例外有两个：一是右键菜单这种 override-redirect 窗口（没有装饰，Position 可信），点击前还要核对指针确实在菜单上、离右键点不超过 80px；二是嵌套模式的指针归位，用测试窗口的 Position 算中心（没有窗口管理器，没有装饰），之后靠读回断言把关。
  - 预期降级：T14 某引擎作左侧时，触发前就读到该 origin 的 SW、没分屏、左侧停在该引擎上并带着查询词（网址或标题带查询词，或该标签自己的主框架跳转链经过触发网址——Perplexity 的 SPA 会改写网址），并且没有扩展接管过这次触发的反证（任何跳转链里出现带本次查询词的 `go.html?u=`、触发后新增扩展控制台错误、新出现不在分屏里的 Google 标签——go.js 分屏失败时 `location.replace(左侧)` 的结果和普通搜索长得一样，靠这些区分；没有控制台收集器时不判降级），记 `degrade`（预期降级）：单独计数、不算失败、退出码 0；没检测到 SW 仍是失败。多子项步骤里跳过/预期降级的子项，步骤整体通过或预期降级时写在说明第一行；无论步骤结果如何，都列进报告“未覆盖”小节。
- v0.3 步骤（`steps/v03-*.mjs`、`xauto-t19.mjs`）：T16 分屏记录绑定 splitViewId（拆开再拼回、对调、清理）；T17 窄窗口降级；T18 工具栏弹窗；T19 快捷键换右侧（xauto 真实按键，judge 回退）；B16 引擎库；B17 快捷键区与 `cycleExclude`；B2 改为点工具栏图标出现弹窗。模拟服务器多了 `/about`。
  - e2e 的 storage 基线含 `narrowFallback: false`（测试窗口宽度不总受控，关掉窄窗口降级现有分屏步骤才不受影响）；T17 自己删掉它并用 `guarded` 写回。
  - 快捷键绑定的快照与恢复：`ext-shortcuts.mjs` 改动前记到 `.e2e/shortcut-snapshot.json`，结束（含中断）按它改回并删文件，遗留快照下次启动先恢复。
- v0.4 步骤（`steps/v04-*.mjs`，设计见 v0.4 spec 3.14，验收表 `docs/acceptance-v0.4.md`）：T20 补成分屏（auto，经 CDP `Extensions.triggerAction` 作用于标签目标打开弹窗，和真点图标一样授予 activeTab）；T21 边读边查、T22 以图搜图（xauto，assist 回退）；T23 不覆盖用户页面的 go.html 与弹窗路径（auto，查询对由脚本直接构造）；T24 不覆盖用户页面的右键路径（xauto，judge 回退；可选 (d') 快捷键、(i) 无痕菜单项数）；B18 设置页“右键查询”卡片（auto，含以图搜图列表的小标题 `#image-list-title`、列表的 aria-labelledby 和两个写明对象的按钮）；I18N、B14 扩充到弹窗“补成分屏”区和新卡片。
  - 不授权的模拟 host（`config.mjs` 的 `UNGRANTED_HOSTS`：`engine-u.localhost` 模拟引擎 U、`page-u.localhost` 普通文章页（两段文字、一张 http 图片、一张 `data:` 图片）、`engine-i.localhost` 模拟以图搜图引擎，回显收到的 `url`）：不进 `HOSTS`，所以不进 `GRANT_ORIGINS`，已有测试配置不用重新授权。扩展读不到这些标签的网址，步骤一律从 CDP 读、按标签 id 认。判“没被重定向”不能只看导航历史里有没有 `go.html`（go.js 的 `location.replace` 会换掉那一项），要看主框架跳转链或断言网址仍带 `_ss`。G5 降级网址必须开在从没触发过 action 的新标签里（S9）。
  - 页面没被导航的证据：给不该被动的标签写随机页面标记（`window` 上的变量），结束时按 CDP 网址和标记核对（`guardProblems`）；网址相同但页面重载过，标记就没了。
  - 右键菜单按文字行定位、悬停确认高亮后点击，不向菜单发任何按键（F20：首字母助记键与 Chrome 自带项冲突）。行号 `MENU_INDEX = { text: -2, image: -2 }`（`v04-lib.mjs`）从末尾数：本扩展项总在倒数第二行，紧挨“检查”；`MENU_MIN_ITEMS = { text: 7, image: 7 }`。依据是 S11 加 e2e 测试配置实测（测试配置界面英文、默认引擎 Kagi/sse2e，没有“翻译所选内容”和 Lens 两项，两种菜单都是 7 行；一次性配置默认引擎 Google 时是 8 行）。使用方把 `MENU_INDEX` 原样传给 `contextMenuPick`，不换算成正数；对不对以效果判定，detail 写当次菜单的实际行数。图片上右键前先清掉页面选区（选区和图片同时命中时 Chrome 把本扩展两项收进子菜单）。关菜单点在菜单矩形以外（`dismissMenu`），不沿用 `(at.x, at.y + 400)`：那个点落在菜单里。T24(i) 只比两次 `contextMenuCount` 的差（无痕少 1）。
  - 日志分级：预期的拒绝和忽略（右键 `ignore` 的各个 reason、`not_results_page`、`message_rejected`、`window_unsupported`）只记 `console.info`，B15 只收 `error` 级，所以 T20、T23、T24 有意走的拒绝路径不会让它判失败。
  - 存储基线不加 `lookupEngine`、`imageEngine`、`imageEngines`，用到它们的步骤自己用 `guarded` 写、写回。
  - 界面翻新（设计 `docs/superpowers/specs/2026-10-26-v0.4-ui-refresh-design.md`）：B19“开始使用”卡（auto，`b19.mjs`）：清掉 `setupDone` 后卡片显示三步；“试一下”打开的一对不算完成（标签 id 在 `setupTryTabs` 里）；不经“试一下”在新标签打开触发网址出现一对后 `setupDone` 为 true、卡片换成完成确认，重开后隐藏；(c') 卡片所在的设置页关着时触发一次，重新打开卡片不显示；撤销左侧授权后卡片重新出现、只有第 1 步，恢复后消失。引擎行按 `data-id` 定位。卡片显示时“添加到 Chrome”卡的默认组合一段（`.trigger-default`）和 5 步说明（`#guide-steps ol.steps`）应收在收起的 `<details>` 里，卡片不显示时照常显示、不包 `<details>`（CARD 的 `def`、`guideSteps`）；(a) 最后点第 2 步的“详细步骤”，两段都展开、hash 不变、5 步说明顶边在视口内、焦点落在 5 步说明的 summary 上（`detailsLink`），之后焦点放到折叠区里的复制按钮、写临时 sync 键 `e2eB19Probe` 触发重渲染，折叠区不重建、焦点不丢（`keepsFocus`，用完删键）；再直接打开 `options.html#guide-steps`（`openOptions` 的 `hash`），效果应与左键点击相同（`hashOpen`）。B8 核对“其他组合”默认收起、不用默认组合卡的窗格、初值不等于默认组合。第 2 步核对三个小步依次是设置地址、触发网址（各一个复制按钮）、设为默认（`substepProblems`）。弹窗分屏外三档（`popup.html?tabId=<普通标签>`，`plainTab` 在 v03-popup.mjs）：(a') try 档先关掉所有设置页再点“查看第 2 步”，退回新开 `#setup`、焦点在卡片标题；(e) ready 档，直接打开 `#setup` 卡片不显示、焦点不动；(d) 撤销后是 setup 档、说明是“已无权访问模拟引擎 A”（regrant），设置页开着时点“完成设置”不新开标签，已开的设置页成为活动标签、卡片是 regrant、焦点在卡片标题。T18(c) 要求 try 或 ready 档；I18N 每种语言另截弹窗分屏外 try 档（`<locale>-popup-idle.png`）。v0.6 起卡片在“添加到 Chrome”tab：B4 另断言默认选中 `#tabbtn-add`；B19 撤销左侧授权后 `pairCallouts`（`#pair-body .callout-warn`，`#pair-changed` 不算）期望 1（“搜索组合”的左侧未授权提示框常驻）；弹窗 (a')(d) 点完后 ① 选中、hash 是 `#tab-add`、`#setup` 或原值，(e) `#setup` 页卡片不显示时 ② 选中、焦点在 BODY。
  - 引擎行精简（设计 `docs/superpowers/specs/2026-10-27-engine-row-design.md`，验收表见 `docs/acceptance-v0.4.md`“引擎行精简”）：隐藏、删除经编辑对话框（`optpage.mjs` 的 `openEdit` 点 `#edit-<id>`、等对话框打开），可见性一律用 `checkVisibility()` 判（作者样式的 `display` 会盖过 `hidden`，读 `.hidden` 会假通过）。B7 在对话框里点两次 `#dlg-delete`，焦点交给相邻行的 `#edit-<id>`；B10 读 `#dlg-hide`/`#dlg-delete` 的 `aria-disabled`、`aria-describedby` 和 `#dlg-remove-reason`；B12 含“调整顺序”模式中的焦点去向（撤销、另一页隐藏、恢复、可见引擎只剩 1 个时自动退出，最后一种直接写存储构造，guarded 键含 `customEngines`）；B13（`options-b3.mjs`）经 `setReorder` 进出模式，按 `#move-<dir>-<id>` 移动，“完成”立即写入的时刻在页内用 `storage.onChanged` 记；B17(c) 先展开 `#cycle details` 再点 `#cycle-ec`；I18N 每种语言打开两次编辑对话框（ea 不可用的删除、ddg 可用的隐藏）并进一次排序模式核对溢出。全新安装的 Tab 停靠点（改前 46、改后 32、排序模式 28）只用 CDP 实测过一次、写在验收表里，不做常驻断言。
  - `setupDone`（`storage.local`）与 `setupTryTabs`（`storage.session`）不在 storage 快照里：B4、B19、I18N 用 `keepSetupDone` 或自己写回步骤前的值，但其他步骤经 go.html 建出的一对都会写入 `setupDone: true`，所以跑过一次完整 e2e 后测试配置里 `setupDone` 一直是 true（只在测试配置里，不影响判定；要看首次状态的卡片，删掉这个键再开设置页）。
  - T5 的重启子项（`flow-restart.mjs`）从 v0.4 起期望不覆盖：恢复出来的本扩展分屏两侧都没有记录，兜底判出的 `fallback-own` 按 `foreign` 处理，在旁边新开一对，原来两侧都不动。
- v0.5 步骤（`steps/v05-*.mjs`，设计见 v0.5 spec 第 11 节，验收表 `docs/acceptance-v0.5.md`）：T25 按关键词换右侧（auto，`v05-rules.mjs` 管 (a0)–(g) 与 (l)，`v05-rules-popup.mjs` 管弹窗 (h)(i)(j) 与 ⑦ 建议 (k)）；B20 设置页规则区（auto，`v05-options.mjs`，设计稿 11.2 第 1–11 步；v0.6 起是“搜索组合”tab 的规则卡 `#rules-card`，打开时带 `{ tab: "pair" }`，第 10 步先 showTab 到 ③、第 11 步切回 ②；v05-i18n 的审计范围与截图裁切都换成 `#rules-card`）；I18N 每种语言另截 `<locale>-options-rules.png`、`<locale>-popup-rule.png`（`v05-i18n.mjs`），B14 另截 `b14-options-rules-dark.png`、`b14-popup-rule-dark.png`。只跑 v0.5：`npm run e2e -- --auto-only --only T25,B20,I18N,B14,B15`。
  - 模拟引擎 D（`ed`，`v05-lib.mjs` 的 `mockEngineD`，模板 `http://engine-c.localhost:<port>/search?q=%s`）只在步骤里经 `guarded(ctx, ["customEngines", "rightRules", …])` 临时加：与 `ec`（`/wiki/%s`）同 host，按路径区分（`/search` 是 D，`/wiki` 是 C），不加 host、不重新授权。`rightRules` 不进存储基线，T25、B20 自己写、写回，整份 storage.sync 快照兜底。
  - 编码：`util.mjs` 的 `trigger(port, q, ss)` 要求 q 已编码，`expectPair` 写死右侧是 engine-b；v0.5 步骤一律用 `ruleTrigger(port, raw, ss)`（内部 `encodeURIComponent`）和 `expectRight(port, engineId, raw)`（ec → `/wiki/<编码>`，eb、ed → `/search?q=<编码>`，与 `expandTemplate` 逐字相同，`test/e2e-v05.test.js` 守着）。中文查询经 CDP 打开，不走 xauto 键盘。查询都带一次性 token，(l) 按 token 核对 sync、local、session 记录键（`RECORD_KEYS`）与日志（`privacyProblems`）。
  - 快捷键路径不在 e2e 里：`cycleRight` 在 SW 里，`ctx.ext.eval` 在设置页执行、调不到，也不 attach SW；它与弹窗共用 `switchRight → writeEngine`，由 T25(h)(j) 与 `test/background.test.js`、`test/right-switch.test.js` 覆盖。窄窗口相邻对、join 的透传由 `test/split-actions.test.js` 覆盖。
  - 控制台收集器（`console.mjs` 的 `collectConsole`）另有 `infos`：只收带 `[split-search]` 的 info 级消息，供 T25(l) 核对日志不含查询；B15 仍只读 `errors`。
- v0.6 步骤（设计见 `docs/superpowers/specs/2026-10-27-options-tabs-design.md` 第 5 节，验收表 `docs/acceptance-v0.6.md`）：设置页分成四个 tab 后，步骤在哪个 tab 里操作就带上哪个 tab：`optpage.mjs` 的 `openOptions(browser, { tab })` 在网址后接 `#tab-<key>`（真实用户也会用的深链），`withOptions(browser, fn, opts)` 把第三个参数交给 `openOptions`，已打开的页面中途换 tab 用 `showTab(page, key)`（点 `#tabbtn-<key>`，等面板 `checkVisibility()`）。隐藏面板里的节点仍在 DOM 里，READY 不变；但做焦点、可见性、坐标、截图、行数、溢出检查时目标 tab 必须可见。B21 设置页 tab 与宽度（auto，`b21.mjs`、`b21-links.mjs`、`b21-width.mjs`）：(a) ARIA；(b) CDP 真实按键 →、End、Home、← 换 tab，带修饰键的 → 与 ↓ 不处理；(c) 点 tab 写 `#tab-<key>`、不增加历史、刷新后仍在；(d) 默认 tab（卡片显示进 ①、`#tab-*` 优先、否则 ②，认不出的 hash 含元素 id 不滚动）；(e) 停在 ① 时完成设置不跳 tab；(f) 跨 tab 链接（“更换组合”、第 5 步“搜索引擎”、末行指引、“查看设置步骤”）切 tab 并定位；(g) `#pair-changed` 按档位选文案、何时清掉，另开的设置页没有它，在另一页改回原组合后它消失；(h)(h′) 改引擎网址后的“查看触发网址”（卡片不显示 / 显示时还要展开 `#guide-default`）；(i) 排序模式中切走立即写出 order；(j) 已开的设置页停在 ③ 时从弹窗“打开设置”不新开、不重载；(k) 左侧未授权时第 5 步“搜索引擎”的焦点（left-grant）与授权按钮消失后的焦点兜底（`#setup-grant`、`#pair-grant`、`#gen-grant`，CDP 可信点击）；(l) 四种语言 × 1280、600 宽的同一条右边界、无溢出、引擎行不折、600 档页头 h1 一行且与语言框同行（空读数判失败）；(m) 停在 ③ 时换语言；(n) 地址栏手改 hash；(o) go.html 出错页“打开设置”按错误码进 ① 或 ③（新开、复用停在 ② 的已开页），no_trigger 照旧。`guarded` 写回 `defaultPair`、`uiLocale`、`customEngines`、`presetOverrides`、`order`，`keepSetupDone` 写回 `setupDone`；撤销过的授权（模拟引擎 A，(k) 另有 B）子项自己恢复，恢复不了的收尾 `requestGrant`。只跑设置页：`npm run e2e -- --auto-only --only B4,B6,B7,B8,B10,B11,B12,B13,B16,B17,B18,B19,B20,B21,B14,I18N`。
- v0.7 步骤（`steps/v07-*.mjs`，设计见 `docs/superpowers/specs/2026-10-28-v0.7-design.md` 第 4.2 节，验收表 `docs/acceptance-v0.7.md`；spec 里的“T25 新子项、B20 新步骤、B16 无百度”拆成了独立的 T26、B23）：T26 关键词规则去掉命中的词（auto，`v07-strip.mjs`）：`guarded` 写回 `rightRules`、`customEngines`、`defaultPair`，默认组合写成 ea ｜ eb，规则 `STRIP_RULE`（“vd”→ 模拟引擎 C，`strip: true`），查询带一次性 token；(a) “vd <token>” 两侧都搜 token、右侧是 ec、两侧记录 query 都是 token、右侧记录 rule r1 与 base eb；(b) 只搜 “vd” 不去；(c) 自建触发网址在模拟引擎 A 上多带一个 `src=e2e`，去词后左侧只换 `q`、`src` 逐字保留、`_ss` 去掉；(d) 规则去掉 strip 后两侧都搜原查询、右侧仍换；(e) 照 T25(l) 的隐私核对，另加日志（error 与 info）里不得整词出现 “vd”（`wordLogProblems`）。B22 设置页对话框点外部（auto，`v07-dialogs.mjs`）：`guarded` 写回 `customEngines`；所有点击都是 CDP `Input.dispatchMouseEvent` 可信事件，遮罩点固定 `(8, 8)`，点之前读对话框矩形断言它在外面（`pointOutside`）；(a) 两个引擎库点外部关、不问；(b) 三个表单没改时点外部关、不弹 `#discard-dialog`；(c) 编辑 ec 改名后点外部弹确认、焦点在 `#discard-save`；(d) “继续编辑”回表单、修改还在、焦点回 `#dlg-name`；(d′) 确认框上按 Esc 同继续编辑；(e) 点确认框的遮罩等同继续编辑、焦点回 `#dlg-name`，之后“不保存”两个都关、`storage.sync` 整体不变、焦点同“取消”回 `#edit-ec`；(f) “保存”写入新名称；(g) 网址改坏后“保存”：确认框关、表单留着、显示字段错误；(h) 在 `#dlg-name` 里按下拖到遮罩上松开不关不问；(i) Esc 与“取消”直接关、不问；(j) 保存进行中（页内把 `chrome.storage.sync.set` 扣住，`HOLD_SETS`）点外部不关不问，放行后只写一次。B23 设置页 v0.7 小改动（auto，`v07-options.mjs`）：`guarded` 写回 `rightRules`、`presetOverrides`（Perplexity 被隐藏时临时取消隐藏）；(a) 引擎库每个分类至少一行、没有百度；(b) `#pair-left` 里 Perplexity 的选项文字等于 `engine_left_discouraged_suffix`；(c) `#rule-strip` 与 `#rule-strip-hint` 只在“这些词”时可见、默认不勾，切走再切回保留勾选；(d) 勾选保存后存储为 `strip: true`、行内有 `.rule-strip`；(e) 取消勾选后存储里没有 strip 键、行内没有 `.rule-strip`。I18N 每种语言另截 `<locale>-rule-dialog-strip.png`、`<locale>-discard-dialog.png`（`v07-i18n.mjs`）。开关滑块（A1）不做常驻 e2e 断言，本机验证一次写在验收表里。只跑 v0.7：`npm run e2e -- --auto-only --only T25,T26,B16,B20,B22,B23,I18N,B15`。
- I18N（`steps/i18n.mjs`，auto，`--auto-only` 会跑）：en、zh_CN、zh_TW、es 逐一打开设置页和 go.html 出错页，核对 `lang`、没有显示成 key 的文字、没有横向和按钮内容溢出。设置页按 tab 审（v0.6，`i18n-audit.mjs` 的 `auditTabs`）：每个 tab 切过去，先确认面板里至少有一个看得见的后代（否则隐藏面板里的溢出检查会静默通过，判失败），审面板，页头和 tab 栏另审一次；再展开所有 `details.disclosure`（`OPEN_ALL`，含“默认组合的触发网址”“其他组合”“设置步骤”“参与快捷键轮换”）逐个 tab 再审；最后视口模拟成 600 宽，四个 tab 各审一次溢出（不截图），核对每个 `.tab` 不截字、选中的 tab 完全在 `.tablist` 可视范围里；“右键查询”卡的以图搜图两个按钮按行框数核对不换行，`i18n-audit.mjs` 的 `lineProblems`）；再测页内切换（不刷新、2 秒内）、连切 en → zh_TW 停在最后一次、第二个设置页跟随，以及 `uiLocale = "auto"` 时 `t()` 与 `chrome.i18n.getMessage` 逐 key 相同。它会改写 `storage.sync` 的 `uiLocale`，用 `guarded` 写回步骤前的值（中断时由 storage 快照兜底）。截图存 `.e2e/i18n/<locale>-*.png`：设置页每个 tab 一张 `options-<tab>`（tab 是 add、pair、engines、lookup）、折叠区全部展开后 `options-<tab>-open`，`options-reorder`（“调整顺序”模式，在 ③ 拍），引擎库 `catalog`，编辑对话框 `engine-dialog`、`engine-dialog-hide`，弹窗 `popup`、`popup-idle`，go.html 出错页 `go-error`；`popup-complete`、`options-lookup` 由 `v04-i18n.mjs` 截；`options-rules`（规则卡的裁切）、`popup-rule`（带规则标记的弹窗）由 `v05-i18n.mjs` 截，它还核对规则对话框“这些词”“某种文字”两种状态，要求“换回”按钮不换行；`rule-dialog-strip`（规则对话框勾上“搜索时去掉这些词”）、`discard-dialog`（保存确认，三个按钮各一行）由 `v07-i18n.mjs` 截。各张对应的检查见各版本验收表。
- 测试窗口尺寸：第一次改尺寸（`fixWindow`、T17 的 `sizeTo`）前记到 `.e2e/window-snapshot.json`（`window-snap.mjs`），收尾改回，强制退出留下的快照下次启动先改回。快捷键：测试配置里原有绑定是脚本录不回去的（`parseKeys` 不认，如媒体键）时不改动它，B17(a)(b)/T19 记跳过。
- 运行前快照 `chrome.storage.sync` 到 `.e2e/storage-snapshot.json`，结束（含中断）后恢复；遗留快照下次启动先恢复。报告在 `.e2e/report-*.md|json`，网址里的 token/session/sid/auth/key/code、access_token 等 `*_token`、session_id/sessionid、`google_abuse` 等 `*_abuse` 与含 exemption 的参数值（含一次、两次百分号编码嵌套在 next=、r=、continue= 里的），以及单独出现的 `…ABUSE_EXEMPTION=…`（含用户 IP）、Google 人机验证页 `/sorry/…` 的 `q`（编码了访问者 IP 的令牌）脱敏为 `***`，终端与向导页同样。失败诊断除扩展读到的标签外，还列出 CDP 页面目标网址（扩展读不到的标签按窗口与网址对应）和步骤页面的主框架跳转链（控制台收集器在页面会话上 Network.enable 记录，没有时用 Page.getNavigationHistory）。左侧 Google 停在人机验证页（/sorry，`continue` 解码后是期望的搜索）算分屏已建成（`steps/captcha.mjs`）；脚本自己准备现场的等待，“重试”都会重新准备并重新记下判定用的 id。B4、T8 之后脚本自动核对扩展已启用、授权齐全（扩展不可用先经 chrome://extensions 详情页自动启用，缺授权自动重新申请），恢复不了就跳过剩余步骤（`--auto-only` 不请用户启用扩展）。Kagi 登录检查打开 `https://kagi.com/settings`，只有最终停在 kagi.com/settings 才算已登录；用户登录期间只读现有标签的网址、不再发起导航（未登录时那条跳转链会重写会话 cookie，可能打断登录），用户点“我已完成”后再探测一次。
- 授权框与扩展管理页（2026-10-24 在 Xvfb 上实测）：
  - `chrome.permissions.remove` 撤销的可选 host 权限只是从“生效中”拿掉，仍留在配置的“已授予”记录里；再 `permissions.request` 同样的 origin，Chrome 直接批准、不弹框（实测 12 ms）。一次性授权检查保证这些 origin 运行前都生效，所以 B4、T8(c)(e) 的恢复、步骤后的恢复检查都不需要点授权框。`requestGrant`（guided.mjs）只申请一次，从独占一个新窗口的设置页发起；15 秒内没批准才说明弹了原生框：`--auto-only` 关掉这个窗口（对话框随之关闭）、返回 false；引导式运行换成“请点允许”的说明，继续等同一个对话框（不关掉重弹，开头的说明也已写明“万一弹框请点允许”），中断时同样关掉窗口。
  - 真正弹框时（从没授予过的 origin），授权框画在浏览器窗口内部，不是单独的 X 窗口，CDP 也看不到；初始焦点在“拒绝”，Tab 一次到“允许”，Escape = 拒绝。内容读不到、焦点位置是实现细节，**不做原生对话框点击器**。授权框挂在浏览器窗口上、不是标签上：只关掉发起申请的设置页标签，对话框还留在那个窗口里（请求也不结算）；关掉它所在的窗口，对话框才随之消失。所以 `requestGrant` 和 B4 的设置页都开在单独的新窗口里（`openOptions(browser, { newWindow: true })`）。
  - B4（`steps/b4.mjs`）：在设置页里包一层 `chrome.permissions.request` 记录调用，清掉 `setupDone`、撤销两者授权后，用 CDP `Input.dispatchMouseEvent`（可信事件，带用户激活，headless 也可用）点“开始使用”卡（`#setup`）第 1 步的授权按钮，断言恰好一次申请且同时含 www.google.com 与 www.bing.com、授权生效、第 1 步变为已授权；点之前还核对引擎列表里默认左侧 Google 是 `perm-missing`“未授权（必需）”、没授权的右侧 Bing 是 `perm-optional`“未授权（可选）”；`setupDone` 由 `keepSetupDone` 写回步骤前的值。
  - chrome://extensions 详情页（`ext-webui.mjs`）：后台新窗口打开 `chrome://extensions/?id=<扩展>`，shadow DOM 里 `extensions-detail-view` 的 `#enableToggle` 点一下即停用/启用，读回 `data.state`（`DISABLED`/`ENABLED`）；重新启用点开关不生效时用页面里的 `chrome.management.setEnabled` 兜底。T8(b) 在 finally 里一定重新启用，再等扩展页能执行脚本。停用期间只读 CDP 目标（扩展的页面和 SW 目标应随停用消失），不新开扩展页（停用时新开的扩展页要等满 10 秒才知道不可用），整段可被中断：中断后立刻进 finally 重新启用、不再等扩展页，停用窗口约 5 秒，落在运行器的收尾期限（15 秒）以内。兜底还有两道：收尾（`teardown.mjs` 的 `reenableStep`，开始过 B4/T8 且扩展不可用时，先经详情页启用再恢复 storage）和下次启动（`ext.ensureExtensionUp`：扩展已登记但设置页打不开，稍等重试仍不行就经详情页启用；第二次 Ctrl+C 强制退出留下的停用状态靠它）。“已登记”按扩展 id 读测试配置的 Preferences，不论装自哪个目录（启动时可能还登记在别的检出的 `src/`，随后才改装本检出，见上文“测的是哪份代码”）。T8(a) 先读详情页的 `data.incognitoAccess`：“在无痕模式下启用”打开了就判失败（测的不是用户看到的行为），读不到只在说明里注明。本扩展只有可选 host 权限，“有权访问的网站”渲染成逐站开关列表（`extensions-host-permissions-toggle-list`），没有带“点击时”的下拉（`extensions-runtime-host-permissions`），T8(d) 据此自动记“不适用”（跳过）。
  - T8(a)：`Target.createBrowserContext` 建的是 off-the-record（无痕）上下文，扩展（`incognito: "not_allowed"`）不在里面运行；在新窗口里打开模拟触发网址，断言网址原样（带 `_ss`）、`Page.getNavigationHistory` 里没有 go.html、没有右侧引擎页面，最后 `disposeBrowserContext`。
  - B14（`steps/b14.mjs`）：`Emulation.setEmulatedMedia` 依次模拟 dark、light，期望值从页面样式表源码里读（body 引用的颜色变量在 `:root` 与 `@media (prefers-color-scheme: dark)` 里的取值），经探针元素换算成计算值后与 body 的背景色、文字色比较；页面依次是设置页（`b14-options-dark.png` 拍的是不带 hash 打开时的默认 tab）、向导页、工具栏弹窗（说明文字与“补成分屏”区）、设置页“搜索组合”tab（点 `#tabbtn-pair`，规则卡里有规则后拍整个 tab）与带规则标记的弹窗（`#rule-note`，规则现场由 `v05-lib.mjs` 的 `withRulePopup` 写入、经 `guarded` 写回 `rightRules`）和 go.html 出错页（`go.html?u=` 后接 `_ss` 只有一个引擎的未编码触发网址）；深色截图存 `.e2e/b14-options-dark.png`、`b14-guide-dark.png`、`b14-popup-dark.png`、`b14-popup-complete-dark.png`、`b14-options-rules-dark.png`、`b14-popup-rule-dark.png`、`b14-go-dark.png`。`--auto-only` 不打开向导页，B14 自己开一个、用完关掉（`focusGuide` 在 auto-only 下不新开向导页）。
- 已知事实：扩展 SW 空闲约 30 秒就被回收，扩展 API 一律在扩展页（设置页）里经 CDP 执行（`browser.evalExt`），不要 attach SW；控制台收集器 attach 了 SW，调试会话让它一直存活，所以 e2e 测不到 SW 回收后冷启动的问题（靠 Windows 冒烟或手测）；必须直接 spawn `/opt/google/chrome/google-chrome`，`~/.local/bin/google-chrome` 包装脚本会 nohup 后台化、破坏调试管道；启动参数不得含 `--enable-automation`；正式版 Chrome 忽略 `--load-extension`。
- 已知事实：WSL 的 `/etc/fonts/local.conf` 把 `/mnt/c/Windows/Fonts`（9P）列为字体目录时，Chrome 浏览器进程匹配字体要对候选字体文件逐个 `access()`（每次一趟 9P 往返），渲染进程主线程在同步字体请求上等它，期间该页的 CDP `Runtime.evaluate` 全部没有回复（平时约 2 秒，Windows 侧忙时十几秒以上，表现为启动时“Runtime.evaluate 超时”、设置页“没有加载出来”）。所以 `launch()` 经 `FONTCONFIG_FILE` 给测试浏览器一份生成的配置（`~/.cache/split-search-e2e/fonts.conf`：include 原配置 + `rejectfont` 排除所有 9p/drvfs 挂载点下的字体），不改系统配置；测试浏览器里只有 Linux 侧字体（中文用 Noto Sans CJK）。复现：并行跑几个只读的 `find /mnt/c/Windows/System32 /mnt/c/Windows/WinSxS -maxdepth 3` 让 9P 变慢，修复前 `--only B5` 12 次失败 10 次，修复后 37 次全过。

## 文案

适用于所有面向用户的文字：扩展界面（设置页、go.html 出错页）、README、商店详情与隐私政策（`docs/store/`）、宣传图文字（`assets/templates/i18n/*.json`）。v0.2 起支持 en、zh_CN、zh_TW、es（见 `docs/superpowers/specs/2026-10-24-i18n-design.md`），之前界面仍只有简体中文。

- 隐私政策有任何改动，`docs/privacy.md`、`docs/privacy.zh-CN.md`（GitHub Pages 托管副本）必须与 `docs/store/privacy.md` (f) 一起改。
- 术语用 Chrome 官方界面在该语言里的叫法（拆分视图/Split view、地址栏、标签栏、网站搜索、设为默认等），从 `/opt/google/chrome/locales/<语言>.pak` 或 Chrome 官方帮助页核实，不自造译名。
- 产品名所有语言都是 `Split Search`，不翻译、不加本地副标题。
- 写给真实用户看：只讲用户关心的关键点（能做什么、怎么设置、有什么限制、隐私），短句、精炼；不解释实现原理和设计取舍，不加“部分截图里的 X 就是这样来的”之类旁白。细节留给设置页的逐步说明和内部文档（2026-10-24 用户要求，商店详情、README 同样适用）。
- 每种语言按本语言的习惯写，去掉翻译腔和 AI 味，分别过一遍：
  - zh_CN：lieflat-less-ai-tone + humanizer-zh；
  - zh_TW：humanizer-zh，再按台湾用语审校（不得有简体字和大陆用语）；
  - en：humanizer；
  - es：content-l10n 做本地化质检（翻译腔、机器腔），再按母语标准审校（中性国际西语，用 tú）。
- 顺序：中文源文案先润色定稿 → 各语言按市场转写（不逐字直译）→ 每种语言单独润色一轮。改了中文源文案，其他语言跟着重做这一流程。
- 宣传图文字改完要重新出图（`node scripts/store/render-assets.mjs --locale <语言>`，`all` 为全部），渲染器会报出溢出和超行。目前只维护 `en` 的商店截图（2026-10-24 用户决定）：其他语言的图可以重渲，但不上传，`assets/store/zh_TW|es`、`assets/readme/es` 停在旧模板文案上属于有意为之（见 `docs/store/assets-spec.md` 第 4 节）。

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
- Document Picture-in-Picture 窗口（Chrome 156.0.8078.47 实测，spike S5）：报 `type: "normal"`、`alwaysOnTop: true`，有自己的标签；PiP 获得焦点时 `windows.getLastFocused({ windowTypes: ["normal"] })` 返回的就是它；按 `createPaired` 的参数调 `tabs.create({ windowId: <PiP>, splitWithTabId: <PiP 的标签> })` 会让 Chrome 崩溃（SIGTRAP），先用 `tabs.query` 确认找得到这个标签也没用。所以能否分屏按 `lib/window-kind.js` 的 `splitWindowType`/`canSplitIn` 判定；挑窗口经 `lastSplitWindow()`（`chrome/split-actions.js`），不直接用 `getLastFocused` 的结果。go.js 的判定经 `decideFor`（`test/go-wiring.test.js` 静态守着这条接线，改判定时不得删）。
- 窗口管理器“置顶”的普通窗口（Linux X11 的 `_NET_WM_STATE_ABOVE`，Chrome 156.0.8078.47 在 Xvfb 上实测）同样报 `alwaysOnTop: true`，去掉置顶后变回 false。和 PiP 靠标签数区分：PiP 只有一个标签，`tabs.create({ windowId: <PiP> })` 会落到打开者的窗口，加不进去；PiP 标签带 `openerTabId`（打开它的标签）。所以 `type === "normal" && alwaysOnTop === true` 且标签不多于一个（或没有标签列表）才算 PiP；读窗口一律带 `populate: true`（不需要 `tabs` 权限，标签带 `lastAccessed`，没有 `url`）。代价：置顶且只有一个标签的普通窗口按 PiP 处理，在里面搜索会到别的窗口分屏。PiP 获得焦点时 `lastSplitWindow()` 依次取 focused 的、打开 PiP 的、没最小化且最近用过的窗口；快捷键（`lastSplitWindow({ fallback: false })`）则什么都不做。
- v0.3 实测（Chrome 156.0.8078.47）：`tabs.move` 对调分屏两侧后两个标签 `splitViewId` 不变；`tabs.unsplit` 或关掉一侧后，留下的标签 `splitViewId` 为 -1；`tabs.createSplit` 总是分配新的 `splitViewId`（拆开再拼回后与旧 id 不同，所以记录要绑 id）；`tabs.onUpdated` 没有过滤，不监听；没有 `tabs` 权限也能用 `windows.get` 读 `width`；CDP `Extensions.triggerAction` 作用于 TAB 目标时，弹窗以 `type:"page"` 的 CDP 目标出现（约 250ms），传页面 targetId 会报错。
- v0.4 核查（附录 A，Chromium M155 源码与 Chrome 156.0.8078.47 原型）：
  - activeTab：点工具栏图标打开 `default_popup` 时就授予（F1，CDP `Extensions.triggerAction` 作用于 tab 目标同样授予，它只接受 `type: "tab"` 的目标）；`action.openPopup()` 不授予（F2）；点右键菜单项在派发 `onClicked` 前授予，直接调处理函数的对照组读不到网址（F3）；`commands.onCommand` 派发前也给活动标签授予（媒体键除外，未实测，F4）。授予的是当前已提交 origin 的标签专属 host 权限和 `url/title/favIconUrl`，声明了 DNR 时附带 `declarativeNetRequestFeedback`，opaque origin 不加 host 权限（F5）；只作用于这个标签，弹窗关掉后还在，同 origin、同文档导航后还在，跨 origin 导航提交或标签销毁后撤销（F6）。
  - `tabs.create({ splitWithTabId })`、`tabs.createSplit` 不检查 host 权限和 activeTab，`createSplit` 返回新 `splitViewId`（F7）；对本扩展分屏右侧 `tabs.update` 原地换页、分屏不拆，对未授权的左侧 `tabs.update` 同样成功（F8）。分屏 API 在 155–157 签名不变；M155/M156 在 Document PiP 窗口上会 CHECK，M157 返回错误（F17）。
  - 右键菜单：标题里 `%s` 替换后按词边界截到 75 字符，只截标题（F10）；SW 扩展的菜单项存进 state store、重启后读回，卸载、重新加载、更新时清掉，MV3 必须用 `onClicked`、`id` 必填（F13）；CDP 右键能弹原生菜单但点不了菜单项，首字母助记键与 Chrome 自带项冲突（`y` 撞 “Cop&y image”，F20）。
  - S2：真点固定在工具栏上的图标会授予 activeTab，弹窗和 SW（`tabs.get(tabId).url`）都读得到网址，弹窗关掉后 SW 仍读得到，跨 origin 导航后读不到；`sender.url` 是弹窗页本身的网址（本仓库按 `chrome.runtime.getURL("popup/popup.html")` 比对，带不带查询串都算）。S1：弹窗里建成分屏（`active: false`）后弹窗没有被关掉（只在 Xvfb 上测过）。
  - S3：Chrome 不截断 `selectionText`（测到 500 万字符）；每个 `\n`、`\t` 各换成一个空格、不合并；NBSP、U+2003、U+3000 原样保留；隐藏文字不在里面。所以查询词上限就是 500 码点，规范化前先粗截 10000 码点。
  - S6：`documentUrlPatterns` 按选区所在 frame 的网址匹配（`srcdoc`、`about:blank` iframe 里不出现，跨 origin 和 sandbox 的 http(s) iframe 里出现，`tab` 是顶层标签）；可编辑区域里菜单项会出现、`info.editable === true`（所以 `editable` 规则是必需的）；密码框的 `selectionText` 是掩码圆点；拆分视图右侧窗格里 `tab` 就是右侧标签；无痕窗口、chrome:// 里不出现；PDF 查看器里会出现选区项（② 可用）。应用店页面没测。
  - S7：`targetUrlPatterns` 只放行 http(s) 时，菜单项在 `data:`、`blob:` 图片上不出现；`srcUrl` 等于图片的 `currentSrc`（srcset、`<picture>` 实际选中的候选），过滤也按 `currentSrc` 匹配；JS 懒加载换成真实地址前不出现。
  - S8：用户在 Windows Chrome（住宅 IP）手测，TinEye、SauceNAO、Yandex 都直接出结果，Yandex 未被地区封锁；Lens 对 404 图显示“出了点问题 / 该网址中没有图片”，不需特别处理。
  - S9：activeTab 会让 DNR 规则在那个标签里生效一次：未授权引擎的结果页标签触发 action 后，同一标签同 origin 导航到带 `_ss` 的网址会被重定向并分屏；经 go.html 往返后 activeTab 失效。从没触发过 action 的标签不重定向。
  - S10：扩展用 `tabs.create`/`tabs.update` 发起的导航不带页面 `Referer`（`Sec-Fetch-Site` 分别是 `none`、`cross-site`），所以隐私说明可以写“页面网址不发”。对照：页面里点链接跨 origin 打开带 `Referer`。
  - S11：本扩展菜单项排在 Chrome 自带项之后、“检查”之前（倒数第二行），zh_CN 与 en 相同；选区落在别处时在图片上右键只有图片项；只有图片在选区里时本扩展两项收进标题为 `Split Search` 的子菜单。引擎名 `A&B %s` 经转义显示为 `A&B % s`，默认标题没有字符被当成助记键。
  - S12：e2e 测试配置里 `engine-u`、`page-u`、`engine-i` 三个 origin 都没有 host 权限；引擎 U 作左侧会进 DNR 的 `requestDomains`，但带 `_ss` 的网址不重定向。
  - S14：“继续浏览上次打开的网页”会恢复拆分视图，`splitViewId` 与重启前相同，标签 id 全变；`storage.session` 清空，恢复的分屏两侧都没有记录。所以兜底判出的 `fallback-own` 按 `foreign` 处理确有必要。
