# 隐私做法与隐私政策

> 状态：v0.2.0 已于 2026-10-25 提交；本文件已按 v0.8 代码同步（`storage.sync` 含关键词规则 `rightRules` 与联动关闭开关 `closePairTogether`，`storage.session` 含拆分视图记录与配对标记 `linked:<splitViewId>`，`storage.local` 含 `setupDone`），下次上传时照此更新控制台的“隐私做法”。公开版本在 `docs/privacy.md`、`docs/privacy.zh-CN.md`（GitHub Pages）。全文只写当前版本的完整做法，版本间的差别写在 `CHANGELOG.md`。
> 前半部分是控制台“隐私做法”标签页各栏的填写建议。审核员读英文，所以可粘贴的文字用英文，说明用中文。后半部分 (f) 是隐私政策全文（中英两版），需要托管在公开网址上。
> 依据：`src/manifest.json`、`src/background.js`、`src/go.js`、`src/popup/popup.js`、`src/popup/complete.js`、`src/lib/rules.js`、`src/lib/engines.js`、`src/lib/image-engines.js`、`src/lib/split-owner.js`、`src/lib/split-decision.js`、`src/lib/lookup-input.js`、`src/lib/menu-spec.js`、`src/lib/result-match.js`、`src/lib/messages.js`、`src/lib/close-pair.js`、`src/chrome/config-store.js`、`src/chrome/split-state.js`、`src/chrome/split-actions.js`、`src/chrome/right-switch.js`、`src/chrome/menus.js`、`src/chrome/lookup-actions.js`、`src/chrome/complete-actions.js`、`src/chrome/close-store.js`、`src/chrome/i18n.js`、`src/options/ui.js`、`src/options/shortcut.js`、`src/options/lookup.js`、`src/options/setup.js`、`src/chrome/setup-store.js`、`src/lib/right-rules.js`、`src/options/rules.js`、`src/popup/rule-note.js`。

> **重点说明（2026-10-25）**
> - **数据使用披露勾“网页浏览记录”（Web history）和“网站内容”（Website content），其余七类不勾。** 依据和结论见 (d)。
> - 勾选不等于“收集后发走”。扩展只在本机读取并暂存它被要求处理的内容：组合网址（关键词和 `_ss` 标记）；用户选了本扩展的右键菜单项时，选中的文字或那张图片的网址；用户点工具栏图标时当前标签页的网址；没有记录时另一侧标签页的网址（只比较 origin、路径和搜索词参数是否存在）；以及内存里的拆分视图记录。这一点在 (d) 的审核说明、隐私政策和商店详情的“隐私”段都要写明，不能删。
> - 不向开发者或任何第三方发送数据；没有统计代码，没有远程代码。关键词、选中的文字和图片网址只由用户的浏览器发给用户选的引擎。设置在用户开启 Chrome 同步时会由 Chrome 同步，这一点必须保留披露；v0.5 起设置里还有用户在设置页自己写的关键词规则（词或一种文字），扩展不会从搜索里取词写进去。

## 代码事实速查（供核对）

| 事实 | 出处 |
|---|---|
| `permissions` 是 `activeTab`、`contextMenus`、`declarativeNetRequest`、`storage`；没有 `tabs`，没有必需的 `host_permissions`。`activeTab`、`contextMenus` 没有安装警告；`action.default_popup` 和 `commands` 不是权限，也不产生安装警告 | `src/manifest.json`、`scripts/pack-smoke.mjs`（核对权限警告只有 DNR 那一条） |
| `optional_host_permissions` 为 `https://*/*`、`http://*/*`，但运行时只为文字引擎的精确 origin 申请 `<origin>/*`，含 `*` 的不生成；只在用户点击“授权”时调用 `chrome.permissions.request`。从引擎库添加条目不申请权限；以图搜图引擎不申请任何权限，设置页也不给它们显示授权按钮 | `src/options/ui.js` `originPattern` / `authButton`、`src/options/catalog.js`、`src/options/lookup.js` |
| 只有一条 DNR 动态规则（id 1）：只匹配带 `_ss=` 参数的 `main_frame` 请求，`requestDomains` 只含可作左侧的引擎的 hostname（DNR 也会匹配它们的子域名），动作是重定向到本扩展的 `go.html?u=<原网址>`。不拦截、不改请求头和响应头 | `src/lib/rules.js`、`src/background.js` |
| 右键菜单只有两项：`ss-lookup-text`（`contexts: ["selection"]`）和 `ss-lookup-image`（`contexts: ["image"]`，`targetUrlPatterns` 只允许 http(s) 图片网址，`data:`、`blob:` 图片不出现这一项），两项的 `documentUrlPatterns` 都只是 http(s) 页面。不改 Chrome 自带的菜单项 | `src/lib/menu-spec.js`、`src/chrome/menus.js` |
| 点了菜单项后，扩展只读 Chrome 随这次点击给出的 `selectionText`、`editable`、`mediaType`、`srcUrl`，不读 `pageUrl`、`frameUrl`；没有内容脚本，不读页面上的其他内容。选中的文字去掉多余空白后最多取 500 个字符；在可编辑区域（输入框、密码框等）里选中的文字不处理。图片网址按 `encodeURIComponent` 编码后代入以图搜图引擎的网址模板，引擎解码后得到原网址 | `src/lib/lookup-input.js`、`src/chrome/lookup-actions.js` |
| 右侧（查询一侧）的网址 = 用户选的查词引擎或以图搜图引擎的模板，`%s` 换成选中的文字或图片网址。扩展自己不下载图片，由引擎的服务器按网址去取。扩展用 `tabs.create` / `tabs.update` 打开的导航不带 `Referer`（S10 实测，2026-10-25），所以不会把用户正在看的页面网址发给引擎；但图片网址本身可能透露它所在的网站或页面 | `src/chrome/lookup-actions.js`、`src/lib/trigger.js` `expandTemplate`；实现计划 Spike 结论 S10 |
| 工具栏弹窗：用户点工具栏图标后，Chrome 经 `activeTab` 临时提供当前标签页的网址。弹窗用它判断是不是某个已配置文字引擎的结果页、取出关键词（只看已配置的引擎模板），用户点了引擎后只给 SW 发 `{ type: "complete-split", tabId, engineId }`，SW 用 `tabs.get` 重新读这个标签页、重新识别后才打开右侧。网址不保存、不发送 | `src/popup/popup.js`、`src/popup/complete.js`、`src/lib/result-match.js`、`src/lib/messages.js`、`src/chrome/complete-actions.js` |
| `chrome.storage.sync` 只存设置：`customEngines`（id、名称、网址模板，从引擎库带来的条目可另有 `leftDiscouraged`）、`presetOverrides`（名称、网址、隐藏）、`order`、`defaultPair`、`uiLocale`（界面语言）、`narrowFallback`（窄窗口时右侧是否改开相邻标签页）、`closePairTogether`（同时关闭另一侧开关）、`cycleExclude`（不参与快捷键轮换的引擎 id）、`lookupEngine`（查词引擎 id，缺省时跟随默认组合的右侧）、`imageEngine`（以图搜图引擎 id，缺省 `lens`）、`imageEngines`（自定义以图搜图引擎的 id、名称、网址模板）、`rightRules`（关键词规则，有序：每条的条件是用户写的词或一种文字，右侧是一个引擎 id 或“保持默认组合的右侧”标记 `keep`；规则删光时整个键删除）。不含用户搜索过的关键词、选中的文字或图片网址；关键词规则里的词是用户在设置页自己写的，扩展不会从搜索里取词 | `src/lib/engines.js` `mergeConfig`、`src/lib/image-engines.js`、`src/lib/right-rules.js` `cleanRules`、`src/options/edits.js`、`src/options/image-edits.js`、`src/options/rule-edits.js`、`src/options/rules.js`、`src/options/options.js` |
| `chrome.storage.local` 只存布尔值 `setupDone`：网站搜索网址是否打开过一对搜索结果（go.html 在一次真实触发写成一对搜索记录后写 true，“试搜示例”打开的那一对不算）。不同步，不含关键词、网址或标签页 id。“试搜示例”打开的标签页 id 存在 `chrome.storage.session` 的 `setupTryTabs`（只有 id 数组，最多 50 个），只在内存，浏览器关闭即清空。工具栏弹窗也读 `setupDone`（和默认组合左侧引擎是否已授权，`permissions.contains`），只用来决定分屏外显示哪一档引导，不写 | `src/chrome/setup-store.js`、`src/lib/setup-state.js`、`src/go.js`、`src/options/setup.js`、`src/popup/idle.js` |
| `chrome.storage.session` 存本扩展所建拆分视图（或窄窗口下的相邻标签页）的记录：键 `split:<tabId>`，值 `{ peer, splitViewId, mode, role, input?, engine, query, rule?, base? }`，以及开启同时关闭时记录配对标签 id 的 `linked:<splitViewId>`。不含页面网址，也不存命中的词。只在内存中，不同步；浏览器关闭即清空，扩展重新加载、更新、停用时也清空；标签页关闭时（`tabs.onRemoved`）删掉它的记录 | `src/chrome/split-state.js`、`src/chrome/close-store.js`、`src/lib/split-owner.js`、`src/chrome/split-actions.js`、`src/go.js`、`src/background.js` |
| 查询内容的用途只有三个：拼出引擎的网址；在工具栏弹窗里显示（图片只显示网址的 host，不加载图片、不放进悬停提示），并在用户从弹窗或用快捷键换引擎时拼出新引擎的网址；在本机与用户的关键词规则比较（只比规范化后的前 1000 个字符）：`go.html` 用它决定默认组合的右侧，弹窗按记录里的查询重算命中的词、说明右侧为什么换了，补成分屏时用它排建议顺序 | `src/go.js`、`src/popup/popup.js`、`src/lib/popup-view.js`、`src/chrome/right-switch.js`、`src/lib/trigger.js`、`src/lib/right-rules.js`、`src/popup/rule-note.js`、`src/lib/result-match.js` |
| 读取另一侧标签页的 `url`（拆分视图经 `tabs.query({splitViewId})`，相邻标签页经 `tabs.get`）：有有效记录时按记录和 `splitViewId` 判定。没有记录时（典型是浏览器重启后），`go.html`（地址栏、拖拽、Chrome 自带的右键“使用X搜索”都经过它）、工具栏弹窗（`ownedPair` 与补成分屏的 `complete-actions`）和快捷键（`ownedPair`）仍会经 `looksLikeSearchPage` 比较它的 origin、路径和 `%s` 所在参数是否存在且非空，看是否像某个已配置引擎的结果页，但这个结论只用来判断，不会据此改写任何标签页：`go.html` 把判出的 `fallback-own` 按 `foreign` 处理，在旁边新开一对；弹窗和快捷键只认 `own`。本扩展自己的右键菜单项（`lookup-actions`）判定时不传引擎模板，另一侧的网址不参与比较。只有已授权 origin 上的标签页才读得到；不保存网址 | `src/lib/split-owner.js` `judgeOwnership`、`looksLikeSearchPage`、`src/lib/split-decision.js` `decideSplit`、`src/chrome/split-state.js` `inspectTab`、`src/chrome/right-switch.js` `ownedPair`、`src/chrome/complete-actions.js`、`src/chrome/lookup-actions.js` |
| 弹窗只读当前窗口的活动标签页（`tabs.query({active:true, currentWindow:true})`）；快捷键 `cycle-right` 只改最后聚焦的 normal 窗口的活动标签页。挑窗口时（`windows.getLastFocused`、`windows.getAll`、`windows.get` 带 `populate`，用来排除画中画小窗）会拿到这些窗口的标签列表，网址只有已授权网站才给，代码只用标签数、`openerTabId`、`lastAccessed` 挑窗口，不读、不存网址。`manifest` 不写 `suggested_key`，用户没绑定时快捷键不生效 | `src/popup/popup.js`、`src/background.js`、`src/chrome/split-actions.js` |
| 日志不带关键词、关键词规则命中的词、选中的文字、图片网址和任何标签页网址：打印错误前一律经 `safeError` / `safeArgs`，只留错误名和消息，引号里的内容和网址样的文字换成 …，不带堆栈；预期的拒绝只记 `console.info` 级 | `src/lib/safe-error.js`、`src/background.js`、`src/chrome/lookup-actions.js`、`src/chrome/complete-actions.js`；`test/log-wiring.test.js` 守门 |
| 唯一的 `fetch` 读取扩展包内的 `_locales/*/messages.json`（`chrome-extension://` 地址），没有任何外部请求；没有 `XMLHttpRequest`、`WebSocket`、`sendBeacon`，也没有 `eval` 或远程脚本；两个引擎库都只写在代码里 | `src/chrome/i18n.js`、`src/lib/engine-catalog.js`、`src/lib/image-engines.js`；`test/i18n-catalog.test.js` 的 fetch 守门 |
| 没有 `externally_connectable`，不注册 `onMessageExternal`；`runtime.onMessage` 只处理本扩展弹窗发来的两种消息：SW 处理 `complete-split`（`{ type, tabId, engineId }`），已开的设置页只接受发给本标签的 `reveal-setup`（`{ type, tabId }`），两种都不带网址或关键词，都校验发送方是本扩展的 `popup/popup.html`；SW 对 `reveal-setup` 不回复 | `src/manifest.json`、`src/background.js`、`src/options/setup.js`、`src/lib/messages.js` |
| 复制按钮用 `navigator.clipboard.writeText` 写入组合网址或 `chrome://settings/searchEngines`；不读剪贴板。设置页“快捷键”一行用 `chrome.commands.getAll` 读当前绑定，按钮用 `tabs.create` 打开 `chrome://extensions/shortcuts` | `src/options/ui.js`、`src/options/shortcut.js` |
| `incognito: "not_allowed"`：扩展不在无痕式窗口运行，右键菜单项在无痕式窗口里不出现 | `src/manifest.json` |

## (a) Single purpose（单一用途）

```text
Split Search opens search results side by side in Chrome’s split view: two search engines’ results for the same search, or a search or image search next to the page the user is reading. When the user searches from the address bar or drags text onto the tab strip, and Chrome navigates to a pair URL the user added as a site search (as default search engine or via its shortcut), the extension opens the left engine’s results in the current tab and the right engine’s results in the other tab of the split view. Everything else in the extension serves this purpose: the engine lists and catalogs, the pair-URL generator, site-access requests, the toolbar popup (switch the engine on one side, or open another engine next to a results page that is already open), the keyboard shortcut that switches the right-side engine, and the two right-click menu items that look up selected text or search an image next to the current page.
```

字数：926

## (b) Permission justification（权限理由）

控制台会逐项列出 manifest 中声明的权限。每栏上限 1000 字符，各段控制在 950 字符以内，留出约 5% 余量；改动后重新统计下面的“字数”（按 JavaScript 字符串长度计）。

### activeTab

```text
When the user clicks the toolbar icon, Chrome temporarily grants access to the current tab. The popup uses it only to read that tab’s URL: it checks whether the page is a results page of one of the user’s search engines and reads its search terms, so the user can open another engine’s results next to it in a split view. The search terms are also compared on the device with the user’s keyword rules to choose which engine to suggest first. The URL is used on the device only and is never stored or sent anywhere. If the user then opens the split view, the search terms are kept in memory like any other split view (see storage). Choosing one of the extension’s right-click menu items, or pressing its keyboard shortcut, also grants this access because of how Chrome works; the extension does not use it there. No content scripts are injected.
```

字数：844

### contextMenus

```text
Adds two items to the right-click menu on http and https pages: one for selected text and one for images with a public http(s) URL. When the user chooses an item, the extension opens the selected text or image URL in the search engine chosen on the settings page, next to the current page (in a split view when possible). It reads only the selected text or image URL that Chrome passes with that click. It does not read or store the page’s own URL, and it does not inject content scripts.
```

字数：488

### declarativeNetRequest

```text
Used for exactly one dynamic redirect rule. It matches only top-level (main_frame) navigations whose URL contains the extension’s own marker parameter “_ss=”, and only on the hostnames (and their subdomains) of the user’s engines that can act as the left side (Chrome applies the redirect only where the user has granted host access). Those navigations are redirected to the extension’s own page (go.html), which reads the search terms from that URL and opens the two result pages in a split view. The rule never blocks requests and never modifies request or response headers. Such URLs come from the pair URLs the user adds to Chrome as site searches.
```

字数：652

### storage

```text
chrome.storage.sync holds only settings: custom engines (name, URL template, right-only flag), renamed or hidden built-in engines, engine order, default pair, language, narrow-window, linked-closing, and shortcut options, right-click lookup engines, custom image search engines, and keyword rules. It syncs only if Chrome sync is on and never holds search queries, selected text, or image URLs; rule words are typed manually, never taken from searches. chrome.storage.session keeps in memory a record per tab pair opened by the extension: paired tab IDs, split view ID, each tab’s role and engine, any matched rule, and the active query (search terms, selected text, or image URL) so the popup and shortcut can show the query and switch engines; it clears when the tab or browser closes. chrome.storage.local holds one setup-completed flag; session storage keeps sample-search tab IDs in memory.
```

字数：895

### Host permissions（optional_host_permissions）

```text
No host access is granted at install. https://*/* and http://*/* are optional host permissions only, so users can add any search engine. The extension requests only each selected engine’s exact origin (e.g. https://www.google.com/*), and only when the user clicks “Grant access” for that engine in settings; wildcard hosts are never requested. Catalog engines request nothing when added, and image search engines need no host access. The left engine’s origin is needed because a declarativeNetRequest redirect requires host permission for the request URL. For granted origins, Chrome also exposes the URL of the tab paired with the current one; without a record of that pair (e.g. after a browser restart), the extension compares that URL’s origin, path, and search-terms parameter with the user’s engine templates, and never overwrites a tab based on it. The tabs permission is not used. Access can be revoked anytime in chrome://extensions.
```

字数：942

说明：扩展还调用了 `chrome.tabs.create / get / update / query / remove / getCurrent / createSplit`、`chrome.tabs.onRemoved`、`chrome.windows.get / getCurrent / getLastFocused / getAll / create / update`、`chrome.runtime.onMessage / sendMessage / getContexts / openOptionsPage`、`chrome.permissions.contains / onAdded / onRemoved`（`request` 见速查表）、`chrome.contextMenus.onClicked` 和 `chrome.commands.getAll / onCommand` 等（不逐个列全）。这些 API 不需要声明权限，控制台不会让你写理由；上面的 host 一栏已说明为什么不需要 `tabs` 权限。

## (c) Remote code（远程代码）

选择：**No, I am not using remote code.**

依据：所有脚本都打包在扩展里，用 `<script type="module" src="…">` 和相对路径 `import` 加载；没有 `eval`、`new Function` 或外部脚本，manifest 也没有放宽 CSP。

## (d) Data usage（数据使用披露）

**决定（2026-10-25）：勾 Web history（网页浏览记录）和 Website content（网站内容），其余七类不勾。**

上传时在控制台“隐私做法 → 数据使用”照下表勾选（控制台的类别名以英文为准）：

| 类别 | 勾选 | 理由 |
|---|---|---|
| Personally identifiable information | 否 | 不读姓名、地址、邮箱、账号等。选中的文字可能含个人信息，但扩展只处理用户自己选中并要求查询的那一段，不把它当作个人信息收集或识别 |
| Health information | 否 | 无 |
| Financial and payment information | 否 | 无 |
| Authentication information | 否 | 不读密码、凭据、cookie；可编辑区域（含密码框）里的选区不处理 |
| Personal communications | 否 | 不读邮件、消息。选中的文字可能来自邮件，同样只按用户的要求发给查词引擎，不当作通信内容收集 |
| Location | 否 | 不读位置，也不读 IP |
| **Web history** | **是** | 读取组合网址（含关键词）、点工具栏图标时当前标签页的网址，没有记录时读取另一侧标签页的网址；把查询内容和两侧引擎 id 记在 `storage.session`，直到标签页或浏览器关闭 |
| User activity | 否 | 不监听点击、滚动、鼠标位置或按键；快捷键由 Chrome 的 `commands` 触发，菜单点击由 Chrome 的 `contextMenus` 派发，扩展收不到按键内容，只收到选区和图片网址 |
| **Website content** | **是** | 用户选了本扩展的右键菜单项时，读取选中的文字或那张图片的网址，发给用户选的引擎，并作为这次查询记在 `storage.session`。没有内容脚本，不读页面上的其他内容 |

三项合规声明照旧全部勾选，见 (e)。

### 扩展在本机实际读取和保存的内容（核对代码后的完整清单）

1. 组合网址：只有带 `_ss=` 的主框架导航、且 hostname 属于可作左侧的引擎（含子域名）时，DNR 规则才把它交给 `go.html`。规则不看导航从哪里来：网页里一个带 `_ss` 的链接被点开时同样会交给 `go.html`；正常使用中这类网址只来自用户自己添加的组合网址。`go.html` 从中取出关键词和 `_ss` 的值（两个引擎 id），拼出左右两个结果页网址后在标签页中打开（`src/go.js`、`src/lib/trigger.js`）。
2. 右键菜单的选区和图片网址：只在用户选了本扩展的菜单项时，从 Chrome 给的点击信息里读 `selectionText` 或 `srcUrl`。文字发给查词引擎，图片网址发给以图搜图引擎，都是拼进右侧标签页的网址里，由用户的浏览器打开。不读 `pageUrl`、`frameUrl`，没有内容脚本（`src/lib/lookup-input.js`、`src/chrome/lookup-actions.js`）。
3. 当前标签页的网址（工具栏弹窗）：用户点工具栏图标后经 `activeTab` 读到，用来判断是不是结果页、取出关键词，关键词还在本机与关键词规则比较、决定建议里排第一的引擎；用户点了引擎才打开右侧。网址不保存（`src/popup/popup.js`、`src/chrome/complete-actions.js`）。
4. 拆分视图记录：打开拆分视图（或窄窗口下的相邻标签页）后，把两个标签页的 id、`splitViewId`、角色、查询类型、各自显示的引擎 id 和查询内容写进 `chrome.storage.session`；右侧是关键词规则换的时，右侧记录另有规则 id 和本来的右侧引擎 id；开启同时关闭时另记配对标签 id。用途是工具栏弹窗显示当前查询和右侧为什么换了、弹窗和快捷键换引擎、判断这一对标签页是不是本扩展的，以及同时关闭配对搜索标签页。只在内存，不同步、不上传；标签页关闭时删掉，浏览器关闭即清空（`src/chrome/split-state.js`、`src/chrome/close-store.js`、`src/background.js`）。
5. 另一侧标签页的网址：tabs API 返回的是完整网址。有有效记录时扩展按记录判定，不看网址；没有记录时（浏览器重启后），`go.html`、工具栏弹窗和快捷键会比较它的 origin、路径和搜索词参数是否存在，看是否像某个已配置引擎的结果页，结论只用来判断，不会据此改写任何标签页，`go.html` 在旁边新开一对。本扩展自己的右键菜单项不比较这个网址。只有已授权 origin 上的标签页 Chrome 才提供网址。网址不保存（`src/lib/split-owner.js`、`src/lib/split-decision.js`）。
6. 设置：`chrome.storage.sync` 中的引擎名称、网址模板、排序、隐藏、默认组合、界面语言、窄窗口与同时关闭开关、快捷键轮换排除列表、查词引擎和以图搜图引擎的选择、自定义以图搜图引擎、用户写的关键词规则；用户开启 Chrome 同步时由 Chrome 同步。不含用户搜索过的关键词、选中的文字或图片网址；关键词规则里的词是用户在设置页自己写的，扩展不会从搜索里取词（`src/lib/right-rules.js`、`src/options/rule-edits.js`）。另有 `chrome.storage.local` 的布尔值 `setupDone`（网站搜索网址是否打开过一对搜索结果，由 go.html 经 `src/chrome/setup-store.js` 写入；设置页和工具栏弹窗读它决定显示哪种设置引导），不同步，不含查询数据；设置完成前“试搜示例”打开的标签页 id 记在 `chrome.storage.session` 的 `setupTryTabs`，只在内存。
7. 没有任何网络请求、统计、广告或远程代码；没有 `history`、`tabs`、`cookies` 权限，没有 content script。关键词、选中的文字和图片网址只由用户的浏览器发给用户选的引擎，包括用户在弹窗里或用快捷键换上的引擎。

### 为什么勾 Web history 和 Website content

依据：CWS 用户数据 FAQ（https://developer.chrome.com/docs/webstore/program-policies/user-data-faq ，2026-10-25 查阅）。

- 第 2 条（什么叫 handle）：“Generally, by "handle" we mean collecting, transmitting, using, or sharing user data.” 例子里有 “Collecting web browsing activity and any information about the website content or resources”。只是“使用”也算 handle，传输（transmitting）同样算。
- 第 3 条：本地处理、不传输也要披露（“even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties”）。
- 第 4 条（用户数据举例）：“Web browsing activity (which is any information about the websites or other web resources a user requests …)”。
- Website content 类别在控制台里的举例是 “text, images, sounds, videos, or hyperlinks”。

Web history：扩展读取组合网址、当前标签页的网址，并把查询内容和两侧引擎 id 按标签页存进 `storage.session`，保留到标签页或浏览器关闭，相当于在本机保存了一份“当前打开的几次查询”的记录。即使只在内存、不出设备，按第 3、4 条也属于处理网页浏览活动；九个类别里最贴近的是 Web history。

Website content：右键查词读取的是网页上的文字（选区），以图搜图读取的是网页上图片资源的网址，两者都会经由右侧标签页的网址发给一个外部服务（用户选的引擎）。这正是第 2 条说的“处理网站内容并传输”。“是用户主动点的”不能把它排除在外，第 3 条连本地处理都要求披露。给审核员的说明里如果还写“不读页面内容”，加了 `contextMenus` 之后审核员很容易看出这句不成立，按披露不完整处理。

其他类别不勾的理由见上表。

### 各处说法对照（改一处，其他几处一起核对）

| 位置 | 当前说法 |
|---|---|
| 本文件开头“重点说明”、(d) 开头的决定 | 勾 Web history 和 Website content，其余不勾 |
| 隐私政策中英两版的小标题 | “核心原则：查询内容只发往你所选的引擎，绝不发给开发者或其他第三方” / “Core principle: queries go only to the engines you choose, never to the developer or other third parties” |
| 隐私政策“儿童”一节 | 不针对儿童，也不收集任何人的个人信息（选中的文字和关键词不当作个人信息处理） |
| 4 种语言 `listing.*.md` 详细说明【隐私】段第一句 | 查询内容只发往所选引擎，绝不发给开发者或其他第三方 |
| 4 份 README 的隐私段、`docs/index.md` | 同上 |
| `listing.zh-CN.md` “提交前必做”与“措辞说明” | 勾网页浏览记录和网站内容，填两个新权限的理由，先更新 GitHub Pages 隐私政策 |

### 给审核员的英文说明（可直接粘贴）

放在提交时给审核员的说明栏（如“测试说明”），或在审核询问时回复。

```text
Data usage: “Web history” and “Website content” are selected. Here is exactly what the extension reads and keeps, all inside the user’s browser.
- It reads the URL of a search the user started with a pair URL they added to Chrome as a site search. Only top-level navigations to the hostnames of the user’s left-capable engines that carry the marker parameter “_ss” (normally produced only by the user’s own pair URL) reach the extension, via one declarativeNetRequest redirect to its own page. It takes the search terms and the “_ss” value (two engine IDs) from that URL to open the two result pages in a split view.
- Right-click menu: only when the user chooses one of the extension’s two menu items, it reads the selected text or image URL that Chrome passes with that click, and opens it in the engine the user picked, next to the current page. That text or URL goes only to that engine. It does not read the page URL or anything else on the page; there are no content scripts.
- activeTab: when the user clicks the toolbar icon, the popup reads the current tab’s URL to check whether it is a results page of one of the user’s engines and to read its search terms, which are compared on the device with the user’s keyword rules to order the suggested engines. The URL is not stored.
- For each pair of tabs it opens, it keeps a record in chrome.storage.session (memory only): the paired tab IDs, the split view ID, each tab’s role, which engine each tab shows, which keyword rule (if any) picked the right-side engine and which engine it replaced, and what was searched (search terms, selected text, or an image URL). The toolbar popup shows this and lets the user load another engine, and an optional keyboard shortcut (unbound by default) does the same. The record is never synced or transmitted, is deleted when the tab closes, and is cleared when the browser closes.
- To tell whether a split view is its own, it checks that record. Without a record (for example after a browser restart), it reads the other tab’s URL and compares its origin, path, and search-terms parameter with the user’s engine templates; it never overwrites a tab based on that check. The extension’s own right-click lookups skip this comparison. Chrome exposes that URL only for sites the user granted access to. The URL is not stored.
- It does not read browsing history (no “history” or “tabs” permission), cookies, clipboard contents, keystrokes, or text the user types on web pages.
- Settings are stored in chrome.storage.sync (Chrome syncs them if the user has Chrome sync on). They never contain what the user searched, selected text, or image URLs. They can include keyword rules the user writes on the settings page: words or a writing system, each with a right-side engine. Searches are compared with these rules on the device, and the extension never takes words from a search to put in a rule.
- Nothing is transmitted to the developer or any third party. There are no network requests, no analytics, and no remote code. Search terms, selected text, and image URLs go only from the user’s browser to the engines the user chose, including an engine the user switches to.
We selected “Web history” because the extension reads search URLs and keeps what was searched in its split views in memory until the tab or browser closes, and “Website content” because, at the user’s request, it reads selected text or an image URL from the page and sends it to the user’s chosen engine.
```

## (e) Certifications（合规声明）

三项都勾选，扩展的实际行为与之相符：

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
  不出售、不转让：扩展没有服务器，不向开发者或任何第三方发送数据。关键词、选中的文字和图片网址由用户自己的浏览器发往用户选择的引擎，这正是用户要求的功能。
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  读取组合网址、选区、图片网址和当前标签页网址，暂存查询内容，都只为在拆分视图里并排打开结果、换引擎。
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.
  无关。

## 隐私政策网址

控制台填 `https://pine2d.github.io/split-search/privacy`（GitHub Pages，`main:/docs`，与 Pinboard 扩展同一做法）。开发者账号层面的隐私政策网址与这里一致。中文版在 `https://pine2d.github.io/split-search/privacy.zh-CN.html`。

托管副本是 `docs/privacy.md`（English）和 `docs/privacy.zh-CN.md`（简体中文），内容取自下面 (f)；**改 (f) 必须同步改这两个文件**，反之亦然。提交前先把托管副本推上 GitHub Pages，再在控制台改“隐私做法”。

---

## (f) 隐私政策全文

> 占位符已在托管副本里填好：`{{PRIVACY_POLICY_URL}}` = `https://pine2d.github.io/split-search/privacy`、`{{CONTACT_URL}}` = `https://github.com/pine2D/split-search/issues`、`{{EFFECTIVE_DATE}}` = 2026-10-27（按 v0.5 改写，加了关键词规则；此前 2026-10-26 按 v0.4 改写，界面翻新补了 `setupDone`）。此处保留占位符作模板；托管副本另在标题下加了中英互链，中文副本的“本政策网址”填的是中文页 `https://pine2d.github.io/split-search/privacy.zh-CN.html`（与模板唯一不同之处）。作者署名 pine2D。

### 简体中文

```markdown
# Split Search 隐私政策

生效日期：{{EFFECTIVE_DATE}}
本政策网址：{{PRIVACY_POLICY_URL}}

Split Search（以下简称“本扩展”）是由 pine2D 开发的 Chrome 扩展，用于在 Chrome 拆分视图中并排显示两个搜索引擎的结果，或在当前网页旁分屏查词、搜图。本政策说明本扩展如何处理数据。

## 核心原则：查询内容只发往你所选的引擎，绝不发给开发者或其他第三方

- 本扩展不向开发者或任何第三方发送任何数据，也不出售数据。本扩展没有服务器，不主动发起网络请求，不含统计、广告、第三方代码或远程代码。
- 搜索关键词、右键选中的文字和图片网址，仅由浏览器直接发往你选定的搜索引擎。
- 本扩展仅保存你的设置项，以及当前已打开拆分视图的临时记录（含当次查询内容；仅存于浏览器内存，关闭浏览器即清除，详见第 4 条）。
- 为完成分屏与换引擎操作，本扩展会在本地读取：你发起搜索时的网址；点击本扩展右键菜单项时选中的文字或图片网址；点击工具栏图标时当前标签页的网址；必要时另一侧标签页的网址。上述网址均不保存。

## 本扩展在本地处理的数据

1. 组合网址与关键词。当你使用添加到 Chrome 的组合网址搜索时（仅含本扩展标记参数 `_ss` 的网址会交由本扩展处理），本扩展在本地读取该网址，提取关键词与 `_ss` 中的引擎标识，生成右侧引擎网址，并在两个标签页中并排打开两侧结果页。
2. 右键菜单选中的文字与图片网址。仅当你点击本扩展的右键菜单项时，本扩展才读取 Chrome 随点击传入的所选文字（最多取前 500 个字符）或图片网址。文字只发往所选查词引擎，图片网址只发往所选以图搜图引擎（由引擎服务器自行拉取图片）。本扩展不含内容脚本，不读取页面网址或页面其他内容，打开查询页时也不向搜索引擎发送原网页地址（不带 Referer 来源信息）；输入框等可编辑区域内选中的文字不处理。注意：图片网址可能反映其来源网站；若网址本身带有临时访问凭证（如带签名或有效期的链接），发送后该引擎也能凭此读取图片。
3. 当前标签页网址。点击工具栏图标时，Chrome 临时允许本扩展访问当前标签页（`activeTab`）。弹窗在本地读取该标签页网址，识别是否为已配置引擎的搜索结果页并提取关键词（同时在本地比对关键词规则以排列建议顺序），以便你在右侧加开另一个引擎。该网址不保存、不外发；若你随后打开拆分视图，关键词会按第 4 条记入内存记录。
4. 拆分视图记录。本扩展打开拆分视图（或窄窗口下的相邻标签页）后，会在 `chrome.storage.session` 中记录两个标签页编号、各自角色（搜索页、原网页或查询页）、对应引擎及当次查询内容（关键词、所选文字或图片网址；若由关键词规则切换右侧，还记录规则编号与原右侧引擎），不含原网页网址；开启同时关闭另一侧时还会记录配对标签编号。工具栏弹窗和快捷键据此展示当前查询并切换引擎。记录仅存于浏览器内存，不同步、不上传；关闭标签页即删除对应记录，关闭浏览器或重载、更新、停用扩展时全部清空。
5. 另一侧标签页网址。判断一对标签页是否由本扩展打开时，优先核对第 4 条记录；无记录时（如重启浏览器后），本扩展在处理搜索、打开弹窗或按快捷键换引擎时，会读取已授权网站上另一侧标签页的网址，仅核对其网站域名、路径及是否带有搜索词参数，且不会据此覆盖已有标签页（需要时在旁边另开一对）。本扩展的右键菜单查询不比对另一侧网址。该网址仅用于当次判断，不保存；本扩展不读取浏览历史。
6. 设置项。搜索引擎列表与排序、隐藏状态、默认组合、界面语言、窄窗口与同时关闭开关、快捷键轮换范围、右键查词与以图搜图引擎配置、以及你在设置页填写的关键词规则保存在 `chrome.storage.sync` 中，不含任何搜索记录、所选文字或图片网址（规则词均由你手动输入，不会从搜索历史提取）。若你开启了 Chrome 同步，这些设置会随你的 Google 账号同步（受 Chrome 与 Google 隐私政策约束，开发者无法访问）。此外，`chrome.storage.local` 仅在本机记录一项“是否已用网站搜索完成过分屏”的状态标记，用来收起首次使用引导；“试搜示例”打开的标签页编号仅暂存于内存 `chrome.storage.session`，关闭浏览器即清除。

## 发往搜索引擎的数据

搜索关键词、选中的文字和图片网址由你的浏览器直接发往所选搜索引擎（包括在弹窗里或用快捷键换上的引擎），不发给其他任何一方，与你直接在这些网站上搜索无异。以图搜图时，由所选引擎的服务器按图片网址读取图片。各搜索引擎如何处理数据，适用其各自的隐私政策。

## 权限

- activeTab：点击工具栏图标时，用于读取当前标签页网址以识别是否为搜索结果页。点击本扩展右键菜单或按下快捷键时，虽然 Chrome 按机制也会临时授予此权限，但本扩展不会在这些时候读取标签页网址。
- contextMenus：在网页右键菜单中添加两项，分别用于查询选中的文字和带公开网址的图片。
- declarativeNetRequest：仅将带有本扩展标记参数 `_ss` 的搜索网址重定向到本扩展页面，不拦截其他请求，也不修改请求头或响应头。
- storage：保存上述设置项与拆分视图记录。
- 网站访问权限：安装时不授予任何网站权限。只有你在设置页为所选搜索引擎点“授权”时，才申请该引擎具体网站的权限；从引擎库添加引擎时不申请，以图搜图引擎也不需要任何网站权限。你可以随时在 `chrome://extensions` 的扩展详情页“有权访问的网站”中撤销。

本扩展不在无痕式窗口中运行。快捷键默认未设置，仅在 Chrome“键盘快捷键”页面绑定后生效。

## 数据共享

本扩展不与任何人共享、出售或转让数据。本扩展对数据的使用遵守 Chrome 网上应用店用户数据政策，包括其中的“有限使用”（Limited Use）要求。

## 数据删除

关闭标签页或浏览器会删除拆分视图记录。卸载本扩展会删除保存在本机的设置；若开启了 Chrome 同步，同步数据由 Chrome 按其规则处理。你也可以在设置页删除自定义引擎、以图搜图引擎和关键词规则，或在 `chrome://extensions` 的扩展详情页“有权访问的网站”中撤销网站权限。

## 儿童

本扩展不针对儿童，也不收集任何人的个人信息。

## 政策变更

如本政策有变更，会更新本页面并修改生效日期。若新版本处理数据的方式发生实质变化，会在更新说明中写明。各版本更新说明见 https://github.com/pine2D/split-search/blob/main/CHANGELOG.md 。

## 联系方式

开发者：pine2D
联系：{{CONTACT_URL}}
```

### English

```markdown
# Split Search Privacy Policy

Effective date: {{EFFECTIVE_DATE}}
Policy URL: {{PRIVACY_POLICY_URL}}

Split Search (“the extension”) is a Chrome extension developed by pine2D. It opens search results from two engines side by side in Chrome’s split view, or looks up selected text and images next to the page you are reading. This policy explains how the extension handles data.

## Core principle: queries go only to the engines you choose, never to the developer or other third parties

- The extension sends no data to the developer or any third party and does not sell data. It has no servers, makes no network requests of its own, and contains no analytics, advertising, third-party code, or remote code.
- Your browser sends search terms, selected text, and image URLs directly to the search engines you choose.
- The extension stores only your settings and temporary session records of open split views (including what was searched; kept only in browser memory and cleared when the browser closes, as detailed in item 4).
- To open and manage split views, the extension reads locally on your device: the search URL you trigger; selected text or an image URL when you click its right-click menu items; the active tab’s URL when you click the toolbar icon; and, when needed, the paired tab’s URL. None of these URLs are stored.

## Data handled on your device

1. Pair URLs and search terms. When you search using a pair URL added to Chrome (only URLs carrying the extension’s `_ss` parameter reach the extension), the extension reads that URL locally, extracts the search terms and engine IDs from `_ss`, builds the right-side engine URL, and opens both result pages in two tabs.
2. Selected text and image URLs from the right-click menu. Only when you click one of the extension’s context-menu items does it read the selected text (up to 500 characters) or image URL passed by Chrome. Text goes only to your chosen text lookup engine, and image URLs go only to your chosen image search engine (whose server fetches the image). The extension uses no content scripts, never reads the page URL or other page content, and opens lookup tabs without sending the source page’s Referer; selections inside editable fields are ignored. An image URL may reveal its source site, or carry temporary access tokens (such as signed URLs) that let the chosen engine fetch the image.
3. Active tab URL. Clicking the toolbar icon grants temporary `activeTab` access to the current tab. The popup reads that tab’s URL locally to check whether it matches a configured search engine’s results page and extract its search terms (also matching them locally against your keyword rules to order suggestions), so you can open a second engine beside it. The URL is neither stored nor sent anywhere; if you open a split view from the popup, the query is recorded in memory as in item 4.
4. Split records. When opening a split view (or adjacent tabs in narrow windows), the extension stores in `chrome.storage.session` the two tab IDs, each tab’s role (search, original page, or lookup), the engine shown, and the query (search terms, selected text, or image URL; plus the matched rule ID and original right engine when switched by a keyword rule), with no page URLs; if linked closing is enabled, paired tab IDs are also noted. The popup and keyboard shortcut use this record to display the active query and switch engines. Records stay in browser memory, are never synced or uploaded, and are deleted when a tab closes or cleared completely when the browser closes or the extension reloads, updates, or is disabled.
5. Paired tab URL. To check whether a tab pair belongs to Split Search, the extension first checks item 4. If no record exists (such as after a browser restart), handling a search, opening the popup, or pressing the shortcut reads the other tab’s URL (only on sites you granted access to) and checks only its origin, path, and whether a query parameter is present. It never overwrites an existing tab based on that check, opening a new pair beside it instead. Right-click lookups do not check the other tab’s URL. The URL is not stored, and browsing history is never read.
6. Settings. Configured engines, order, hidden built-in engines, default pair, interface language, narrow-window and linked-closing switches, shortcut rotation choices, lookup and image search engines, and keyword rules are saved in `chrome.storage.sync`. They never contain search queries, selected text, or image URLs (rule words are typed manually in settings, never taken from searches). If Chrome sync is enabled, Chrome syncs these settings under Google’s privacy policies without developer access. One local status flag in `chrome.storage.local` notes whether a site search URL has opened a result pair so first-run setup prompts can collapse once completed; tab IDs from “Run example search” stay in `chrome.storage.session` only until the browser closes.

## Data sent to search engines

Your browser sends your search terms, selected text, and image URLs directly to the engines you choose, including an engine you switch to from the popup or with the keyboard shortcut, and to no one else. This is the same as searching on those sites yourself. For an image search, the engine’s server fetches the image from its URL. How those sites handle your searches is governed by their own privacy policies.

## Permissions

- activeTab: when you click the toolbar icon, reads the current tab’s URL to check whether it is a search results page. Chrome also grants this temporary access when you choose one of the extension’s right-click menu items or press its keyboard shortcut, though the extension does not read the tab URL then.
- contextMenus: adds two items to the right-click menu on web pages, one for selected text and one for images with a public URL.
- declarativeNetRequest: redirects only search URLs carrying the extension’s `_ss` marker parameter to the extension’s own page. It never blocks other requests or modifies request or response headers.
- storage: stores the settings and split records described above.
- Site access: no site access is granted at install. Access to a specific search engine’s site is requested only when you click “Grant access” for an engine on the settings page; adding an engine from the catalog requests nothing, and image search engines need no site access at all. You can revoke access at any time under “Site access” on the extension’s details page in `chrome://extensions`.

The extension does not run in Incognito windows. The keyboard shortcut is not set by default and works only after you set it on Chrome’s Keyboard shortcuts page.

## Data sharing

The extension does not share, sell, or transfer data to anyone. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Data deletion

Closing a tab or the browser deletes the split records. Uninstalling the extension deletes the settings stored on your device; if Chrome sync is on, synced data is handled by Chrome under its own rules. You can also delete custom engines, image search engines, and keyword rules on the settings page, or revoke site access in `chrome://extensions`.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, this page will be updated along with the effective date. If a new version changes how the extension handles data in a material way, the release notes will say so. Release notes for every version are at https://github.com/pine2D/split-search/blob/main/CHANGELOG.md.

## Contact

Developer: pine2D
Contact: {{CONTACT_URL}}
```
