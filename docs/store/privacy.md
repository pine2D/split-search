# 隐私做法与隐私政策（草稿）

> 状态：草稿，待审。
> 前半部分是控制台“隐私做法”标签页各栏的填写建议。审核员读英文，所以可粘贴的文字用英文，说明用中文。后半部分 (f) 是隐私政策全文（中英两版），需要托管在公开网址上。
> 依据：`src/manifest.json`、`src/background.js`、`src/go.js`、`src/lib/rules.js`、`src/lib/engines.js`、`src/chrome/config-store.js`、`src/chrome/split-actions.js`、`src/options/ui.js`（核对日期 2026-10-24，对应 v0.1.0）。

## 代码事实速查（供核对）

| 事实 | 出处 |
|---|---|
| `permissions` 只有 `declarativeNetRequest`、`storage`；没有 `tabs`，没有必需的 `host_permissions` | `src/manifest.json` |
| `optional_host_permissions` 为 `https://*/*`、`http://*/*`，但运行时只为引擎的精确 origin 申请 `<origin>/*`，含 `*` 的不生成；在用户点击“授权”时调用 `chrome.permissions.request` | `src/options/ui.js` `originPattern` / `authButton` |
| 只有一条 DNR 动态规则（id 1）：只匹配带 `_ss=` 参数的 `main_frame` 请求，`requestDomains` 只含可作左侧的引擎域名，动作是重定向到本扩展的 `go.html?u=<原网址>`。不拦截、不改请求头和响应头 | `src/lib/rules.js`、`src/background.js` |
| `chrome.storage.sync` 只存设置：`customEngines`（id、名称、网址模板）、`presetOverrides`（名称、网址、隐藏）、`order`、`defaultPair` | `src/lib/engines.js` `mergeConfig`、`src/options/edits.js` |
| `chrome.storage.session` 只存本扩展所建分屏的标签 id 配对（`split:<tabId>` → 另一侧 tabId），仅在内存中，浏览器关闭即清空 | `src/chrome/split-actions.js` `recordPair` |
| 扩展代码不发任何网络请求（没有 `fetch`、`XMLHttpRequest`、`WebSocket`、`sendBeacon`），也没有 `eval` 或远程脚本 | 全仓 `src/` 检索 |
| 查询词只在 `go.html` 里从触发网址解析出来，用来拼右侧引擎网址，然后在标签页中打开左右两个引擎；不保存 | `src/go.js`、`src/lib/trigger.js` |
| 读取分屏另一侧标签的 `url`，只用来比较它的 origin 是否属于用户的引擎（判断是不是本扩展的分屏）；只有已授权 origin 上的标签才读得到 | `src/lib/split-decision.js`、`src/go.js` `gatherContext` |
| 复制按钮用 `navigator.clipboard.writeText` 写入触发网址或 `chrome://settings/searchEngines`；不读剪贴板 | `src/options/ui.js` |
| `incognito: "not_allowed"`：扩展不在无痕窗口运行 | `src/manifest.json` |

## (a) Single purpose（单一用途）

```text
Split Search opens a search in two search engines side by side in Chrome's native Split View. When the user searches from the address bar (or drags text onto the tab strip) using a trigger URL they added as a Chrome site search, the extension opens the left engine's results in the current tab and the right engine's results in a paired split tab. Everything in the extension (engine list, trigger-URL generator, site-access requests) serves only this purpose.
```

字数：460

## (b) Permission justification（权限理由）

控制台会逐项列出 manifest 中声明的权限。

### declarativeNetRequest

```text
Used for exactly one dynamic redirect rule. It matches only top-level (main_frame) navigations whose URL contains the extension's own marker parameter "_ss=", and only on the domains of the user's configured search engines (Chrome applies the redirect only where the user has granted host access). Those navigations are redirected to the extension's own page (go.html), which reads the search terms from that URL and opens the two result pages in a split view. The rule never blocks requests and never modifies request or response headers. Such URLs come from the trigger URLs the user adds to Chrome as site searches.
```

字数：618

### storage

```text
chrome.storage.sync stores only the user's settings: custom search engines (id, name, URL template), renamed/hidden built-in engines, engine order, and the default engine pair. Chrome syncs it only if the user has Chrome sync turned on. chrome.storage.session keeps, in memory only, the tab-id pairs of split views this extension created, so a new search can refresh its own split instead of overwriting a split the user made; it is cleared when the browser closes. No search terms or browsing data are stored.
```

字数：510

### Host permissions（optional_host_permissions）

```text
No host access is granted at install. The manifest lists https://*/* and http://*/* only as optional host permissions so that users can add any search engine. At runtime the extension requests access only to each selected engine's exact origin (for example https://www.google.com/*), and only when the user clicks the "授权" (Grant) button on the settings page; wildcard hosts are never requested. Access to the left engine's origin is required because a declarativeNetRequest redirect needs host permission for the request URL. For granted origins, Chrome also exposes the URL of tabs in the current split view, which the extension compares by origin to recognize its own split; it does not use the tabs permission. Users can revoke access at any time in chrome://extensions.
```

字数：774

说明：扩展还调用了 `chrome.tabs.create / update / query / getCurrent` 和 `chrome.windows.get / getLastFocused / create`。这些 API 不需要声明权限，控制台不会让你写理由；上面的 host 一栏已说明为什么不需要 `tabs` 权限。

## (c) Remote code（远程代码）

选择：**No, I am not using remote code.**

依据：所有脚本都打包在扩展里，用 `<script type="module" src="…">` 和相对路径 `import` 加载；没有 `eval`、`new Function` 或外部脚本，manifest 也没有放宽 CSP。

## (d) Data usage（数据使用披露）

Chrome 网上应用店的用户数据 FAQ 把“处理”（handle）定义为收集、传输、使用或共享用户数据，并要求即使数据只在本地处理也要披露。所以这里不能因为“不上传”就全部不勾，要按扩展在本机实际读取的内容判断。

| 控制台类别 | 建议 | 理由 |
|---|---|---|
| Personally identifiable information（姓名、地址、邮箱、年龄、证件号等） | 不勾 | 不读取、不要求输入任何身份信息 |
| Health information | 不勾 | 无 |
| Financial and payment information | 不勾 | 无付费、无支付 |
| Authentication information（密码、凭据等） | 不勾 | 各引擎的登录状态留在各自标签的 Cookie 里，扩展没有 `cookies` 权限，也不读取 |
| Personal communications（邮件、短信、聊天） | 不勾 | 无 |
| Location（地区、IP、GPS） | 不勾 | 不读取位置；扩展自身不发网络请求 |
| **Web history**（访问过的网页列表及相关数据） | **建议勾选** | `go.html` 会在本机读取用户正在打开的触发网址（含查询词），用来拼出右侧引擎的网址；还会比较分屏另一侧标签网址的 origin。数据只在本机即时使用，不保存，也不离开浏览器。按 FAQ“本地处理也要披露”的要求，保守起见勾选 |
| User activity（网络监控、点击、鼠标位置、滚动、按键记录） | 不勾 | 不监听点击、按键或页面事件；DNR 规则由 Chrome 执行，扩展看不到其他请求 |
| Website content（文字、图片、声音、视频、链接） | 不勾 | 没有 content script，不读取任何网页内容 |

取舍说明：勾选 Web history 后，商店页的隐私栏会显示扩展处理“网页浏览记录”，部分用户可能会犹豫。另一种做法是全部不勾，理由是数据既不离开设备也不保存。这种做法的风险是审核员按 FAQ 判定披露不完整。v0.1 建议勾选，并在详细说明和隐私政策里讲清楚“只在本机使用、不上传”。

## (e) Certifications（合规声明）

三项都勾选，扩展的实际行为与之相符：

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
  不出售、不转让：扩展没有服务器，不向开发者或任何第三方发送数据。查询词由用户自己的浏览器发往用户选择的引擎，这正是用户要求的功能。
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  读取触发网址只为打开分屏。
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

Split Search（以下简称“本扩展”）是由 pine2D 开发的 Chrome 扩展，用两个搜索引擎在 Chrome 原生分屏中打开同一次搜索。本政策说明本扩展如何处理你的数据。

## 概要

本扩展不收集、不上传、不出售你的任何数据。它没有服务器，不含统计、广告或第三方代码。

## 本扩展在你的设备上处理的数据

1. 触发网址和查询词。当你通过自己添加到 Chrome 的触发网址进行搜索时，本扩展会在本机读取这个网址，取出查询词，拼出右侧搜索引擎的网址，然后在两个标签页中分别打开左右两个引擎的结果页。查询词不会被保存，也不会发给除这两个引擎以外的任何一方。
2. 分屏标签的网址。为了判断一个分屏是不是本扩展打开的，本扩展会比较分屏另一侧标签的网址是否属于你配置的搜索引擎。只有你授权过的网站上的标签，Chrome 才会把网址提供给本扩展。这一信息只用于当次判断，不保存。
3. 设置。你配置的搜索引擎（名称、网址模板）、排序、隐藏的预置引擎和默认组合，保存在 chrome.storage.sync 中。如果你开启了 Chrome 同步，Chrome 会通过你的 Google 账号在你的设备之间同步这些设置；这由 Chrome 和 Google 的隐私政策管辖，本扩展的开发者无法访问。
4. 分屏记录。本扩展所建分屏的标签编号配对保存在 chrome.storage.session 中，只存在内存里，关闭浏览器即清除。

## 发往搜索引擎的数据

查询词由你的浏览器直接发往你选择的两个搜索引擎，与你直接访问这些网站搜索没有区别。这些网站如何处理你的搜索，适用它们各自的隐私政策。

## 权限

- declarativeNetRequest：只把带有本扩展标记参数 _ss 的搜索网址重定向到本扩展自己的页面，不拦截请求，不修改请求头或响应头。
- storage：保存上述设置和分屏记录。
- 网站访问权限：安装时不授予任何网站权限。只有你在设置页点“授权”时，才为所选搜索引擎的具体网站申请权限。你可以随时在 chrome://extensions 中撤销。

本扩展不在无痕窗口中运行。

## 数据共享

本扩展不与任何人共享、出售或转让数据。本扩展对数据的使用遵守 Chrome 网上应用店用户数据政策，包括其中的“有限使用”（Limited Use）要求。

## 数据删除

卸载本扩展会删除它保存在本机的设置；如果开启了 Chrome 同步，同步数据由 Chrome 按其规则处理。你也可以在设置页删除自定义引擎，或在 chrome://extensions 中撤销网站访问权限。

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

Split Search ("the extension") is a Chrome extension developed by pine2D. It opens a search in two search engines side by side in Chrome's native Split View. This policy explains how the extension handles your data.

## Summary

The extension does not collect, upload or sell any of your data. It has no servers and contains no analytics, advertising or third-party code.

## Data handled on your device

1. Trigger URLs and search terms. When you search using a trigger URL you added to Chrome, the extension reads that URL on your device, extracts the search terms, builds the right-hand engine's URL, and opens both engines' result pages in two tabs. Search terms are not stored and are not sent to anyone other than those two engines.
2. URLs of split-view tabs. To tell whether a split view was opened by the extension, it checks whether the other tab in the split belongs to one of your configured engines. Chrome provides that URL only for sites you have granted access to. It is used for that check only and is not stored.
3. Settings. Your search engines (names and URL templates), their order, hidden built-in engines and your default pair are stored in chrome.storage.sync. If you have Chrome sync turned on, Chrome syncs these settings across your devices through your Google Account; this is governed by Chrome's and Google's privacy policies, and the developer has no access to it.
4. Split records. Tab-ID pairs of split views the extension created are kept in chrome.storage.session, in memory only, and are cleared when the browser closes.

## Data sent to search engines

Your browser sends your search terms directly to the two engines you chose, exactly as if you had searched on those sites yourself. How those sites handle your searches is governed by their own privacy policies.

## Permissions

- declarativeNetRequest: redirects only search URLs that carry the extension's marker parameter "_ss" to the extension's own page. It never blocks requests or modifies request or response headers.
- storage: stores the settings and split records described above.
- Site access: no site access is granted at install. Access to a specific search engine's site is requested only when you click "授权" (Grant) on the settings page. You can revoke it at any time in chrome://extensions.

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
