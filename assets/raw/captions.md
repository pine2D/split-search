# 原始截图说明

这些是真实截图，用于合成商店截图和 README 配图，只做裁剪、缩放和外框处理，不改动画面内容；唯一例外是下面“修补”一节列出的一处。合成模板在 `assets/templates/`，渲染脚本是 `scripts/store/render-assets.mjs`。

## 拍摄环境

- Google Chrome 155.0.8059.84（Linux），界面语言 zh-CN；独立 Xvfb 屏幕 2400×1500，包装脚本固定缩放 1.5，所以窗口是 1600×1000 CSS 像素。
- 全新的临时配置，带 `--disable-sync`，没有登录 Chrome 账号，也没有登录任何网站。拍完已删除。
- 扩展从本仓库 `src/` 用 CDP `Extensions.loadUnpacked` 加载，版本 0.1.0。
- 用 `import -window root` 截取整个屏幕，包括标签栏和分屏。Xvfb 截图里没有鼠标指针。
- 除 `options-fullpage.png` 外，其余都是 2400×1500 的整窗截图。
- `drag-result-split.png`、`omnibox-suggest.png`、`omnibox-result-split.png` 三张是 2026-10-28 用 Chrome 156 重拍的，环境见下文“中文结果截图的重拍”。

## 设置页的状态

- 默认组合：DuckDuckGo ｜ Bing。
- 引擎排序：DuckDuckGo、Bing、Google、Kagi、Perplexity。
- 授权：只授权了 `https://duckduckgo.com/*` 和 `https://www.bing.com/*`，是在设置页点“点此授权”后，在 Chrome 授权框里点“允许”授予的。

## 截图清单

| 文件 | 尺寸 | 内容 |
|---|---|---|
| `options-top.png` | 2400×1500 | 设置页首屏：标题、默认组合（DuckDuckGo ｜ Bing）、“添加到 Chrome”卡片里的触发网址 `https://duckduckgo.com/?q=%s&_ss=ddg,bing`、其他组合、设置步骤开头。 |
| `options-engines.png` | 2400×1500 | 设置页滚动到“搜索引擎”一节：DuckDuckGo 和 Bing 标着“已授权”和“默认左侧/默认右侧”，Google、Kagi、Perplexity 标着“未授权”。 |
| `options-fullpage.png` | 2378×2876 | 设置页整页，用 CDP `Page.captureScreenshot` 拍，只有页面内容、不含浏览器界面。状态和上面两张相同。 |
| `permission-prompt.png` | 2400×1500 | 设置页点“点此授权 DuckDuckGo（必需）和 Bing（建议）”后弹出的 Chrome 授权框，内容是“读取和更改您在 duckduckgo.com 和 www.bing.com 上的数据”。这时默认组合已经改成 DuckDuckGo ｜ Bing，但还没授权，所以页面上有黄色提示。 |
| `split-ddg-bing-rust.png` | 2400×1500 | 原生分屏：左边是 DuckDuckGo，右边是 Bing，查询词“rust programming”。新开一个标签访问触发网址 `https://duckduckgo.com/?q=rust+programming&_ss=ddg,bing`，由扩展的 DNR 规则和 go.html 建成分屏，和真实使用的路径相同。页面缩放 100%。两个网页在约 800 CSS 像素宽的窗格里都有横向滚动条，这是两个网站本身的问题。 |
| `drag-to-tabstrip.png` | 2400×1500 | 拖拽过程中：在中文维基百科“Rust (编程语言)”页面选中正文里的“Graydon Hoare”，用 xdotool 真实按下鼠标，把选中的文字拖到标签栏空白处，在还没松手时截图。可以看到标签栏上方的拖拽影像“Graydon Hoare”；第一个标签右下方还有一个黑底白色“↑”方块，应该是 Chrome 的标签插入位置箭头，Xvfb 没有合成器，它的透明背景变成了黑色（合成时已盖掉，见“修补”）。拍之前用页面自带的关闭按钮关掉了维基百科的活动横幅。 |
| `drag-result-split.png` | 2400×1500 | 拖拽松手之后的结果（2026-10-28 重拍，拖拽过程同上一张）：Chrome 用默认搜索引擎打开新标签，扩展把它变成分屏，左边 DuckDuckGo、右边 Bing，查询词“Graydon Hoare”。标签栏里是维基百科和分屏的两个标签。 |
| `omnibox-suggest.png` | 2400×1500 | 在上一张分屏左侧的地址栏输入“rust ownership”，下拉建议显示“rust ownership - DuckDuckGo ｜ Bing 搜索”。这是 Chrome 用默认搜索引擎（触发网址做成的网站搜索）给出的建议（2026-10-28 重拍）。 |
| `omnibox-result-split.png` | 2400×1500 | 上一张按回车后的结果：扩展在原分屏里更新两侧，左边 DuckDuckGo、右边 Bing，查询词“rust ownership”（2026-10-28 重拍）。 |

## 修补

| 修补图 | 盖在哪里 | 做法 |
|---|---|---|
| `patches/drag-to-tabstrip-397-61.png`（32×31） | `drag-to-tabstrip.png` 的 (397,61) 处，由 `store-3-drag.html` 以 `<img class="patch">` 叠加 | 去掉黑底“↑”方块：上半填标签白、下半填地址栏底色 `#EDF2FA`；被挡住的“/”上半截取自同一斜杠下段（下移 8 行、右移 2 列），“wi”上半截取自同一张图里“zh.wikipedia”的“wi”（x 减 142，同一基线）。原图不动。 |
| `en/patches/drag-to-tabstrip-397-61.png`（31×31） | `en/drag-to-tabstrip.png` 的 (397,61) 处，由 `assets/templates-v2/store-3-drag.html` 以 `<img class="patch">` 叠加 | 英文版的同一个黑底“↑”方块（位置相同）：上 8 行填工具栏白、其余填地址栏底色 `#EDF2FA`，再按“取较暗像素”叠回被挡住的字：“wi”上半取自同一行“wikipedia”的“wi”（x 减 141），“/”上半取自同一斜杠下段（下移 8 行、右移 2 列），“g”顶端取自“(programming”里的“g”（x 加 148）。原图不动。 |

重做命令（在 `assets/raw/` 下）：

```bash
convert drag-to-tabstrip.png \
  -fill white -draw "rectangle 397,61 428,68" -fill "#EDF2FA" -draw "rectangle 397,69 428,91" \
  \( drag-to-tabstrip.png -crop 7x7+400+93 +repage \) -geometry +402+85 -composite \
  \( drag-to-tabstrip.png -crop 21x10+266+82 +repage \) -geometry +408+82 -composite \
  -crop 32x31+397+61 +repage -strip patches/drag-to-tabstrip-397-61.png
```

## 拍摄时的默认搜索引擎

拖拽和地址栏两组截图需要把触发网址设成 Chrome 默认搜索引擎。做法是用 e2e 脚本的 `settings-se.mjs` 操作 `chrome://settings/searchEngines`，添加网站搜索“DuckDuckGo ｜ Bing”，网址 `https://duckduckgo.com/?q=%s&_ss=ddg,bing`，快捷字词是脚本专用的 `sse2e`，再设为默认（2026-10-24 的 `drag-to-tabstrip.png` 拍摄时这条网站搜索的右侧是当时的自定义引擎，拖拽中的画面里看不到它）。这和设置页引导用户手动做的步骤效果相同，只是快捷字词不一样；快捷字词不出现在任何截图里。

## 已知限制（以后补拍时注意）

- 2026-10-24 这台机器上 Bing 对中文查询弹过人机验证（“最后一步 / 请验证您是真人”）。2026-10-28 重拍用的是英文查询词“Graydon Hoare”“rust ownership”，Bing 没有弹。补拍时尽量用英文查询词；Bing 弹验证时改用 `en/` 的同名截图，并在这里写明。
- 截图里引擎页面的内容（DuckDuckGo 的 Search Assist、Bing 的结果和结果数、第一条结果标题的下划线等）都是网站当时实际返回的结果，没有改过。
- 横向滚动条是 Linux 版 Chrome 的普通滚动条。Windows 上的效果以实拍为准。

## 中文结果截图的重拍（2026-10-28，v0.7 去掉百度）

v0.7 起百度不再出现在任何面向用户的地方（设计见 `docs/superpowers/specs/2026-10-28-v0.7-design.md` A2）。画面里有百度的三张 `drag-result-split.png`、`omnibox-suggest.png`、`omnibox-result-split.png` 换成 DuckDuckGo ｜ Bing 重拍，原来没被任何模板用到的 `split-ddg-baidu-weather.png` 删掉。`drag-to-tabstrip.png` 画面里没有百度，没有重拍。

- Google Chrome 156.0.8078.47（Linux），界面语言中文：启动参数加 `--lang=zh-CN`、环境变量 `LANGUAGE=zh_CN:zh`，另加 `--disable-features=LcdTextAntialiasing,Translate`（包装脚本自带的 `LcdTextAntialiasing` 一起写上，同名开关只认最后一个），并往临时配置的 `Default/Preferences` 写 `translate.enabled: false`。私有 Xvfb（:90，2400×1500），`/opt/google/chrome/google-chrome` 固定缩放 1.5，窗口经 CDP 设成 1600×1000 CSS 像素铺满屏幕，`import -window root` 截整屏，没有鼠标指针。
- 全新的一次性配置（`--disable-sync`，没有登录 Chrome 账号和任何网站），拍完删除；没有用 e2e 测试配置。启动、字体配置、Xvfb 都经 `scripts/e2e` 的 `browser.mjs`（`launch()`）、`display.mjs`。Accept-Language 是全新配置按 `--lang` 给的中文，DuckDuckGo 和 Bing（`www.bing.com`）都返回中文界面，没有加 `kl`、`setlang` 之类的参数。
- 扩展从本仓库 `src/` 用 CDP `Extensions.loadUnpacked` 加载，版本 0.6.1（main 上 ecc7961 之后的工作区）。`storage.sync` 写成默认组合 DuckDuckGo ｜ Bing、引擎排序 DuckDuckGo、Bing、Google、Kagi、Perplexity；只授权 `https://duckduckgo.com/*` 和 `https://www.bing.com/*`，在设置页发起申请，Chrome 授权框里用 xdotool 按 Tab、回车点“允许”。
- 网站搜索：`settings-se.mjs` 添加“DuckDuckGo ｜ Bing”（设置页建议的名称）、网址 `https://duckduckgo.com/?q=%s&_ss=ddg,bing`、快捷字词 `sse2e`，设为默认；之后关掉设置页和 `chrome://settings` 窗口，标签栏只剩一个标签。
- 拍摄过程：这个标签打开中文维基百科“Rust (编程语言)”，用页面自带的关闭按钮关掉活动横幅，在正文“…员工Graydon Hoare的个人项目…”里选中“Graydon Hoare”（不是链接），用 xdotool 真实按下鼠标拖到标签栏空白处（落点 1509,30，与 `drag-to-tabstrip.png` 相同）松手，等两侧结果都出来后截 `drag-result-split.png`；指针挪到标签栏右侧空白处（1900,30），按 Ctrl+L 在分屏左侧的地址栏输入“rust ownership”、按 Delete 去掉行内补全，截 `omnibox-suggest.png`；回车后扩展在原分屏里更新两侧，等两侧结果都出来后截 `omnibox-result-split.png`。
- Bing 两次都直接出结果，没有人机验证，所以没用 `en/` 的截图顶替。
- 与 `drag-to-tabstrip.png` 不同之处：那张是 2026-10-24 用 Chrome 155 拍的（拖拽中的画面），这三张是 Chrome 156，浏览器界面的细节（标签图标、配色）略有差别，只用在不上传的 zh_CN、zh_TW、es 套图里。
- 模板随之改的：`readme-how-it-works.html` 第 3 栏的裁切高度原来是 1127（百度截图的空白行），新截图在 x 0–1640 范围内的空白行是 1100–1120，改成与英文截图共用的 1102；`store-2-omnibox.html` 的下拉框细框（246,132,504,56）和两张模板的结果分屏裁切不用改。`node scripts/store/render-assets.mjs --locale zh_CN`、`zh_TW`、`es` 重新渲染，渲染器没有报溢出或超行；`--locale en` 重新渲染后英文图逐字节不变。

三张都逐一看过：没有百度，右侧是 Bing；地址栏下拉建议是“rust ownership - DuckDuckGo ｜ Bing 搜索”；没有账号头像（右上角是未登录的默认图标）、令牌、IP 和其他浏览历史。

## 英文截图（en/）

2026-10-24 用户决定宣传截图暂时只做英文。`en/` 是同一套画面的英文版，`render-assets.mjs --locale en` 用它们替换上面的同名图（其他语言仍用上面的中文截图，见 `docs/store/assets-spec.md` 第 4 节）。

拍摄环境（与上面不同之处）：

- Google Chrome 155.0.8059.84（Linux），界面语言英文：启动参数加 `--lang=en-US`、环境变量 `LANGUAGE=en_US:en`。独立 Xvfb 屏幕 2400×1500、缩放 1.5，窗口 1600×1000 CSS 像素，`import -window root` 截整屏，没有鼠标指针。
- 用 e2e 的隔离测试配置 `~/.cache/split-search-e2e/profile`（`--disable-sync`，不登录 Chrome 账号），全程经 `scripts/e2e` 的模块：`display.mjs` 起私有 Xvfb，`browser.mjs` 启动，`ext-source.mjs` 改装本检出（feat/v0.2）的 `src/`，`settings-se.mjs` 加网站搜索并设默认，`xinput.mjs` 真实拖拽和键盘输入，`teardown.mjs` 的恢复步骤收尾：`storage.sync` 读回与快照一致，默认搜索引擎改回运行前的那个、删掉 `sse2e` 条目，扩展改回运行前装自的目录。测试配置的 Accept-Language 是 `en-US,en,zh-CN`，DuckDuckGo 和 Bing 都返回英文页面，没有加 `kl`、`setlang` 之类的参数。
- 扩展版本 0.2（带 c6 正式图标），`storage.sync` 临时写成 `uiLocale: "en"`、默认组合 DuckDuckGo ｜ Bing、引擎排序 DuckDuckGo、Bing、Google、Kagi、Perplexity。测试配置里五个预置引擎都已授权，所以设置页里全部显示“Access granted”。
- 网站搜索：名称 `DuckDuckGo | Bing`（设置页建议的名称）、网址 `https://duckduckgo.com/?q=%s&_ss=ddg,bing`、快捷字词 `sse2e`，设为默认。右侧全部是预置的 Bing。

| 文件 | 内容 |
|---|---|
| `en/options-top.png` | 设置页“Search pairs”tab（英文界面，`options.html#tab-pair`，2026-10-27 v0.6 重拍，见下文“设置页三张的重拍”）：标题、语言下拉框、四个 tab（Add to Chrome、Search pairs、Search engines、Right-click lookup，选中的是 Search pairs）、“Default pair”卡（左右窗格 DuckDuckGo ｜ Bing、窄窗口开关与说明、指向“Add to Chrome”的一行）、“Keyword rules for the right side”卡（说明、“No rules yet…”、“Add rule”），整页一屏放得下 |
| `en/options-engines.png` | 设置页“Search engines”tab（`#tab-engines`），滚到底（页面只比视口高约 69 CSS 像素），引擎卡上缘在原图 y 309（tab 栏下缘 y 284）；卡头是“Reorder”“Add from catalog”“Add engine”；五个引擎都是“Access granted”和一个“Edit”按钮，DuckDuckGo、Bing 带“Default left/Default right”标签，前四行等高；在 x=840 处，行分隔线在原图 y 468、547、626、705、784，行左缘 x=710；下面是“Keyboard shortcut”卡（2026-10-27 v0.6 重拍） |
| `en/options-fullpage.png` | 设置页“Add to Chrome”tab 整页（CDP `Page.captureScreenshot`，`setupDone: true`，“Get started”卡不显示），2376×1391（2026-10-27 v0.6 重拍，见下文“设置页三张的重拍”） |
| `en/split-ddg-bing-rust.png` | 新标签打开触发网址 `https://duckduckgo.com/?q=rust+programming&_ss=ddg,bing`，扩展建成 DuckDuckGo ｜ Bing 拆分视图；标签栏里是“Split Search settings”和两个分屏标签 |
| `en/drag-to-tabstrip.png` | 英文维基百科“Rust (programming language)”，在正文“Software developer Graydon Hoare created Rust…”里选中“Graydon Hoare”（不是链接），用 xdotool 真实按下拖到标签栏空白处（落点 1460,30），没松手时截图。第一个标签旁同样有 Xvfb 下的黑底插入箭头（397,61），商店截图 3（v2）的裁切包含它，用 `en/patches/` 的修补图盖掉（见“修补”） |
| `en/drag-result-split.png` | 松手后：默认搜索引擎（触发网址）打开新标签，扩展建成 DuckDuckGo ｜ Bing 拆分视图，查询词“Graydon Hoare” |
| `en/omnibox-suggest.png` | 在上一张的左侧地址栏输入“rust ownership”，下拉建议“rust ownership - DuckDuckGo \| Bing Search”（行的位置与中文版相同） |
| `en/omnibox-result-split.png` | 回车后扩展在原分屏里更新两侧，查询词“rust ownership” |

两次拍摄：第一次拍了全部 8 张，但拖拽落点（1509,30）离选区太远，商店截图 3 的左块装不下选区和拖拽影像；第二次只把落点改到 1460,30 重拍拖拽和地址栏两组。`en/drag-to-tabstrip.png` 取第二次的；`en/drag-result-split.png`、`en/omnibox-*.png` 取第一次的（同一流程、同一查询词，第二次的地址栏下拉多了一条第一次留下的历史记录）。

### 设置页三张的重拍（2026-10-26，v0.4 界面翻新）

界面翻新（配色、“开始使用”卡、左右窗格、引擎行精简）之后，只重拍了画面里有设置页的三张 `en/options-*.png`。另外五张英文图里的设置页只是标签栏上的标签标题“Split Search settings”，没有变，不重拍。

- Google Chrome 156.0.8078.47（Linux），`--lang=en-US`、`LANGUAGE=en_US:en`，另加 `--disable-features=Translate`，并在启动前往临时配置的 `Default/Preferences` 写 `translate.enabled: false`（只加启动参数不够）：设置页的静态 HTML 是 `lang="zh-CN"`，全新配置里 Chrome 会在右上角弹“要翻译此页吗（中文）”的气泡，盖住页面右上角。
- 私有 Xvfb（:131，2400×1500，`/opt/google/chrome/google-chrome` 固定缩放 1.5，窗口 1600×1000 CSS 像素），`import -window root` 截整屏，没有鼠标指针。
- 全新的临时配置（`--disable-sync`，没有登录 Chrome 账号和任何网站），拍完删除；没有用 e2e 测试配置。字体配置同 e2e 的 `launch()`（排除 9P 挂载上的 Windows 字体）。
- 扩展从本仓库 `src/` 用 CDP `Extensions.loadUnpacked` 加载，版本 0.4.0（界面翻新后、提交前的工作区，含“右键查询”卡片两个下拉框的排版修正）。
- `storage.sync` 写成 `uiLocale: "en"`、默认组合 DuckDuckGo ｜ Bing、引擎排序 DuckDuckGo、Bing、Google、Kagi、Perplexity；`storage.local` 没有 `setupDone`，所以“开始使用”卡显示三步。
- 授权：在设置页里一次申请五个预置引擎的网站，Chrome 弹出授权框后用 xdotool 按 Tab、回车点“允许”（和用户点击效果相同）。所以第 1 步显示“已授权”，引擎列表全部“Access granted”。
- 模板裁切随之改了：商店截图 4 是 `648,308,1120,600`，顶部宣传图是 `640,310,678,290`（见 `assets/templates-v2/README.md`；2026-10-27 起改成按行分段裁切，见下文第四次重拍）。

第二次重拍（同一天，整体审查后的修正）：“不能隐藏”的说明放宽到一行（`options.css` 的 `.row-reason` 改为 `max-width: 56ch`），引擎卡片和整页随之变矮，所以重拍了这三张。用同一个脚本、同一套环境和状态（私有 Xvfb :131、全新临时配置、五个预置引擎在授权框里点“允许”、没有 `setupDone`），扩展是修正后的工作区。设置页的静态 HTML 这时已改成 `lang="en"`，不会再弹翻译气泡；关掉翻译的参数和 Preferences 仍然照旧加着。`options-top.png` 与上一版只差右边滚动条滑块（页面变矮了），画面内容相同；`options-engines.png` 里 DuckDuckGo、Bing 两行各矮了一行。重新渲染后只有商店截图 4 和顶部宣传图变了；商店截图 4 的裁切只到引擎行的左半边，说明文字在右半边、不在画面里，所以这两行的复选框下面仍有一行高的空白（比上一版少一行）。

第三次重拍（2026-10-26，v0.4.0 打标签前的“开始使用”第 2 步改版）：第 2 步拆成三个编号小步（复制设置地址、粘贴触发网址、设为默认，每步只带自己的复制按钮），只有画面里有这张卡的 `options-top.png` 和 `options-fullpage.png` 换了。同一个脚本、同一套环境和状态（私有 Xvfb :131、全新临时配置、五个预置引擎在授权框里点“允许”、没有 `setupDone`）。`options-fullpage.png` 变成 2376×4637（第 2 步比原来的“说明 + 两个带标签的复制框”矮了一点）。`options-engines.png` 也重拍过对比：内容相同，只有文字抗锯齿的像素差（页面高度变了，滚动位置不同），所以保留上一版不换。商店图和宣传图只用 `options-engines.png`，重新渲染后没有变化。工具栏弹窗不在任何原始截图里，弹窗分屏外的三档不用补拍。

第四次重拍（2026-10-27，v0.4 界面收尾）：没授权的非必需引擎改成中性样式、“开始使用”卡显示时“添加到 Chrome”卡里的默认组合一段和“其他组合”收进折叠区、以图搜图列表加了小标题和写明对象的按钮。三张 `en/options-*.png` 都用同一个脚本、同一套环境和状态重拍（私有 Xvfb :131、Chrome 156.0.8078.47、全新临时配置、五个预置引擎在授权框里点“允许”、没有 `setupDone`），扩展是当时 main 上的 `src/`。`options-top.png` 与上一版只差右边滚动条滑块（整页变矮了），画面内容相同；`options-engines.png` 内容相同，滚动位置差约 1 原图像素；`options-fullpage.png` 变成 2376×4343，“添加到 Chrome”卡里是收起的“Trigger URL for the default pair”和“Other pairs”，“右键查询”卡里有“Image search engines”小标题和“Add from image search catalog”“Add image search engine”两个按钮。界面里没授权的引擎都授权了，所以截图里看不到新的中性“未授权”样式。

第五次重拍（2026-10-27，v0.4 收尾第二批 A）：“开始使用”卡显示时“添加到 Chrome”卡的 5 步说明也收进折叠区，说明文字限宽 60ch（标语、提示和步骤换行更早），引擎卡说明去掉了“网址模板里 %s 代表关键词”半句，Perplexity 的提示改成不提 Service Worker 的说法。三张 `en/options-*.png` 都用同一个脚本、同一套环境和状态重拍（私有 Xvfb :131、Chrome 156.0.8078.47、全新临时配置、五个预置引擎在授权框里点“允许”、没有 `setupDone`），扩展是当时 main 上的 `src/`。`options-top.png` 里标语换成三行、各步说明换行位置变了；`options-engines.png` 的卡片说明多一行，引擎行整体比第四次低 29 原图像素，所以 `assets/templates-v2/store-4-engines.html`、`promo-marquee.html` 的分段裁切 y 跟着加 29（305→334、460→489、616→645），重新渲染后商店截图 4 和顶部宣传图与上一版内容相同，只有文字抗锯齿的像素差；`options-fullpage.png` 变成 2376×4161，“添加到 Chrome”卡里只有四个收起的标题（默认组合的触发网址、其他组合、设置步骤、注意事项），第四次重拍后改过的第 3 步句子收在折叠区里、不在画面中。

商店截图 4 多出的一行空白（同日查明；第六次重拍后行上没有这行说明，四行等高，改回整块裁切，见下文）：DuckDuckGo、Bing 两行右侧多一行“不能隐藏”的说明，所以这两行比 Google、Kagi 高 38 原图像素；商店截图 4 和顶部宣传图的裁切都只到行的左半边，说明在画面外，整块裁切就在这两行的复选框下面各留一行空白。原因在模板的裁切，不在文案。改成按行分段裁切、上下紧接：DuckDuckGo 行与 Bing 行都切在复选框一行之后（与 Google 行同高），切掉的两条带在画面可见范围里是纯白，没有删掉任何看得见的内容（见 `assets/templates-v2/store-4-engines.html`、`promo-marquee.html` 的注释）。

第六次重拍（2026-10-27，引擎行精简，设计见 `docs/superpowers/specs/2026-10-27-engine-row-design.md`）：引擎行上只剩授权状态、授权按钮（没授权时）和“Edit”，隐藏/删除挪进编辑对话框，轮换复选框挪到快捷键卡的“Shortcut rotation”折叠区，↑↓ 只在“Reorder”模式里出现，卡头多一个“Reorder”按钮，卡片说明换成新句子。三张 `en/options-*.png` 都用同一个脚本、同一套环境和状态重拍（私有 Xvfb :131、Chrome 156.0.8078.47、全新临时配置、五个预置引擎在授权框里点“允许”、没有 `setupDone`），扩展是当时 main 上的 `src/`（1db3f95）。`options-top.png` 与上一版只差右边滚动条滑块（整页变矮了）和文字抗锯齿，画面内容相同；`options-engines.png` 里行变矮、前四行等高（79 原图像素），分隔线在 y 333、412、492、571、650；`options-fullpage.png` 变成 2376×3972，快捷键卡多一个收起的“Shortcut rotation: 5 of 5 selected”。各行等高后不再需要分段裁切：商店截图 4 改成整块 `648,334,1120,316`（DuckDuckGo 到 Kagi 四行），顶部宣传图的 02 卡片改成整块 `640,334,678,158`（DuckDuckGo、Bing 两行），重新渲染后这两张图里的引擎行变矮、卡片随之变矮，渲染器没有报溢出。

v0.5（2026-10-27，按关键词换右侧，设计见 `docs/superpowers/specs/2026-10-27-v0.5-keyword-routing-design.md`）：默认组合卡末尾多了收起的“Keyword rules for the right side”折叠区。用同一个脚本、同一套环境和状态（私有 Xvfb :131、Chrome 156.0.8078.47、全新临时配置、五个预置引擎在授权框里点“允许”、没有 `setupDone`）重拍了三张，扩展是 2f6faa6（v0.5.0）的 `src/`，只换了 `options-fullpage.png`：变成 2376×4041，默认组合卡里窄窗口复选框和说明之后多一行收起的规则区。`options-top.png` 的画面截到默认组合卡的左右窗格为止，规则区不在其中，新拍的与上一版只差右边滚动条滑块，保留上一版；`options-engines.png` 的引擎卡在 v0.5 没变，新拍的只有文字抗锯齿和不到 1 CSS 像素的滚动位置差，保留上一版。`--locale en` 重新渲染后商店图和 README 图逐字节不变（它们不用整页图）。

v0.6（2026-10-27，设置页分 tab 与宽度统一，设计见 `docs/superpowers/specs/2026-10-27-options-tabs-design.md`）：设置页分成 Add to Chrome、Search pairs、Search engines、Right-click lookup 四个 tab，内容列从 780px 改成 680px，规则区成了“Search pairs”里默认展开的卡片。三张都重拍：私有 Xvfb :131（2400×1500）、Chrome 156.0.8078.47（`/opt/google/chrome/google-chrome`，包装脚本缩放 1.5）、`--lang=en-US`、`LANGUAGE=en_US:en`、`--disable-features=Translate` 加 Preferences 的 `translate.enabled: false`、一次性临时配置（拍完删除）、字体配置同 e2e 的 `launch()`，扩展经 CDP `Extensions.loadUnpacked` 装 c8cda28 的 `src/`；`uiLocale: "en"`，默认组合 DuckDuckGo ｜ Bing，顺序 DuckDuckGo、Bing、Google、Kagi、Perplexity，五个预置引擎在授权框里点“允许”。状态与前几次不同：`storage.local` 写了 `setupDone: true`，所以默认打开的 tab 不是“开始使用”，三张都按 hash 打开指定 tab（`#tab-pair`、`#tab-engines`、`#tab-add`）。`options-top.png` 改拍“Search pairs”tab 的首屏，画面里是默认组合卡和规则卡的开头（整卡都在一屏里）；`options-engines.png` 的引擎卡上缘在原图 y 309（页面太矮，滚到底也只比视口高约 69 CSS 像素，到不了上一版的“卡片上缘在视口顶下约 8 CSS 像素”），行分隔线变成 y 468、547、626、705、784，行左缘从 659 移到 710；`options-fullpage.png` 只有“Add to Chrome”一个 tab，变成 2376×1391。裁切随之改：商店截图 4 从 `648,334,1120,316` 改成 `699,469,1018,315`（左缘仍比行左缘少 11px，右边按卡片右缘外多留 19px 收窄），顶部宣传图的 02 卡片从 `640,334,678,158` 改成 `692,469,678,157`（见 `assets/templates-v2/README.md`）。`node scripts/store/render-assets.mjs --locale en` 重新渲染后只有商店截图 4 和顶部宣传图变了，渲染器没有报溢出或超行，引擎行完整。

每张都逐一看过：没有中文、没有账号头像（右上角是未登录的默认图标）、没有 Kagi 或其他网站的令牌、IP 和浏览历史。网页内容是网站当时实际返回的结果，没有改过。
