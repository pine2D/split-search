# 隐私做法与隐私政策（草稿）

> 状态：草稿，待审。
> 前半部分是控制台“隐私做法”标签页各栏的填写建议。审核员读英文，所以可粘贴的文字用英文，说明用中文。后半部分 (f) 是隐私政策全文（中英两版），需要托管在公开网址上。
> 依据：`src/manifest.json`、`src/background.js`、`src/go.js`、`src/lib/rules.js`、`src/lib/engines.js`、`src/chrome/config-store.js`、`src/chrome/split-actions.js`、`src/chrome/i18n.js`、`src/options/ui.js`（核对日期 2026-10-24，对应 v0.2；v0.2 已新增读取扩展包内 `_locales` 的 `fetch`，见 i18n 方案 5.4）。提交在 v0.3（2026-10-24 用户决定），提交前按 v0.3 代码重新核对“代码事实速查”。

> **重点说明（已定，2026-10-24）**
> - **数据使用披露一项都不勾，包括“网页浏览记录”（Web history）。** 理由和风险见 (d)。
> - 不勾不等于“不处理数据”。扩展会在本机读取它被要求处理的触发网址（查询词和 `_ss` 标记），并在当前标签页已处于拆分视图时读取另一侧标签页的网址、只用它的 origin 判断是不是本扩展的拆分视图。这一点在 (d) 的审核说明、隐私政策和商店详情的“隐私”段都要写明，不能删。
> - 除设置外不保存任何数据（另有仅存内存的拆分视图标签页编号）；不向开发者或任何第三方发送数据；没有统计代码，没有远程代码。设置在用户开启 Chrome 同步时会由 Chrome 同步，这一点必须保留披露。

## 代码事实速查（供核对）

| 事实 | 出处 |
|---|---|
| `permissions` 只有 `declarativeNetRequest`、`storage`；没有 `tabs`，没有必需的 `host_permissions` | `src/manifest.json` |
| `optional_host_permissions` 为 `https://*/*`、`http://*/*`，但运行时只为引擎的精确 origin 申请 `<origin>/*`，含 `*` 的不生成；在用户点击“授权”时调用 `chrome.permissions.request` | `src/options/ui.js` `originPattern` / `authButton` |
| 只有一条 DNR 动态规则（id 1）：只匹配带 `_ss=` 参数的 `main_frame` 请求，`requestDomains` 只含可作左侧的引擎的 hostname（DNR 也会匹配它们的子域名），动作是重定向到本扩展的 `go.html?u=<原网址>`。不拦截、不改请求头和响应头 | `src/lib/rules.js`、`src/background.js` |
| `chrome.storage.sync` 只存设置：`customEngines`（id、名称、网址模板）、`presetOverrides`（名称、网址、隐藏）、`order`、`defaultPair`、`uiLocale`（界面语言选择） | `src/lib/engines.js` `mergeConfig`、`src/options/edits.js`、`src/options/options.js` |
| `chrome.storage.session` 只存本扩展所建拆分视图的标签页 id 配对（`split:<tabId>` → 另一侧 tabId），仅在内存中，浏览器关闭即清空 | `src/chrome/split-actions.js` `recordPair` |
| 唯一的 `fetch` 读取扩展包内的 `_locales/*/messages.json`（`chrome-extension://` 地址），没有任何外部请求；没有 `XMLHttpRequest`、`WebSocket`、`sendBeacon`，也没有 `eval` 或远程脚本 | `src/chrome/i18n.js`；`test/i18n-catalog.test.js` 的 fetch 守门 |
| 查询词只在 `go.html` 里从触发网址解析出来，用来拼右侧引擎网址，然后在标签页中打开左右两个引擎；不保存 | `src/go.js`、`src/lib/trigger.js` |
| 读取拆分视图另一侧标签页的 `url`，只用来比较它的 origin 是否属于用户的引擎（判断是不是本扩展的拆分视图）；只有已授权 origin 上的标签页才读得到 | `src/lib/split-decision.js`、`src/go.js` `gatherContext` |
| 复制按钮用 `navigator.clipboard.writeText` 写入触发网址或 `chrome://settings/searchEngines`；不读剪贴板 | `src/options/ui.js` |
| `incognito: "not_allowed"`：扩展不在无痕窗口运行 | `src/manifest.json` |

## (a) Single purpose（单一用途）

```text
Split Search opens a search in two search engines side by side in Chrome’s split view. When the user searches from the address bar or drags text onto the tab strip, and Chrome navigates to a trigger URL the user added as a site search (as default search engine or via its shortcut), the extension opens the left engine’s results in the current tab and the right engine’s results in the other tab of the split view. Everything in the extension (engine list, trigger-URL generator, site-access requests) serves only this purpose.
```

字数：527

## (b) Permission justification（权限理由）

控制台会逐项列出 manifest 中声明的权限。

### declarativeNetRequest

```text
Used for exactly one dynamic redirect rule. It matches only top-level (main_frame) navigations whose URL contains the extension’s own marker parameter “_ss=”, and only on the hostnames (and their subdomains) of the user’s engines that can act as the left side (Chrome applies the redirect only where the user has granted host access). Those navigations are redirected to the extension’s own page (go.html), which reads the search terms from that URL and opens the two result pages in a split view. The rule never blocks requests and never modifies request or response headers. Such URLs come from the trigger URLs the user adds to Chrome as site searches.
```

字数：655

### storage

```text
chrome.storage.sync stores only the user’s settings: custom search engines (id, name, URL template), renamed/hidden built-in engines, engine order, the default engine pair, and the chosen interface language. Chrome syncs it only if the user has Chrome sync turned on. chrome.storage.session keeps, in memory only, the tab-id pairs of split views this extension created, so a new search can refresh its own split view instead of overwriting a split view the user made; it is cleared when the browser closes. No search terms or browsing data are stored.
```

字数：551

### Host permissions（optional_host_permissions）

```text
No host access is granted at install. The manifest lists https://*/* and http://*/* only as optional host permissions so that users can add any search engine. At runtime the extension requests access only to each selected engine’s exact origin (for example https://www.google.com/*), and only when the user clicks “Grant access” next to each engine on the settings page (the button label follows the interface language); wildcard hosts are never requested. Access to the left engine’s origin is required because a declarativeNetRequest redirect needs host permission for the request URL. For granted origins, Chrome also exposes the URL of tabs in the current split view, which the extension compares by origin to recognize its own split view; it does not use the tabs permission. Users can revoke access at any time in chrome://extensions.
```

字数：840

说明：扩展还调用了 `chrome.tabs.create / update / query / getCurrent` 和 `chrome.windows.get / getLastFocused / create`。这些 API 不需要声明权限，控制台不会让你写理由；上面的 host 一栏已说明为什么不需要 `tabs` 权限。

## (c) Remote code（远程代码）

选择：**No, I am not using remote code.**

依据：所有脚本都打包在扩展里，用 `<script type="module" src="…">` 和相对路径 `import` 加载；没有 `eval`、`new Function` 或外部脚本，manifest 也没有放宽 CSP。

## (d) Data usage（数据使用披露）

**决定：九个类别全部不勾，包括 Web history。**

### 扩展在本机实际读取的内容（核对代码后的完整清单）

1. 触发网址：只有带 `_ss=` 的主框架导航、且 hostname 属于可作左侧的引擎（含子域名）时，DNR 规则才把它交给 `go.html`。规则不看导航从哪里来：网页里一个带 `_ss` 的链接被点开时同样会交给 `go.html`；正常使用中这类网址只来自用户自己添加的触发网址。`go.html` 从中取出查询词和 `_ss` 的值（两个引擎 id），拼出左右两个结果页网址后在标签页中打开。查询词不写入任何存储（`src/go.js`、`src/lib/trigger.js`）。
2. 拆分视图另一侧标签页的网址：只在当前标签页已处于拆分视图中时读取。tabs API 返回的是完整网址，扩展从中算出 origin，只用 origin 与用户配置的引擎比较，判断是否是本扩展的拆分视图；只有已授权 origin 上的标签页 Chrome 才提供网址。不保存（`src/go.js` `gatherContext`、`src/lib/split-decision.js`）。
3. 保存的数据只有两类：`chrome.storage.sync` 中的设置（引擎名称、网址模板、排序、隐藏、默认组合、界面语言），用户开启 Chrome 同步时由 Chrome 同步；`chrome.storage.session` 中本扩展所建拆分视图的标签页编号配对，仅在内存，关浏览器即清空。
4. 没有任何网络请求、统计、广告或远程代码；没有 `history`、`tabs`、`cookies` 权限，没有 content script。

### 为什么不勾 Web history

- 控制台对 Web history 的定义是“用户访问过的网页列表及页面标题、访问时间等相关数据”。扩展不读取浏览历史，不建立任何访问列表，也看不到用户访问的其他网页：DNR 规则由 Chrome 执行，只把带 `_ss` 标记的搜索网址交给扩展；拆分视图另一侧的网址只做一次 origin 比较。
- 扩展只读两类网址：① 触发网址，即用户自己配置成网站搜索、并主动发起的那一次搜索（见上文第 1 条）；② 拆分视图另一侧标签页的网址，只用来比较 origin。读取的目的就是完成用户这一次主动发起的操作，用完即弃，不保存、不传输。
- 控制台问卷问的是“收集了哪些类别的数据”，Web history 这一类指的是访问记录列表。扩展只是为完成用户当次的操作按需读取单个网址，不形成任何列表，也不保存，所以不属于这一类。
- 其他类别同理：不读身份信息、凭据、通信、位置、点击按键或网页内容。

风险（如实记录）：CWS 用户数据 FAQ（https://developer.chrome.com/docs/webstore/program-policies/user-data-faq ，2026-10-24 查阅）有三条可以被用来反驳上面的理由，其中第 2、4 条是被拒审时最可能引用的依据：

- 第 2 条（什么叫 handle）：“Generally, by "handle" we mean collecting, transmitting, using, or sharing user data.” 例子里有 “Collecting web browsing activity and any information about the website content … including the domains or URLs the browser interacts with”。也就是说，只是“使用”也算 handle。
- 第 4 条（用户数据举例）：“Web browsing activity (which is any information about the websites or other web resources a user requests … including the domains or URLs the browser interacts with).” 扩展读取触发网址和另一侧标签页的网址，字面上落在这个定义里。
- 第 3 条：本地处理、不传输也要披露（“even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties”）。

审核员如果按这几条认定读取网址属于 Web history，可能判定披露不完整而拒审。应对：被问到时用下面的英文说明回复；如仍被要求，就勾选 Web history 重新提交，无需改代码。

回退时要同步修改的文字（先列好，免得漏改）：

| 位置 | 现在的说法 | 回退后 |
|---|---|---|
| 本文件开头“重点说明”第 1 条、(d) 开头的决定 | 一项都不勾，含 Web history | 只勾 Web history，其余不勾 |
| 本文件 (d)“为什么不勾 Web history”和英文审核说明最后一段 | 解释为什么不勾 | 删掉，改为说明勾选的是什么、只在本机使用、不保存不传输 |
| 隐私政策中英两版的小标题“重点说明：我们不收集任何数据” / “In short: we collect no data” | 不收集任何数据 | 改为“只在你的设备上使用完成搜索所需的网址，不保存，不发送给开发者或第三方” |
| 隐私政策“儿童”一节“也不收集任何人的个人信息” | 不收集 | 保留（网址不是个人信息），但核对措辞与上一行一致 |
| `listing.zh-CN.md` 与 `listing.en.md` 详细说明【隐私】段第一句 | 本扩展不收集任何数据 | 同隐私政策小标题的新说法 |
| `listing.zh-CN.md` “提交前必做”与“措辞说明”最后一条 | 一项都不勾（含网页浏览记录） | 只勾网页浏览记录 |
| i18n 方案第 11 节“隐私”一条 | Web history 不勾选 | 改为勾选，各语言详情的隐私段照新说法翻译 |

### 给审核员的英文说明（可直接粘贴）

放在提交时给审核员的说明栏（如“测试说明”），或在审核询问时回复。

```text
Important: no data-usage category is selected, and here is exactly what the extension reads.
- It reads, only inside the user’s browser, the URL of a search the user started with a trigger URL they added to Chrome as a site search. Only top-level navigations to the hostnames of the user’s left-capable engines that carry the marker parameter “_ss” (normally produced only by the user’s own trigger URL) reach the extension, via one declarativeNetRequest redirect to its own page. It takes the search terms and the “_ss” value (two engine IDs) from that URL to open the two result pages in a split view. The search terms are not stored.
- When the current tab is already in a split view, it reads the other tab’s URL and compares only its origin with the user’s configured engines, to decide whether that split view is its own. Chrome exposes that URL only for sites the user granted access to. It is not stored.
- It does not read browsing history (no “history” or “tabs” permission), page content (no content scripts), cookies, clipboard contents, or user input on web pages.
- Stored data: only the user’s settings in chrome.storage.sync (Chrome syncs them if the user has Chrome sync on) and, in memory only, tab-ID pairs of split views it created (chrome.storage.session).
- Nothing is transmitted to the developer or any third party. There are no network requests, no analytics and no remote code. Search terms go only from the user’s browser to the two search engines the user chose.
Because the extension never builds or accesses a list of visited pages, and the only URLs it reads are the trigger URL of the user’s own search and, for a split view it may have opened, the other tab’s URL, which is reduced to its origin for one comparison and discarded, we did not select “Web history”.
```

## (e) Certifications（合规声明）

三项都勾选，扩展的实际行为与之相符：

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
  不出售、不转让：扩展没有服务器，不向开发者或任何第三方发送数据。查询词由用户自己的浏览器发往用户选择的引擎，这正是用户要求的功能。
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  读取触发网址只为打开拆分视图。
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.
  无关。

## 隐私政策网址

控制台填 `{{PRIVACY_POLICY_URL}}`。可以托管在 GitHub Pages、仓库里的 `PRIVACY.md`（需公开仓库），或其他能匿名访问的页面。开发者账号层面的隐私政策网址要与这里一致。

---

## (f) 隐私政策全文

> 占位符：`{{PRIVACY_POLICY_URL}}`（本政策的公开网址）、`{{CONTACT_URL}}`（联系方式，例如公开仓库的 Issues 页面）、`{{EFFECTIVE_DATE}}`（生效日期）。作者署名 pine2D。

### 简体中文

```markdown
# Split Search 隐私政策

生效日期：{{EFFECTIVE_DATE}}
本政策网址：{{PRIVACY_POLICY_URL}}

Split Search（以下简称“本扩展”）是由 pine2D 开发的 Chrome 扩展，用两个搜索引擎在 Chrome 拆分视图中打开同一次搜索。本政策说明本扩展如何处理你的数据。

## 重点说明：我们不收集任何数据

- 本扩展不把任何数据发送给开发者或任何第三方，也不出售数据。它没有服务器，不发网络请求，不含统计、广告、第三方代码或远程代码。
- 除你的设置外不保存任何数据（另有关闭浏览器即清除的拆分视图标签页编号，见下文第 4 条）。
- 为了完成搜索，本扩展会在你的设备上读取少量信息：你发起的那次搜索的触发网址（含查询词），以及拆分视图另一侧标签页的网址（只用来比较其网站来源，不保存）。下文逐条说明。

## 本扩展在你的设备上处理的数据

1. 触发网址和查询词。当你通过自己添加到 Chrome 的触发网址进行搜索时（只有带本扩展标记参数 _ss 的网址会交给本扩展），本扩展会在本机读取这个网址，取出查询词和 _ss 中的引擎标识，拼出右侧搜索引擎的网址，然后在两个标签页中分别打开左右两个引擎的结果页。查询词不会被保存，也不会发给除这两个引擎以外的任何一方。
2. 拆分视图另一侧标签页的网址。当前标签页已在拆分视图中时，为了判断这个拆分视图是不是本扩展打开的，本扩展会读取拆分视图另一侧标签页的网址，只用它的网站来源（origin）判断是否属于你配置的搜索引擎。本扩展不读取你的浏览历史，也不读取网页内容。只有你授权过的网站上的标签页，Chrome 才会把网址提供给本扩展。这一信息只用于当次判断，不保存。
3. 设置。你配置的搜索引擎（名称、网址模板）、排序、隐藏的预置引擎、默认组合和你选择的界面语言，保存在 chrome.storage.sync 中。如果你开启了 Chrome 同步，Chrome 会通过你的 Google 账号在你的设备之间同步这些设置；这由 Chrome 和 Google 的隐私政策管辖，本扩展的开发者无法访问。
4. 拆分视图记录。本扩展所建拆分视图的标签页编号配对保存在 chrome.storage.session 中，只存在内存里，关闭浏览器即清除。

## 发往搜索引擎的数据

查询词由你的浏览器直接发往你选择的两个搜索引擎，与你直接访问这些网站搜索没有区别。这些网站如何处理你的搜索，适用它们各自的隐私政策。

## 权限

- declarativeNetRequest：只把带有本扩展标记参数 _ss 的搜索网址重定向到本扩展自己的页面，不拦截请求，不修改请求头或响应头。
- storage：保存上述设置和拆分视图记录。
- 网站访问权限：安装时不授予任何网站权限。只有你在设置页点“授权”时，才为所选搜索引擎的具体网站申请权限。你可以随时在 chrome://extensions 的扩展详情页“有权访问的网站”中撤销。

本扩展不在无痕窗口中运行。

## 数据共享

本扩展不与任何人共享、出售或转让数据。本扩展对数据的使用遵守 Chrome 网上应用店用户数据政策，包括其中的“有限使用”（Limited Use）要求。

## 数据删除

卸载本扩展会删除它保存在本机的设置；如果开启了 Chrome 同步，同步数据由 Chrome 按其规则处理。你也可以在设置页删除自定义引擎，或在 chrome://extensions 的扩展详情页“有权访问的网站”中撤销授权。

## 儿童

本扩展不针对儿童，也不收集任何人的个人信息。

## 政策变更

如本政策有变更，会更新本页面并修改生效日期。如果新版本扩展处理数据的方式发生实质变化，会在更新说明中写明。

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

## In short: we collect no data

- The extension sends no data to the developer or any third party and does not sell data. It has no servers, makes no network requests, and contains no analytics, advertising, third-party code or remote code.
- It stores nothing except your settings (plus split-view tab IDs that are cleared when the browser closes; see item 4 below).
- To do its job, it reads a small amount of information on your device: the trigger URL of the search you start (including the search terms) and, when the current tab is already in a split view, the URL of the other tab. It uses that URL only to compare its origin and doesn’t store it. Each item is explained below.

## Data handled on your device

1. Trigger URLs and search terms. When you search using a trigger URL you added to Chrome (only URLs carrying the extension’s marker parameter “_ss” are handed to it), the extension reads that URL on your device, extracts the search terms and the engine IDs in “_ss”, builds the right-hand engine’s URL, and opens both engines’ result pages in two tabs. Search terms are not stored and are not sent to anyone other than those two engines.
2. URL of the other tab in a split view. When the current tab is already in a split view, the extension reads the other tab’s URL and checks only whether its origin belongs to one of your configured engines, to tell whether it opened that split view. It does not read your browsing history or any page content. Chrome provides that URL only for sites you have granted access to. It is used for that check only and is not stored.
3. Settings. Your search engines (names and URL templates), their order, hidden built-in engines, your default pair and the interface language you chose are stored in chrome.storage.sync. If you have Chrome sync turned on, Chrome syncs these settings across your devices through your Google Account; this is governed by Chrome’s and Google’s privacy policies, and the developer has no access to it.
4. Split records. Tab-ID pairs of split views the extension created are kept in chrome.storage.session, in memory only, and are cleared when the browser closes.

## Data sent to search engines

Your browser sends your search terms directly to the two engines you chose, exactly as if you had searched on those sites yourself. How those sites handle your searches is governed by their own privacy policies.

## Permissions

- declarativeNetRequest: redirects only search URLs that carry the extension’s marker parameter “_ss” to the extension’s own page. It never blocks requests or modifies request or response headers.
- storage: stores the settings and split records described above.
- Site access: no site access is granted at install. Access to a specific search engine’s site is requested only when you click “Grant access” next to an engine on the settings page. You can revoke it at any time under “Site access” on the extension’s details page in chrome://extensions.

The extension does not run in Incognito windows.

## Data sharing

The extension does not share, sell or transfer data to anyone. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Data deletion

Uninstalling the extension deletes the settings it stored on your device; if Chrome sync is on, synced data is handled by Chrome under its own rules. You can also delete custom engines on the settings page or revoke site access in chrome://extensions.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, this page will be updated along with the effective date. If a new version changes how the extension handles data in a material way, the release notes will say so.

## Contact

Developer: pine2D
Contact: {{CONTACT_URL}}
```
