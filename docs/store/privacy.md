# 隐私做法与隐私政策

> 状态：v0.2.0 已于 2026-10-25 提交；本文件已按 v0.5 代码改写（2026-10-27：`storage.sync` 加了用户写的关键词规则 `rightRules`，搜索对右侧的拆分视图记录加了 `rule`、`base`，查询内容多了在本机与规则比较这一用途；此前按 v0.4 改写于 2026-10-25，2026-10-26 界面翻新补了 `storage.local` 的 `setupDone` 与 `storage.session` 的 `setupTryTabs`），下次上传时照此更新控制台的“隐私做法”。公开版本在 `docs/privacy.md`、`docs/privacy.zh-CN.md`（GitHub Pages）。全文只写当前版本的完整做法，版本间的差别写在 `CHANGELOG.md`。
> 前半部分是控制台“隐私做法”标签页各栏的填写建议。审核员读英文，所以可粘贴的文字用英文，说明用中文。后半部分 (f) 是隐私政策全文（中英两版），需要托管在公开网址上。
> 依据：`src/manifest.json`、`src/background.js`、`src/go.js`、`src/popup/popup.js`、`src/popup/complete.js`、`src/lib/rules.js`、`src/lib/engines.js`、`src/lib/image-engines.js`、`src/lib/split-owner.js`、`src/lib/split-decision.js`、`src/lib/lookup-input.js`、`src/lib/menu-spec.js`、`src/lib/result-match.js`、`src/lib/messages.js`、`src/chrome/config-store.js`、`src/chrome/split-state.js`、`src/chrome/split-actions.js`、`src/chrome/right-switch.js`、`src/chrome/menus.js`、`src/chrome/lookup-actions.js`、`src/chrome/complete-actions.js`、`src/chrome/i18n.js`、`src/options/ui.js`、`src/options/shortcut.js`、`src/options/lookup.js`、`src/options/setup.js`、`src/chrome/setup-store.js`、`src/lib/right-rules.js`、`src/options/rules.js`、`src/popup/rule-note.js`（核对日期 2026-10-25，对应 v0.4；2026-10-26 界面翻新补核 `storage.local` 与 `setupTryTabs`；2026-10-27 按 v0.5 补核关键词规则）。

> **重点说明（2026-10-25）**
> - **数据使用披露勾“网页浏览记录”（Web history）和“网站内容”（Website content），其余七类不勾。** 依据和结论见 (d)。
> - 勾选不等于“收集后发走”。扩展只在本机读取并暂存它被要求处理的内容：触发网址（关键词和 `_ss` 标记）；用户选了本扩展的右键菜单项时，选中的文字或那张图片的网址；用户点工具栏按钮时当前标签页的网址；没有记录时另一侧标签页的网址（只比较 origin、路径和搜索词参数是否存在）；以及内存里的拆分视图记录。这一点在 (d) 的审核说明、隐私政策和商店详情的“隐私”段都要写明，不能删。
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
| 工具栏弹窗：用户点工具栏按钮后，Chrome 经 `activeTab` 临时提供当前标签页的网址。弹窗用它判断是不是某个已配置文字引擎的结果页、取出关键词（只看已配置的引擎模板），用户点了引擎后只给 SW 发 `{ type: "complete-split", tabId, engineId }`，SW 用 `tabs.get` 重新读这个标签页、重新识别后才打开右侧。网址不保存、不发送 | `src/popup/popup.js`、`src/popup/complete.js`、`src/lib/result-match.js`、`src/lib/messages.js`、`src/chrome/complete-actions.js` |
| `chrome.storage.sync` 只存设置：`customEngines`（id、名称、网址模板，从引擎库带来的条目可另有 `leftDiscouraged`）、`presetOverrides`（名称、网址、隐藏）、`order`、`defaultPair`、`uiLocale`（界面语言）、`narrowFallback`（窄窗口时右侧是否改开后台标签页）、`cycleExclude`（不参与快捷键轮换的引擎 id）、`lookupEngine`（查词引擎 id，缺省时跟随默认组合的右侧）、`imageEngine`（以图搜图引擎 id，缺省 `lens`）、`imageEngines`（自定义以图搜图引擎的 id、名称、网址模板）、`rightRules`（关键词规则，有序：每条的条件是用户写的词或一种文字，右侧是一个引擎 id 或“保持默认组合的右侧”标记 `keep`；规则删光时整个键删除）。不含用户搜索过的关键词、选中的文字或图片网址；关键词规则里的词是用户在设置页自己写的，扩展不会从搜索里取词 | `src/lib/engines.js` `mergeConfig`、`src/lib/image-engines.js`、`src/lib/right-rules.js` `cleanRules`、`src/options/edits.js`、`src/options/image-edits.js`、`src/options/rule-edits.js`、`src/options/rules.js`、`src/options/options.js` |
| `chrome.storage.local` 只存布尔值 `setupDone`：设置页“开始使用”卡是否已完成（go.html 在一次真实触发写成一对搜索记录后写 true，“试一下”打开的那一对不算）。不同步，不含关键词、网址或标签页 id。“试一下”打开的标签页 id 存在 `chrome.storage.session` 的 `setupTryTabs`（只有 id 数组，最多 50 个），只在内存，浏览器关闭即清空。工具栏弹窗也读 `setupDone`（和默认组合左侧引擎是否已授权，`permissions.contains`），只用来决定分屏外显示哪一档引导，不写 | `src/chrome/setup-store.js`、`src/lib/setup-state.js`、`src/go.js`、`src/options/setup.js`、`src/popup/idle.js` |
| `chrome.storage.session` 存本扩展所建拆分视图（或窄窗口下的相邻标签页）的记录：键 `split:<tabId>`，值 `{ peer, splitViewId, mode, role, input?, engine, query, rule?, base? }`，即另一侧标签页 id、建立时的 `splitViewId`、`split`/`adjacent`、这个标签页的角色（`search` 本扩展打开的搜索页、`page` 用户的网页、`lookup` 查询结果）、查询类型（`text`/`image`，只有右键查询的一对才有）、这个标签页显示的引擎 id（`page` 一侧为空）、查询内容（关键词、选中的文字或图片网址），以及（只在搜索对的右侧、右侧是关键词规则换的时）选中它的规则 id 和本来的右侧引擎 id；用户在弹窗里或用快捷键换过右侧后这两项去掉。不含页面网址，也不存命中的词。只在内存中，不同步；浏览器关闭即清空，扩展重新加载、更新、停用时也清空；标签页关闭时（`tabs.onRemoved`）删掉它的记录 | `src/chrome/split-state.js`、`src/lib/split-owner.js`、`src/chrome/split-actions.js`、`src/go.js`、`src/background.js` |
| 查询内容的用途只有三个：拼出引擎的网址；在工具栏弹窗里显示（图片只显示网址的 host，不加载图片、不放进悬停提示），并在用户从弹窗或用快捷键换引擎时拼出新引擎的网址；在本机与用户的关键词规则比较（只比规范化后的前 1000 个字符）：`go.html` 用它决定默认组合的右侧，弹窗按记录里的查询重算命中的词、说明右侧为什么换了，补成分屏时用它排建议顺序 | `src/go.js`、`src/popup/popup.js`、`src/lib/popup-view.js`、`src/chrome/right-switch.js`、`src/lib/trigger.js`、`src/lib/right-rules.js`、`src/popup/rule-note.js`、`src/lib/result-match.js` |
| 读取另一侧标签页的 `url`（拆分视图经 `tabs.query({splitViewId})`，相邻标签页经 `tabs.get`）：有有效记录时按记录和 `splitViewId` 判定。没有记录时（典型是浏览器重启后），`go.html`（地址栏、拖拽、Chrome 自带的右键“使用X搜索”都经过它）、工具栏弹窗（`ownedPair` 与补成分屏的 `complete-actions`）和快捷键（`ownedPair`）仍会经 `looksLikeSearchPage` 比较它的 origin、路径和 `%s` 所在参数是否存在且非空，看是否像某个已配置引擎的结果页，但这个结论只用来判断，不会据此改写任何标签页：`go.html` 把判出的 `fallback-own` 按 `foreign` 处理，在旁边新开一对；弹窗和快捷键只认 `own`。本扩展自己的右键菜单项（`lookup-actions`）判定时不传引擎模板，另一侧的网址不参与比较。只有已授权 origin 上的标签页才读得到；不保存网址 | `src/lib/split-owner.js` `judgeOwnership`、`looksLikeSearchPage`、`src/lib/split-decision.js` `decideSplit`、`src/chrome/split-state.js` `inspectTab`、`src/chrome/right-switch.js` `ownedPair`、`src/chrome/complete-actions.js`、`src/chrome/lookup-actions.js` |
| 弹窗只读当前窗口的活动标签页（`tabs.query({active:true, currentWindow:true})`）；快捷键 `cycle-right` 只改最后聚焦的 normal 窗口的活动标签页。挑窗口时（`windows.getLastFocused`、`windows.getAll`、`windows.get` 带 `populate`，用来排除画中画小窗）会拿到这些窗口的标签列表，网址只有已授权网站才给，代码只用标签数、`openerTabId`、`lastAccessed` 挑窗口，不读、不存网址。`manifest` 不写 `suggested_key`，用户没绑定时快捷键不生效 | `src/popup/popup.js`、`src/background.js`、`src/chrome/split-actions.js` |
| 日志不带关键词、关键词规则命中的词、选中的文字、图片网址和任何标签页网址：打印错误前一律经 `safeError` / `safeArgs`，只留错误名和消息，引号里的内容和网址样的文字换成 …，不带堆栈；预期的拒绝只记 `console.info` 级 | `src/lib/safe-error.js`、`src/background.js`、`src/chrome/lookup-actions.js`、`src/chrome/complete-actions.js`；`test/log-wiring.test.js` 守门 |
| 唯一的 `fetch` 读取扩展包内的 `_locales/*/messages.json`（`chrome-extension://` 地址），没有任何外部请求；没有 `XMLHttpRequest`、`WebSocket`、`sendBeacon`，也没有 `eval` 或远程脚本；两个引擎库都只写在代码里 | `src/chrome/i18n.js`、`src/lib/engine-catalog.js`、`src/lib/image-engines.js`；`test/i18n-catalog.test.js` 的 fetch 守门 |
| 没有 `externally_connectable`，不注册 `onMessageExternal`；`runtime.onMessage` 只接受本扩展弹窗发来的 `complete-split` 消息 | `src/manifest.json`、`src/background.js`、`src/lib/messages.js` |
| 复制按钮用 `navigator.clipboard.writeText` 写入触发网址或 `chrome://settings/searchEngines`；不读剪贴板。设置页“快捷键”一行用 `chrome.commands.getAll` 读当前绑定，按钮用 `tabs.create` 打开 `chrome://extensions/shortcuts` | `src/options/ui.js`、`src/options/shortcut.js` |
| `incognito: "not_allowed"`：扩展不在无痕窗口运行，右键菜单项在无痕窗口里不出现 | `src/manifest.json` |

## (a) Single purpose（单一用途）

```text
Split Search opens search results side by side in Chrome’s split view: two search engines’ results for the same search, or a search or image search next to the page the user is reading. When the user searches from the address bar or drags text onto the tab strip, and Chrome navigates to a trigger URL the user added as a site search (as default search engine or via its shortcut), the extension opens the left engine’s results in the current tab and the right engine’s results in the other tab of the split view. Everything else in the extension serves this purpose: the engine lists and catalogs, the trigger-URL generator, site-access requests, the toolbar popup (switch the engine on one side, or open another engine next to a results page that is already open), the keyboard shortcut that switches the right-side engine, and the two right-click menu items that look up selected text or search an image next to the current page.
```

字数：932

## (b) Permission justification（权限理由）

控制台会逐项列出 manifest 中声明的权限。每栏上限 1000 字符，各段控制在 950 字符以内，留出约 5% 余量；改动后重新统计下面的“字数”（按 JavaScript 字符串长度计）。

### activeTab

```text
When the user clicks the toolbar icon, Chrome temporarily grants access to the current tab. The popup uses it only to read that tab’s URL: it checks whether the page is a results page of one of the user’s search engines and reads its search terms, so the user can open another engine’s results next to it in a split view. The URL is used on the device only and is never stored or sent anywhere. If the user then opens the split view, the search terms are kept in memory like any other split view (see storage). Choosing one of the extension’s right-click menu items, or pressing its keyboard shortcut, also grants this access because of how Chrome works; the extension does not use it there. No content scripts are injected.
```

字数：724

### contextMenus

```text
Adds two items to the right-click menu on http and https pages: one for selected text and one for images that have a public http(s) address. When the user chooses an item, the extension opens the selected text, or the image’s address, in the search engine the user picked on the settings page, next to the current page (in a split view when possible). It reads only the selected text or image address that Chrome passes with that click. It does not read or store the page’s own URL, and it does not inject content scripts.
```

字数：522

### declarativeNetRequest

```text
Used for exactly one dynamic redirect rule. It matches only top-level (main_frame) navigations whose URL contains the extension’s own marker parameter “_ss=”, and only on the hostnames (and their subdomains) of the user’s engines that can act as the left side (Chrome applies the redirect only where the user has granted host access). Those navigations are redirected to the extension’s own page (go.html), which reads the search terms from that URL and opens the two result pages in a split view. The rule never blocks requests and never modifies request or response headers. Such URLs come from the trigger URLs the user adds to Chrome as site searches.
```

字数：655

### storage

```text
chrome.storage.sync holds only settings: custom engines (name, URL template, right-only flag), renamed or hidden built-in engines, engine order, the default pair, interface language, narrow-window and shortcut options, right-click lookup engines, custom image search engines, and keyword rules for the right side. It syncs only if Chrome sync is on. It never holds what the user searched, selected text or image addresses; rule words are typed by the user, never taken from searches. chrome.storage.session keeps in memory a record per tab pair the extension opened: the other tab’s ID, split view ID, each tab’s role and engine, which rule picked the right engine, and what was searched (search terms, selected text or an image address). The popup and shortcut use it to show the search and switch engines. It is cleared when the tab or browser closes. chrome.storage.local holds one setup flag; session storage also keeps setup’s “Try it” tab IDs.
```

字数：949

### Host permissions（optional_host_permissions）

```text
No host access is granted at install. https://*/* and http://*/* are optional host permissions only, so users can add any search engine. The extension requests only each selected engine’s exact origin (e.g. https://www.google.com/*), and only when the user clicks “Grant access” for that engine on the settings page; wildcard hosts are never requested. Catalog engines request nothing when added, and image search engines need no host access. The left engine’s origin is needed because a declarativeNetRequest redirect requires host permission for the request URL. For granted origins, Chrome also exposes the URL of the tab paired with the current one; without a record of that pair (e.g. after a browser restart), the extension compares that URL’s origin, path and search-terms parameter with the user’s engine templates, and never overwrites a tab based on it. The tabs permission is not used. Access can be revoked anytime in chrome://extensions.
```

字数：950

说明：扩展还调用了 `chrome.tabs.create / get / update / query / remove / getCurrent / createSplit`、`chrome.tabs.onRemoved`、`chrome.windows.get / getLastFocused / getAll / create / update`、`chrome.runtime.onMessage / sendMessage`、`chrome.contextMenus.onClicked` 和 `chrome.commands.getAll / onCommand`。这些 API 不需要声明权限，控制台不会让你写理由；上面的 host 一栏已说明为什么不需要 `tabs` 权限。

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
| **Web history** | **是** | 读取触发网址（含关键词）、点工具栏按钮时当前标签页的网址，没有记录时读取另一侧标签页的网址；把查询内容和两侧引擎 id 记在 `storage.session`，直到标签页或浏览器关闭 |
| User activity | 否 | 不监听点击、滚动、鼠标位置或按键；快捷键由 Chrome 的 `commands` 触发，菜单点击由 Chrome 的 `contextMenus` 派发，扩展收不到按键内容，只收到选区和图片网址 |
| **Website content** | **是** | 用户选了本扩展的右键菜单项时，读取选中的文字或那张图片的网址，发给用户选的引擎，并作为这次查询记在 `storage.session`。没有内容脚本，不读页面上的其他内容 |

三项合规声明照旧全部勾选，见 (e)。

### 扩展在本机实际读取和保存的内容（核对代码后的完整清单）

1. 触发网址：只有带 `_ss=` 的主框架导航、且 hostname 属于可作左侧的引擎（含子域名）时，DNR 规则才把它交给 `go.html`。规则不看导航从哪里来：网页里一个带 `_ss` 的链接被点开时同样会交给 `go.html`；正常使用中这类网址只来自用户自己添加的触发网址。`go.html` 从中取出关键词和 `_ss` 的值（两个引擎 id），拼出左右两个结果页网址后在标签页中打开（`src/go.js`、`src/lib/trigger.js`）。
2. 右键菜单的选区和图片网址：只在用户选了本扩展的菜单项时，从 Chrome 给的点击信息里读 `selectionText` 或 `srcUrl`。文字发给查词引擎，图片网址发给以图搜图引擎，都是拼进右侧标签页的网址里，由用户的浏览器打开。不读 `pageUrl`、`frameUrl`，没有内容脚本（`src/lib/lookup-input.js`、`src/chrome/lookup-actions.js`）。
3. 当前标签页的网址（工具栏弹窗）：用户点工具栏按钮后经 `activeTab` 读到，用来判断是不是结果页、取出关键词；用户点了引擎才打开右侧。网址不保存（`src/popup/popup.js`、`src/chrome/complete-actions.js`）。
4. 拆分视图记录：打开拆分视图（或窄窗口下的相邻标签页）后，把两个标签页的 id、`splitViewId`、角色、查询类型、各自显示的引擎 id 和查询内容写进 `chrome.storage.session`；右侧是关键词规则换的时，右侧记录另有规则 id 和本来的右侧引擎 id。用途是工具栏弹窗显示当前查询和右侧为什么换了、弹窗和快捷键换引擎，以及判断这一对标签页是不是本扩展的。只在内存，不同步、不上传；标签页关闭时删掉，浏览器关闭即清空（`src/chrome/split-state.js`、`src/background.js`）。
5. 另一侧标签页的网址：tabs API 返回的是完整网址。有有效记录时扩展按记录判定，不看网址；没有记录时（浏览器重启后），`go.html`、工具栏弹窗和快捷键会比较它的 origin、路径和搜索词参数是否存在，看是否像某个已配置引擎的结果页，结论只用来判断，不会据此改写任何标签页，`go.html` 在旁边新开一对。本扩展自己的右键菜单项不比较这个网址。只有已授权 origin 上的标签页 Chrome 才提供网址。网址不保存（`src/lib/split-owner.js`、`src/lib/split-decision.js`）。
6. 设置：`chrome.storage.sync` 中的引擎名称、网址模板、排序、隐藏、默认组合、界面语言、窄窗口开关、快捷键轮换排除列表、查词引擎和以图搜图引擎的选择、自定义以图搜图引擎、用户写的关键词规则；用户开启 Chrome 同步时由 Chrome 同步。不含用户搜索过的关键词、选中的文字或图片网址；关键词规则里的词是用户在设置页自己写的，扩展不会从搜索里取词（`src/lib/right-rules.js`、`src/options/rule-edits.js`）。另有 `chrome.storage.local` 的布尔值 `setupDone`（设置页“开始使用”卡是否已完成，由 go.html 经 `src/chrome/setup-store.js` 写入；设置页和工具栏弹窗读它决定显示哪种设置引导），不同步，不含查询数据；设置完成前“试一下”打开的标签页 id 记在 `chrome.storage.session` 的 `setupTryTabs`，只在内存。
7. 没有任何网络请求、统计、广告或远程代码；没有 `history`、`tabs`、`cookies` 权限，没有 content script。关键词、选中的文字和图片网址只由用户的浏览器发给用户选的引擎，包括用户在弹窗里或用快捷键换上的引擎。

### 为什么勾 Web history 和 Website content

依据：CWS 用户数据 FAQ（https://developer.chrome.com/docs/webstore/program-policies/user-data-faq ，2026-10-25 查阅）。

- 第 2 条（什么叫 handle）：“Generally, by "handle" we mean collecting, transmitting, using, or sharing user data.” 例子里有 “Collecting web browsing activity and any information about the website content or resources”。只是“使用”也算 handle，传输（transmitting）同样算。
- 第 3 条：本地处理、不传输也要披露（“even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties”）。
- 第 4 条（用户数据举例）：“Web browsing activity (which is any information about the websites or other web resources a user requests …)”。
- Website content 类别在控制台里的举例是 “text, images, sounds, videos, or hyperlinks”。

Web history：扩展读取触发网址、当前标签页的网址，并把查询内容和两侧引擎 id 按标签页存进 `storage.session`，保留到标签页或浏览器关闭，相当于在本机保存了一份“当前打开的几次查询”的记录。即使只在内存、不出设备，按第 3、4 条也属于处理网页浏览活动；九个类别里最贴近的是 Web history。

Website content：右键查词读取的是网页上的文字（选区），以图搜图读取的是网页上图片资源的网址，两者都会经由右侧标签页的网址发给一个外部服务（用户选的引擎）。这正是第 2 条说的“处理网站内容并传输”。“是用户主动点的”不能把它排除在外，第 3 条连本地处理都要求披露。给审核员的说明里如果还写“不读页面内容”，加了 `contextMenus` 之后审核员很容易看出这句不成立，按披露不完整处理。

其他类别不勾的理由见上表。

### 各处说法对照（改一处，其他几处一起核对）

| 位置 | 当前说法 |
|---|---|
| 本文件开头“重点说明”、(d) 开头的决定 | 勾 Web history 和 Website content，其余不勾 |
| 隐私政策中英两版的小标题 | “重点说明：你查的内容只发给你选的引擎，不发给开发者或其他第三方” / “In short: what you look up goes only to the engines you choose, never to the developer or other third parties” |
| 隐私政策“儿童”一节 | 不针对儿童，也不收集任何人的个人信息（选中的文字和关键词不当作个人信息处理） |
| 4 种语言 `listing.*.md` 详细说明【隐私】段第一句 | 不发给开发者或其他第三方，你要查的内容只发给你选的引擎 |
| 4 份 README 的隐私段、`docs/index.md` | 同上 |
| `listing.zh-CN.md` “提交前必做”与“措辞说明” | 勾网页浏览记录和网站内容，填两个新权限的理由，先更新 GitHub Pages 隐私政策 |

### 给审核员的英文说明（可直接粘贴）

放在提交时给审核员的说明栏（如“测试说明”），或在审核询问时回复。

```text
Data usage: “Web history” and “Website content” are selected. Here is exactly what the extension reads and keeps, all inside the user’s browser.
- It reads the URL of a search the user started with a trigger URL they added to Chrome as a site search. Only top-level navigations to the hostnames of the user’s left-capable engines that carry the marker parameter “_ss” (normally produced only by the user’s own trigger URL) reach the extension, via one declarativeNetRequest redirect to its own page. It takes the search terms and the “_ss” value (two engine IDs) from that URL to open the two result pages in a split view.
- Right-click menu: only when the user chooses one of the extension’s two menu items, it reads the selected text or the image’s address that Chrome passes with that click, and opens it in the engine the user picked, next to the current page. That text or address goes only to that engine. It does not read the page URL or anything else on the page; there are no content scripts.
- activeTab: when the user clicks the toolbar icon, the popup reads the current tab’s URL to check whether it is a results page of one of the user’s engines and to read its search terms. The URL is not stored.
- For each pair of tabs it opens, it keeps a record in chrome.storage.session (memory only): the other tab’s ID, the split view ID, each tab’s role, which engine each tab shows, which keyword rule (if any) picked the right-side engine and which engine it replaced, and what was searched (search terms, selected text or an image address). The toolbar popup shows this and lets the user load another engine, and an optional keyboard shortcut (unbound by default) does the same. The record is never synced or transmitted, is deleted when the tab closes, and is cleared when the browser closes.
- To tell whether a split view is its own, it checks that record. Without a record (for example after a browser restart), it reads the other tab’s URL and compares its origin, path and search-terms parameter with the user’s engine templates; it never overwrites a tab based on that check. The extension’s own right-click lookups skip this comparison. Chrome exposes that URL only for sites the user granted access to. The URL is not stored.
- It does not read browsing history (no “history” or “tabs” permission), cookies, clipboard contents, keystrokes or text the user types on web pages.
- Settings are stored in chrome.storage.sync (Chrome syncs them if the user has Chrome sync on). They never contain what the user searched, selected text or image addresses. They can include keyword rules the user writes on the settings page: words or a writing system, each with a right-side engine. Searches are compared with these rules on the device, and the extension never takes words from a search to put in a rule.
- Nothing is transmitted to the developer or any third party. There are no network requests, no analytics and no remote code. Search terms, selected text and image addresses go only from the user’s browser to the engines the user chose, including an engine the user switches to.
We selected “Web history” because the extension reads search URLs and keeps what was searched in its split views in memory until the tab or browser closes, and “Website content” because, at the user’s request, it reads selected text or an image address from the page and sends it to the user’s chosen engine.
```

## (e) Certifications（合规声明）

三项都勾选，扩展的实际行为与之相符：

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
  不出售、不转让：扩展没有服务器，不向开发者或任何第三方发送数据。关键词、选中的文字和图片网址由用户自己的浏览器发往用户选择的引擎，这正是用户要求的功能。
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  读取触发网址、选区、图片网址和当前标签页网址，暂存查询内容，都只为在拆分视图里并排打开结果、换引擎。
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

Split Search（以下简称“本扩展”）是由 pine2D 开发的 Chrome 扩展，在 Chrome 拆分视图中并排打开搜索结果：两个搜索引擎的结果并排，或者在你正在看的网页旁边打开一次搜索或以图搜图。本政策说明本扩展如何处理你的数据。

## 重点说明：你查的内容只发给你选的引擎，不发给开发者或其他第三方

- 本扩展不把任何数据发送给开发者或任何第三方，也不出售数据。它没有服务器，自己不发网络请求，不含统计、广告、第三方代码或远程代码。
- 关键词、你在右键菜单里查的文字和图片网址，只由你的浏览器发给你选的引擎。
- 本扩展保存的只有你的设置，以及它打开的拆分视图的记录（含这次查询的内容）。记录只在浏览器内存里，关闭浏览器即清除，见下文第 4 条。
- 为了完成搜索，本扩展会在你的设备上读取几样东西：你发起的那次搜索的网址；你选了本扩展的右键菜单项时，选中的文字或那张图片的网址；你点工具栏按钮时当前标签页的网址；必要时另一侧标签页的网址。网址都不保存。下文逐条说明。

## 本扩展在你的设备上处理的数据

1. 触发网址和关键词。你通过自己添加到 Chrome 的触发网址搜索时（只有带本扩展标记参数 _ss 的网址会交给本扩展），本扩展会在本机读取这个网址，取出关键词和 _ss 中的引擎标识，拼出右侧搜索引擎的网址，然后在两个标签页中分别打开左右两个引擎的结果页。
2. 右键菜单里选中的文字和图片网址。只有你在右键菜单里选了本扩展的菜单项时，本扩展才读取你选中的文字（最多取前 500 个字符）或那张图片的网址，这是 Chrome 随这次点击交给它的。文字只发给你选的查词引擎，图片网址只发给你选的以图搜图引擎，由引擎的服务器自己下载图片。本扩展不读取页面网址，也不读取页面上的其他内容，没有内容脚本；它打开的结果页不会带上你正在看的页面的网址。在输入框等可编辑区域里选中的文字不处理。另外，有些图片网址本身就是访问凭证（例如带签名或有效期的地址），发给引擎就等于让引擎也能打开这张图；图片网址也可能透露它所在的网站或页面。
3. 当前标签页的网址。你点工具栏按钮时，Chrome 临时允许本扩展访问当前标签页（activeTab）。弹窗读取这个标签页的网址，判断它是不是你配置的某个搜索引擎的结果页，并取出关键词，方便你在旁边用另一个引擎打开同一次搜索。这个网址不保存、不发送；如果你接着打开了拆分视图，关键词会像其他拆分视图一样记进第 4 条的记录。
4. 拆分视图记录。本扩展打开拆分视图（窗口较窄时是相邻的两个标签页）后，会把两个标签页的编号、各自的角色（搜索结果、你的网页或查询结果）、各自显示的引擎和这次查询的内容记在 chrome.storage.session 里；右侧如果是关键词规则换的，还会记下是哪条规则换的，以及原来的右侧引擎。查询的内容是关键词、选中的文字或图片网址，记录里没有页面网址。工具栏弹窗用它显示当前查询和右侧为什么换了；你在弹窗里或用快捷键换引擎时，也靠它拼出新引擎的网址。这些记录只在浏览器内存里，不同步、不上传。标签页关闭时删除它的记录，关闭浏览器即全部清除；扩展重新加载、更新或停用时也会清除。
5. 另一侧标签页的网址。为了判断一对标签页是不是本扩展打开的，本扩展会先查上一条的记录。没有记录时（例如浏览器重启后），它会读取另一侧标签页的网址，看它像不像你配置的某个搜索引擎的结果页；比较时只看网站来源（origin）、路径，以及有没有带搜索词的参数。本扩展处理搜索时（从地址栏、拖拽文字或 Chrome 自带的右键“使用X搜索…”发起的都算），以及你打开工具栏弹窗、用快捷键换引擎时，都会这样比较。这个结论只用来判断，不会据此改写任何标签页；需要时，本扩展会在旁边另开一对。本扩展自己的右键菜单项（查询选中的文字或图片）不比较另一侧的网址。只有你授权过的网站上的标签页，Chrome 才会把网址提供给本扩展。这个网址只用于当次判断，不保存。本扩展不读取你的浏览历史。
6. 设置。你配置的搜索引擎（名称、网址模板）、排序、隐藏的预置引擎、默认组合、界面语言、窄窗口时的打开方式、哪些引擎参与快捷键轮换、查词引擎和以图搜图引擎的选择、你添加的以图搜图引擎（名称、网址模板），以及你写的关键词规则（规则里的词或一种文字，和要换成的右侧引擎），保存在 chrome.storage.sync 中。其中没有你搜索过的关键词、选中的文字或图片网址；规则里的词是你自己写的，本扩展不会从你的搜索里取词。用默认组合搜索时，本扩展在本机拿关键词和这些规则比较，决定右侧用哪个引擎。如果你开启了 Chrome 同步，Chrome 会通过你的 Google 账号在你的设备之间同步这些设置；这由 Chrome 和 Google 的隐私政策管辖，本扩展的开发者无法访问。本扩展还在 chrome.storage.local 里记一个“是否已完成设置”的标记（只有是或否），设置页和工具栏弹窗据此决定要不要显示设置引导，这个标记不会同步。设置完成前，用“试一下”打开的标签页编号会记在 chrome.storage.session 里，这样试一下不会被当成已完成设置；关闭浏览器即清除。

## 发往搜索引擎的数据

关键词、选中的文字和图片网址由你的浏览器直接发给你选的引擎，包括你在弹窗里或用快捷键换上的引擎，不发给其他任何一方。这和你直接在这些网站上搜索没有区别。以图搜图时，引擎的服务器会按网址去下载那张图片。这些网站如何处理你的搜索，适用它们各自的隐私政策。

## 权限

- activeTab：你点工具栏按钮时，读取当前标签页的网址，判断它是不是搜索结果页。选本扩展的右键菜单项或按它的快捷键时，Chrome 也会给出这项临时权限，本扩展在那时不用它。
- contextMenus：在网页的右键菜单里加两项，一项用于选中的文字，一项用于有公开网址的图片。
- declarativeNetRequest：只把带有本扩展标记参数 _ss 的搜索网址重定向到本扩展自己的页面，不拦截请求，不修改请求头或响应头。
- storage：保存上述设置和拆分视图记录。
- 网站访问权限：安装时不授予任何网站权限。只有你在设置页点“授权”时，才为所选搜索引擎的具体网站申请权限；从引擎库添加引擎时不申请，以图搜图引擎也不需要任何网站权限。你可以随时在 chrome://extensions 的扩展详情页“有权访问的网站”中撤销。

本扩展不在无痕窗口中运行。快捷键默认未设置，只有你在 Chrome 的“键盘快捷键”页面设置后才生效。

## 数据共享

本扩展不与任何人共享、出售或转让数据。本扩展对数据的使用遵守 Chrome 网上应用店用户数据政策，包括其中的“有限使用”（Limited Use）要求。

## 数据删除

关闭标签页或浏览器会删除拆分视图记录。卸载本扩展会删除它保存在本机的设置；如果开启了 Chrome 同步，同步数据由 Chrome 按其规则处理。你也可以在设置页删除自定义引擎、以图搜图引擎和关键词规则，或在 chrome://extensions 的扩展详情页“有权访问的网站”中撤销授权。

## 儿童

本扩展不针对儿童，也不收集任何人的个人信息。

## 政策变更

如本政策有变更，会更新本页面并修改生效日期。如果新版本扩展处理数据的方式发生实质变化，会在更新说明中写明。各版本的更新说明见 https://github.com/pine2D/split-search/blob/main/CHANGELOG.md 。

## 联系方式

开发者：pine2D
联系：{{CONTACT_URL}}
```

### English

```markdown
# Split Search Privacy Policy

Effective date: {{EFFECTIVE_DATE}}
Policy URL: {{PRIVACY_POLICY_URL}}

Split Search (“the extension”) is a Chrome extension developed by pine2D. It opens search results side by side in Chrome’s split view: results from two search engines, or a search or image search next to the page you are reading. This policy explains how the extension handles your data.

## In short: what you look up goes only to the engines you choose, never to the developer or other third parties

- The extension sends no data to the developer or any third party and does not sell data. It has no servers, makes no network requests of its own, and contains no analytics, advertising, third-party code or remote code.
- Your browser sends your search terms, and any text or image address you look up from the right-click menu, only to the engines you chose.
- The extension stores only your settings and a record of the split views it opened, which includes what was searched. That record is kept in browser memory and cleared when the browser closes (see item 4 below).
- To do its job, it reads a few things on your device: the URL of the search you start; the selected text or the image’s address when you choose one of its right-click menu items; the current tab’s URL when you click its toolbar button; and, when needed, the URL of the other tab. It stores none of these URLs. Each item is explained below.

## Data handled on your device

1. Trigger URLs and search terms. When you search using a trigger URL you added to Chrome (only URLs carrying the extension’s marker parameter “_ss” are handed to it), the extension reads that URL on your device, extracts the search terms and the engine IDs in “_ss”, builds the right-hand engine’s URL, and opens both engines’ result pages in two tabs.
2. Selected text and image addresses from the right-click menu. Only when you choose one of the extension’s items in the right-click menu does it read the text you selected (up to the first 500 characters) or the address of that image, which Chrome passes along with that click. Text goes only to the lookup engine you chose, and an image address goes only to the image search engine you chose; the engine’s server then downloads the image itself. The extension does not read the page’s URL or anything else on the page, and it has no content scripts. The result pages it opens don’t carry the URL of the page you are reading. Text selected in an editable field, such as a text box, is ignored. Note that some image addresses work as access credentials (for example, signed addresses that expire), so sending one to an engine lets that engine open the image too, and that an image address can reveal the site or page it comes from.
3. URL of the current tab. When you click the toolbar button, Chrome gives the extension temporary access to the current tab (activeTab). The popup reads that tab’s URL to check whether it is a results page of one of your configured search engines and to read its search terms, so you can open the same search in another engine next to it. That URL is not stored or sent anywhere. If you then open the split view, the search terms are recorded like any other split view (see item 4).
4. Split records. After the extension opens a split view (or two tabs side by side when the window is narrow), it records in chrome.storage.session the IDs of the two tabs, each tab’s role (search results, your page, or lookup results), the engine each tab shows, and what was searched: search terms, selected text or an image address. If a keyword rule switched the right side, the record also notes which rule did it and the original right-side engine. The record contains no page URLs. The toolbar popup uses it to show the current search and why the right side was switched, and when you switch engines from the popup or with the keyboard shortcut, the extension uses it to build the new engine’s URL. The record stays in browser memory and is never synced or uploaded. A tab’s record is deleted when the tab closes, and all records are cleared when the browser closes, or when the extension is reloaded, updated or turned off.
5. URL of the other tab. To tell whether a pair of tabs is one it opened, the extension first checks the record in item 4. If there is no record (for example after a browser restart), it reads the other tab’s URL to see whether it looks like a results page of one of your configured engines. It compares only the origin, the path and whether the URL has a search-terms parameter. It does this when it handles a search (started from the address bar, by dragging text, or from Chrome’s own right-click search item, such as “Search Google for …”), when you open the toolbar popup, and when you switch engines with the keyboard shortcut. The result only informs the decision: the extension never overwrites a tab because of it, and opens a new pair next to it when needed. The extension’s own right-click menu items (for looking up selected text or an image) do not compare the other tab’s URL. Chrome provides that URL only for sites you have granted access to. The URL is used for that check only and is not stored. The extension does not read your browsing history.
6. Settings. Your search engines (names and URL templates), their order, hidden built-in engines, your default pair, the interface language, how narrow windows are handled, which engines the keyboard shortcut rotates through, your choice of lookup engine and image search engine, any image search engines you added (names and URL templates), and the keyword rules you write (words or a writing system, and the right-side engine to use) are stored in chrome.storage.sync. They contain nothing you searched for, and no selected text or image addresses. The words in your rules are ones you typed yourself; the extension never takes words from your searches. When you search with your default pair, the extension compares your search terms with these rules on your device to choose the right-side engine. If you have Chrome sync turned on, Chrome syncs these settings across your devices through your Google Account; this is governed by Chrome’s and Google’s privacy policies, and the developer has no access to it. The extension also keeps one yes-or-no flag in chrome.storage.local that records whether you finished setup, so the settings page and the toolbar popup know whether to show setup guidance. It is not synced. Before setup is finished, the IDs of tabs opened with the “Try it” button are recorded in chrome.storage.session, so a search started there doesn’t count as finishing setup. They are cleared when the browser closes.

## Data sent to search engines

Your browser sends your search terms, selected text and image addresses directly to the engines you chose, including an engine you switch to from the popup or with the keyboard shortcut, and to no one else. This is the same as searching on those sites yourself. For an image search, the engine’s server downloads the image from its address. How those sites handle your searches is governed by their own privacy policies.

## Permissions

- activeTab: when you click the toolbar button, reads the current tab’s URL to check whether it is a search results page. Chrome also grants this temporary access when you choose one of the extension’s right-click menu items or press its keyboard shortcut; the extension doesn’t use it then.
- contextMenus: adds two items to the right-click menu on web pages, one for selected text and one for images that have a public address.
- declarativeNetRequest: redirects only search URLs that carry the extension’s marker parameter “_ss” to the extension’s own page. It never blocks requests or modifies request or response headers.
- storage: stores the settings and split records described above.
- Site access: no site access is granted at install. Access to a specific search engine’s site is requested only when you click “Grant access” next to an engine on the settings page; adding an engine from the catalog requests nothing, and image search engines need no site access at all. You can revoke access at any time under “Site access” on the extension’s details page in chrome://extensions.

The extension does not run in Incognito windows. The keyboard shortcut is not set by default and works only after you set it on Chrome’s Keyboard shortcuts page.

## Data sharing

The extension does not share, sell or transfer data to anyone. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Data deletion

Closing a tab or the browser deletes the split records. Uninstalling the extension deletes the settings it stored on your device; if Chrome sync is on, synced data is handled by Chrome under its own rules. You can also delete custom engines, image search engines and keyword rules on the settings page, or revoke site access in chrome://extensions.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, this page will be updated along with the effective date. If a new version changes how the extension handles data in a material way, the release notes will say so. Release notes for every version are at https://github.com/pine2D/split-search/blob/main/CHANGELOG.md.

## Contact

Developer: pine2D
Contact: {{CONTACT_URL}}
```
