# 隐私做法与隐私政策

> 状态：v0.2.0 已于 2026-10-25 提交；本文件已按 v0.3 代码改写（2026-10-25），随 v0.3.0 上传时照此更新控制台的“隐私做法”。公开版本在 `docs/privacy.md`、`docs/privacy.zh-CN.md`（GitHub Pages）。
> 前半部分是控制台“隐私做法”标签页各栏的填写建议。审核员读英文，所以可粘贴的文字用英文，说明用中文。后半部分 (f) 是隐私政策全文（中英两版），需要托管在公开网址上。
> 依据：`src/manifest.json`、`src/background.js`、`src/go.js`、`src/popup/popup.js`、`src/lib/rules.js`、`src/lib/engines.js`、`src/lib/split-owner.js`、`src/chrome/config-store.js`、`src/chrome/split-state.js`、`src/chrome/split-actions.js`、`src/chrome/right-switch.js`、`src/chrome/i18n.js`、`src/options/ui.js`、`src/options/shortcut.js`（核对日期 2026-10-25，对应 v0.3）。

> **重点说明（v0.3 起，2026-10-25）**
> - **数据使用披露只勾“网页浏览记录”（Web history），其余八类不勾。** v0.2 一项都不勾；v0.3 把关键词和两侧引擎暂存进 `chrome.storage.session`，按 CWS 用户数据 FAQ 已经属于“处理（handle）”网页浏览活动，依据和结论见 (d)。用户已同意“该勾就勾”（2026-10-25）。
> - 勾选不等于“收集后发走”。扩展只在本机读取并暂存它被要求处理的内容：触发网址（关键词和 `_ss` 标记）、拆分视图另一侧标签页的网址（只比较 origin 和路径），以及关键词和两侧引擎 id 的内存记录。这一点在 (d) 的审核说明、隐私政策和商店详情的“隐私”段都要写明，不能删。
> - 不向开发者或任何第三方发送数据；没有统计代码，没有远程代码。设置在用户开启 Chrome 同步时会由 Chrome 同步，这一点必须保留披露。

## 代码事实速查（供核对）

| 事实 | 出处 |
|---|---|
| `permissions` 只有 `declarativeNetRequest`、`storage`；没有 `tabs`，没有必需的 `host_permissions`。`action.default_popup` 和 `commands` 不是权限，不产生安装警告 | `src/manifest.json` |
| `optional_host_permissions` 为 `https://*/*`、`http://*/*`，但运行时只为引擎的精确 origin 申请 `<origin>/*`，含 `*` 的不生成；只在用户点击“授权”时调用 `chrome.permissions.request`。从引擎库添加条目不申请权限 | `src/options/ui.js` `originPattern` / `authButton`、`src/options/catalog.js` |
| 只有一条 DNR 动态规则（id 1）：只匹配带 `_ss=` 参数的 `main_frame` 请求，`requestDomains` 只含可作左侧的引擎的 hostname（DNR 也会匹配它们的子域名），动作是重定向到本扩展的 `go.html?u=<原网址>`。不拦截、不改请求头和响应头 | `src/lib/rules.js`、`src/background.js` |
| `chrome.storage.sync` 只存设置：`customEngines`（id、名称、网址模板，从引擎库带来的条目可另有 `leftDiscouraged`）、`presetOverrides`（名称、网址、隐藏）、`order`、`defaultPair`、`uiLocale`（界面语言）、`narrowFallback`（窄窗口时右侧是否改开后台标签页）、`cycleExclude`（不参与快捷键轮换的引擎 id）。不含关键词 | `src/lib/engines.js` `mergeConfig`、`src/options/edits.js`、`src/options/options.js` |
| `chrome.storage.session` 存本扩展所建拆分视图（或窄窗口下的相邻标签页）的记录：键 `split:<tabId>`，值 `{ peer, splitViewId, mode, engine, query }`，即另一侧标签页 id、建立时的 `splitViewId`、`split`/`adjacent`、这个标签页显示的引擎 id、关键词。只在内存中，不同步；浏览器关闭即清空，扩展重新加载、更新、停用时也清空；标签页关闭时（`tabs.onRemoved`）删掉它的记录 | `src/chrome/split-state.js`、`src/lib/split-owner.js`、`src/background.js` |
| 关键词的用途只有两个：拼出左右引擎的网址；在工具栏弹窗里显示，并在用户从弹窗或用快捷键换右侧时拼出新引擎的网址 | `src/go.js`、`src/popup/popup.js`、`src/chrome/right-switch.js`、`src/lib/trigger.js` |
| 读取另一侧标签页的 `url`（拆分视图经 `tabs.query({splitViewId})`，相邻标签页经 `tabs.get`）：有有效记录时按记录和 `splitViewId` 判定；没有记录时（典型是浏览器重启后），比较它的 origin 和搜索页路径是否像某个已配置引擎的结果页。只有已授权 origin 上的标签页才读得到；不保存网址 | `src/lib/split-owner.js`、`src/chrome/split-state.js` `inspectTab` |
| 弹窗只读当前窗口的活动标签页（`tabs.query({active:true, currentWindow:true})`）；快捷键 `cycle-right` 只读最后聚焦的 normal 窗口的活动标签页。`manifest` 不写 `suggested_key`，用户没绑定时快捷键不生效 | `src/popup/popup.js`、`src/background.js` |
| 唯一的 `fetch` 读取扩展包内的 `_locales/*/messages.json`（`chrome-extension://` 地址），没有任何外部请求；没有 `XMLHttpRequest`、`WebSocket`、`sendBeacon`，也没有 `eval` 或远程脚本；引擎库只写在代码里 | `src/chrome/i18n.js`、`src/lib/engine-catalog.js`；`test/i18n-catalog.test.js` 的 fetch 守门 |
| 复制按钮用 `navigator.clipboard.writeText` 写入触发网址或 `chrome://settings/searchEngines`；不读剪贴板。设置页“快捷键”一行用 `chrome.commands.getAll` 读当前绑定，按钮用 `tabs.create` 打开 `chrome://extensions/shortcuts` | `src/options/ui.js`、`src/options/shortcut.js` |
| `incognito: "not_allowed"`：扩展不在无痕窗口运行 | `src/manifest.json` |

## (a) Single purpose（单一用途）

```text
Split Search opens a search in two search engines side by side in Chrome’s split view. When the user searches from the address bar or drags text onto the tab strip, and Chrome navigates to a trigger URL the user added as a site search (as default search engine or via its shortcut), the extension opens the left engine’s results in the current tab and the right engine’s results in the other tab of the split view. Everything in the extension (engine list and catalog, trigger-URL generator, site-access requests, the toolbar popup and keyboard shortcut that switch the right-side engine) serves only this purpose.
```

字数：617

## (b) Permission justification（权限理由）

控制台会逐项列出 manifest 中声明的权限。

### declarativeNetRequest

```text
Used for exactly one dynamic redirect rule. It matches only top-level (main_frame) navigations whose URL contains the extension’s own marker parameter “_ss=”, and only on the hostnames (and their subdomains) of the user’s engines that can act as the left side (Chrome applies the redirect only where the user has granted host access). Those navigations are redirected to the extension’s own page (go.html), which reads the search terms from that URL and opens the two result pages in a split view. The rule never blocks requests and never modifies request or response headers. Such URLs come from the trigger URLs the user adds to Chrome as site searches.
```

字数：655

### storage

```text
chrome.storage.sync stores only the user’s settings: custom search engines (id, name, URL template, and whether an engine is recommended for the right side only), renamed/hidden built-in engines, engine order, the default engine pair, the interface language, whether narrow windows open the right side in a background tab, and which engines the keyboard shortcut skips. Chrome syncs it only if the user has Chrome sync turned on; it never contains search terms. chrome.storage.session keeps, in memory only, a record for each pair of tabs this extension opened: the other tab’s ID, the split view ID, which engine each tab shows, and the search terms. The toolbar popup and keyboard shortcut use it to show the current search and to load another engine on the right side, and go.html uses it to refresh its own split view instead of overwriting one the user made. It is not synced, is deleted when a tab closes, and is cleared when the browser closes.
```

字数：871

### Host permissions（optional_host_permissions）

```text
No host access is granted at install. The manifest lists https://*/* and http://*/* only as optional host permissions so that users can add any search engine. At runtime the extension requests access only to each selected engine’s exact origin (for example https://www.google.com/*), and only when the user clicks “Grant access” next to each engine on the settings page (the button label follows the interface language); wildcard hosts are never requested, and adding an engine from the built-in catalog requests nothing. Access to the left engine’s origin is required because a declarativeNetRequest redirect needs host permission for the request URL. For granted origins, Chrome also exposes the URL of the tab paired with the current one; when the extension has no record of that pair (for example after a browser restart), it compares that URL’s origin and path with the user’s engine templates to recognize its own split view. It does not use the tabs permission. Users can revoke access at any time in chrome://extensions.
```

字数：1017

说明：扩展还调用了 `chrome.tabs.create / get / update / query / remove / getCurrent`、`chrome.tabs.onRemoved`、`chrome.windows.get / getLastFocused / create / update` 和 `chrome.commands.getAll / onCommand`。这些 API 不需要声明权限，控制台不会让你写理由；上面的 host 一栏已说明为什么不需要 `tabs` 权限。

## (c) Remote code（远程代码）

选择：**No, I am not using remote code.**

依据：所有脚本都打包在扩展里，用 `<script type="module" src="…">` 和相对路径 `import` 加载；没有 `eval`、`new Function` 或外部脚本，manifest 也没有放宽 CSP。

## (d) Data usage（数据使用披露）

**决定（v0.3 起，2026-10-25）：只勾 Web history（网页浏览记录），其余八类不勾。**

上传 v0.3.0 时在控制台“隐私做法 → 数据使用”照下表勾选（控制台的类别名以英文为准）：

| 类别 | 勾选 | 理由 |
|---|---|---|
| Personally identifiable information | 否 | 不读姓名、地址、邮箱、账号等 |
| Health information | 否 | 无 |
| Financial and payment information | 否 | 无 |
| Authentication information | 否 | 不读密码、凭据、cookie |
| Personal communications | 否 | 不读邮件、消息 |
| Location | 否 | 不读位置，也不读 IP |
| **Web history** | **是** | 读取触发网址（含关键词）和另一侧标签页的网址；把关键词和两侧引擎 id 记在 `storage.session`，直到标签页或浏览器关闭 |
| User activity | 否 | 不监听点击、滚动、鼠标位置或按键；快捷键由 Chrome 的 `commands` 触发，扩展收不到按键内容 |
| Website content | 否 | 没有 content script，不读网页文字、图片或链接 |

三项合规声明照旧全部勾选，见 (e)。

### 扩展在本机实际读取和保存的内容（核对代码后的完整清单）

1. 触发网址：只有带 `_ss=` 的主框架导航、且 hostname 属于可作左侧的引擎（含子域名）时，DNR 规则才把它交给 `go.html`。规则不看导航从哪里来：网页里一个带 `_ss` 的链接被点开时同样会交给 `go.html`；正常使用中这类网址只来自用户自己添加的触发网址。`go.html` 从中取出关键词和 `_ss` 的值（两个引擎 id），拼出左右两个结果页网址后在标签页中打开（`src/go.js`、`src/lib/trigger.js`）。
2. 拆分视图记录：打开拆分视图（或窄窗口下的相邻标签页）后，`go.html` 把两个标签页的 id、`splitViewId`、各自显示的引擎 id 和关键词写进 `chrome.storage.session`。用途是工具栏弹窗显示当前搜索、弹窗和快捷键换右侧引擎，以及判断这一对标签页是不是本扩展的。只在内存，不同步、不上传；标签页关闭时删掉，浏览器关闭即清空（`src/chrome/split-state.js`、`src/background.js`）。
3. 另一侧标签页的网址：tabs API 返回的是完整网址。有有效记录时扩展按记录判定，不看网址；没有记录时（浏览器重启后），比较它的 origin 和搜索页路径是否像某个已配置引擎的结果页。只有已授权 origin 上的标签页 Chrome 才提供网址。网址不保存（`src/lib/split-owner.js`）。
4. 设置：`chrome.storage.sync` 中的引擎名称、网址模板、排序、隐藏、默认组合、界面语言、窄窗口开关、快捷键轮换排除列表；用户开启 Chrome 同步时由 Chrome 同步。不含关键词。
5. 没有任何网络请求、统计、广告或远程代码；没有 `history`、`tabs`、`cookies` 权限，没有 content script。关键词只由用户的浏览器发给用户选的引擎，包括用户在弹窗里或用快捷键换上的右侧引擎。

### 为什么 v0.3 要勾 Web history

依据：CWS 用户数据 FAQ（https://developer.chrome.com/docs/webstore/program-policies/user-data-faq ，2026-10-25 查阅）。

- 第 2 条（什么叫 handle）：“Generally, by "handle" we mean collecting, transmitting, using, or sharing user data.” 例子里有 “Collecting web browsing activity and any information about the website content or resources”。只是“使用”也算 handle。
- 第 3 条：本地处理、不传输也要披露（“even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties”）。
- 第 4 条（用户数据举例）：“Web browsing activity (which is any information about the websites or other web resources a user requests …)”。

v0.2 只在当次操作中读取网址、用完即弃，当时判断它不构成“访问记录列表”，所以一项都没勾（风险已在 v0.2 版本里记录）。v0.3 把关键词和两侧引擎 id 按标签页存进 `storage.session`，保留到标签页或浏览器关闭，相当于在本机保存了一份“当前打开的几次搜索”的记录。即使只在内存、不出设备，按第 3、4 条也属于处理网页浏览活动；九个类别里最贴近的是 Web history。继续一项不勾，被审核员按第 2–4 条认定披露不完整的风险明显变大，所以勾上并照实写。

不勾其他类别的理由见上表。关键词由用户输入，理论上可能含个人信息，但扩展不把它当作个人信息收集或识别，只用来打开搜索页，所以不勾 Personally identifiable information。

勾选后已同步改写（原“回退表”，已执行）：

| 位置 | v0.2 的说法 | v0.3 的说法 |
|---|---|---|
| 本文件开头“重点说明”、(d) 开头的决定 | 一项都不勾，含 Web history | 只勾 Web history，其余不勾 |
| 本文件 (d)“为什么不勾 Web history”和英文审核说明最后一段 | 解释为什么不勾 | 改为说明勾选的是什么、只在本机使用、不上传 |
| 隐私政策中英两版的小标题“重点说明：我们不收集任何数据” / “In short: we collect no data” | 不收集任何数据 | “重点说明：数据只留在你的设备上” / “In short: your data stays on your device” |
| 隐私政策“儿童”一节“也不收集任何人的个人信息” | 不收集 | 保留（关键词不当作个人信息处理），措辞与小标题一致 |
| 4 种语言 `listing.*.md` 详细说明【隐私】段第一句 | 本扩展不收集任何数据 | 数据只留在你的设备上，不发给开发者或第三方 |
| 4 份 README 的隐私段、`docs/index.md` | 不收集任何数据 | 同上 |
| `listing.zh-CN.md` “提交前必做”与“措辞说明”最后一条 | 一项都不勾（含网页浏览记录） | 只勾网页浏览记录 |
| i18n 方案第 11 节“隐私”一条 | Web history 不勾选 | 已加注：v0.3 起改为勾选，以本文件为准 |

### 给审核员的英文说明（可直接粘贴）

放在提交时给审核员的说明栏（如“测试说明”），或在审核询问时回复。

```text
Data usage: only “Web history” is selected. Here is exactly what the extension reads and keeps, all inside the user’s browser.
- It reads the URL of a search the user started with a trigger URL they added to Chrome as a site search. Only top-level navigations to the hostnames of the user’s left-capable engines that carry the marker parameter “_ss” (normally produced only by the user’s own trigger URL) reach the extension, via one declarativeNetRequest redirect to its own page. It takes the search terms and the “_ss” value (two engine IDs) from that URL to open the two result pages in a split view.
- For each pair of tabs it opens, it keeps a record in chrome.storage.session (memory only): the other tab’s ID, the split view ID, which engine each tab shows, and the search terms. The toolbar popup shows this search and lets the user load another engine on the right side, and an optional keyboard shortcut (unbound by default) does the same. The record is never synced or transmitted, is deleted when the tab closes, and is cleared when the browser closes.
- To tell whether a split view is its own, it checks that record. Without a record (for example after a browser restart), it reads the other tab’s URL and compares its origin and path with the user’s engine templates. Chrome exposes that URL only for sites the user granted access to. The URL is not stored.
- It does not read browsing history (no “history” or “tabs” permission), page content (no content scripts), cookies, clipboard contents, keystrokes or user input on web pages.
- Settings are stored in chrome.storage.sync (Chrome syncs them if the user has Chrome sync on). They never contain search terms.
- Nothing is transmitted to the developer or any third party. There are no network requests, no analytics and no remote code. Search terms go only from the user’s browser to the search engines the user chose, including an engine the user switches to on the right side.
We selected “Web history” because the extension reads search URLs and keeps the search terms of the split views it opened in memory until the tab or browser closes. This data never leaves the device.
```

## (e) Certifications（合规声明）

三项都勾选，扩展的实际行为与之相符：

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
  不出售、不转让：扩展没有服务器，不向开发者或任何第三方发送数据。关键词由用户自己的浏览器发往用户选择的引擎，这正是用户要求的功能。
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  读取触发网址、暂存关键词只为打开拆分视图和换右侧引擎。
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.
  无关。

## 隐私政策网址

控制台填 `https://pine2d.github.io/split-search/privacy`（GitHub Pages，`main:/docs`，与 Pinboard 扩展同一做法）。开发者账号层面的隐私政策网址与这里一致。中文版在 `https://pine2d.github.io/split-search/privacy.zh-CN.html`。

托管副本是 `docs/privacy.md`（English）和 `docs/privacy.zh-CN.md`（简体中文），内容取自下面 (f)；**改 (f) 必须同步改这两个文件**，反之亦然。

---

## (f) 隐私政策全文

> 占位符已在托管副本里填好：`{{PRIVACY_POLICY_URL}}` = `https://pine2d.github.io/split-search/privacy`、`{{CONTACT_URL}}` = `https://github.com/pine2D/split-search/issues`、`{{EFFECTIVE_DATE}}` = 2026-10-25（v0.3 改写；v0.2 版为 2026-10-24）。此处保留占位符作模板；托管副本另在标题下加了中英互链，中文副本的“本政策网址”填的是中文页 `https://pine2d.github.io/split-search/privacy.zh-CN.html`（与模板唯一不同之处）。作者署名 pine2D。

### 简体中文

```markdown
# Split Search 隐私政策

生效日期：{{EFFECTIVE_DATE}}
本政策网址：{{PRIVACY_POLICY_URL}}

Split Search（以下简称“本扩展”）是由 pine2D 开发的 Chrome 扩展，用两个搜索引擎在 Chrome 拆分视图中打开同一次搜索。本政策说明本扩展如何处理你的数据。

## 重点说明：数据只留在你的设备上

- 本扩展不把任何数据发送给开发者或任何第三方，也不出售数据。它没有服务器，不发网络请求，不含统计、广告、第三方代码或远程代码。
- 关键词只由你的浏览器发给你选的搜索引擎。
- 本扩展保存的只有你的设置，以及它打开的拆分视图的记录（含关键词）。记录只在浏览器内存里，关闭浏览器即清除，见下文第 2 条。
- 为了完成搜索，本扩展会在你的设备上读取你发起的那次搜索的网址，必要时还会读取另一侧标签页的网址（不保存）。下文逐条说明。

## 本扩展在你的设备上处理的数据

1. 触发网址和关键词。你通过自己添加到 Chrome 的触发网址搜索时（只有带本扩展标记参数 _ss 的网址会交给本扩展），本扩展会在本机读取这个网址，取出关键词和 _ss 中的引擎标识，拼出右侧搜索引擎的网址，然后在两个标签页中分别打开左右两个引擎的结果页。
2. 拆分视图记录。本扩展打开拆分视图（窗口较窄时是相邻的两个标签页）后，会把两个标签页的编号、各自显示的引擎和这次搜索的关键词记在 chrome.storage.session 里。工具栏弹窗用它显示当前搜索；你在弹窗里或用快捷键换右侧引擎时，也靠它拼出新引擎的网址。这些记录只在浏览器内存里，不同步、不上传。标签页关闭时删除它的记录，关闭浏览器即全部清除；扩展重新加载、更新或停用时也会清除。
3. 另一侧标签页的网址。为了判断一对标签页是不是本扩展打开的，本扩展会先查上一条的记录。没有记录时（例如浏览器重启后），它读取另一侧标签页的网址，只比较网站来源（origin）和路径，看它是不是你配置的某个搜索引擎的结果页。只有你授权过的网站上的标签页，Chrome 才会把网址提供给本扩展。这个网址只用于当次判断，不保存。本扩展不读取你的浏览历史，也不读取网页内容。
4. 设置。你配置的搜索引擎（名称、网址模板）、排序、隐藏的预置引擎、默认组合、界面语言、窄窗口时的打开方式，以及哪些引擎参与快捷键轮换，保存在 chrome.storage.sync 中，其中没有关键词。如果你开启了 Chrome 同步，Chrome 会通过你的 Google 账号在你的设备之间同步这些设置；这由 Chrome 和 Google 的隐私政策管辖，本扩展的开发者无法访问。

## 发往搜索引擎的数据

关键词由你的浏览器直接发给你选的搜索引擎，包括你在弹窗里或用快捷键换上的右侧引擎，不发给其他任何一方。这和你直接在这些网站上搜索没有区别。这些网站如何处理你的搜索，适用它们各自的隐私政策。

## 权限

- declarativeNetRequest：只把带有本扩展标记参数 _ss 的搜索网址重定向到本扩展自己的页面，不拦截请求，不修改请求头或响应头。
- storage：保存上述设置和拆分视图记录。
- 网站访问权限：安装时不授予任何网站权限。只有你在设置页点“授权”时，才为所选搜索引擎的具体网站申请权限；从引擎库添加引擎时不申请。你可以随时在 chrome://extensions 的扩展详情页“有权访问的网站”中撤销。

本扩展不在无痕窗口中运行。快捷键默认未设置，只有你在 Chrome 的“键盘快捷键”页面设置后才生效。

## 数据共享

本扩展不与任何人共享、出售或转让数据。本扩展对数据的使用遵守 Chrome 网上应用店用户数据政策，包括其中的“有限使用”（Limited Use）要求。

## 数据删除

关闭标签页或浏览器会删除拆分视图记录。卸载本扩展会删除它保存在本机的设置；如果开启了 Chrome 同步，同步数据由 Chrome 按其规则处理。你也可以在设置页删除自定义引擎，或在 chrome://extensions 的扩展详情页“有权访问的网站”中撤销授权。

## 儿童

本扩展不针对儿童，也不收集任何人的个人信息。

## 政策变更

如本政策有变更，会更新本页面并修改生效日期。如果新版本扩展处理数据的方式发生实质变化，会在更新说明中写明。v0.3.0 起，本扩展会在浏览器内存中暂存关键词（见第 2 条）。

## 联系方式

开发者：pine2D
联系：{{CONTACT_URL}}
```

### English

```markdown
# Split Search Privacy Policy

Effective date: {{EFFECTIVE_DATE}}
Policy URL: {{PRIVACY_POLICY_URL}}

Split Search (“the extension”) is a Chrome extension developed by pine2D. It opens a search in two search engines side by side in Chrome’s split view. This policy explains how the extension handles your data.

## In short: your data stays on your device

- The extension sends no data to the developer or any third party and does not sell data. It has no servers, makes no network requests, and contains no analytics, advertising, third-party code or remote code.
- Your browser sends your search terms only to the search engines you chose.
- The extension stores only your settings and a record of the split views it opened, which includes the search terms. That record is kept in browser memory and cleared when the browser closes (see item 2 below).
- To do its job, it reads the URL of the search you start on your device and, when needed, the URL of the other tab, which it doesn’t store. Each item is explained below.

## Data handled on your device

1. Trigger URLs and search terms. When you search using a trigger URL you added to Chrome (only URLs carrying the extension’s marker parameter “_ss” are handed to it), the extension reads that URL on your device, extracts the search terms and the engine IDs in “_ss”, builds the right-hand engine’s URL, and opens both engines’ result pages in two tabs.
2. Split records. After the extension opens a split view (or two tabs side by side when the window is narrow), it records in chrome.storage.session the IDs of the two tabs, the engine each tab shows, and the search terms. The toolbar popup uses this record to show the current search, and when you switch the right-side engine from the popup or with the keyboard shortcut, the extension uses it to build the new engine’s URL. The record stays in browser memory and is never synced or uploaded. A tab’s record is deleted when the tab closes, and all records are cleared when the browser closes, or when the extension is reloaded, updated or turned off.
3. URL of the other tab. To tell whether a pair of tabs is one it opened, the extension first checks the record in item 2. Without a record (for example after a browser restart), it reads the other tab’s URL and compares only its origin and path, to see whether it looks like a results page of one of your configured engines. Chrome provides that URL only for sites you have granted access to. The URL is used for that check only and is not stored. The extension does not read your browsing history or any page content.
4. Settings. Your search engines (names and URL templates), their order, hidden built-in engines, your default pair, the interface language, how narrow windows are handled, and which engines the keyboard shortcut rotates through are stored in chrome.storage.sync. They contain no search terms. If you have Chrome sync turned on, Chrome syncs these settings across your devices through your Google Account; this is governed by Chrome’s and Google’s privacy policies, and the developer has no access to it.

## Data sent to search engines

Your browser sends your search terms directly to the search engines you chose, including an engine you switch to on the right side from the popup or with the keyboard shortcut, and to no one else. This is the same as searching on those sites yourself. How those sites handle your searches is governed by their own privacy policies.

## Permissions

- declarativeNetRequest: redirects only search URLs that carry the extension’s marker parameter “_ss” to the extension’s own page. It never blocks requests or modifies request or response headers.
- storage: stores the settings and split records described above.
- Site access: no site access is granted at install. Access to a specific search engine’s site is requested only when you click “Grant access” next to an engine on the settings page; adding an engine from the catalog requests nothing. You can revoke it at any time under “Site access” on the extension’s details page in chrome://extensions.

The extension does not run in Incognito windows. The keyboard shortcut is not set by default and works only after you set it on Chrome’s Keyboard shortcuts page.

## Data sharing

The extension does not share, sell or transfer data to anyone. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Data deletion

Closing a tab or the browser deletes the split records. Uninstalling the extension deletes the settings it stored on your device; if Chrome sync is on, synced data is handled by Chrome under its own rules. You can also delete custom engines on the settings page or revoke site access in chrome://extensions.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, this page will be updated along with the effective date. If a new version changes how the extension handles data in a material way, the release notes will say so. Starting with v0.3.0, the extension keeps search terms in browser memory (see item 2).

## Contact

Developer: pine2D
Contact: {{CONTACT_URL}}
```
