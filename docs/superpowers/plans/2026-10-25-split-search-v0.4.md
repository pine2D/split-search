# Split Search v0.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加 `activeTab`、`contextMenus` 两个权限，实现 ⑦ 工具栏弹窗把现有搜索补成分屏、② 选中文字右键边读边查、⑧ 图片右键以图搜图，并把记录模型扩展成能区分“搜索对”和“查询对”，保证任何路径都不覆盖用户的网页。

**Architecture:** 记录多两个字段 `role`（`search`/`page`/`lookup`）和 `input`（`text`/`image`），归属判定仍收敛在 `src/lib/split-owner.js`；`decideSplit` 收 `role`，`fallback-own` 一律按 `foreign` 处理。右键的八行判定表是纯函数 `src/lib/lookup-decision.js`，执行在 SW 的 `src/chrome/lookup-actions.js`；⑦ 的结果页识别是纯函数 `src/lib/result-match.js`，执行也在 SW（`src/chrome/complete-actions.js`，弹窗只发 `{type, tabId, engineId}`）。右键和 ⑦ 共用 SW 里一条全局串行链；以图搜图引擎是独立的一套列表（`src/lib/image-engines.js` 数据 + `mergeConfig` 合并），按 `kind` 经 `enginesFor`/`engineById` 取用。

**Tech Stack:** Chrome MV3（最低 155，本机实测 156），原生 ES modules，无构建、无依赖；`node --test`；`scripts/e2e`（管道 CDP、Xvfb/Xephyr、xinput）。

**Spec:** `/home/oumu/projects/split-search/docs/superpowers/specs/2026-10-25-v0.4-read-and-search-design.md`（下文“spec 3.1”等指它的章节）。执行者必须同时读 spec 与本计划；本计划只写 spec 留给计划的决定（文件、签名、测试、取值），spec 已写明的行为不重复。

## Global Constraints

- 直接在 `main` 上工作，不建 worktree（用户决定）。
- `manifest_version: 3`；`minimum_chrome_version: "155"`；`incognito: "not_allowed"`；`manifest.key` 不动。
- `permissions` 恰好是 `["activeTab", "contextMenus", "declarativeNetRequest", "storage"]`（字母序；`src/manifest.json`、`scripts/pack-lib.mjs` 的 `HARD.permissions`、`test/manifest.test.js` 三处同一顺序）。禁止 `tabs`，禁止 `host_permissions`。
- `optional_host_permissions: ["https://*/*", "http://*/*"]`；运行时只为文字引擎的精确 origin 申请；以图搜图引擎不申请任何权限、设置页不显示授权按钮。
- `web_accessible_resources: [{ "resources": ["go.html"], "matches": ["<all_urls>"], "use_dynamic_url": true }]` 不变；不加 `externally_connectable`，不注册 `onMessageExternal`。
- `src/lib/` 不得引用 `chrome`；JS 单文件 ≤ 300 行（`test/` 除外，`scripts/` 同样受限）；无构建、无运行时依赖。
- 标记参数 `_ss`、引擎 id `/^[a-z0-9-]{1,20}$/`（文字引擎与以图搜图引擎共用一个命名空间）、DNR 规则 id `1`、`regexSubstitution` 写法均不变。
- 预置文字引擎与默认组合 `["google", "bing"]` 不变；以图搜图预置 `lens` Google Lens `https://lens.google.com/uploadbyurl?url=%s`，不能删除。
- 界面文字只写在 `src/_locales/{en,zh_CN,zh_TW,es}/messages.json`，4 种语言 key 同时补齐；`src` 代码里不得有界面文字；SW 的菜单标题同样经 `src/chrome/i18n.js` 的 `t()`；`chrome.i18n.getMessage` 只用于 manifest；唯一允许的 `fetch` 是读包内 `_locales`。
- 关键词、选中文字、图片网址只进 `storage.session`，不进 `storage.sync`，只发给用户所选引擎。
- ② ⑧ 不读、不存、不发 `pageUrl`、`frameUrl`；⑦ 只在用户点图标后读当前标签 `url`，不保存网址本身。不注入内容脚本，不读页面里选区和被右键图片网址以外的内容；不改 Chrome 原生菜单项。
- 只改写记录确认属于本扩展的那一侧（spec 3.1“谁能改写哪一侧”表）；`fallback-own` 不允许任何调用方改写标签。
- 调分屏 API 前必须 `splitWindowType(win) === "normal"`（`src/lib/window-kind.js`：`type === "normal"`、`alwaysOnTop === true` 且标签不多于一个才算 PiP，把 Document PiP 窗口排除在外，见 Spike 结论 S5；窗口管理器置顶的普通窗口同样报 `alwaysOnTop: true`，靠标签数区分，所以喂给 `splitWindowType` 的窗口一律用 `windows.get(id, { populate: true })` 读，不带 populate 时置顶窗口一律按 PiP 处理）；挑“最后聚焦的 normal 窗口”一律经 `lastSplitWindow()`（Task 3），不直接用 `windows.getLastFocused` 的结果；窄窗口阈值 `960`（`width < 960`），`narrowFallback` 缺省 `true`。`window-kind.js`（含 `pickSplitWindow`）、`lastSplitWindow({ fallback })`、`decideFor` 及其在 v0.3 go.js、`openInOtherWindow`、`cycleRight` 的接入已在 v0.3.0 热修（e21e10e，复审修正 073380b）中完成，v0.4 新增的调用方照此使用。
- 菜单项 id：`ss-lookup-text`（`contexts: ["selection"]`）、`ss-lookup-image`（`contexts: ["image"]`，`targetUrlPatterns: ["https://*/*", "http://*/*"]`），两项 `documentUrlPatterns: ["https://*/*", "http://*/*"]`。
- `storage.sync` 新顶层键：`lookupEngine`（缺省 = 跟随默认组合右侧，不写默认值）、`imageEngine`（缺省 `lens`）、`imageEngines`（`{ id, name, url }[]`）；单项 8192 字节上限沿用 `saveKeys` 预检。
- ⑦ 消息形状 `{ type: "complete-split", tabId, engineId }`；回复 `{ ok: true, mode: "split" | "adjacent" | "plain" }` 或 `{ ok: false, code }`。新错误码：`not_results_page`、`window_unsupported`、`split_failed`、`message_rejected`。
- 提交用 Conventional Commits，内联身份 `git -c user.name=pine2D -c user.email=oumu323@gmail.com commit`；提交信息末尾空一行后是两行 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 和 `Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9`（下文的 `-m A -m B` 写法正好产生这个格式）。`git add` 一律写明路径。
- 每个任务结束前 `npm test` 全绿。中间任务写的文案初稿照常写 `description`，不得用 `[needs-translation]` 标记（`test/i18n-catalog.test.js` 会拒绝）；待 Task 15 定稿的 key 就是各任务 Files 里列出的那些。
- 日志分两级：预期的拒绝和忽略（右键 `ignore` 的各个 `reason`、`not_results_page`、`message_rejected`、`window_unsupported`）只用 `console.info("[split-search]", <事件>, <code 或 reason>)`；`console.error`（现有的 `log`）只留给真正的异常（API 抛错、写记录失败、菜单 `runtime.lastError`）。e2e 的 B15 只收 `error` 级，所以 T20、T23、T24 有意走的拒绝路径不会让它判失败。两级日志都不带选中文字、图片网址、关键词、`pageUrl` 和标签网址。

## Review Focus

1. **两次右键几乎同时落在同一个没有记录的标签上**：只建一对分屏，第二次在串行链上重新判定后走判定表第 3 行（就地更新查询标签），不留孤立标签。→ Task 9 `background.test.js`“并发右键只建一对”。
2. **图片网址带 `#`、`%20`、`&`、查询串**（`https://img.example.com/a%20b.png?x=1&y=2#f`）：右侧网址里 `url=` 参数解码后逐字等于 `srcUrl`。→ Task 8 `lookup-input.test.js`“图片网址往返”。
3. **结果页网址里关键词用 `+` 表示空格、参数重复、带 `#`**（`?q=hello+world`、`?q=a&q=b`、`?q=a#frag`）：识别出 `"hello world"`、第一个值 `"a"`、不含 fragment。→ Task 10 `result-match.test.js`。
4. **用户引擎名含 `&`、`%s`、`$1`**（`A&B %s $1`）：菜单标题里是 `A&&B % s $1`，`$1` 不被当成占位符，标题里给 Chrome 的 `%s` 保留一个。→ Task 7 `menu-spec.test.js`、`i18n.test.js`。
5. **弹窗打开后、点按钮前，标签被关掉或跨 origin 导航**（`tabs.get` 抛 `No tab with id`，或 `url` 变成 `undefined`）：SW 回 `not_results_page`，不建任何标签、不写记录。→ Task 11 `complete-actions.test.js`。

## Spike 结论

第 0 阶段 spike 已于 2026-10-25 完成（Chrome 156.0.8078.47，Linux Xvfb，记录见会话 scratchpad 的 `v04-spikes.md`）。S2、S7 都成立，没有触发 spec 第 4 节的停止条件，⑦ ⑧ 按原设计实现。Task 11b 于同日完成 S9–S12（同一版本 Chrome，Xvfb 2400×1500、dpr 1.5；S11 用一次性配置装本检出的 `src/`，S9、S10、S12 用 e2e 测试配置，做完 storage 已逐键恢复；脚本在会话 scratchpad 的 `spike-11b/`），四项都落在默认分支；S8 待用户手测。

| Spike | 结果 | 对本计划的影响 |
|---|---|---|
| S2 | 成立。真点固定在工具栏上的图标会授予 activeTab；弹窗和 SW（`tabs.get(tabId).url`）都读得到网址，弹窗关掉后 SW 仍读得到，跨 origin 导航后读不到；`sender.url` 是弹窗页本身的网址（spike 扩展的弹窗放在根目录，所以是 `/popup.html`；S2 只证实它带扩展 origin、没有额外前缀） | Task 11 按原设计在 SW 执行，`activeTab` 的权限理由成立；不需要先做 S1；本仓库按 `chrome.runtime.getURL("popup/popup.html")` 比对（Task 10） |
| S1（顺带） | 弹窗里 `tabs.create({ splitWithTabId, active: false })` 建成分屏后，弹窗没有被关掉（又活了 4 秒以上，一直 visible）。只在 Xvfb 上测过 | 不改设计，写进已知事实（Task 16） |
| S3 | Chrome 不截断 `selectionText`（测到 500 万字符）；每个 `\n`、`\t` 各换成一个空格、不合并；NBSP、U+2003、U+3000 原样保留；隐藏文字不在里面 | Task 8：`SELECTION_MAX = 500`；规范化前先粗截（`SELECTION_PRECUT = 10000` 码点），免得对几 MB 的文字跑正则；`/\s+/gu` 已覆盖 NBSP 和 U+3000 |
| S5 | PiP 窗口在扩展 API 里是 `type: "normal"`、`alwaysOnTop: true`，带一个自己的标签；PiP 获得焦点时 `windows.getLastFocused({ windowTypes: ["normal"] })` 返回的就是它；在 PiP 里右键时 `tab` 指向 PiP 自己的标签。按 `createPaired` 的参数形状（`windowId` 是 PiP、`splitWithTabId` 是 PiP 标签）调用，Chrome 156 直接崩溃（SIGTRAP）。spec 3.7 举的拦截写法（“再核对该窗口里能 `tabs.query` 到这个标签”）拦不住，PiP 的标签本来就查得到。`documentUrlPatterns` 只放行 http(s) 时，PiP（`about:blank`）里根本不出现本扩展的菜单项 | 落在 spec 第 4 节“要加额外拦截”的分支，拦截条件改用 `alwaysOnTop`：Task 2 新增纯函数 `splitWindowType(win)`、`canSplitIn(win)`（`src/lib/window-kind.js`），所有判定窗口类型的地方都传它的结果；Task 3 新增 `lastSplitWindow()`，v0.3 的 `openInOtherWindow`、go.js 和 Task 5 的 `cycleRight`、Task 9 的 `other-window`、Task 11 的 `window_unsupported` 都改用它们。`documentUrlPatterns` 是第一道拦截，这是第二道。置信度中（只在 Linux 156 上测过）。window-kind.js、lastSplitWindow() 及 v0.3 go.js/openInOtherWindow/cycleRight 的接入已在 v0.3.0 热修（e21e10e，复审修正 073380b）中完成；复审补测：窗口管理器置顶（`_NET_WM_STATE_ABOVE`）的普通窗口也报 `alwaysOnTop: true`，PiP 只有一个标签且加不进去，所以判定加了“标签不多于一个”，读窗口带 `populate: true` |
| S6 | `documentUrlPatterns` 按选区所在 frame 的网址匹配（`srcdoc`、`about:blank` iframe 里不出现，跨 origin 和 sandbox 的 http(s) iframe 里出现，`tab` 是顶层标签）；可编辑区域里菜单项会出现、`info.editable === true`；密码框的 `selectionText` 是掩码圆点；拆分视图右侧窗格里 `tab` 就是右侧标签；无痕窗口不出现；chrome:// 不出现。**与 spec 3.8 不一致：PDF 查看器里会出现选区项**（② 可用；PDF 里的图片项没测）。应用店页面没测 | Task 8 的 `editable` 规则是必需的（不只是保险），判定表照常用 `tab`；Task 14 的验收表把 PDF 查看器改成“出现”；Task 16 写进已知事实 |
| S7 | 成立。`targetUrlPatterns` 只放行 http(s) 时，菜单项在 `data:`、`blob:` 图片上不出现；`srcUrl` 等于图片的 `currentSrc`（srcset、`<picture>` 实际选中的候选），过滤也按 `currentSrc` 匹配；JS 懒加载换成真实地址前不出现，之后出现 | Task 8 的 `bad_src` 复查作为保险保留；Task 13 T22(c) 按原设计；Task 16 写进已知事实 |
| S14（顺带） | “继续浏览上次打开的网页”会恢复拆分视图（两种方式建的都恢复），`splitViewId` 与重启前相同，标签 id 全变；`storage.session` 清空，恢复的分屏两侧都没有记录 | 不改设计：`fallback-own` 按 `foreign` 处理（Task 2、Task 3 的 T5 重启子项）确有必要；Task 16 写进已知事实 |
| S11 | 默认分支成立，zh_CN 与 en 数值相同。本地 http 页面（英文段落 + http 图片）上真实右键：选区菜单 8 行（复制、复制指向突出显示的内容的链接、使用 Google 搜索、打印、在阅读模式下打开、将所选内容翻译为中文（简体）、**本扩展项**、检查），图片菜单 8 行（在新标签页中打开图片、图片另存为、复制图片、复制图片地址、为此图片创建二维码、使用 Google 智能镜头搜索此图片、**本扩展项**、检查）；扩展页 `contextMenus.removeAll()` 后两种菜单都剩 7 行，少掉的就是倒数第二行（0 起算第 6 行），排在 Chrome 自带项之后、“检查”之前。选区落在别处时在图片上右键：选区还在，但菜单只有图片项、没有子菜单；只有图片在选区里（`selectAllChildren(body)`）时才是 13 行，本扩展两项收进标题为 `Split Search` 的子菜单（0 起算第 11 行）。引擎名 `A&B %s` 显示为 `A&B % s`（`&&` 显示成一个 `&`）；两种语言的默认标题都没有字符被当成助记键（无下划线、无字符丢失）。“翻译所选内容”在 en 界面、英文页面上也出现（Translate selection to English） | Task 13：`MENU_INDEX = { text: 6, image: 6 }`、`MENU_MIN_ITEMS = { text: 8, image: 8 }`；`page-u` 页面的菜单若多出别的项（如链接项），行号会变，`contextMenuPick` 的 `expectItems` 只拦“少于”，所以 T21/T22 的 detail 照写实际行数。Task 7 Step 5（T11 点第 3 项不受影响）、Task 15 Step 1 按默认分支不变。“图片右键前清掉选区”保留：清掉后两种情况都排除。**关菜单的点不能沿用现有 `dismiss` 的 `(at.x, at.y + 400)`**：菜单从右键点向右下展开，8 行菜单高 448–471 X 像素（dpr 1.5），这个点正好落在菜单里本扩展项到“检查”一带（可能点中其中一项），spike 第一轮这样点完菜单没关掉、下一次右键没出菜单；Task 13 的 `dismissMenu` 要点在菜单矩形（`windowRect`）以外的页面位置 |
| S12 | 成立。e2e 测试配置里 `permissions.contains` 对 `engine-u`、`page-u`、`engine-i` 三个 origin 都是 `false`（`engine-b` 对照为 `true`）；临时加 `eu` 后 DNR 规则的 `requestDomains` 含 `engine-u.localhost`，新标签打开 `engine-u/search?q=x&_ss=eu,eb` 仍不重定向：网址原样带 `_ss`，模拟服务器收到带 `_ss` 的请求。对照：已授权的 `engine-b` 当左侧（`_ss=eb,eu`）会重定向并分屏，**但 `Page.getNavigationHistory` 里同样没有 `go.html`**：go.js 用 `location.replace` 换掉了这一项，只剩去掉 `_ss` 的左侧网址 | Task 12 的 `UNGRANTED_HOSTS` 不变。判“没被重定向”不能只看导航历史里有没有 `go.html`：要用控制台收集器 Network 记下的主框架跳转链，或者同时断言标签网址仍带 `_ss`（或模拟服务器收到了带 `_ss` 的请求） |
| S10 | 成立。在 `page-u` 标签上经扩展页调 `tabs.create({ url, splitWithTabId })` 和 `tabs.update(另一标签, { url })`（目标 `engine-u` 与已授权的 `engine-b` 都测了），模拟服务器收到的请求都没有 `Referer`（`Sec-Fetch-Site` 分别是 `none`、`cross-site`）。对照：同一页面里点链接跨 origin 打开，带 `Referer: http://page-u.localhost:8765/` | Task 15 Step 2 照写“页面网址不发”；Task 16 Step 6 向用户报告这条结论 |
| S9 | activeTab 会让 DNR 规则在那个标签里生效一次。没授权的 `engine-u` 结果页标签：`triggerAction` 前 `tabs.get(id).url` 为空，之后有值（156 上复核 F1：`triggerAction` 和真点图标一样授予 activeTab；它只接受 `type: "tab"` 的目标）。随后同一标签同 origin 导航到 `engine-u/search?q=y9&_ss=eu,eb`：被重定向到 go.html 并建成分屏（左侧去掉 `_ss`，右侧是 `eb`）；经 go.html 往返后 activeTab 失效，`tabs.get(id).url` 又为空。另一个从没触发过 action 的标签打开同类网址不重定向 | 不改设计，Task 16 Step 2 写进已知事实；Task 12 的 G5 降级网址必须用从没触发过 action 的新标签（已这样写） |

e2e 可以复用的办法（不在本计划范围内，记下备用）：`developerPrivate.updateExtensionConfiguration({ pinnedToToolbar: true })` 固定图标后按图标颜色定位、真实点击打开弹窗，能测到 activeTab 路径；菜单项可用 Z、J、K、X 首字母键选中，不和 en 的 Chrome 自带项冲突（本计划不用：zh_CN 与其他语言没核实，Task 13 规定不向菜单发任何按键）。

## Spike 对账（尚未完成的 spike）

下列 spike 由 Task 11b（S8–S12，按 spec 第 4 节的时机：S11、S12 在写 e2e 前，S10 在改隐私文案前）和 Task 16 Step 6（S13，发布前）完成。完成前相关步骤按默认分支写；完成后按 spec 第 4 节的分支改对应步骤，并把结论移进上一节。

| Spike | 默认分支（本计划按此写） | 在哪做 → 受影响的步骤 |
|---|---|---|
| S8 | 引擎库只收 `bing-img`、`yandex-img` | Task 11b Step 5（用户手测）→ Task 4 的 `IMAGE_CATALOG`。S8: 待用户手测（controller 另行询问） |
| S13 | Lens 活动记录不提 | Task 16 Step 6（发布前，用户手测）→ Task 15 Step 2 |

---

### Task 0: 提交本计划

- [ ] **Step 1**：`git add docs/superpowers/plans/2026-10-25-split-search-v0.4.md`，提交 `docs(plan): add the v0.4 implementation plan`（身份与尾注同 Global Constraints）。之后每次把 spike 结论写回本计划，都在对应任务里用 `docs(plan): …` 单独提交，保证 Task 16 Step 5 的工作区是干净的。

---

### Task 1: 权限变更（manifest、硬约束、pack-lib、冒烟）

**Files:**
- Modify: `src/manifest.json`（`permissions`）、`scripts/pack-lib.mjs`（`HARD.permissions` 与第 4 行注释）、`scripts/pack-smoke.mjs`（权限警告核对）、`CLAUDE.md`（“硬约束”的 `permissions` 一条）
- Test: `test/manifest.test.js`、`test/pack.test.js`

**Interfaces:**
- Produces：`HARD.permissions = ["activeTab", "contextMenus", "declarativeNetRequest", "storage"]`；`pack-smoke.mjs` 里 `export const EXPECTED_PERMISSION_WARNINGS: string[]`（v0.3 装出的英文警告原文，只有 DNR 一条）。

- [ ] **Step 1: 记下 v0.3 的权限警告原文**：改动前在干净树上跑 `npm run pack -- --smoke`，在 `smoke()` 里临时打印 `developerPrivate.getExtensionInfo` 的 `permissions.simplePermissions.map(p => p.message)`，把输出记下（Step 4 写成常量）。临时打印不提交。

- [ ] **Step 2: 写失败的测试**

```js
// test/manifest.test.js（改写“manifest 满足硬约束”的 permissions 断言）
assert.deepEqual(m.permissions, ["activeTab", "contextMenus", "declarativeNetRequest", "storage"]);
assert.ok(!m.permissions.includes("tabs"));
assert.equal(m.host_permissions, undefined);
// test/pack.test.js
test("checkManifest：多出别的权限照样报错", () => {
  const bad = { ...goodManifest, permissions: [...HARD.permissions, "tabs"] };
  assert.ok(checkManifest(bad, { version: bad.version }).length > 0);
});
test("checkManifest：少一个新权限也报错", () => {
  const bad = { ...goodManifest, permissions: ["declarativeNetRequest", "storage"] };
  assert.ok(checkManifest(bad, { version: bad.version }).length > 0);
});
```
（`goodManifest` 沿用 `test/pack.test.js` 现有的合法 manifest 构造方式。）

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/manifest.test.js test/pack.test.js`
Expected: FAIL（permissions 断言不符）

- [ ] **Step 4: 实现**：manifest、`HARD.permissions` 按上面的顺序；`pack-smoke.mjs` 读 `simplePermissions` 的 `message` 列表，与 `EXPECTED_PERMISSION_WARNINGS` 逐项相等，不等就判冒烟失败并打印实际值；CLAUDE.md 硬约束改成“`permissions` 只能是 `["activeTab", "contextMenus", "declarativeNetRequest", "storage"]`（字母序）。禁止 `tabs`，禁止必需的 `host_permissions`。”（CLAUDE.md 其余 v0.4 改动在 Task 16。）

- [ ] **Step 5: 跑测试与冒烟**

Run: `npm test && npm run pack -- --smoke --allow-dirty`
Expected: PASS；冒烟打印的权限警告与 v0.3 相同（证明两个新权限没有安装警告，spec F15）

- [ ] **Step 6: Commit**（两个提交：spec 3.9 要求第一个只含硬约束、manifest、`HARD.permissions` 和对应测试；冒烟的警告核对单独第二个）

```bash
git add src/manifest.json scripts/pack-lib.mjs CLAUDE.md test/manifest.test.js test/pack.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(manifest): request activeTab and contextMenus" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
git add scripts/pack-smoke.mjs
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "test(pack): check that the smoke install shows no new permission warnings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 2: 记录模型与归属判定纯逻辑（W1）

**Files:**
- ~~Create: `src/lib/window-kind.js`~~（已在 v0.3.0 热修中完成（e21e10e），不再新建）
- Modify: `src/lib/split-owner.js`、`src/lib/split-decision.js`
- Test: ~~`test/window-kind.test.js`（新建）~~（已在 v0.3.0 热修中完成（e21e10e））、`test/split-owner.test.js`、`test/split-decision.test.js`；期望值随记录形状改：`test/split-actions.test.js`、`test/split-state.test.js`、`test/right-switch.test.js`、`test/background.test.js`

**Interfaces:**
- Produces（`src/lib/split-owner.js`）：
  - `Record = { peer, splitViewId, mode: "split"|"adjacent", role: "search"|"page"|"lookup", input?: "text"|"image", engine: string, query: string }`
  - `parseRecord(value): Record | null`：没有 `role` 补 `"search"`；`role: "search"` 的结果不带 `input`（存了也丢掉）；`page`/`lookup` 必须有合法 `input`；`role` 其他值 → `null`；`engine === ""` 只允许 `page`，`page` 的 `engine` 必须是 `""`（否则 `null`）。
  - `makeRecords({ a, b, splitViewId, mode, engineA, engineB, query, roleA = "search", roleB = "search", input })`：两条记录总是写 `role`（搜索对写 `role: "search"`）；`roleA`/`roleB` 不是 `search` 时两条都写同一个 `input`；搜索对不写 `input` 键。
  - `staleMarker`、`judgeOwnership` 签名不变；`recordMatches` 多两条：角色配对（`search`↔`search` 或 `page`↔`lookup`）、查询对两侧 `input` 相同，不满足 → `"stale"`。
- Produces（`src/lib/split-decision.js`）：`decideSplit({ windowType, splitViewId, peer, ownership, narrow, role })`：先算 `own = ownership === "own" && role !== "lookup"`（`fallback-own` 不算），再沿用 v0.3 的分支（`own` 代替原来的 `ownership === "own"`；分屏中只有 `own` 才 `reuse`，其余 `foreign`）。`windowType` 仍按 `!== "normal"` 判 `other-window`，调用方传 `splitWindowType(win)`（Task 3）。
- Produces（`src/lib/window-kind.js`，S5）——已在 v0.3.0 热修中完成（e21e10e），下列接口已存在，本任务不重做：
  - `splitWindowType(win): string`：`win` 缺失 → `"none"`；`win.type === "normal" && win.alwaysOnTop === true` 且 `win.tabs` 不多于一个（或没有）→ `"pip"`；其余返回 `win.type`。
  - `pickSplitWindow(last, all): Window | null`：`last` 能分屏就用它；否则在 `all` 里依次取 focused 的、打开 PiP 的（`last.tabs[0].openerTabId` 所在）、没最小化且最近用过的（标签 `lastAccessed` 最大）。
  - `src/lib/split-decision.js` 的 `decideFor(ctx, narrowEnabled)`：go.js 的判定入口，`windowType: splitWindowType(ctx.win)`、`narrow: isNarrow(ctx.win?.width, narrowEnabled)`。
  - `canSplitIn(win): boolean`：`splitWindowType(win) === "normal"`。
  - 文件头注释写明原因：Document PiP 窗口报 `type: "normal"`、`alwaysOnTop: true`，在它上面按 `createPaired` 的参数调用分屏 API 会让 Chrome 156 崩溃。

- [ ] **Step 1: 写失败的测试**（`test/split-owner.test.js` 增加；`base = { peer: 2, splitViewId: 7, mode: "split", engine: "ea", query: "q" }`）

```js
test("parseRecord：没有 role 按 search，search 不带 input", () => {
  assert.deepEqual(parseRecord(base), { ...base, role: "search" });
  assert.equal("input" in parseRecord({ ...base, role: "search", input: "text" }), false);
});
test("parseRecord：查询对", () => {
  assert.equal(parseRecord({ ...base, role: "lookup" }), null);               // 缺 input
  assert.equal(parseRecord({ ...base, role: "lookup", input: "video" }), null);
  assert.deepEqual(parseRecord({ ...base, role: "lookup", input: "image" }), { ...base, role: "lookup", input: "image" });
  assert.deepEqual(parseRecord({ ...base, engine: "", role: "page", input: "text" }), { ...base, engine: "", role: "page", input: "text" });
  assert.equal(parseRecord({ ...base, role: "page", input: "text" }), null);  // page 的 engine 必须为空
});
test("parseRecord：未知 role、engine 为空却不是 page", () => {
  assert.equal(parseRecord({ ...base, role: "owner" }), null);
  assert.equal(parseRecord({ ...base, engine: "" }), null);
  assert.equal(parseRecord({ ...base, engine: "", role: "lookup", input: "text" }), null);
});
test("makeRecords：查询对两侧同一个 input", () => {
  assert.deepEqual(makeRecords({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "", engineB: "bing",
    query: "x", roleA: "page", roleB: "lookup", input: "text" }), {
    "split:1": { peer: 2, splitViewId: 7, mode: "split", role: "page", input: "text", engine: "", query: "x" },
    "split:2": { peer: 1, splitViewId: 7, mode: "split", role: "lookup", input: "text", engine: "bing", query: "x" },
  });
  const s = makeRecords({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "ea", engineB: "eb", query: "q" })["split:1"];
  assert.equal(s.role, "search"); assert.equal("input" in s, false);
});
test("staleMarker 保留 role 与 input", () => {
  const r = staleMarker({ ...base, role: "lookup", input: "image" });
  assert.equal(r.role, "lookup"); assert.equal(r.input, "image"); assert.equal(r.splitViewId, -1);
});
```
  `judgeOwnership`（沿用现有 `tab`/`peer` 夹具，两条记录互指、`splitViewId` 都是 7）：`page`↔`lookup` 同 `input` → `"own"`；`search`↔`lookup` → `"stale"`；`page`↔`page` → `"stale"`；`page:text`↔`lookup:image` → `"stale"`；旧形状两侧都无 `role` → `"own"`。

  `test/split-decision.test.js`：删掉“无记录兜底判为本扩展 → reuse”，换成：

```js
test("fallback-own 在分屏中 → foreign", () => assert.equal(decideSplit({ ...base, ownership: "fallback-own" }), "foreign"));
test("当前标签是 lookup：分屏中 foreign，相邻对 new", () => {
  assert.equal(decideSplit({ ...base, ownership: "own", role: "lookup" }), "foreign");
  assert.equal(decideSplit({ ...base, splitViewId: -1, ownership: "own", role: "lookup", narrow: true }), "new");
});
test("当前标签是 page：照常 reuse / join", () => {
  assert.equal(decideSplit({ ...base, ownership: "own", role: "page" }), "reuse");
  assert.equal(decideSplit({ ...base, splitViewId: -1, ownership: "own", role: "page", narrow: false }), "join");
});
test("没有 role（旧调用方）按 search", () => assert.equal(decideSplit({ ...base, ownership: "own" }), "reuse"));
test("PiP 窗口 → other-window", () => assert.equal(decideSplit({ ...base, windowType: "pip", ownership: "own" }), "other-window"));
```
  （最后一条“PiP 窗口 → other-window”已在 v0.3.0 热修中完成（e21e10e），已在 `test/split-decision.test.js` 里，不要重复添加。）

  `test/window-kind.test.js`（已在 v0.3.0 热修中完成（e21e10e），以下用例已在仓库里，本任务不再写；复审修正 073380b 又加了置顶且多标签 → `normal`、`pickSplitWindow` 的用例）：

```js
test("splitWindowType：普通窗口、PiP、popup、缺失", () => {
  assert.equal(splitWindowType({ type: "normal", alwaysOnTop: false }), "normal");
  assert.equal(splitWindowType({ type: "normal" }), "normal");
  assert.equal(splitWindowType({ type: "normal", alwaysOnTop: true }), "pip");
  assert.equal(splitWindowType({ type: "popup", alwaysOnTop: true }), "popup");
  assert.equal(splitWindowType(undefined), "none");
});
test("canSplitIn 只放行非置顶的 normal", () => {
  assert.equal(canSplitIn({ type: "normal", alwaysOnTop: false }), true);
  assert.equal(canSplitIn({ type: "normal", alwaysOnTop: true }), false);
  assert.equal(canSplitIn({ type: "app" }), false);
  assert.equal(canSplitIn(null), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/window-kind.test.js test/split-owner.test.js test/split-decision.test.js`
Expected: FAIL

- [ ] **Step 3: 实现** ~~`window-kind.js`~~（已在 v0.3.0 热修中完成（e21e10e））、`parseRecord`、`makeRecords`、`recordMatches`、`decideSplit`；`judgeOwnership` 的兜底逻辑与 `looksLikeSearchPage` 不改（spec 3.1“兜底”）。文件头注释里的记录形状同步改。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS。对 `session.set` 做全等断言的旧用例会因多了 `role: "search"` 失败，按新形状改期望值、不改行为：`test/split-actions.test.js` 的 `rec()` 补 `role: "search"`（第 68 行，覆盖第 86–400 行的十几处），`test/split-state.test.js`、`test/right-switch.test.js`、`test/background.test.js` 里同类断言同样补上。

- [ ] **Step 5: Commit**

```bash
git add src/lib/split-owner.js src/lib/split-decision.js test/split-owner.test.js test/split-decision.test.js test/split-actions.test.js test/split-state.test.js test/right-switch.test.js test/background.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(split): tell search pairs from lookup pairs and stop fallback reuse" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 3: 记录读写与动作接入角色（W1）

**Files:**
- Modify: `src/chrome/split-state.js`（`writePair` 透传）、`src/chrome/split-actions.js`、`src/go.js`、`scripts/e2e/steps/v03-lib.mjs`（`checkPairRecords`；接收 `ids`、`fmt`、`expectForeign`）、`scripts/e2e/steps/v03-split.mjs`（`expectForeign` 移出）、`scripts/e2e/steps/flow-restart.mjs`（`T5_RESTART` 期望改成 `foreign`、注释）、`scripts/e2e/steps/flow.mjs`（T5 标题、`ids`/`fmt` 的 import）
- Test: `test/split-state.test.js`、`test/split-actions.test.js`、`test/e2e-v03.test.js`

**Interfaces:**
- Consumes: Task 2 的 `makeRecords`、`parseRecord`、`decideSplit`、`splitWindowType`、`canSplitIn`。
- Produces：
  - `writePair({ a, b, splitViewId, mode, engineA, engineB, query, roleA, roleB, input })`（原样交给 `makeRecords`）。
  - `createPaired(url, withTab, { split = true, active = false } = {}): Promise<{ tab, splitViewId }>`。
  - `export async function confirmedSplitViewId(aId, bId): Promise<number>`（改成导出，逻辑不变）。
  - `export async function openRight(left, rightUrl, narrow, { leftId, rightId, query, roleA = "search", roleB = "search", input, active = false }): Promise<"split" | "adjacent" | "plain">`：建成分屏写 `split` 记录、窄窗口写 `adjacent`、退化不写并返回 `"plain"`。`recordNewPair` 收同样的角色参数。
  - `refreshPair` 写回时 `roleA = roleB = "search"`、不传 `input`。
  - go.js 经 `decideFor(ctx, narrowEnabled)` 判定（v0.3.0 热修（e21e10e，复审修正 073380b）已把 go.js 的判定抽到 `src/lib/split-decision.js` 的 `decideFor`，`windowType: splitWindowType(ctx.win)` 就在里面），本任务只在 `decideFor` 里加 `role: ctx.record?.role`。**`test/split-decision.test.js` 的 `decideFor` PiP 用例（`ctx.win` 是 `{ type: "normal", alwaysOnTop: true }` → `other-window`）和 `test/go-wiring.test.js`（go.js 经 `decideFor`、不直接调 `decideSplit`、`windows.get` 带 `populate: true`）必须保留**：回退成 `windowType: ctx.win.type` 时 PiP 会判成 `new`，`createPaired` 在 PiP 上调分屏 API，Chrome 156 崩溃。
  - `export async function lastSplitWindow({ fallback = true } = {}): Promise<Window | null>`（`split-actions.js`，S5；已在 v0.3.0 热修（e21e10e，复审修正 073380b）中完成，连同 `openInOtherWindow` 改用它，本任务不重做）：`windows.getLastFocused({ windowTypes: ["normal"], populate: true })` 的结果 `canSplitIn` 就用它；不是（PiP 获得焦点时拿到的就是 PiP）时 `fallback` 为 false 返回 `null`，否则 `pickSplitWindow(last, windows.getAll({ windowTypes: ["normal"], populate: true }))`；抛错 → `null`。`openInOtherWindow` 改用它选目标窗口（`null` 时照旧 `windows.create`），宽度取选中窗口的 `width`。
  - e2e：`checkPairRecords(recs, left, right, want)` 的 `want` 多 `roles: [左, 右]`（缺省 `["search", "search"]`）和可选 `input`；期望字段集合按角色算（`search` 对 `engine,mode,peer,query,role,splitViewId`，查询对再加 `input`）。

- [ ] **Step 1: 写失败的测试**
  - `split-state.test.js`：`writeEngine(2, parseRecord(lookupRec), "ddg")` 之后 `split:2` 的 `role === "lookup"`、`input === "image"`、`engine === "ddg"`。
  - `split-actions.test.js`：
    - `reuse` 在 `page` 一侧（会话里 `split:1 = page/text`、`split:2 = lookup/text`，同一 `splitViewId`）：`tabs.update(2, …)` 一次，之后两条记录 `role` 都是 `"search"`、都没有 `input`、`engine` 按左右是 `leftId`/`rightId`。
    - `openRight(T, url, false, { leftId: "", rightId: "bing", query: "x", roleA: "page", roleB: "lookup", input: "text" })`：`splitWithTabId` 成功、复核一致 → 返回 `"split"`，写 `page`/`lookup` 记录。
    - `openRight(T, url, true, { …, active: true })`：`tabs.create` 收到 `active: true`、没有 `splitWithTabId` → 返回 `"adjacent"`，写 `adjacent` 记录。
    - `splitWithTabId` 抛错 → 返回 `"plain"`，不写记录。
    - （已在 v0.3.0 热修（e21e10e，复审修正 073380b）中完成，测试已在 `test/split-actions.test.js`）`lastSplitWindow`：`getLastFocused` 返回 `{ id: 9, type: "normal", alwaysOnTop: true }`、`getAll` 返回 PiP 与 `{ id: 1, type: "normal", alwaysOnTop: false, width: 1200 }` → 返回窗口 1；两者都只有 PiP → `null`；`getLastFocused` 抛错 → `null`。
    - （已在 v0.3.0 热修中完成（e21e10e））`openInOtherWindow` 在最后聚焦的是 PiP 时：`tabs.create` 的 `windowId` 是 1，窄窗口判定用 1200（不是 PiP 的 524），没有任何以 PiP 的窗口或标签为参数的分屏调用。
  - `e2e-v03.test.js`：`checkPairRecords` 对带 `role: "search"` 的记录通过；缺 `role` 报字段不符；查询对 `want.roles = ["page", "lookup"], input: "text"` 时校验 `input`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/split-state.test.js test/split-actions.test.js test/e2e-v03.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**上述接口；`openNew`/`openForeign`/`openInOtherWindow` 改调导出的 `openRight`，行为不变（`active: false`）；`openInOtherWindow` 选窗口改经 `lastSplitWindow()`（已在 v0.3.0 热修中完成（e21e10e））。

- [ ] **Step 4: 改 e2e 的重启兜底期望**：`T5_RESTART` 现在期望“恢复的分屏两侧都不动，在右边新开一对”（spec 3.1“兜底”），判定复用 `v03-split.mjs` 的 `expectForeign`。为免 `v03-lib.mjs` ↔ `flow-restart.mjs` 循环引用，`ids`、`fmt` 与 `expectForeign` 一起移到 `v03-lib.mjs` 导出，`flow-restart.mjs`、`flow.mjs`、`v03-split.mjs` 改从那里 import。`expectForeign` 靠扩展读得到的 `tabUrl`，只适用于已授权的模拟 host（`page-u` 这类未授权标签用 Task 12 的 `cdpUrl` + 标记，T23、T24 不直接复用它）。子项名改成“重启后在左侧触发：不覆盖，在旁边新开一对”；`flow.mjs` 第 54 行 T5 标题的“重启后仍就地更新”改成“重启后在旁边新开一对”，`flow-restart.mjs` 第 43 行注释同步改。

- [ ] **Step 5: 跑测试与相关 e2e**

Run: `npm test && npm run e2e -- --auto-only --only T5,T16,T17,T18`
Expected: PASS；T5 的重启子项按新期望通过（重启后分屏没有恢复时记 skip，同现状）

- [ ] **Step 6: Commit**

```bash
git add src/chrome/split-state.js src/chrome/split-actions.js src/go.js scripts/e2e/steps/v03-lib.mjs scripts/e2e/steps/v03-split.mjs scripts/e2e/steps/flow-restart.mjs scripts/e2e/steps/flow.mjs test/split-state.test.js test/split-actions.test.js test/e2e-v03.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "fix(split): keep roles through record writes and never overwrite on fallback" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 4: 以图搜图引擎与查词引擎配置（纯逻辑）

**Files:**
- Create: `src/lib/image-engines.js`
- Modify: `src/lib/engines.js`（`mergeConfig`、`isIdTaken`，新增 `cleanImageEngines`、`enginesFor`、`engineById`）
- Test: `test/image-engines.test.js`（新建）、`test/engines.test.js`

**Interfaces:**
- Produces（`src/lib/image-engines.js`，纯数据，**不 import 任何模块**，避免与 `engines.js` 循环引用）：
  - `export const IMAGE_PRESET = Object.freeze({ id: "lens", name: "Google Lens", url: "https://lens.google.com/uploadbyurl?url=%s" })`
  - `export const IMAGE_CATALOG = [{ id: "bing-img", name: "Bing Visual Search", url: "https://www.bing.com/images/searchbyimage?cbir=sbi&imgurl=%s" }, { id: "yandex-img", name: "Yandex Images", url: "https://yandex.com/images/search?rpt=imageview&url=%s" }]`
- Produces（`src/lib/engines.js`）：
  - `cleanImageEngines(value): { id, name, url }[]`：不是数组当空；只留 `id` 匹配 `ID_PATTERN`、`name`/`url` 是非空字符串、`id !== "lens"` 的项，只取这三个字段，按 id 去重保留首次。
  - `mergeConfig` 多返回 `imageEngines`（`[IMAGE_PRESET, ...cleanImageEngines(stored.imageEngines)]`）、`imageEngine`（存的 id 在 `imageEngines` 里就用，否则 `"lens"`）、`lookupEngine`（存的 id 是未隐藏文字引擎就用，否则 `defaultPair[1]`）。
  - `enginesFor(cfg, kind): Engine[]`：`kind === "image"` 返回 `cfg.imageEngines`，其余返回 `cfg.engines`。
  - `engineById(cfg, kind, id): Engine | null`：`image` 在 `imageEngines` 里查；其余在 `engines` 和 `hidden` 里查。
  - `isIdTaken(id, stored)`：再查 `id === IMAGE_PRESET.id` 和 `cleanImageEngines(stored.imageEngines)`。

- [ ] **Step 1: 写失败的测试**

```js
// test/engines.test.js
test("mergeConfig：lens 在前，自定义以图搜图引擎被清洗", () => {
  const cfg = mergeConfig({ imageEngines: [
    { id: "bing-img", name: "Bing", url: "https://www.bing.com/images/searchbyimage?cbir=sbi&imgurl=%s", extra: 1 },
    { id: "BAD", name: "x", url: "https://x.com/?u=%s" }, "nope",
    { id: "lens", name: "fake", url: "https://evil.example/?u=%s" } ] });
  assert.deepEqual(cfg.imageEngines.map(e => e.id), ["lens", "bing-img"]);
  assert.deepEqual(Object.keys(cfg.imageEngines[1]), ["id", "name", "url"]);
  assert.equal(cfg.imageEngine, "lens");
  assert.equal(mergeConfig({ imageEngine: "gone" }).imageEngine, "lens");
});
test("mergeConfig：lookupEngine 缺省跟随默认组合右侧，隐藏或无效时回退", () => {
  assert.equal(mergeConfig({}).lookupEngine, "bing");
  assert.equal(mergeConfig({ lookupEngine: "ddg" }).lookupEngine, "ddg");
  assert.equal(mergeConfig({ lookupEngine: "ddg", presetOverrides: { ddg: { hidden: true } } }).lookupEngine, "bing");
  assert.equal(mergeConfig({ lookupEngine: "lens" }).lookupEngine, "bing");
  assert.equal(mergeConfig({ defaultPair: ["google", "ddg"] }).lookupEngine, "ddg");
});
test("enginesFor / engineById 按 kind 取", () => {
  const cfg = mergeConfig({ presetOverrides: { ddg: { hidden: true } } });
  assert.equal(enginesFor(cfg, "image"), cfg.imageEngines);
  assert.equal(enginesFor(cfg, "text"), cfg.engines);
  assert.equal(enginesFor(cfg, "search"), cfg.engines);
  assert.equal(engineById(cfg, "image", "lens").name, "Google Lens");
  assert.equal(engineById(cfg, "text", "ddg").id, "ddg");
  assert.equal(engineById(cfg, "image", "google"), null);
  assert.equal(engineById(cfg, "text", "lens"), null);
});
test("isIdTaken 同时查两套引擎", () => {
  assert.equal(isIdTaken("lens", {}), true);
  assert.equal(isIdTaken("bing-img", { imageEngines: [IMAGE_CATALOG[0]] }), true);
  assert.equal(isIdTaken("bing-img", {}), false);
});
```

```js
// test/image-engines.test.js
for (const e of [IMAGE_PRESET, ...IMAGE_CATALOG]) test(`${e.id} 模板合法`, () => {
  assert.equal(validateTemplate(e.url).ok, true);
  assert.ok(ID_PATTERN.test(e.id));
  assert.ok(!PRESETS.some(p => p.id === e.id) && !CATALOG.some(c => c.id === e.id));
});
test("文字引擎库 id 不与以图搜图冲突", () => {
  for (const c of CATALOG) assert.ok(c.id !== IMAGE_PRESET.id && !IMAGE_CATALOG.some(i => i.id === c.id));
});
test("uniqueId 两个方向互相查重", () => {
  const textTaken = { customEngines: [{ id: "bing-img", name: "x", url: "https://x.com/?q=%s" }] };
  assert.equal(uniqueId("bing-img", id => isIdTaken(id, textTaken)), "bing-img-2");
  const imageTaken = { imageEngines: [{ id: "youtube", name: "y", url: "https://y.com/?u=%s" }] };
  assert.equal(uniqueId("youtube", id => isIdTaken(id, imageTaken)), "youtube-2");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/engines.test.js test/image-engines.test.js`
Expected: FAIL（`image-engines.js` 不存在）

- [ ] **Step 3: 实现**。TinEye、SauceNAO 先不收（S8 默认分支；Task 11b Step 5 用户手测可用时再加）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-engines.js src/lib/engines.js test/image-engines.test.js test/engines.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(engines): add image search engines and a lookup engine setting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 5: 换右侧、快捷键与弹窗对视图按 `kind` 取引擎

**Files:**
- Modify: `src/chrome/right-switch.js`（`ownedPair` 加 `kind`）、`src/lib/cycle.js`（`cycleCandidates`）、`src/lib/popup-view.js`（`popupView`）、`src/popup/popup.js`、`src/popup/popup.html`、`src/background.js`（`cycleRight`）、`src/_locales/*/messages.json`（`popup_role_page`、`popup_role_lookup`、`popup_page_origin`、`popup_lookup_image`）
- Test: `test/right-switch.test.js`、`test/cycle.test.js`、`test/popup-view.test.js`、`test/background.test.js`

**Interfaces:**
- Consumes: Task 4 的 `enginesFor`、`engineById`；Task 2 的记录形状。
- Produces：
  - `ownedPair(tab, engines): Promise<{ kind: "search" | "text" | "image", left, right, query } | null>`：`kind` 取当前记录的 `role === "search" ? "search" : input`；查询对 `right` 固定是 `role === "lookup"` 的一侧，`left` 是 `page` 一侧；搜索对仍按 index。
  - `cycleCandidates(cfg, kind): { engines: Engine[], exclude: string[] }`：`image` → `{ engines: cfg.imageEngines, exclude: [] }`；其余 → `{ engines: cfg.engines, exclude: cfg.cycleExclude }`。`nextRightEngine` 不改。
  - `popupView(pair, cfg): { kind, query, imageHost: string | null, left: Engine | null, right: Engine | null, leftIsPage: boolean, choices: Engine[] }`：引擎经 `engineById(cfg, pair.kind, id)`；`choices = enginesFor(cfg, pair.kind)` 去掉右侧当前引擎；`leftIsPage = pair.kind !== "search"`；`imageHost` 只在 `kind === "image"` 时是 `new URL(query).host`，解析失败为 `""`，其余为 `null`。
  - 弹窗：`popup.html` 的两个 `dt` 加 id `left-label`、`right-label`；`kind !== "search"` 时用 `popup_role_page`/`popup_role_lookup`，左侧值显示 `popup_page_origin`；图片查询的关键词行显示 `t("popup_lookup_image", imageHost)`，不加载缩略图；`onSwitch` 改用 `enginesFor(state.cfg, state.pair.kind).find(…)`。
  - `background.js` 的 `cycleRight`：窗口经 `lastSplitWindow({ fallback: false })` 取（S5：PiP 获得焦点时什么都不做，不拿 PiP 的标签，也不去改看不见的其他窗口；已在 v0.3.0 热修（e21e10e，复审修正 073380b）中完成，本任务只改后面的轮换候选）；`const cfg = await loadConfig()` → `ownedPair(tab, cfg.engines)` → `const { engines, exclude } = cycleCandidates(cfg, pair.kind)` → `nextRightEngine(engines, pair.right.engineId, exclude)`。

- [ ] **Step 1: 写失败的测试**
  - ~~`background.test.js` 的 chrome 替身先补 `windows.getAll`（`lastSplitWindow` 要用）。~~（已在 v0.3.0 热修中完成（e21e10e））
  - （已在 v0.3.0 热修（e21e10e，复审修正 073380b）中完成，测试已在 `test/background.test.js`）`background.test.js`：`getLastFocused` 返回 PiP（`type: "normal"`、`alwaysOnTop: true`）→ `cycleRight` 什么都不做，不读 `getAll`；窗口管理器置顶、有两个标签的普通窗口照常换右侧。
  - `right-switch.test.js`：会话里 `split:10 = page/text`（index 1）、`split:11 = lookup/text`（index 0，用户对调过）→ `ownedPair` 返回 `kind: "text"`、`right.tabId === 11`、`left.tabId === 10`；`switchRight` 之后 `split:11` 的 `role`、`input` 不变。
  - `cycle.test.js`：`cycleCandidates(mergeConfig({ cycleExclude: ["ddg"] }), "image")` 的 `exclude` 是 `[]`、`engines[0].id === "lens"`；`"text"` 时 `exclude` 是 `["ddg"]`。
  - `popup-view.test.js`：

```js
test("popupView：图片查询对", () => {
  const cfg = mergeConfig({ imageEngines: [IMAGE_CATALOG[0]] });
  const pair = { kind: "image", query: "https://img.example.com/a.png?sig=1",
    left: { engineId: "" }, right: { engineId: "lens" } };
  const v = popupView(pair, cfg);
  assert.equal(v.imageHost, "img.example.com");
  assert.equal(v.leftIsPage, true);
  assert.equal(v.left, null);
  assert.equal(v.right.id, "lens");
  assert.deepEqual(v.choices.map(e => e.id), ["bing-img"]);
});
test("popupView：图片网址解析失败时 imageHost 为空串", () => {
  assert.equal(popupView({ kind: "image", query: "::", left: { engineId: "" }, right: { engineId: "lens" } }, mergeConfig({})).imageHost, "");
});
test("popupView：搜索对 imageHost 为 null、leftIsPage 为 false", () => {
  const v = popupView({ kind: "search", query: "q", left: { engineId: "google" }, right: { engineId: "bing" } }, mergeConfig({}));
  assert.equal(v.imageHost, null); assert.equal(v.leftIsPage, false); assert.equal(v.left.id, "google");
});
```
  - `background.test.js`：图片查询对上触发 `cycle-right`，`cycleExclude` 含 `bing-img` 也照样换成 `bing-img`（`tabs.update` 的 url 等于 `expandTemplate(bingImg.url, query)`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/right-switch.test.js test/cycle.test.js test/popup-view.test.js test/background.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**；4 种语言补 4 个 key（初稿，Task 15 定稿；中文初稿取 spec 3.13）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test && npm run e2e -- --auto-only --only T18,T19`
Expected: PASS（搜索对的弹窗与快捷键行为不变）

- [ ] **Step 5: Commit**

```bash
git add src/chrome/right-switch.js src/lib/cycle.js src/lib/popup-view.js src/popup/popup.js src/popup/popup.html src/background.js src/_locales test/right-switch.test.js test/cycle.test.js test/popup-view.test.js test/background.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(popup): switch the lookup side of a lookup pair by input kind" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 6: 设置页“右键查询”卡片

**Files:**
- Create: `src/options/actions.js`（从 `options.js` 搬出 `write`/`act`/`saveEngine`/`actions`）、`src/options/lookup.js`、`src/options/image-edits.js`
- Modify: `src/options/options.js`、`src/options/edits.js`、`src/options/catalog.js`（参数化或另写以图搜图引擎库对话框，实现者定，spec 第 5 节）、`src/options/options.html`、`src/options/options.css`、`src/chrome/config-store.js`、`src/_locales/*/messages.json`
- Test: `test/options-edits.test.js`、`test/image-edits.test.js`（新建）、`test/config-store.test.js`

**Interfaces:**
- Consumes: Task 4 的 `mergeConfig` 新字段、`IMAGE_PRESET`、`IMAGE_CATALOG`、`isIdTaken`；`uniqueId`（`engine-catalog.js`）。
- Produces：
  - `config-store.js`：`export async function removeKeys(keys: string[], area = defaultArea()): Promise<void>`（`area.remove(keys)`）。
  - 编辑结果可带 `remove: string[]`；`actions.js` 的 `write` 在 `ok` 时先 `saveKeys(patch)`（有 patch 时），再 `removeKeys(remove)`（非空时）。
  - `edits.js`：`export function checkFields(input)`（改成导出）；`export function setLookupEngine(raw, id: string | null)`：`null` → `{ ok: true, patch: null, remove: ["lookupEngine"] }`；未隐藏文字引擎 → `{ ok: true, patch: { lookupEngine: id } }`；否则 `fail("engine_gone")`。`deleteEngine`、`hideEngine` 在 `raw.lookupEngine === id` 时结果多 `remove: ["lookupEngine"]`。
  - `image-edits.js`：
    - `addImageEngine(raw, { name, url })` → `{ ok: true, engine, patch: { imageEngines } } | { ok: false, errors }`；校验用 `checkFields`；id = `uniqueId("img", x => isIdTaken(x, raw))`。
    - `addImageFromCatalog(raw, entry)` → 同上；已有同 `url` 的项 → `fail("catalog_already_added", entry.name)`；id = `uniqueId(entry.id, x => isIdTaken(x, raw))`。
    - `deleteImageEngine(raw, id)` → `lens` 或不存在 → `fail("only_custom_delete")`；删的是 `raw.imageEngine` 时多 `remove: ["imageEngine"]`。
    - `setImageEngine(raw, id)` → `"lens"` → `{ ok: true, patch: null, remove: ["imageEngine"] }`；其他存在的 id → `{ ok: true, patch: { imageEngine: id } }`；否则 `fail("engine_gone")`。
  - `lookup.js`：`export function renderLookupCard(cfg, actions): HTMLElement`（spec 3.11 第 1–6 条；没有授权按钮、没有轮换开关）；`actions` 新增 `setLookupEngine(id | null)`、`setImageEngine(id)`、`addImageEngine(input)`、`addImageFromCatalog(entry)`、`deleteImageEngine(engine)`。
  - 文案 key（spec 3.13）：`options_lookup_title`、`options_lookup_intro`、`options_lookup_engine_label`、`options_lookup_follow`（`$ENGINE$`）、`options_image_engine_label`、`options_image_add_catalog`、`options_image_add_custom`、`options_image_note_embedded`、`options_image_note_login`、`options_lookup_privacy`、`catalog_image_title`，成功提示用 `notice_` 前缀（实现者命名）。

- [ ] **Step 1: 纯搬家**：把 `write`、`act`、`saveEngine`、`actions` 搬到 `src/options/actions.js`（`actions` 需要的 `render`、`current`、`attention` 等通过一个 `bindActions(deps)` 注入，实现者定），`options.js` 只调用。

Run: `npm test && npm run e2e -- --auto-only --only B5,B16,B17`
Expected: PASS（行为不变）

- [ ] **Step 2: 写失败的测试**

```js
// test/options-edits.test.js
test("setLookupEngine：写入、跟随、无效", () => {
  assert.deepEqual(setLookupEngine({}, "ddg"), { ok: true, patch: { lookupEngine: "ddg" } });
  assert.deepEqual(setLookupEngine({ lookupEngine: "ddg" }, null), { ok: true, patch: null, remove: ["lookupEngine"] });
  assert.equal(setLookupEngine({ presetOverrides: { ddg: { hidden: true } } }, "ddg").error.code, "engine_gone");
});
test("隐藏或删除查词引擎时一并删掉 lookupEngine", () => {
  assert.deepEqual(hideEngine({ lookupEngine: "ddg" }, "ddg").remove, ["lookupEngine"]);
  const raw = { customEngines: [{ id: "my", name: "M", url: "https://m.com/?q=%s" }], lookupEngine: "my" };
  assert.deepEqual(deleteEngine(raw, "my").remove, ["lookupEngine"]);
  assert.equal(deleteEngine({ ...raw, lookupEngine: "bing" }, "my").remove, undefined);
});
// test/image-edits.test.js
test("addImageFromCatalog：重复添加被拒，id 与文字引擎查重", () => {
  const raw = { customEngines: [{ id: "bing-img", name: "x", url: "https://x.com/?q=%s" }] };
  const r = addImageFromCatalog(raw, IMAGE_CATALOG[0]);
  assert.equal(r.engine.id, "bing-img-2");
  assert.equal(addImageFromCatalog({ imageEngines: [r.engine] }, IMAGE_CATALOG[0]).error.code, "catalog_already_added");
});
test("addImageEngine：模板校验", () => {
  assert.equal(addImageEngine({}, { name: "X", url: "https://x.com/" }).errors.url.code, "tpl_no_placeholder");
  assert.equal(addImageEngine({}, { name: "X", url: "https://x.com/?u=%s&_ss=a,b" }).errors.url.code, "tpl_reserved_param");
  assert.equal(addImageEngine({}, { name: "X", url: "https://x.com/?u=%s" }).engine.id, "img");
});
test("deleteImageEngine / setImageEngine", () => {
  assert.equal(deleteImageEngine({}, "lens").error.code, "only_custom_delete");
  const raw = { imageEngines: [IMAGE_CATALOG[0]], imageEngine: "bing-img" };
  assert.deepEqual(deleteImageEngine(raw, "bing-img"), { ok: true, patch: { imageEngines: [] }, remove: ["imageEngine"] });
  assert.deepEqual(setImageEngine(raw, "lens"), { ok: true, patch: null, remove: ["imageEngine"] });
  assert.equal(setImageEngine({}, "bing-img").error.code, "engine_gone");
});
// test/config-store.test.js
test("removeKeys 调用 area.remove", async () => { /* 替身记录参数，断言 ["lookupEngine"] */ });
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/options-edits.test.js test/image-edits.test.js test/config-store.test.js`
Expected: FAIL

- [ ] **Step 4: 实现**上述接口与卡片（放在“默认组合”卡片后面；跟随项括号里的名字取 `engineById(cfg, "text", cfg.defaultPair[1]).name`）；4 种语言补齐初稿。

- [ ] **Step 5: 跑测试并检查行数**

Run: `npm test && wc -l src/options/*.js`
Expected: PASS；每个文件 ≤ 300 行

- [ ] **Step 6: Commit**

```bash
git add src/options src/chrome/config-store.js src/_locales test/options-edits.test.js test/image-edits.test.js test/config-store.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(options): add the right-click lookup card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 7: SW 里的文案与右键菜单注册

**Files:**
- Create: `src/lib/menu-spec.js`、`src/lib/serial.js`、`src/chrome/menus.js`
- Modify: `src/chrome/i18n.js`（`setLocale` 写 `lang` 前加 `typeof document !== "undefined"` 守卫）、`src/background.js`（注册重建）、`src/_locales/*/messages.json`（`menu_lookup_text`、`menu_lookup_image`）、`test/i18n-catalog.test.js`（`KEY_RE` 前缀表加 `menu`）、`test/background.test.js`（替身补 `contextMenus.{create,removeAll,update,onClicked}`、`runtime.onMessage`、`runtime.getURL`、`i18n.getUILanguage`，以及返回仓库真实 `_locales/<l>/messages.json` 的全局 `fetch`：`rebuildMenus` 经 `initI18n` 要用到）、`scripts/pack-smoke.mjs`
- Test: `test/menu-spec.test.js`、`test/serial.test.js`、`test/menus.test.js`（新建）、`test/i18n.test.js`、`test/chrome-i18n.test.js`

**Interfaces:**
- Consumes: Task 4 的 `engineById`、`mergeConfig` 的 `lookupEngine`/`imageEngine`。
- Produces：
  - `menu-spec.js`：`MENU_TEXT = "ss-lookup-text"`、`MENU_IMAGE = "ss-lookup-image"`、`PAGE_PATTERNS = ["https://*/*", "http://*/*"]`；`menuSafeName(name: string): string`（`&` → `&&`，`%s` → `% s`）；`menuItems({ textEngine, imageEngine }, t): CreateProperties[]`（两项，标题 `t("menu_lookup_text", menuSafeName(textEngine.name))`、`t("menu_lookup_image", menuSafeName(imageEngine.name))`）。
  - `serial.js`：`export function serialQueue(): (fn: () => Promise<T>) => Promise<T>`：按调用顺序执行，前一个失败不影响后一个，返回值/错误交给各自的调用方。
  - `menus.js`：`export function rebuildMenus(): Promise<void>`：挂在自己的 `serialQueue()` 上；每次依次 `await ensureI18n()`（惰性缓存 `initI18n()` 的 Promise，失败清缓存）→ `loadConfig()` → `setLocale(cfg.uiLocale)` → `contextMenus.removeAll()` → 两次 `create`（回调里读 `runtime.lastError` 只记日志）；任何一步失败只记日志、不抛。
  - `background.js`：`onInstalled`、`onStartup` 里在 `rebuildRules` 之外调 `rebuildMenus()`；`storage.onChanged` 的 `sync` 分支里同样调用（任何变化都完整重建，spec 3.6）。
  - 文案：`menu_lookup_text` 中文初稿“在拆分视图中用 $ENGINE$ 搜索“%s””，`menu_lookup_image`“在拆分视图中用 $ENGINE$ 搜索图片”，`ENGINE` 占位符 `content: "$1"`。

- [ ] **Step 1: 写失败的测试**

```js
// test/menu-spec.test.js
test("menuSafeName：& 写成 &&，%s 拆开，其余不动", () =>
  assert.equal(menuSafeName("A&B %s $1 100%"), "A&&B % s $1 100%"));
test("menuItems：两项的 id、contexts 与过滤网址", () => {
  const t = (k, n) => `${k}|${n}`;
  const [text, image] = menuItems({ textEngine: { name: "Bing" }, imageEngine: { name: "Google Lens" } }, t);
  assert.deepEqual(text, { id: "ss-lookup-text", title: "menu_lookup_text|Bing", contexts: ["selection"],
    documentUrlPatterns: ["https://*/*", "http://*/*"] });
  assert.deepEqual(image, { id: "ss-lookup-image", title: "menu_lookup_image|Google Lens", contexts: ["image"],
    documentUrlPatterns: ["https://*/*", "http://*/*"], targetUrlPatterns: ["https://*/*", "http://*/*"] });
});
// test/i18n.test.js
test("formatMessage 不动 %s，参数里的 $1 原样插入", () => {
  const entry = { message: "在拆分视图中用 $ENGINE$ 搜索“%s”", placeholders: { engine: { content: "$1" } } };
  assert.equal(formatMessage(entry, ["A&&B % s $1"]), "在拆分视图中用 A&&B % s $1 搜索“%s”");
});
// test/chrome-i18n.test.js
test("setLocale 在没有 document 的环境（SW）里不抛", async () => { /* 删掉 globalThis.document 后调用 */ });
// test/serial.test.js
test("serialQueue：按顺序执行，前一个失败不影响后一个", async () => { /* 记录执行顺序 [1,2,3]，第 1 个 reject 时第 2 个照常 resolve */ });
```
  `test/menus.test.js`（chrome 替身：`storage.sync.get` 返回可配置对象，`fetch` 返回仓库里真实的 `_locales/<l>/messages.json`，`contextMenus` 记录调用）：
  - `{ lookupEngine: "ddg", presetOverrides: { ddg: { hidden: true } }, uiLocale: "en" }` → 文字项标题含 `Bing`。
  - `uiLocale: "zh_CN"` → 标题等于 zh_CN 目录的 `menu_lookup_text` 按 `Bing` 格式化的结果；改成 `"en"` 再重建 → 英文。
  - 连续两次不 await 的 `rebuildMenus()`：调用序列是 `removeAll, create, create, removeAll, create, create`。
  - `create` 回调里设 `runtime.lastError` → `rebuildMenus()` 照常 resolve。
  - `background.test.js`：派发 `storage.onChanged({ … }, "sync")` 后 `contextMenus.removeAll` 被调用。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/menu-spec.test.js test/serial.test.js test/menus.test.js test/i18n.test.js test/chrome-i18n.test.js test/background.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**；`i18n-catalog.test.js` 的 `KEY_RE` 前缀加 `menu`；4 种语言补两个 key。

- [ ] **Step 4: 冒烟核对 SW 文案**：`pack-smoke.mjs` 在设置页里 `chrome.storage.sync.set({ uiLocale: "en" })` 触发一次重建，等 1 秒，断言没有 `[split-search]` 错误（`t()` 缺 key、目录没加载、重建失败都会记这类日志）。先确认 smoke 现有的运行时错误检查能收到 SW 的 `console.error`；收不到就 attach SW 目标读控制台（冒烟是一次性配置，不受 e2e“不 attach SW”的约束）。

Run: `npm test && npm run pack -- --smoke --allow-dirty`
Expected: PASS

- [ ] **Step 5: 确认 T11 没被新菜单项打乱**（默认分支：本扩展项排在 Chrome 自带项之后，T11 点的第 3 项“用 sse2e 搜索”不受影响，T11 通过即证明这一点。T11 失败且原因是点错了项时，先做 Task 11b Step 1 的 S11 数出序号，再改 `xauto.mjs` 里 T11 的 `itemIndex`）

Run: `npm run e2e -- --auto-only --only T11`
Expected: pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/menu-spec.js src/lib/serial.js src/chrome/menus.js src/chrome/i18n.js src/background.js src/_locales scripts/pack-smoke.mjs scripts/e2e/steps/xauto.mjs test/menu-spec.test.js test/serial.test.js test/menus.test.js test/i18n.test.js test/chrome-i18n.test.js test/i18n-catalog.test.js test/background.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(menus): register localized lookup items in the service worker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 8: 右键输入处理与判定表（纯逻辑，② ⑧ 共用）

**Files:**
- Create: `src/lib/lookup-input.js`、`src/lib/lookup-decision.js`
- Test: `test/lookup-input.test.js`、`test/lookup-decision.test.js`（新建）

**Interfaces:**
- Consumes: Task 7 的 `MENU_TEXT`、`MENU_IMAGE`。
- Produces（`src/lib/lookup-input.js`）：
  - `export const SELECTION_MAX = 500`（S3：Chrome 不截断 `selectionText`，没有更小的实测值）、`export const SELECTION_PRECUT = 10000`。
  - `normalizeSelection(text, max = SELECTION_MAX): string`：先粗截（`text.slice(0, 2 * SELECTION_PRECUT)`，再按码点截到 `SELECTION_PRECUT`；不对整串展开码点，S3 实测几 MB 的选区会原样进 SW）→ 去首尾空白 → `/\s+/gu` 合并成一个空格（已覆盖 NBSP、U+2003、U+3000）→ 按码点截到 `max` → 再去尾部空白。
  - `lookupInput(menuItemId, info): { ok: true, input: "text" | "image", query: string } | { ok: false, reason: "unknown_item" | "editable" | "empty" | "not_image" | "bad_src" }`。只读 `info.selectionText`、`info.editable`、`info.mediaType`、`info.srcUrl`。文字：`editable === true` → `editable`（S6：可编辑区域里菜单项会出现，这条是必需的；密码框给的是掩码圆点，也被它挡住）；规范化后为空 → `empty`。图片：`mediaType !== "image"` → `not_image`；`srcUrl` 解析失败或协议不是 `http:`/`https:` → `bad_src`（S7 证实 `targetUrlPatterns` 已拦住 `data:`/`blob:`，这里是保险）。
- Produces（`src/lib/lookup-decision.js`）：
  - `LookupAction = "ignore" | "other-window" | "reuse-split" | "beside-split" | "reuse-adjacent" | "join" | "beside-pair" | "new"`（对应 spec 3.3 判定表第 1–8 行）。
  - `decideLookup({ hasTab, inputOk, windowType, splitViewId, ownership, role, narrow }): LookupAction`：第 1 行 `!hasTab || !inputOk`；第 2 行 `windowType !== "normal"`（调用方传 `splitWindowType(win)`，PiP 是 `"pip"`）；分屏中 `ownership === "own" && role === "page"` → `reuse-split`，否则 `beside-split`；不在分屏中 `own && page` → `narrow ? "reuse-adjacent" : "join"`，`own && lookup` → `beside-pair`，其余 `new`。
  - `besideIndex(action, { tab, splitTabs, peer }): number`：`beside-split` → `Math.max(tab.index, ...splitTabs.map(t => t.index)) + 1`；`beside-pair` → `Math.max(tab.index, peer.index) + 1`。

- [ ] **Step 1: 写失败的测试**

```js
// test/lookup-input.test.js
test("normalizeSelection：合并各种空白", () => assert.equal(normalizeSelection("  a \n\tb  c 　"), "a b c"));
test("normalizeSelection：EM SPACE、连续 NBSP 也合并", () => assert.equal(normalizeSelection("a\u00a0\u00a0b\u2003c"), "a b c"));
test("normalizeSelection：几 MB 的输入先粗截再处理", () => {
  assert.ok(normalizeSelection("ab ".repeat(2_000_000)).length <= SELECTION_MAX);
  assert.equal([...normalizeSelection("x".repeat(5_000_000))].length, SELECTION_MAX);
});
test("normalizeSelection：按码点截断，不切断代理对", () => {
  const s = normalizeSelection("😀".repeat(600));
  assert.equal([...s].length, 500);
  assert.ok(!/[\uD800-\uDBFF]$/.test(s));
});
test("normalizeSelection：截断处是空格时不留尾空格", () => assert.equal(normalizeSelection("a ".repeat(400), 5), "a a a"));
test("lookupInput：文字", () => {
  assert.deepEqual(lookupInput("ss-lookup-text", { selectionText: " hi\nthere " }), { ok: true, input: "text", query: "hi there" });
  assert.equal(lookupInput("ss-lookup-text", { selectionText: "x", editable: true }).reason, "editable");
  assert.equal(lookupInput("ss-lookup-text", { selectionText: " \n " }).reason, "empty");
  assert.equal(lookupInput("ss-lookup-text", {}).reason, "empty");
  assert.equal(lookupInput("other", { selectionText: "x" }).reason, "unknown_item");
});
test("lookupInput：图片", () => {
  assert.equal(lookupInput("ss-lookup-image", { mediaType: "image", srcUrl: "data:image/png;base64,AA" }).reason, "bad_src");
  assert.equal(lookupInput("ss-lookup-image", { mediaType: "image", srcUrl: "blob:https://a.com/1" }).reason, "bad_src");
  assert.equal(lookupInput("ss-lookup-image", { mediaType: "video", srcUrl: "https://a.com/v.mp4" }).reason, "not_image");
});
test("lookupInput 不读 pageUrl / frameUrl", () => {
  const info = new Proxy({ selectionText: "x" }, { get(t, k) { if (k === "pageUrl" || k === "frameUrl") throw new Error(String(k)); return t[k]; } });
  assert.equal(lookupInput("ss-lookup-text", info).ok, true);
});
test("图片网址往返：url= 解码后逐字等于 srcUrl", () => {
  const src = "https://img.example.com/a%20b.png?x=1&y=2#f";
  const r = lookupInput("ss-lookup-image", { mediaType: "image", srcUrl: src });
  assert.equal(r.query, src);
  assert.equal(new URL(expandTemplate(IMAGE_PRESET.url, r.query)).searchParams.get("url"), src);
});
```

```js
// test/lookup-decision.test.js（base = { hasTab: true, inputOk: true, windowType: "normal", splitViewId: 7, ownership: "none", narrow: false }）
const cases = [
  [{ hasTab: false }, "ignore"], [{ inputOk: false }, "ignore"],
  [{ windowType: "popup" }, "other-window"], [{ windowType: "pip", ownership: "own", role: "page" }, "other-window"],
  [{ ownership: "own", role: "page" }, "reuse-split"],
  [{ ownership: "own", role: "search" }, "beside-split"], [{ ownership: "own", role: "lookup" }, "beside-split"],
  [{ ownership: "fallback-own" }, "beside-split"], [{ ownership: "stale" }, "beside-split"],
  [{ splitViewId: -1, ownership: "own", role: "page", narrow: true }, "reuse-adjacent"],
  [{ splitViewId: -1, ownership: "own", role: "page", narrow: false }, "join"],
  [{ splitViewId: -1, ownership: "own", role: "lookup" }, "beside-pair"],
  [{ splitViewId: -1, ownership: "own", role: "search" }, "new"], [{ splitViewId: -1, ownership: "stale" }, "new"],
  [{ splitViewId: -1 }, "new"],
];
for (const [over, want] of cases) test(`decideLookup ${JSON.stringify(over)} → ${want}`, () => assert.equal(decideLookup({ ...base, ...over }), want));
test("besideIndex：分屏右边；相邻对取两者较大 index", () => {
  assert.equal(besideIndex("beside-split", { tab: { index: 3 }, splitTabs: [{ index: 3 }, { index: 4 }] }), 5);
  assert.equal(besideIndex("beside-pair", { tab: { index: 6 }, peer: { index: 2 } }), 7);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/lookup-input.test.js test/lookup-decision.test.js`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 实现** 两个文件（`SELECTION_MAX`、粗截按 S3，`editable` 按 S6，`bad_src` 复查按 S7，见 Spike 结论）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/lookup-input.js src/lib/lookup-decision.js test/lookup-input.test.js test/lookup-decision.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(lookup): normalize menu input and decide where results open" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 9: 右键执行（② ⑧，SW）

**Files:**
- Create: `src/chrome/lookup-actions.js`
- Modify: `src/background.js`（`contextMenus.onClicked` 顶层注册，经 SW 全局串行链）
- Test: `test/lookup-actions.test.js`（新建）、`test/background.test.js`

**Interfaces:**
- Consumes: Task 8 的 `lookupInput`、`decideLookup`、`besideIndex`；`src/lib/window-kind.js` 的 `splitWindowType`、`split-actions.js` 的 `lastSplitWindow`（v0.3.0 热修）；Task 3 的 `openRight`、`confirmedSplitViewId`、`writePair`；`inspectTab`；`isNarrow`；Task 4 的 `engineById`；`expandTemplate`。
- Produces：
  - `export async function handleMenuClick(info, tab): Promise<{ action: LookupAction }>`：`lookupInput(info.menuItemId, info)` → `tab` 缺失或 `id` 不是非负整数 → `ignore`；`tabs.get(tab.id)` 重读（抛错 → `ignore`）→ `loadConfig()` → 引擎 `engineById(cfg, input, input === "image" ? cfg.imageEngine : cfg.lookupEngine)` → `url = expandTemplate(engine.url, query)` → `windows.get(fresh.windowId, { populate: true })` → `inspectTab(fresh, [])` → `decideLookup({ …, windowType: splitWindowType(win) })` → 执行（spec 3.3 判定表“动作”“记录”两列）。记录一律 `roleA: "page"`（`engineA: ""`）、`roleB: "lookup"`（`engineB: engine.id`）、`input`、`query`。
  - 执行细节：`reuse-split` 用 `tabs.update(peer.id, { url })`（不传 `active`），整对改写沿用当前 `splitViewId` 与 `"split"`；`reuse-adjacent` 用 `tabs.update(peer.id, { url, active: true })`，改写 `adjacent`；`join` 先 `tabs.update(peer.id, { url })`，再 `tabs.createSplit([左, 右])`（按 index），`confirmedSplitViewId` 复核成功写 `split`；`createSplit` 抛错或复核不一致时退回第 5 行：`tabs.update(peer.id, { active: true })` 激活查询标签、改写 `adjacent`；`reuse-split`/`reuse-adjacent` 的 `tabs.update` 抛错 → 退回 `new`；`beside-*` 用 `tabs.create({ url, index: besideIndex(…), windowId, active: true })` 不写记录；`new` 用 `openRight(fresh, url, narrow, { …, active: narrow })`；`other-window` 在 `lastSplitWindow()` 选出的窗口里 `tabs.create({ url, windowId, active: true })` 再 `windows.update(id, { focused: true })`，没有（`null`）就 `windows.create({ type: "normal", url })`，不写记录。窗口类型按 `splitWindowType`（S5：PiP 报 `normal` 但 `alwaysOnTop: true`，按非 normal 处理；`documentUrlPatterns` 已让 PiP 里不出现菜单项，这是第二道拦截）。
  - 日志（Global Constraints 的两级）：返回 `ignore` 时 `console.info("[split-search]", "lookup ignored", reason)`，`reason` 取 `lookupInput` 的 `reason`，或 `no_tab`、`tab_gone`；不带 `info` 的任何字段。
  - `background.js`：`const swQueue = serialQueue()`（Task 11 的 `onMessage` 共用这一个）；`chrome.contextMenus.onClicked.addListener((info, tab) => swQueue(() => handleMenuClick(info, tab)).catch(err => log("lookup failed", err)))`，返回这个 Promise 供测试等待。

- [ ] **Step 1: 写失败的测试** `test/lookup-actions.test.js`（沿用 `split-actions.test.js` 的 chrome 桩；`T = { id: 5, index: 2, windowId: 1, splitViewId: -1 }`，窗口宽 1200，`narrowFallback: true`，`lookupEngine` 缺省即 `bing`）：
  - 无记录、宽窗口 → `tabs.create` 带 `splitWithTabId: 5`、`active: false`、url 为 `expandTemplate(bing.url, "hi there")`；`split:5 = { role: "page", input: "text", engine: "", … }`、新标签 `{ role: "lookup", engine: "bing" }`；返回 `{ action: "new" }`。
  - 窄窗口（宽 800）→ `active: true`、没有 `splitWithTabId`，记录 `mode: "adjacent"`。
  - 已有 `page`/`lookup` 分屏、再点图片菜单 → `tabs.update(查询标签, { url: expandTemplate(lens.url, src) })` 且参数里没有 `active`；两条记录 `input` 变 `"image"`、`engine` 变 `"lens"`、`splitViewId` 不变。
  - 同上但 `tabs.update` 抛 `No tab with id` → 退回新建（调了 `tabs.create`）。
  - T 是搜索对的左侧（分屏中、`own`、`search`）→ `tabs.create({ url, index: 4, windowId: 1, active: true })`，没有任何 `tabs.update`，记录不变。
  - 窗口 `type: "popup"` → `lastSplitWindow()` → `tabs.create({ url, windowId, active: true })` → `windows.update(id, { focused: true })`，不写记录、不调任何分屏 API。
  - 窗口是 PiP（`type: "normal"`、`alwaysOnTop: true`），`getLastFocused` 也返回这个 PiP、`getAll` 里另有普通窗口 1 → 走 `other-window`，`tabs.create` 的 `windowId` 是 1；全程没有带 `splitWithTabId` 的 `tabs.create`，也没有 `tabs.createSplit`。
  - 第 5 行：相邻 `page`/`lookup` 对、窗口仍窄 → `tabs.update(查询标签, { url, active: true })`，记录 `mode: "adjacent"`，没有 `createSplit`。
  - 第 6 行 `join`：相邻 `page`/`lookup`、窗口变宽 → `tabs.createSplit([5, 查询标签])`，复核一致后记录 `mode: "split"`；`createSplit` 抛错 → 查询标签被 `tabs.update(…, { active: true })` 激活，记录 `adjacent`。
  - 第 7 行：T 是相邻对的 `lookup` 一侧（`page` 标签 index 6、T index 2）→ `tabs.create({ url, index: 7, windowId: 1, active: true })`，没有 `splitWithTabId`，记录不变。
  - `editable: true` → 没有任何 `tabs.*` 写操作，返回 `{ action: "ignore" }`；`tab` 为 `undefined` 同样。两种情况 `console.info` 收到 `reason`（`editable`、`no_tab`），参数里没有选中文字；`console.error` 没被调用。
  - `info` 用 Task 8 的 Proxy（读 `pageUrl`/`frameUrl` 就抛）跑一遍 `new` 路径，不抛。
  - `test/background.test.js`“并发右键只建一对”：同一个无记录标签，连续两次派发 `contextMenus.onClicked`（不 await 第一次）→ 带 `splitWithTabId` 的 `tabs.create` 恰好 1 次，第二次走 `tabs.update`（第 3 行）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/lookup-actions.test.js test/background.test.js`
Expected: FAIL

- [ ] **Step 3: 实现** `lookup-actions.js` 与 `background.js` 的注册。

- [ ] **Step 4: 跑测试并检查行数**

Run: `npm test && wc -l src/background.js src/chrome/*.js`
Expected: PASS；每个文件 ≤ 300 行

- [ ] **Step 5: Commit**

```bash
git add src/chrome/lookup-actions.js src/background.js test/lookup-actions.test.js test/background.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(lookup): open selected text and images next to the current page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 10: ⑦ 结果页识别、消息校验与弹窗状态（纯逻辑）

**Files:**
- Create: `src/lib/result-match.js`、`src/lib/messages.js`
- Modify: `src/lib/popup-view.js`（`popupMode`、`completeView`）、`src/lib/errors.js`（4 个新码）、`src/_locales/*/messages.json`（`err_not_results_page`、`err_window_unsupported`、`err_split_failed`、`err_message_rejected`）
- Test: `test/result-match.test.js`、`test/messages.test.js`（新建）、`test/popup-view.test.js`、`test/errors.test.js`（完整列表追加 4 个码，标题“27 个”改“31 个”）

**Interfaces:**
- Consumes: `parseTrigger`、`validateTemplate`、`PLACEHOLDER`、`mergeConfig`。
- Produces：
  - `matchResultPage(url: string, { engines, defaultPair }): { engine, query, suggestedId } | null`（spec 3.2“识别结果页”第 1–4 条）。`query` 是 `searchParams.get(leftParam).trim()`，为空 → `null`。分支：`parseTrigger(url, engines)` 返回 `ok: true` → 只拿它的左侧引擎套 origin、`pathname`、固定参数（`u.searchParams.get(k) === v`）三条检查，不通过直接 `null`；通过时建议的右侧取 `_ss` 右侧，它等于识别出的引擎时改按第 4 条取。`parseTrigger` 失败（`bad_url` 以外的 `marker_format`、`unknown_engine`、`not_left`、`template_mismatch`，包括没有 `_ss`）→ 照 spec 走第 2 步逐个比对，建议的右侧按第 4 条取。多个匹配时按“固定参数多 → 模板 `pathname` 长 → 显示顺序靠前”挑。
  - `validateCompleteMessage(msg, sender, { extId, popupUrl, engines }): { ok: true, tabId, engineId } | { ok: false, code: "message_rejected" }`：`sender.id === extId`；`sender.url` 与 `popupUrl` 都用 `new URL` 解析，比对 `protocol + "//" + host + pathname` 相同（**不用 `URL.origin`**：Node 24 里 `new URL("chrome-extension://abc/popup/popup.html").origin` 是 `"null"`，Chrome 里才是扩展 origin，纯函数在两个环境里会不一致；解析失败即拒绝）；`msg.type === "complete-split"`；`Number.isInteger(tabId) && tabId >= 0`；`engines.some(e => e.id === engineId)`（`engines` 是未隐藏文字引擎）。
  - `popupMode({ pair, tab, windowType, match }): "pair" | "complete" | "not-ours"`：`pair` → `"pair"`；`(tab.splitViewId ?? -1) !== -1`、`windowType !== "normal"`、`match == null` → `"not-ours"`；其余 `"complete"`。
  - `completeView(match, engines): { engine, query, suggestedId, choices: Engine[] }`：`choices` = `engines` 去掉识别出的引擎，`suggestedId` 那个排第一，其余保持显示顺序。
  - `ERROR_CODES` 追加 `"not_results_page", "window_unsupported", "split_failed", "message_rejected"`。

- [ ] **Step 1: 写失败的测试**

```js
// test/result-match.test.js
const cfg = mergeConfig({ customEngines: [
  { id: "gh", name: "GitHub", url: "https://github.com/search?q=%s&type=repositories" },
  { id: "gimg", name: "Google Images", url: "https://www.google.com/search?q=%s&tbm=isch" },
  { id: "maps", name: "Maps", url: "https://www.google.com/maps/search/%s" } ] });
const m = url => matchResultPage(url, cfg);
test("识别普通结果页，+ 还原成空格", () => assert.deepEqual(
  pick(m("https://www.google.com/search?q=hello+world&hl=en")), { engine: "google", query: "hello world", suggestedId: "bing" }));
test("默认组合右侧就是识别出的引擎时建议左侧", () => assert.equal(m("https://www.bing.com/search?q=x").suggestedId, "google"));
test("重复参数取第一个，fragment 不进关键词", () => {
  assert.equal(m("https://www.google.com/search?q=a&q=b").query, "a");
  assert.equal(m("https://www.google.com/search?q=a#frag").query, "a");
});
test("空关键词、路径不同、坏网址 → null", () => {
  for (const u of ["https://www.google.com/search?q=%20%20", "https://www.google.com/webhp?q=x", "not a url"]) assert.equal(m(u), null);
});
test("固定参数必须一致；多出的参数不影响", () => {
  assert.equal(m("https://github.com/search?q=x"), null);
  assert.equal(m("https://github.com/search?q=x&type=code"), null);
  assert.equal(m("https://github.com/search?type=repositories&q=x&p=2").engine.id, "gh");
});
test("固定参数多的优先", () => {
  assert.equal(m("https://www.google.com/search?q=x&tbm=isch").engine.id, "gimg");
  assert.equal(m("https://www.google.com/search?q=x").engine.id, "google");
});
test("%s 在路径里不支持", () => assert.equal(m("https://www.google.com/maps/search/tokyo"), null));
test("带 _ss：只按 _ss 声明的左侧引擎识别", () => {
  assert.equal(m("https://evil.example/?q=x&_ss=google,bing"), null);
  assert.equal(m("https://www.google.com/search?q=x&_ss=google,ddg").suggestedId, "ddg");
  assert.equal(m("https://www.google.com/search?q=x&_ss=google,google").suggestedId, "bing");
  assert.equal(m("https://www.bing.com/search?q=x&_ss=google,bing"), null);
});
test("parseTrigger 失败（未知右侧 id、_ss 格式不对）→ 照常逐个比对", () => {
  assert.deepEqual(pick(m("https://www.google.com/search?q=x&_ss=google,gone")), { engine: "google", query: "x", suggestedId: "bing" });
  assert.deepEqual(pick(m("https://www.google.com/search?q=x&_ss=bad")), { engine: "google", query: "x", suggestedId: "bing" });
});
// pick(r) = r && { engine: r.engine.id, query: r.query, suggestedId: r.suggestedId }
```

```js
// test/messages.test.js
const ctx = { extId: "abc", popupUrl: "chrome-extension://abc/popup/popup.html", engines: mergeConfig({}).engines };
const sender = { id: "abc", url: "chrome-extension://abc/popup/popup.html?tabId=5" };
const msg = { type: "complete-split", tabId: 5, engineId: "bing" };
test("合法消息", () => assert.deepEqual(validateCompleteMessage(msg, sender, ctx), { ok: true, tabId: 5, engineId: "bing" }));
test("发送方与字段不对一律拒绝", () => {
  const bad = [
    [msg, { ...sender, id: "evil" }], [msg, { ...sender, url: "chrome-extension://abc/options/options.html" }],
    [msg, { ...sender, url: "chrome-extension://abc/popup/popup.html.evil" }], [msg, { id: "abc" }],
    [{ ...msg, type: "x" }, sender], [{ ...msg, tabId: -1 }, sender], [{ ...msg, tabId: 1.5 }, sender],
    [{ ...msg, tabId: "5" }, sender], [{ ...msg, engineId: "lens" }, sender], [{ ...msg, engineId: "gone" }, sender], [null, sender],
  ];
  for (const [m, s] of bad) assert.deepEqual(validateCompleteMessage(m, s, ctx), { ok: false, code: "message_rejected" });
  const hidden = { ...ctx, engines: mergeConfig({ presetOverrides: { ddg: { hidden: true } } }).engines };
  assert.equal(validateCompleteMessage({ ...msg, engineId: "ddg" }, sender, hidden).ok, false);
});
```
  `popup-view.test.js`：`popupMode` 四种结果各一例（含 `tab.splitViewId: 3` 且 `pair: null` → `"not-ours"`）；`completeView` 的 `choices` 不含识别出的引擎、建议的排第一。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/result-match.test.js test/messages.test.js test/popup-view.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**；4 种语言补 4 个 `err_` key（初稿）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS（含 `test/errors.test.js`、`test/i18n-catalog.test.js`）

- [ ] **Step 5: Commit**

```bash
git add src/lib/result-match.js src/lib/messages.js src/lib/popup-view.js src/lib/errors.js src/_locales test/result-match.test.js test/messages.test.js test/popup-view.test.js test/errors.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(popup): recognize search results pages for completing a split" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 11: ⑦ 补成分屏（SW 执行与弹窗）

**Files:**
- Create: `src/chrome/complete-actions.js`、`src/popup/complete.js`
- Modify: `src/background.js`（`runtime.onMessage`）、`src/popup/popup.js`、`src/popup/popup.html`、`src/popup/popup.css`、`src/_locales/*/messages.json`（`popup_complete_detected`、`popup_complete_hint`、`popup_complete_aria`、`popup_complete_narrow`、`popup_complete_plain`）
- Test: `test/complete-actions.test.js`（新建）、`test/background.test.js`

**Interfaces:**
- Consumes: Task 10 的 `matchResultPage`、`validateCompleteMessage`、`popupMode`、`completeView`；Task 2 的 `splitWindowType`；Task 3 的 `openRight`；Task 9 的 `swQueue`；`inspectTab`、`isNarrow`、`expandTemplate`。
- Produces：
  - `export async function handleCompleteMessage(msg, sender): Promise<{ ok: true, mode: "split" | "adjacent" | "plain" } | { ok: false, code }>`：`loadConfig()` → `validateCompleteMessage(msg, sender, { extId: chrome.runtime.id, popupUrl: chrome.runtime.getURL("popup/popup.html"), engines: cfg.engines })` → `tabs.get(tabId)`（抛错 → `not_results_page`）→ `matchResultPage(tab.url, cfg)`（`null` → `not_results_page`）→ `engineId === match.engine.id` → `message_rejected` → `windows.get(tab.windowId, { populate: true })`（`splitWindowType(win) !== "normal"` → `window_unsupported`，PiP 同样，S5）→ `inspectTab(tab, cfg.engines)`：`splitViewId !== -1` 或 `ownership === "own"` → `not_results_page` → `openRight(tab, expandTemplate(right.url, match.query), isNarrow(win.width, cfg.narrowFallback), { leftId: match.engine.id, rightId: engineId, query: match.query })`（两侧 `search`，`active: false`）→ `{ ok: true, mode }`；`openRight` 抛错 → `split_failed`。**不对 `tabId` 调 `tabs.update`**。整段在 SW（S2 证实真点图标授予 activeTab 后 SW 的 `tabs.get(tabId).url` 有值，弹窗关掉后仍有）。`ok: false` 的预期结果（`message_rejected`、`not_results_page`、`window_unsupported`）各记一条 `console.info("[split-search]", "complete rejected", code)`，不带标签网址和关键词；`split_failed` 与监听器里的 `catch` 用 `console.error`。
  - `background.js`：`chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => { swQueue(() => handleCompleteMessage(msg, sender)).then(sendResponse, err => { log(…); sendResponse({ ok: false, code: "split_failed" }); }); return true; })`。
  - `popup.html` 新 section：`#complete`（`#complete-detected`、`h2#complete-title[data-i18n=popup_complete_hint]`、`ul#complete-choices[aria-labelledby=complete-title]`）和 `p#complete-note`（`adjacent`/`plain` 的提示）。
  - `complete.js`：`export function showComplete(view, tab, { onDone }): void`：渲染 `popup_complete_detected`（`$ENGINE$`、`$QUERY$` 是用户数据，`setI18nText` 传参）和按钮（建议的加 class `suggested`，`aria-label` = `t("popup_complete_aria", engine.name)`）；点击后禁用全部按钮、`chrome.runtime.sendMessage({ type: "complete-split", tabId: tab.id, engineId })`，回复 `ok` 时按 `mode` 设 `#complete-note`（`popup_complete_narrow` / `popup_complete_plain` / 隐藏）再 `onDone()`；失败显示 `t("err_" + code)`。
  - `popup.js` 的 `load()`：`ownedPair` 为空时再 `windows.get(tab.windowId, { populate: true })` 与 `matchResultPage(tab.url, cfg)`，用 `popupMode({ …, windowType: splitWindowType(win) })` 决定显示 `#pair` / `#complete` / `#not-ours`；`targetTab()` 不变（`?tabId=` 接缝保留）。

- [ ] **Step 1: 写失败的测试** `test/complete-actions.test.js`（chrome 桩；`tab = { id: 5, index: 1, windowId: 1, splitViewId: -1, url: "https://www.google.com/search?q=hello" }`，窗口宽 1200，`sender` 为合法弹窗）：
  - 合法 → `tabs.create` 带 `splitWithTabId: 5`、`active: false`、url `expandTemplate(bing.url, "hello")`；两条记录 `role: "search"`、`engine` 分别 `google`/`bing`、`query: "hello"`；`tabs.update` 从未以 5 为参数调用；回复 `{ ok: true, mode: "split" }`。
  - `engineId: "google"`（与识别出的相同）→ `{ ok: false, code: "message_rejected" }`，没有 `tabs.create`。
  - `tabs.get` 抛 `No tab with id` → `not_results_page`；`url` 为 `undefined` → `not_results_page`；`url` 变成 `https://example.com/` → `not_results_page`。都没有 `tabs.create`。
  - `splitViewId: 3` → `not_results_page`；窗口 `type: "popup"` → `window_unsupported`；窗口 `{ type: "normal", alwaysOnTop: true }`（PiP）→ `window_unsupported`，没有 `tabs.create`。
  - 宽 800、`narrowFallback` 缺省 → `mode: "adjacent"`，`tabs.create` 没有 `splitWithTabId`、`active: false`。
  - `splitWithTabId` 抛错 → `mode: "plain"`，不写记录。
  - `sender.url` 是设置页 → `message_rejected`；`console.info` 收到 `message_rejected`，`console.error` 没被调用。
  - `background.test.js`：`runtime.onMessage` 监听器返回 `true`，`sendResponse` 收到 `handleCompleteMessage` 的回复。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/complete-actions.test.js test/background.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**；4 种语言补 5 个 `popup_complete_*` key（初稿，`popup_complete_aria` 以可见引擎名开头）。

- [ ] **Step 4: 跑测试并检查行数**

Run: `npm test && wc -l src/popup/*.js src/background.js src/chrome/*.js`
Expected: PASS；每个文件 ≤ 300 行

- [ ] **Step 5: Commit**

```bash
git add src/chrome/complete-actions.js src/popup src/background.js src/_locales test/complete-actions.test.js test/background.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "feat(popup): complete an existing search into a split view" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 11b: 剩余 spike（S8–S12，写 e2e 与改隐私文案之前）

**Files:**
- Modify: 本计划（“Spike 结论”“Spike 对账”、Task 13 的 `MENU_INDEX`/`MENU_MIN_ITEMS` 取值）；S8 成立时 `src/lib/image-engines.js` 的 `IMAGE_CATALOG`
- 一次性脚本放会话 scratchpad，不进仓库；可复用 `scratchpad/spike-v04/lib.mjs`（一次性配置、管道 CDP、Xvfb、真实右键与截图），它不在了就照 e2e 的 `launch()` 与 `gesture-ui.mjs` 重写同样的做法。

**Interfaces:**
- Produces：`MENU_INDEX = { text, image }`（本扩展项的行号，与 `contextMenuPick` 的 `itemIndex` 同一计法）、`MENU_MIN_ITEMS = { text, image }`（带本扩展项时的总行数），按 zh_CN 菜单测，en 的数值一并记进 Spike 结论；S9、S10、S12 各一行结论。

- [ ] **Step 1: S11 菜单序号**：一次性配置里装本检出的 `src/`（`Extensions.loadUnpacked`），`--lang=zh-CN` 与 `--lang=en` 各起一次。本地 http 页面上分别在选区、http 图片上真实右键，截菜单按 `menuRows` 数行；再在扩展页 `chrome.contextMenus.removeAll()` 后重数，多出来的那一行就是本扩展项的行号。顺带测三件事：页面留有选区时在图片上右键，本扩展两项是否被收进以扩展名为标题的子菜单（T22(b) 的前提）；查词引擎名设成 `A&B %s` 时标题显示为 `A&B % s`（`&&` 显示成一个 `&`）；菜单标题里有没有被当成助记键的字符。
- [ ] **Step 2: S12 不授权的模拟 host**：用 e2e 的测试配置（`--auto-only` 的前提已满足），扩展页里 `chrome.permissions.contains` 对 `http://engine-u.localhost:8765/*`、`http://page-u.localhost:8765/*`、`http://engine-i.localhost:8765/*` 都是 `false`；临时把 `eu`（`/search?q=%s`）加成自定义引擎，新标签导航到 `http://engine-u.localhost:8765/search?q=x&_ss=eu,eb`，`Page.getNavigationHistory` 里没有 `go.html`；做完恢复 storage。不成立 → 按 spec 3.14 换 host 写法，改 Task 12 的 `UNGRANTED_HOSTS`。
- [ ] **Step 3: S10 Referer**：在 `page-u` 一类页面所在标签上，经扩展页分别调 `tabs.create({ url, splitWithTabId })` 和 `tabs.update(另一标签, { url })`，对新导航的目标 `Network.enable`，看 `requestWillBeSent` 的 `headers.Referer`（或让模拟服务器打印 Referer）。不带 → Task 15 照写“页面网址不发”；带 → Task 15 Step 2 删掉这半句，改成如实描述，并在 Task 16 Step 6 报告给用户。
- [ ] **Step 4: S9 activeTab 与 DNR**：对一个从没授权的 `engine-u` 结果页标签 `Extensions.triggerAction`，先在扩展页确认 `chrome.tabs.get(id).url` 有值（顺带在 156 上复核 F1：`triggerAction` 和真点图标一样授予 activeTab），再在同一标签同 origin 导航到带 `_ss` 的网址，记下是否被重定向到 `go.html`。只写进已知事实，不改设计。
- [ ] **Step 5: S8 以图搜图引擎库**：请用户用住宅 IP 手测 TinEye、SauceNAO（`uploadbyurl` 类网址能否直接出结果）、Lens 对 404 图片显示什么、Yandex 是否被地区封锁。用户确认可用的引擎加进 `IMAGE_CATALOG`（`test/image-engines.test.js` 的逐条循环自动覆盖），单独提交 `feat(engines): …`；用户没测就保持默认分支，不阻塞后续任务。
- [ ] **Step 6: 写回本计划**：结论移进“Spike 结论”，对账表删掉已完成的行，Task 13 的 `<n>` 填实测值。

```bash
git add docs/superpowers/plans/2026-10-25-split-search-v0.4.md
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "docs(plan): record the S8-S12 spike results" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 12: e2e 设施、⑦ 补成分屏（T20）与设置页卡片（B18）

**Files:**
- Modify: `scripts/e2e/config.mjs`（`UNGRANTED_HOSTS`、`mockEngineU`、`mockImageEngine`）、`scripts/e2e/server.mjs`（三个新 host 的路由）、`scripts/e2e/steps/v03-popup.mjs`（`POPUP_STATE` 认 `#complete`）、`scripts/e2e/steps/v03-lib.mjs`、`scripts/e2e/steps/v03-narrow.mjs`（`sizeTo` 移出）、`scripts/e2e/steps/index.mjs`
- Create: `scripts/e2e/steps/v04-lib.mjs`、`scripts/e2e/steps/v04-complete.mjs`（T20）、`scripts/e2e/steps/v04-options.mjs`（B18）
- Test: `test/e2e-v04.test.js`（新建）

**Interfaces:**
- Consumes: `popupPage`、`POPUP_URL`（`v03-popup.mjs`）；B2 的 `Extensions.triggerAction` 写法（`options-b.mjs`）；`guarded`、`openOptions`（`optpage.mjs`）；`resetTabs`、`openTab`、`navigate`、`evalIn`、`waitState`、`waitTarget`、`summarize`（`util.mjs`）；`sub`、`verdict`、`readRecords`、`checkPairRecords`（`v03-lib.mjs`）。
- Produces：
  - `config.mjs`：`export const UNGRANTED_HOSTS = { u: "engine-u.localhost", page: "page-u.localhost", img: "engine-i.localhost" }`（**不进 `HOSTS`**，所以不进 `GRANT_ORIGINS`）；`mockEngineU(port) = { id: "eu", name: "模拟引擎 U", url: "http://engine-u.localhost:<port>/search?q=%s" }`；`mockImageEngine(port) = { id: "ei", name: "模拟以图搜图", url: "http://engine-i.localhost:<port>/imgsearch?url=%s" }`。
  - `server.mjs`：`engine-u` 同模拟引擎路由（标题 `U · <q>`）；`page-u` 的 `/article` 返回带两段可选文字（`#p1`、`#p2`，ASCII）、`<img id="http-img" src="http://page-u.localhost:<port>/img.png">`、`<img id="data-img" src="data:image/png;base64,…">` 的页面，`/img.png` 返回一张 PNG；`engine-i` 的 `/imgsearch` 回显收到的 `url` 参数（`<p id="got">`）。
  - `v04-lib.mjs`：`markPage(ctx, targetId): Promise<string>`（写随机标记到 `window.__ssMark` 并返回）、`markIntact(ctx, targetId, mark): Promise<boolean>`；`cdpUrl(ctx, targetId): Promise<string>`（从 `Target.getTargets` 读，扩展读不到未授权标签的 url）；`openActionPopup(ctx, tabTargetId): Promise<popupPage>`（关掉旧弹窗目标 → `Extensions.triggerAction` → 等 `type: "page"` 的 popup 目标 → `popupPage(ctx, { targetId })`）；`sizeTo` 从 `v03-narrow.mjs` 移到 `v03-lib.mjs` 导出（连同它用到的 `rememberWindow`、`NARROW_WIDTH` 的 import），T17 与 T20 共用。
  - 步骤 `T20`（auto，`timeoutMs: 180000`）、`B18`（auto）。T20 用 `guarded(ctx, ["customEngines", "defaultPair", "narrowFallback"], …)` 写入 `eu`。

- [ ] **Step 1: 写失败的测试** `test/e2e-v04.test.js`：
  - `GRANT_ORIGINS(8765)` 不含任何 `UNGRANTED_HOSTS` 的 origin（实际授权状态由 Task 11b 的 S12 实测，这条测试只守住配置）。
  - 起 `startServer({ port: 0 })`：`page-u.localhost` 的 `/article` 含 `id="http-img"` 和 `src="data:`；`engine-i.localhost/imgsearch?url=http%3A%2F%2Fa%2Fb.png` 的响应含 `http://a/b.png`；`engine-u.localhost/search?q=hi` 标题含 `hi`。
  - 把 `POPUP_STATE` 的判定拆成纯函数 `popupStateOf(snap)`（`v03-popup.mjs` 导出；`snap` 是页面里读出的各元素 `hidden`/文字快照，`POPUP_STATE` 只负责读快照）：`#complete` 可见时返回 `complete: true` 和 `detected`、`completeChoices`；`loading` 或三块都隐藏时返回 `null`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/e2e-v04.test.js`
Expected: FAIL

- [ ] **Step 3: 实现设施与 T20**（spec 3.14“⑦ 补成分屏”）：
  - 正例：normal 窗口打开 `engine-u` 的 `/search?q=hello`，`markPage`；`openActionPopup` → 先在扩展页读 `chrome.tabs.get(id).url`：没有值判 `infra`，写明“triggerAction 未授予 activeTab”（F1 原型证实会授予，S9 步骤在 156 上复核，这里守住前提）→ 断言 `#complete` 显示模拟引擎 U 和 `hello` → 点模拟引擎 A。断言：建成分屏；左侧 `cdpUrl` 和标记都没变；右侧是 A 的展开网址；两条记录 `role: "search"`（`checkPairRecords` 的 `roles` 缺省）；`ownership` 判 `own`（经扩展页 `inspectTab` 等价读法，或断言再开一次弹窗显示对视图）。
  - 反证（另开一个从没触发过 action 的 `engine-u` 标签）：先断言扩展页 `chrome.tabs.get(id).url === undefined`，不成立判 `infra`；`popup.html?tabId=<id>` 显示说明；从这个弹窗页 `chrome.runtime.sendMessage({ type: "complete-split", tabId: id, engineId: "ea" })` → 回复 `code === "not_results_page"`，标签数不变。
  - 子项：窄窗口（`narrowFallback` 删掉、窗口设到 < 960，用 `v03-lib.mjs` 的 `sizeTo`）→ 相邻后台标签、`adjacent` 记录、弹窗显示 `popup_complete_narrow`；页面在用户分屏里（`createSplit` 拼 `engine-u | site-x`）→ 说明；模拟引擎 C 的 `/wiki/x` → 说明；`/search?q=` 空关键词 → 说明。
  - 非 normal 窗口：用**已授权**的模拟引擎 A 结果页放进 `windows.create({ type: "popup", url })`（网址读得到，排除“读不到网址才显示说明”的干扰），`popup.html?tabId=<id>` 显示说明；再从这个弹窗页直接发 `complete-split`（`engineId: "eb"`）→ 回 `window_unsupported`，标签数不变。
  - G5 降级网址：另开一个**从没触发过 action** 的新标签（不复用正例或任何授过 activeTab 的 `engine-u` 标签，免得 activeTab 让 DNR 在这个标签里生效，见 S9），先导航到 `engine-u` 的 `/search?q=x&_ss=eu,eb`，断言跳转链里没有 `go.html`，再 `openActionPopup` → 建议的右侧是 `eb`、排第一。
- [ ] **Step 4: 实现 B18**（spec 3.14“其他”第 1 条），用 `guarded(ctx, ["lookupEngine", "imageEngine", "imageEngines"], …)`。

- [ ] **Step 5: 跑**

Run: `npm test && npm run e2e -- --auto-only --only T20,B18,B2,T17,T18,B15`
Expected: 全部 pass（B2、T17、T18 证明 `POPUP_STATE` 与 `sizeTo` 的改动没有打乱 v0.3 步骤；B15 证明 T20 有意走的拒绝路径没有记 `error` 级日志）

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e/config.mjs scripts/e2e/server.mjs scripts/e2e/steps/v03-popup.mjs scripts/e2e/steps/v03-lib.mjs scripts/e2e/steps/v03-narrow.mjs scripts/e2e/steps/index.mjs scripts/e2e/steps/v04-lib.mjs scripts/e2e/steps/v04-complete.mjs scripts/e2e/steps/v04-options.mjs test/e2e-v04.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "test(e2e): cover completing a split through activeTab and the lookup card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 13: e2e ② 边读边查（T21）与 ⑧ 以图搜图（T22）

**Files:**
- Modify: `scripts/e2e/gesture-ui.mjs`（`contextMenuCount`）、`scripts/e2e/screen.mjs`（`elementCenter`）、`scripts/e2e/steps/index.mjs`（`XAUTO` 列表）
- Create: `scripts/e2e/steps/v04-lookup.mjs`（T21、T22 的 xauto 版本与 judge 回退）
- Test: `test/e2e-gesture.test.js`、`test/e2e-v04.test.js`

**Interfaces:**
- Consumes: `contextMenuPick`（`gesture-ui.mjs`）、`selectionCenter`（`screen.mjs`）、`xauto`、`withAttempts`、`fixWindow`、`testWindow`（`xauto-lib.mjs`）；Task 12 的 `v04-lib.mjs`、`UNGRANTED_HOSTS`、`mockImageEngine`。
- Produces：
  - `v04-lib.mjs`：`export const MENU_INDEX = { text: 6, image: 6 }`、`export const MENU_MIN_ITEMS = { text: 8, image: 8 }`（Task 11b Step 1（S11）在 zh_CN 菜单上的实测值，en 相同，见 Spike 结论 S11）。
  - `gesture-ui.mjs`：`contextMenuPick` 里的 `dismiss` 闭包提成模块级 `async function dismissMenu(ctx, { wid })`（在页面里左键点一下），`contextMenuPick` 和新函数共用；`export async function contextMenuCount(ctx, { at, wid }): Promise<number>`：与 `contextMenuPick` 同样的右键与菜单识别，数出 `menuRows` 的行数后 `dismissMenu` 关菜单，**不点任何项**。
  - `screen.mjs`：`export async function elementCenter(browser, targetId, selector): Promise<{ x, y }>`（CSS 坐标经 `cssToScreen` 换成屏幕坐标，同 `selectionCenter`）。
  - 菜单操作：一律按行定位、悬停确认高亮后点击（`contextMenuPick` 现有逻辑），**不向菜单发送任何按键**（含字母键和 Escape；F20：首字母会撞 Chrome 自带项）；关闭菜单只用 `dismissMenu`。在图片上右键前页面里不得留有选区（否则选区项和图片项同时命中，Chrome 会把本扩展两项收进子菜单，行号就不对了）。
  - 报告：T21、T22、T24 每个右键子项的 detail 写上 `contextMenuPick`/`contextMenuCount` 读到的实际菜单行数（spec 3.14“写明当次菜单共有几项”）。
  - 步骤 `T21`、`T22`（xauto，judge 回退：向导请用户在 `page-u` 上右键选本扩展的菜单项，脚本照同样的断言判定）。

- [ ] **Step 1: 写失败的测试**：`e2e-gesture.test.js` 用现有的假 `xi` 写法测 `contextMenuCount`：返回 `menuRows` 认出的行数；只发过一次右键和一次关闭用的左键（`click(1)` 的 `expectWindow` 是测试窗口而不是菜单），没有任何按键。`e2e-v04.test.js`：`MENU_INDEX`、`MENU_MIN_ITEMS` 的四个值都是整数且 `MENU_INDEX.x < MENU_MIN_ITEMS.x`（只防写错；序号对不对由 Step 5 的 e2e 以效果判定）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/e2e-gesture.test.js test/e2e-v04.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 T21**（spec 3.14“② 边读边查”）：在 `page-u/article` 用 CDP 选中 `#p1` 里的一个词（同 T11），`markPage`，真实右键 → `contextMenuPick(ctx, { at, wid, itemIndex: MENU_INDEX.text, expectItems: MENU_MIN_ITEMS.text })`（`at` 取 `selectionCenter`，`wid` 取 `testWindow`）。断言：建成分屏；网页一侧 `cdpUrl` 与标记不变；查询一侧是 `expandTemplate(查词引擎.url, 规范化文字)`；记录 `checkPairRecords(…, { roles: ["page", "lookup"], input: "text", engines: ["", "eb"] })`。子项：(b) 再选 `#p2` 的词 → 查询标签 id 不变、标记仍在；(c) `guarded` 写 `lookupEngine: "ec"` 再查 → 右侧是 C 的 `/wiki/<词>`，删掉键再查 → 回到 `eb`；(d) 选中跨两段、含换行的长选区（拼接到 > 500 码点）→ 查询网址里的文字解码后没有换行、码点数 ≤ `SELECTION_MAX`（从 `src/lib/lookup-input.js` 导入）。

- [ ] **Step 4: 实现 T22**（spec 3.14“⑧ 以图搜图”），`guarded(ctx, ["imageEngines", "imageEngine"], …)` 写入 `mockImageEngine` 并选中：(a) `#http-img` 上右键 → `contextMenuPick(ctx, { at: elementCenter(…, "#http-img"), wid, itemIndex: MENU_INDEX.image, expectItems: MENU_MIN_ITEMS.image })` → 右侧网址的 `url` 参数等于 `http://page-u.localhost:<port>/img.png`、`engine-i` 页面的 `#got` 回显同值、网页标记不变；(b) 同一页先查词（T21 的做法）再查图：查图前在页面里 `getSelection().removeAllRanges()`，并核对 `#http-img` 上的 `contextMenuCount` 与 (a) 相同 → 查询标签 id 不变、记录 `input` 变 `"image"`；(c) 用基线做差，不假设 Chrome 自带项在两种图片上相同：先数两张图的项数，再在扩展页 `chrome.contextMenus.removeAll()` 后各数一次，最后在 `guarded` 里改一次 `imageEngine` 再改回触发 `rebuildMenus`、等 `#http-img` 的项数回到原值；断言 `#http-img` 有菜单时比基线多 1、`#data-img` 与基线相同。Lens、Bing 真实引擎不进自动判定。

- [ ] **Step 5: 跑**（默认 Xvfb，xauto 照跑）

Run: `npm test && npm run e2e -- --auto-only --only T11,T21,T22,B15`
Expected: 全部 pass（T11 证明本扩展的菜单项没有改变它点的那一项，`contextMenuPick` 改用 `dismissMenu` 后行为不变）

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e/gesture-ui.mjs scripts/e2e/screen.mjs scripts/e2e/steps/index.mjs scripts/e2e/steps/v04-lib.mjs scripts/e2e/steps/v04-lookup.mjs test/e2e-gesture.test.js test/e2e-v04.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "test(e2e): drive the lookup context menu items with real input" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 14: e2e 不覆盖用户页面的回归（T23、T24）、I18N/B14 覆盖与验收表

**Files:**
- Create: `scripts/e2e/steps/v04-guard.mjs`（T23 auto、T24 xauto + judge 回退）、`scripts/e2e/steps/v04-i18n.mjs`、`docs/acceptance-v0.4.md`
- Modify: `scripts/e2e/steps/index.mjs`、`scripts/e2e/steps/i18n.mjs`（调用 `v04I18nChecks`）、`scripts/e2e/steps/b14.mjs`（新卡片与 `#complete` 深色截图）、`docs/acceptance-v0.1.md`（T5 加注）、`docs/_config.yml`（`exclude` 加 `acceptance-v0.4.md`）
- Test: `test/e2e-v04.test.js`

**Interfaces:**
- Consumes: Task 12、13 的 `v04-lib.mjs`、`contextMenuPick`、`contextMenuCount`、`MENU_INDEX`；`popupPage`；T19 的快捷键绑定与按键流程（`ext-shortcuts.mjs`、`xauto-t19.mjs`）。
- Produces：`T23`（auto，`timeoutMs: 180000`）子项 (d)(e)(f)(h)；`T24`（xauto）子项 (a)(b)(c)(g)、(d') 快捷键换右侧和可选的 (i) 无痕；`steps/v04-i18n.mjs` 导出 `v04I18nChecks(ctx, locale)`（弹窗 `#complete` 与设置页新卡片的检查和截图），由 `i18n.mjs` 在每种语言下调用；每个子项都断言相关标签的 `cdpUrl` 与 `markIntact`。纯函数 `export function guardProblems(before, after): string[]`（`v04-guard.mjs` 导出：比较 `{ tabId: { url, mark } }` 两份快照，列出被导航或重载的标签）。

- [ ] **Step 1: 写失败的测试**：`e2e-v04.test.js` 测 `guardProblems`：网址相同、标记丢失 → 报“被重载”；网址变了 → 报“被导航”；两者都同 → 空数组。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/e2e-v04.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 T23**（spec 3.14 回归 (d)(e)(f)(h)）：
  - (d) 用 Task 13 的办法建查询对（auto 版直接在扩展页调 `chrome.tabs.create({ splitWithTabId })` 并写 `page`/`lookup` 记录，不需要真实右键），`tabs.move` 对调两侧，`popup.html?tabId=<网页标签>` 点换右侧 → 被换的是查询标签（现在 index 小），网页标记不变。（只测弹窗 `?tabId=` 路径；快捷键要真实按键，放在 T24 的 (d')。）
  - (e) 把查询标签导航到触发网址 → go.html 走 `foreign`，网页不变、旁边新开一对。
  - (f) 把网页一侧导航到触发网址 → 走 `reuse`，两条记录 `role` 都是 `"search"`。
  - (h) **fallback-own → foreign**：网页一侧用模拟引擎 A 的结果页（像搜索页），清空 `storage.session` 后把查询一侧导航到触发网址 → go.html 走 `foreign`，原分屏两侧网址与标记都不变；再测一次网页是模拟引擎 C 的 `/wiki/x`。
- [ ] **Step 4: 实现 T24**（spec 3.14 回归 (a)(b)(c)(g)，真实右键，judge 回退）：
  - (a) **用户分屏不被覆盖**：`createSplit` 拼 `page-u | site-x`（没有记录），在左侧右键查词 → 两侧不变，结果在分屏右边（`max index + 1`）的普通标签，没有写记录。
  - (b) 本扩展搜索对 A ｜ B 的左侧（换成 `page-u` 不行，就在 A 的结果页正文里选词）右键 → 新普通标签，A、B 都不变。
  - (c) 查询对的查询一侧右键 → 新普通标签，两侧都不变。
  - (g) 清空 `storage.session` 后在查询对的网页一侧右键 → 新普通标签，两侧不变。
  - (d') 可选：按 (d) 建好对调过的查询对，复用 `xauto-t19.mjs` 的绑定与真实按键流程（`ext-shortcuts.mjs` 快照与恢复）按一次 `cycle-right` → 被换的是查询标签，网页标记不变；绑定不了记 skip 并写明原因。
  - (i) 可选：无痕窗口（`Target.createBrowserContext`）里同一页面的选区上 `contextMenuCount`，断言比普通窗口少 1 项（本扩展项不出现）；无痕窗口里拿不到测试窗口或菜单结构认不出时记 skip 并写明原因。
- [ ] **Step 5: I18N 与 B14**：`i18n.mjs` 已有 250 行，新检查写在 `steps/v04-i18n.mjs`，`i18n.mjs` 只加一处调用。在 4 种语言下打开 `?tabId=` 指向一个 `engine-a` 结果页的弹窗（`engine-a` 已授权，能读到网址 → 显示 `#complete`）和设置页新卡片，沿用现有的 key 外露、溢出检查，截图 `.e2e/i18n/<locale>-popup-complete.png`；`b14.mjs` 加 `.e2e/b14-popup-complete-dark.png`，设置页深色截图覆盖新卡片。
- [ ] **Step 6: 写 `docs/acceptance-v0.4.md`**（结构同 `docs/acceptance-v0.3.md`）：B18、T20–T24、I18N/B14 新增覆盖，每行写覆盖方式（auto/xauto/judge）；“预期行为”小节逐条抄 spec 3.14 末段的 6 条，加上 spec 3.3 的“窄窗口里查询标签激活”和菜单显示范围（按 S6 实测写，不照抄 spec 3.8：chrome:// 与无痕窗口里不出现；PDF 查看器里出现选区项，② 可用；`srcdoc`、`about:blank` iframe 里不出现；应用店页面未实测，写“预期不出现”）；“本版不在 e2e 里测的”写真点工具栏图标（S2 一次性 spike）、Lens/Bing/Yandex 真实引擎（人工抽查）、SW 冷启动后菜单点击；写明 T5 的重启期望从 v0.4 起改为“在旁边新开一对”，并在 `docs/acceptance-v0.1.md` 第 80 行 T5 的“重启后同样”后加注“（v0.4 起改为在旁边新开一对，见 acceptance-v0.4）”；`docs/_config.yml` 的 `exclude` 加 `acceptance-v0.4.md`。
- [ ] **Step 7: 跑并检查行数**

Run: `npm test && wc -l scripts/e2e/*.mjs scripts/e2e/steps/*.mjs && npm run e2e -- --auto-only --only T23,T24,I18N,B14,B15`
Expected: 每个文件 ≤ 300 行；全部 pass（(i)、(d') 可以是 skip 并写明原因）

- [ ] **Step 8: Commit**

```bash
git add scripts/e2e/steps/v04-guard.mjs scripts/e2e/steps/v04-i18n.mjs scripts/e2e/steps/index.mjs scripts/e2e/steps/i18n.mjs scripts/e2e/steps/b14.mjs docs/acceptance-v0.4.md docs/acceptance-v0.1.md docs/_config.yml test/e2e-v04.test.js
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "test(e2e): guard user pages against every rewrite path" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 15: 文案定稿与隐私、商店、README、CHANGELOG

**Files:**
- Modify: `src/_locales/{zh_CN,en,zh_TW,es}/messages.json`（本版新增的全部 key）、`docs/i18n/chrome-terms.md`（缺的术语经 `scripts/i18n/chrome-terms.mjs` 补）、`docs/store/privacy.md`、`docs/privacy.md`、`docs/privacy.zh-CN.md`、`docs/store/listing.{en,zh-CN,zh-TW,es}.md`、`README.md`、`README.zh-CN.md`、`README.zh-TW.md`、`README.es.md`、`docs/index.md`（检查）、`CHANGELOG.md`

**Interfaces:**
- Consumes: spec 3.10（披露、单一用途、权限理由、隐私政策要改的说法、审核员说明）、3.13（key 清单与中文初稿）、3.9“商店详情、README 与其他”。

- [ ] **Step 1: 界面文案**：按 CLAUDE.md“## 文案”：先把新增 key 的 zh_CN 用 lieflat-less-ai-tone + humanizer-zh 定稿；再按市场转写 en（humanizer）、zh_TW（humanizer-zh + 台湾用语审校，不得有简体字和大陆用语）、es（content-l10n，中性国际西语，用 tú）。“拆分视图”“右键菜单”“以图搜图”“标签页”等术语以 `docs/i18n/chrome-terms.md` 为准，缺的从 `/opt/google/chrome/locales/<语言>.pak` 核实后补进术语表。菜单标题保持短，避免引擎名以外的 `&`（S11 结论见 Spike 结论）。各任务的初稿 key 见 Task 5、6、7、10、11 的 Files。
- [ ] **Step 2: 隐私文档三份同改**：`docs/store/privacy.md` 的速查表、(a) 单一用途、(b) 新增 activeTab 与 contextMenus 两节（spec 3.10 英文初稿走文案流程）、(d) 加勾“Website content”及理由、给审核员的英文说明、(f) 中英两版政策正文（新增条目、删掉“不读取网页内容”、改小标题、`storage.session`/`storage.sync` 字段清单）；`docs/privacy.md`、`docs/privacy.zh-CN.md` 同步并更新生效日期。速查表“读取另一侧标签页的 `url`”一行和政策第 3 条按 v0.4 改：没有记录时 go.html 仍读另一侧网址比较，但结论只用来记日志、一律不覆盖（`fallback-own` 按 `foreign` 新开一对）；右键路径不读另一侧网址；⑦ 只在点图标后读当前标签网址、不保存。**前置条件**：“页面网址不发”只有 Task 11b 的 S10 证实扩展发起的导航不带 Referer 才写，S10 不成立就删掉这半句、如实描述；Lens 活动记录不提，只写“按该引擎自己的隐私政策处理”（S13 在 Task 16 Step 6 发布前核实，结论要提时回来补）。全文只写 v0.4 的完整状态，不写版本间差别。
- [ ] **Step 3: 商店详情 ×4 与 README ×4**：FEATURES/功能列表加补成分屏、右键查词、以图搜图；PRIVACY/隐私段第一句改成“不发给开发者或其他第三方；你要查的内容只发给你选的引擎”这层意思；`listing.zh-CN.md` 的“提交前必做”加“控制台勾选 Website content、填两个新权限理由、先更新 GitHub Pages 隐私政策”，“措辞说明”跟着改；4 份 README 结构一致、语言切换行不变；检查 `docs/index.md` 是否需要同步。各语言按 Step 1 的流程各润色一轮。
- [ ] **Step 4: `CHANGELOG.md`**：在 `## [未发布]` 下写 v0.4 的条目（按仓库现有中文分类：新增 / 变更 / 修复），写明新权限 `activeTab`、`contextMenus`（无安装警告）、读取选中文字和图片网址并只发给所选引擎、CWS 数据披露新增 Website content、重启或更新后在恢复的分屏里触发会在旁边新开一对（兜底不再复用）。版本号与日期在 Task 16 落定。
- [ ] **Step 5: 检查**

Run: `npm test`
Expected: PASS（含 `test/i18n-catalog.test.js` 的 4 语言 key 对齐、`test/store-i18n.test.js`）

- [ ] **Step 6: Commit**（按三组分开提交）

```bash
git add src/_locales docs/i18n/chrome-terms.md
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "docs(i18n): finalize v0.4 interface copy in four languages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
git add docs/store/privacy.md docs/privacy.md docs/privacy.zh-CN.md docs/store/listing.en.md docs/store/listing.zh-CN.md docs/store/listing.zh-TW.md docs/store/listing.es.md
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "docs(store): disclose selected text and image addresses sent to engines" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
git add README.md README.zh-CN.md README.zh-TW.md README.es.md docs/index.md CHANGELOG.md
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "docs: describe v0.4 features in the readmes and changelog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

---

### Task 16: 版本 0.4.0、CLAUDE.md 同步与全量验证

**Files:**
- Modify: `src/manifest.json`、`package.json`（`version: "0.4.0"`）、`test/manifest.test.js`（版本断言）、`CHANGELOG.md`（`[未发布]` → `[0.4.0] - <日期>`）、`CLAUDE.md`

- [ ] **Step 1: 版本号**改成 `0.4.0`（三处），CHANGELOG 晋升版本条目。

Run: `node --test test/manifest.test.js test/pack.test.js`
Expected: PASS

- [ ] **Step 2: CLAUDE.md**（spec 3.9“CLAUDE.md”逐条）：
  - 硬约束、反目标、路线图、机制速览：照 spec 3.9“CLAUDE.md”第 2–6 条改；路线图写“已实现（<日期> 代码完成，尚未上传商店）”；反目标里“读取或保存页面网址”注明 ② ⑧ 不读 `pageUrl`/`frameUrl`、⑦ 只在点图标时读当前标签网址且不保存；机制速览的右键路径写成 `contextMenus.onClicked` → SW 串行链 → `lookup-decision` 八行判定，补成分屏写成 `complete-split` 消息 → SW 重新识别与判定。
  - 目录与职责：`lib/image-engines.js`、`lib/result-match.js`、`lib/messages.js`、`lib/lookup-input.js`、`lib/lookup-decision.js`、`lib/menu-spec.js`、`lib/serial.js`、`chrome/menus.js`、`chrome/lookup-actions.js`、`chrome/complete-actions.js`、`popup/complete.js`、`options/lookup.js`、`options/image-edits.js`、`options/actions.js`、e2e 的 `steps/v04-*.mjs`、新测试文件、`docs/acceptance-v0.4.md`；`config-store.js` 一行加 `lookupEngine`、`imageEngine`、`imageEngines`。
  - 已知事实：spec 附录 A 的 F1–F8、F10、F13、F17、F20，以及已完成 spike 的结论（见本计划“Spike 结论”）：真点工具栏图标授予 activeTab、SW 读得到网址（S2）；弹窗建分屏后没有被关掉（S1，只在 Xvfb 上测过）；`selectionText` 不截断、`\n`/`\t` 各换成一个空格（S3）；PiP 是 `type: "normal"`、`alwaysOnTop: true`，在它上面按 `createPaired` 的参数调分屏 API 会崩溃（S5；已在 v0.3.0 热修中完成（e21e10e），CLAUDE.md 已写入，不要重复）；`documentUrlPatterns` 按 frame 网址匹配、可编辑区域里菜单项出现、密码框 `selectionText` 是掩码、PDF 查看器里出现选区项（S6）；`srcUrl` 是 `currentSrc`（S7）；重启恢复拆分视图后 `splitViewId` 不变、标签 id 变化（S14）；Task 11b 写进“Spike 结论”的 S8–S12。
  - e2e 说明：T20–T24、B18；不授权的模拟 host（`UNGRANTED_HOSTS`，不进 `GRANT_ORIGINS`）；右键菜单按行定位、不发任何按键，图片右键前清掉选区；`MENU_INDEX` 常量来自 S11；预期的拒绝只记 `info` 级日志，B15 不受影响；T5 重启子项改为期望在旁边新开一对。
  - 命令节 `--smoke` 的核对项加两条：权限警告与 v0.3 相同（只有 DNR 一条）；SW 里菜单文案加载正常（切 `uiLocale` 重建菜单后没有 `[split-search]` 错误）。
- [ ] **Step 3: 全量测试与 e2e**

Run: `npm test && npm run e2e -- --auto-only`
Expected: 全部 pass，或已知的预期降级（T14）与写明原因的 skip；没有新增失败

- [ ] **Step 4: Commit**

```bash
git add src/manifest.json package.json test/manifest.test.js CHANGELOG.md CLAUDE.md
git -c user.name=pine2D -c user.email=oumu323@gmail.com commit -m "chore: release v0.4.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QAFczmx2FRoPgu46A1z6D9"
```

- [ ] **Step 5: 干净树上冒烟**

Run: `git status --porcelain && npm run pack -- --smoke`
Expected: `git status --porcelain` 无输出；冒烟通过，打印 `dist/split-search-0.4.0.zip` 的大小与 sha256、key 已去掉，权限警告与 v0.3 相同（Task 1）、SW 文案核对通过（Task 7）

- [ ] **Step 6: 发布前检查与报告**：先请用户做 S13（登录 Google 后用 Lens 搜一次，看“我的活动”里有没有记录），要提就回 Task 15 补隐私文字并重跑 Step 5；再向用户报告 spike 结论与据此改过的步骤（含 S10 的结论）；CWS 上传前要做的事（先更新 GitHub Pages 隐私政策 → 控制台填 `activeTab`、`contextMenus` 理由 → 数据披露加勾 Website content → 更新单一用途与审核员说明）；上传命令 `npm run pack -- --store-key ~/.config/split-search/cws-public-key.pem --smoke`（v0.3 是否单独先发、何时上传由用户决定，不自动执行）。
