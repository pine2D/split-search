# Split Search 设计文档（v0.1）

日期：2026-10-23　作者：pine2D　状态：待审

## 1. 意图与缘由

用户订阅了 Kagi，日常想把 Kagi 和 Google（或其他引擎）的搜索结果放在一起对比。之前用的 Multi Search & Multi AI 扩展有两个问题：

- 它用 iframe 把几个结果页聚合在同一屏，为此删掉了大量响应头，有安全隐患；
- 它的“替换新标签页”逻辑会劫持所有地址还是 `about:blank` 的新标签，Chrome 原生的“拖拽文字到标签栏直接搜索”因此失效。这一点是读本地代码推断出来的，没有实测。

本扩展只做一件事：**用户在地址栏输入关键词，或把文字拖到标签栏时，直接打开一个 Chrome 原生分屏（Split View），左右各是一个用户自选的搜索引擎的结果页。** 两侧都是真实标签，保留各站的登录状态，不嵌 iframe，不改响应头。

## 2. 已验证的技术前提

### 2.1 原型实测（2026-10-23，Chrome 155.0.8059.85 / Windows）

一次性原型位于 `D:\APP\Chrome-Extensions\split-search-spike`，现已弃用。原型的触发地址是 `https://split.invalid/?q=%s&pair=…`；v0.1 改用第 4 节的触发方式，拦截和分屏的机制不变。

| 前提 | 结果 |
|---|---|
| Chrome 允许把自定义网址存成网站搜索，并“设为默认” | ✅ |
| DNR 动态规则能在请求发出前，把 main_frame 导航重定向到扩展页（go.html 已列入 `web_accessible_resources`） | ✅ 每次都走 DNR |
| 四种入口都能触发：地址栏关键词（`keyword`）、地址栏默认搜索（`generated`）、拖到两个标签之间（新建标签）、拖到已有标签上（替换该标签） | ✅ |
| 在扩展页里调用 `tabs.create({splitWithTabId, index})`，以当前标签为左、新建标签为右，组成原生分屏 | ✅ 从拖拽到分屏完成约 0.2 秒 |
| 已在分屏中的标签再次触发时，用 `tabs.query({splitViewId})` 找到另一侧并就地更新 | ✅ |
| 能区分拖拽和地址栏：拖拽是 `transitionType=link`，没有 `from_address_bar`；地址栏是 `generated` 或 `keyword`，带 `from_address_bar` | ✅ v0.1 不用，留给模式 B |

### 2.2 文档与源码核查（2026-10-23，每条结论由两个代理分别查官方文档和 Chromium 源码）

- DNR 的 `redirect` 只要求**请求网址**的 host 权限，可以在运行时通过 `optional_host_permissions` 授予。main_frame 导航**不检查 initiator** 的权限。`regexSubstitution` 可以指向 `chrome-extension://`，`\0` 代表整个匹配串。（源码依据：`composite_matcher.cc`、`web_request_permissions.cc`）
- 有某个 origin 的 host 权限、但没有 `tabs` 权限时，可以读到该 origin 上标签的 `url`；`tabs.query({splitViewId})` 不需要 `tabs` 权限。
- `incognito: "not_allowed"` 是合法值，DNR 规则不会作用于无痕窗口。如果改用 `spanning` 并允许无痕，重定向到扩展页时会以 `ERR_BLOCKED_BY_CLIENT` 失败，用户看到的是错误页，而不是退化成普通搜索。
- `web_accessible_resources` 设置 `use_dynamic_url: true` 后，DNR 重定向仍然可用：Chrome 会把静态 id 的网址改写为 GUID 网址，再 307 跳回静态 id，query 完整保留（M146 修复）。
- Chrome 网站搜索展开 `%s` 的方式：`%s` 在 query 中时，空格编码为 `+`；在 path 中时用 EscapePath，空格编码为 `%20`，`/ & + =` 保持原样。`%s` 出现多次时全部替换。`%S`（大写）表示不转义。Chrome 不会给用户自建的网站搜索追加任何参数，也不会预取。
- Google 忽略未知参数 `_ss`。Kagi 访客状态下结果正常，但会在客户端把逗号编码成 `%2C`；经过 Turnstile 跳转时，参数名可能变成 `amp;_ss`。登录状态下的表现待 T9 实测。
- `tabs.create({splitWithTabId})`：源标签是固定标签或在标签组中时，新标签会自动继承固定状态和所在标签组。在 popup 或 app 类型的窗口里调用，按源码推断可能触发 CHECK 崩溃，必须提前拦住，不调用。
- go.html 里调用 `history.back()` 能回到被 DNR 重定向之前的页面。不要用 `navigation.canGoBack` 判断能否后退，它在扩展页上恒为 false。关闭分屏中的一侧后，另一侧会自动解除分屏。

相关 API 的版本要求：`tabs.create({splitWithTabId})`、`tabs.createSplit`、`tabs.unsplit` 需要 Chrome 155+；`Tab.splitViewId`、`tabs.query({splitViewId})` 需要 Chrome 140+。一个分屏**只能放两个标签**。

## 3. 目标、非目标与反目标

**目标（v0.1）**
- G1：地址栏直接输入关键词、拖拽文字到标签栏，都打开“默认组合”的原生分屏。用户已确认地址栏也默认分屏。
- G2：引擎可自定义，支持增删改和排序，用 URL 模板描述，`%s` 代表关键词。
- G3：可以有多个组合。每个组合通过 Chrome 原生的“网站搜索”绑定一个**用户自己定的快捷字词**，例如 `kb 关键词` 打开 Kagi ｜ Bing。扩展本身不占用任何固定关键词。
- G4：设置页提供引导：生成可复制的触发网址，逐步说明如何添加网站搜索、设为默认，并说明副作用（见 5.6）。
- G5：**优雅降级**。在没装本扩展或扩展没生效的环境里，触发网址就是一次普通的左侧引擎搜索。这类环境包括：通过 Chrome 同步拿到同一套搜索设置的其他电脑和手机、无痕窗口、扩展被停用、未授权，或引擎站点自己的 Service Worker 接管了导航。

**非目标（v0.1 不做）**
- 三个及以上引擎同屏（API 不支持）。
- 在无痕窗口内分屏（v0.1 按 G5 降级）。
- 模式 B：默认引擎保持单一引擎，只有拖拽才分屏（见第 8 节）。
- `chrome.omnibox` 关键词和地址栏实时联想。
- 右键菜单、快捷键、多语言、上架 Chrome 网上应用店。

**反目标（即使能用也算失败）**
- 破坏 Chrome 原生的拖拽搜索或地址栏行为，包括通过同步拿到这套设置的其他设备和无痕窗口。
- 劫持与本扩展无关的标签或新标签页。
- 使用 iframe，或修改任何网站的响应头。
- 申请 `<all_urls>` 或宽泛的 host 权限、申请 `tabs` 权限，或者把查询词发给用户所选引擎以外的任何一方。注意：`web_accessible_resources` 的 `matches` 写 `<all_urls>` 不算权限申请。
- 未经允许覆盖用户**手动建的分屏**里的页面。

## 4. 核心机制

### 4.1 触发网址

触发网址 = **左侧引擎的真实搜索网址 + 标记参数 `_ss=<左id>,<右id>`**，例如：

```
https://www.google.com/search?q=%s&_ss=google,bing
```

- 所有引擎模板（无论左右）都必须满足：
  - 协议是 http 或 https；
  - 含小写 `%s`；
  - 域名非空、不含 `*`，且不是 IPv6 字面量（不以 `[` 开头）；
  - 不含 `_ss` 参数（保留给标记参数）。

  只满足以上条件的模板只能当右侧。
- 能当左侧的模板还要额外满足：
  - 小写 `%s` **恰好出现一次，并且作为某个 query 参数的完整值**（如 `q=%s`）；
  - `%s` 所在的参数名只出现一次；
  - 不含 `#`。
- 禁止 `#` 的理由：如果标记参数落进片段，并且新网址和当前页只差片段（例如在单页应用的引擎页上再搜一次），Chrome 只做同文档导航，不发网络请求，DNR 拦不到，分屏就不能可靠触发。
- 扩展没生效时，这就是一次普通的左侧引擎搜索，满足 G5。

### 4.2 流程

```
地址栏 / 拖拽 / 右键“在 X 中搜索”
  → Chrome 用默认引擎或网站搜索拼出触发网址
  → DNR 动态规则在请求发出前把它重定向到 chrome-extension://<静态id>/go.html?u=<原始网址>
  → go.html 依次执行：
      1. 防重入：导航类型是 back_forward 或 reload 时，不自动分屏，只显示“重新执行”按钮
      2. 解析：取 location.search 中 "u=" 之后的全部文本作为原始网址（\0 未经编码，不能用 URLSearchParams.get('u')）
              → 用 URL + URLSearchParams 读出 _ss（可兼容 %2C）和左侧模板里 %s 所在参数的值作为关键词（+ 会自动还原为空格）
      3. 窗口检查：当前窗口不是 normal 类型（popup/app）时 → 在一个 normal 窗口里新建一对标签组成分屏；当前标签 location.replace(左侧网址)
      4. 分屏：
          ├─ 当前标签不在分屏中：tabs.create({url: 右侧, splitWithTabId: 当前, index: 当前+1, windowId, active:false})
          │                   → 然后 location.replace(左侧网址)
          ├─ 当前标签在“本扩展的分屏”中（判定见 5.3）：tabs.update(另一侧, 右侧) → location.replace(左侧)
          └─ 当前标签在其他分屏中：见 5.3
```

- 导航到左侧引擎时使用**去掉 `_ss` 的网址**，并用 `location.replace`，这样 go.html 不会留在历史记录里，用户点后退不会再次触发分屏。
- `regexSubstitution` 中**写死静态的** `chrome-extension://${chrome.runtime.id}/go.html?u=\0`，不要用 `chrome.runtime.getURL()`。开启 `use_dynamic_url` 后，`getURL()` 返回的是本次会话的 GUID，浏览器重启后会失效，而动态规则是持久保存的。
- `regexFilter` 必须用 `^…$` 锚定整条 URL，因为 RE2::Replace 只替换匹配到的那一段。规则大小写敏感（`isUrlFilterCaseSensitive: true`），并用 `requestDomains` 只匹配已配置引擎的 host。
- 后台 Service Worker 在顶层监听 `storage.onChanged`、`permissions.onAdded` 和 `permissions.onRemoved`，变化时**重建**规则；`onInstalled` 和 `onStartup` 时也重建一次，操作是幂等的。

### 4.3 权限与 manifest

- `permissions`：`declarativeNetRequest`、`storage`。**不申请 `tabs`**。
- `optional_host_permissions: ["https://*/*", "http://*/*"]`。运行时只为已配置引擎的**精确 origin** 调用 `permissions.request`，注意 `www.` 和裸域名是两个 origin。不要再在必需的 `host_permissions` 里重复写这些 origin。
- 只有左侧引擎的 origin 是**必需**的，DNR 重定向依赖它。右侧引擎的 origin 只用于 5.3 的判定，缺少时照常分屏。
- `permissions.request` 只能由用户手势触发：`onInstalled` 只负责调用 `runtime.openOptionsPage()`，用户在设置页点“授权”按钮后才发起请求。授权状态每次都用 `permissions.contains` 实时查询，不缓存。
- `web_accessible_resources: [{ resources: ["go.html"], matches: ["<all_urls>"], use_dynamic_url: true }]`。从网页拖拽文字时，导航带有来源页的 initiator，所以必须列入 WAR，`matches` 也不要收窄。`use_dynamic_url` 只能防止网页直接链接 go.html，防不住带 `_ss` 的引擎链接（见 5.5）。
- `incognito: "not_allowed"`，`minimum_chrome_version: "155"`。
- **`key`**：在 manifest 里固定公钥，保证扩展 ID 稳定。原因：已解压扩展的 ID 由加载路径决定，路径一变，已授权的权限和 `storage.sync` 就对不上了，换机器也无法互通。扩展 ID 只由这个公钥决定，私钥只在自签 `.crx` 时才需要，不保留。

## 5. 行为细节

### 5.1 数据模型（`chrome.storage.sync`）

- 预置引擎（按顺序：Google、Bing、DuckDuckGo、Perplexity、Kagi；默认组合为 Google ｜ Bing）**只写在代码里**，读取时与存储合并，不写入存储。这样可以避免新设备在 `onInstalled` 时写入的预置值覆盖从其他设备同步过来的配置。
- 存储内容只包括用户的改动：`customEngines`、`presetOverrides`（改名、改模板、隐藏）、`order`、`defaultPair`。单项不能超过 8192 字节；排序要防抖，一次写入，避开每分钟 120 次的写入上限。
- `id` 只能由小写字母、数字和 `-` 组成，创建后**不可修改**，因为它会写进已保存的网站搜索网址。默认组合正在引用的引擎不能删除。
- 修改某个引擎的模板后，设置页要提示：已存进 Chrome 的、以它为左侧的网站搜索网址需要重新复制。
- 扩展自己生成左右两侧的结果页网址时，用 `encodeURIComponent` 替换 `%s`。左右可以是同一个引擎。
- host 权限不会同步，每台设备要分别授权。

### 5.2 go.html 的异常处理

- `_ss` 里有未知 id 或格式不对：停在 go.html，显示中文错误说明和“打开设置”链接。
- 关键词为空：打开两个引擎的首页，即模板的 origin。
- 分屏 API 抛错（同一标签已在分屏中的竞态、标签栏不可编辑等）：Chrome 会自己关闭失败的新标签，扩展只需在相邻位置新开一个普通的右侧标签，并在 console 记录错误。
- 所有 `chrome.*` 调用都用 try/catch 包起来，任何异常都至少要让左侧搜索能打开。

### 5.3 已在分屏中再次触发

- **判定“本扩展的分屏”**：
  1. 主依据：`storage.session` 中记录的本扩展创建的标签对（tabId）。会话内有效，并且不受引擎跨 origin 跳转的影响，例如 Bing 跳到 cn.bing.com、Google 跳到 consent 页。
  2. 兜底（浏览器重启后）：用 `tabs.query({splitViewId})` 找到另一侧；只有确实读到了 `url`（判断时用 `typeof url === 'string'`），并且它的 origin 属于已配置的引擎，才算本扩展的分屏。
  3. 读不到 url 或无法判定时，按“其他分屏”处理，宁可多开标签，也不覆盖用户的页面。
- **本扩展的分屏**：就地更新两侧，左右位置不变。
- **其他分屏**：另一侧保持不动。先 `await` 在分屏右侧相邻位置新建一对标签，组成新的分屏；然后当前标签回到被拖拽替换之前的页面：`history.length > 1` 时调用 `history.back()`，否则用 `tabs.remove` 关闭当前标签。如果 `tabs.remove` 抛错（例如用户正在拖动标签），就保留当前页面。

### 5.4 设置页（options_ui，整页打开）

- 引擎列表：增删改，`id` 只能在新建时填；可排序。按 4.1 校验 URL 模板：所有模板都必须是 http/https、含小写 `%s`、域名非空且不含 `*`、不是 IPv6 字面量、不含 `_ss` 参数，否则不能保存；并标出哪些引擎可以当左侧（4.1 的左侧附加条件，含“`%s` 所在参数名只出现一次”）。
- 授权：每个引擎显示授权状态，提供授权按钮；保存引擎或修改默认组合时引导用户授权。
- 默认组合：左、右两个下拉框。
- 组合生成器与引导：生成触发网址并提供复制按钮，图文说明“打开 `chrome://settings/searchEngines` → 在网站搜索里添加 → 设为默认”的步骤，并写明 G5 的降级行为和 5.6 的副作用。
- 点击扩展图标打开设置页；首次安装时自动打开。

### 5.5 来自网页的触发

网页里带 `_ss` 的链接也能触发分屏，但查询词只会发给用户选的引擎，危害很小，接受这个风险。一个相关的情况：降级过一次之后，结果页网址里可能残留 `_ss`，如果引擎在翻页或筛选链接里保留了这个参数，扩展恢复生效后点这些链接会再次触发分屏。v0.1 接受这一点。**不**通过排除引擎域名作为 initiator 来规避，因为从引擎结果页拖拽文字时，initiator 正是引擎域名，这样做会让拖拽失效。

### 5.6 把触发网址设为默认搜索引擎的副作用（引导中要写明）

- 自己添加的网站搜索没有联想网址，地址栏的搜索联想会消失（用户已接受）。需要实测一个替代做法：直接编辑 Chrome 自动发现的 Kagi 条目，在网址后加上 `_ss`，看联想是否保留（T12）。如果保留，引导就优先推荐这种做法。
- 右键菜单的“在 X 中搜索”也会走触发网址（属于 G1 的延伸，T11）。
- 这个设置会同步到用户的所有设备，按 G5 降级为普通搜索。

## 6. 约束

- MV3，原生 JS 的 ES 模块，**不用构建工具，不引入运行时依赖**。
- 纯逻辑放在 `src/lib/`，不依赖 `chrome.*`，用 `node --test` 测试，覆盖以下内容：
  - 模板校验；
  - 触发网址的生成与解析（`u=` 后面跟原始网址，`_ss` 可能是 `%2C` 编码）；
  - 关键词提取，用例包括：空格（`+`）、`+`、`&`、`%`、`#`、中文、emoji、`c++`、`a&_ss=x`；
  - DNR 正则的生成；
  - 配置合并（预置引擎加上用户改动）。
- JS 单文件不超过 300 行。
- 开发时用 `scripts/sync-to-windows.sh` 镜像到 `/mnt/d/APP/Chrome-Extensions/split-search`，在 Windows Chrome 里“加载已解压的扩展程序”。之后只用“重新加载”，不要移除后重装，否则授权会丢失。分屏相关的行为一律在 Windows Chrome 155 及以上版本手动测试。
- 存储写入避免并发的“读取→修改→写回”。

## 7. 验收（手测清单）

| # | 场景 | 期望 |
|---|---|---|
| T1 | 用关键词组合触发（`kb xxx`） | 打开 Kagi ｜ Bing 分屏 |
| T2 | 地址栏默认搜索；Alt+Enter | 打开默认组合分屏；Alt+Enter 在新标签打开，不崩溃 |
| T3 | 从普通网页拖到两个标签之间；从外部应用拖入 | 分屏 |
| T4 | 拖到已有标签上 | 该标签变成左侧 |
| T5 | 在本扩展的分屏内连续拖 3 次；重启浏览器后再拖 | 就地刷新，标签数不增加 |
| T6 | 在手动建的分屏里拖 | 新开一对分屏，原标签回到原页面；没有历史时关闭原标签 |
| T7 | `_ss` 写错 | 显示错误页 |
| T8 | 无痕窗口；停用扩展；撤销左侧授权；站点访问改为“点击时”；只撤销右侧授权 | 前四项是普通左侧搜索；最后一项仍然分屏 |
| T9 | 带 `_ss` 访问已登录的 Kagi、经过 Turnstile 跳转的 Kagi、Google | 结果正常；参数被改写导致没分屏可以接受 |
| T10 | 分屏后在左侧点后退和前进；浏览器“继续上次浏览”恢复会话 | 不会重复分屏 |
| T11 | 右键“在 X 中搜索” | 分屏 |
| T12 | 编辑自动发现的 Kagi 条目，在网址后加 `_ss` | 记录联想是否保留 |
| T13 | 源标签是固定标签、在标签组中（包括组里最后一个）、是窗口里唯一的标签；在 popup 和 PWA 窗口里触发 | 不崩溃，按预期分屏或降级 |
| T14 | 各引擎都正常访问过（Service Worker 已注册）之后，再跑 T1–T4 | 分屏；如果某个引擎的 SW 让 DNR 失效，记录下来，并在设置页标注该引擎“仅建议作右侧” |
| T15 | 在装了 uBlock Origin 的配置下跑 T1–T4 | 分屏 |

## 8. 路线图（方向，不承诺）

- v0.2 模式 B（可选）：默认引擎保持单一引擎，只有拖拽才分屏。依据是原型测到的 `transitionType` 差异，需要排除结果页内的链接点击，届时再验证一次。
- 无痕窗口内分屏，需要 `incognito: "split"`，并重新设计生命周期。
- 每个引擎可配置“附加 host”，以应对跨 origin 跳转。
- 右键菜单“分屏搜索选中文字”；快捷键“换另一个引擎并分屏”。
- 上架 Chrome 网上应用店，需要隐私说明和截图。

## 9. 留给实现者决定

- 设置页的视觉、布局和文案。
- 文件拆分方式，遵守第 6 节的约束即可。
- go.html 的过渡样式。
- Perplexity 的 URL 模板。
- DNR 正则的具体写法，需满足 4.2 的约束。

## 10. 决策记录

| 决策 | 由谁决定 | 理由 |
|---|---|---|
| 地址栏也默认分屏（模式 A） | 用户 | 日常主要用法 |
| 触发网址用“左侧引擎真实网址 + `_ss`”，取代 `split.invalid` | 用户同意 | Chrome 同步会把默认引擎带到没装扩展的设备上 |
| 无痕窗口内不分屏，`incognito: "not_allowed"` | Claude | 降级已经够用；用 spanning 模式时，扩展页在无痕标签里会报错 |
| 判定“本扩展的分屏”：`storage.session` 中的 tabId 对为主，origin 为兜底，判定不了就当作“其他分屏” | Claude | 应对引擎跨 origin 跳转和浏览器重启；宁可多开标签，也不覆盖用户的页面 |
| 接受网页链接触发和残留 `_ss` 的风险；启用 `use_dynamic_url` | Claude | 危害小；排除 initiator 会让从引擎页拖拽失效 |
| 用 `location.replace` 离开 go.html，加防重入 | Claude | 防止后退或恢复会话时重复分屏 |
| `%s` 只能作为 query 参数值出现一次（仅限左侧引擎） | Claude | 关键词可以用 URLSearchParams 无损反解，避开 path 编码的歧义 |
| 所有模板禁用 `_ss`、通配符域名和 IPv6 字面量 | Claude | 防止自引用循环、宽泛 host 授权和整条 DNR 规则失效 |
| 预置引擎只写在代码里；manifest 固定 `key` | Claude | 防止同步覆盖；扩展 ID 稳定，授权才不会丢 |
| 不用构建工具、用 `node --test`、单文件不超过 300 行、镜像到 D 盘 | Claude | 与用户现有扩展项目保持一致 |
| 默认组合改为 Google ｜ Bing，Kagi 排最后 | 用户 | Kagi 用户群小 |
