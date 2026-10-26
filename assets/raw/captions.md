# 原始截图说明

这些是真实截图，用于合成商店截图和 README 配图，只做裁剪、缩放和外框处理，不改动画面内容；唯一例外是下面“修补”一节列出的一处。合成模板在 `assets/templates/`，渲染脚本是 `scripts/store/render-assets.mjs`。

## 拍摄环境

- Google Chrome 155.0.8059.84（Linux），界面语言 zh-CN；独立 Xvfb 屏幕 2400×1500，包装脚本固定缩放 1.5，所以窗口是 1600×1000 CSS 像素。
- 全新的临时配置，带 `--disable-sync`，没有登录 Chrome 账号，也没有登录任何网站。拍完已删除。
- 扩展从本仓库 `src/` 用 CDP `Extensions.loadUnpacked` 加载，版本 0.1.0。
- 用 `import -window root` 截取整个屏幕，包括标签栏和分屏。Xvfb 截图里没有鼠标指针。
- 除 `options-fullpage.png` 外，其余都是 2400×1500 的整窗截图。

## 设置页的状态

- 默认组合：DuckDuckGo ｜ Bing。
- 引擎排序：DuckDuckGo、Bing、Google、Kagi、Perplexity。
- 授权：只授权了 `https://duckduckgo.com/*` 和 `https://www.bing.com/*`，是在设置页点“点此授权”后，在 Chrome 授权框里点“允许”授予的。
- 拍完设置页之后，又添加了一个自定义引擎“百度”（id `baidu`，`https://www.baidu.com/s?wd=%s`），百度没有授权。`options-*.png` 是添加百度之前拍的，所以里面没有百度。

## 截图清单

| 文件 | 尺寸 | 内容 |
|---|---|---|
| `options-top.png` | 2400×1500 | 设置页首屏：标题、默认组合（DuckDuckGo ｜ Bing）、“添加到 Chrome”卡片里的触发网址 `https://duckduckgo.com/?q=%s&_ss=ddg,bing`、其他组合、设置步骤开头。 |
| `options-engines.png` | 2400×1500 | 设置页滚动到“搜索引擎”一节：DuckDuckGo 和 Bing 标着“已授权”和“默认左侧/默认右侧”，Google、Kagi、Perplexity 标着“未授权”。 |
| `options-fullpage.png` | 2378×2876 | 设置页整页，用 CDP `Page.captureScreenshot` 拍，只有页面内容、不含浏览器界面。状态和上面两张相同。 |
| `permission-prompt.png` | 2400×1500 | 设置页点“点此授权 DuckDuckGo（必需）和 Bing（建议）”后弹出的 Chrome 授权框，内容是“读取和更改您在 duckduckgo.com 和 www.bing.com 上的数据”。这时默认组合已经改成 DuckDuckGo ｜ Bing，但还没授权，所以页面上有黄色提示。 |
| `split-ddg-bing-rust.png` | 2400×1500 | 原生分屏：左边是 DuckDuckGo，右边是 Bing，查询词“rust programming”。新开一个标签访问触发网址 `https://duckduckgo.com/?q=rust+programming&_ss=ddg,bing`，由扩展的 DNR 规则和 go.html 建成分屏，和真实使用的路径相同。页面缩放 100%。两个网页在约 800 CSS 像素宽的窗格里都有横向滚动条，这是两个网站本身的问题。 |
| `split-ddg-baidu-weather.png` | 2400×1500 | 原生分屏：左边是 DuckDuckGo，右边是百度（自定义引擎），查询词“北京 天气”。在已有的扩展分屏左侧访问触发网址 `…&_ss=ddg,baidu`，扩展在原分屏里直接更新两侧。 |
| `drag-to-tabstrip.png` | 2400×1500 | 拖拽过程中：在中文维基百科“Rust (编程语言)”页面选中正文里的“Graydon Hoare”，用 xdotool 真实按下鼠标，把选中的文字拖到标签栏空白处，在还没松手时截图。可以看到标签栏上方的拖拽影像“Graydon Hoare”；第一个标签右下方还有一个黑底白色“↑”方块，应该是 Chrome 的标签插入位置箭头，Xvfb 没有合成器，它的透明背景变成了黑色（合成时已盖掉，见“修补”）。拍之前用页面自带的关闭按钮关掉了维基百科的活动横幅。 |
| `drag-result-split.png` | 2400×1500 | 上一张松手之后的结果：Chrome 用默认搜索引擎打开新标签，扩展把它变成分屏，左边 DuckDuckGo、右边百度，查询词“Graydon Hoare”。 |
| `omnibox-suggest.png` | 2400×1500 | 在分屏左侧的地址栏输入“rust ownership”，下拉建议显示“rust ownership - DuckDuckGo ｜ 百度 搜索”。这是 Chrome 用默认搜索引擎（触发网址做成的网站搜索）给出的建议。 |
| `omnibox-result-split.png` | 2400×1500 | 上一张按回车后的结果：扩展在原分屏里更新两侧，左边 DuckDuckGo、右边百度，查询词“rust ownership”。 |

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

拖拽和地址栏两组截图需要把触发网址设成 Chrome 默认搜索引擎。做法是用 e2e 脚本的 `settings-se.mjs` 操作 `chrome://settings/searchEngines`，添加网站搜索“DuckDuckGo ｜ 百度”，网址 `https://duckduckgo.com/?q=%s&_ss=ddg,baidu`，快捷字词是脚本专用的 `sse2e`，再设为默认。这和设置页引导用户手动做的步骤效果相同，只是快捷字词不一样；快捷字词不出现在任何截图里。

## 已知限制（以后补拍时注意）

- 这台机器上 Bing 对中文查询会弹出人机验证（“最后一步 / 请验证您是真人”），所以中文场景的右侧换成了百度。补拍时，中文查询不要用 Bing 作右侧。
- 截图里引擎页面的内容（DuckDuckGo 的 Search Assist、百度的 AI 摘要、“大家还在搜”等）都是网站当时实际返回的结果，没有改过。
- 横向滚动条是 Linux 版 Chrome 的普通滚动条。Windows 上的效果以实拍为准。

## 英文截图（en/）

2026-10-24 用户决定宣传截图暂时只做英文。`en/` 是同一套画面的英文版，`render-assets.mjs --locale en` 用它们替换上面的同名图（其他语言仍用上面的中文截图，见 `docs/store/assets-spec.md` 第 4 节）。

拍摄环境（与上面不同之处）：

- Google Chrome 155.0.8059.84（Linux），界面语言英文：启动参数加 `--lang=en-US`、环境变量 `LANGUAGE=en_US:en`。独立 Xvfb 屏幕 2400×1500、缩放 1.5，窗口 1600×1000 CSS 像素，`import -window root` 截整屏，没有鼠标指针。
- 用 e2e 的隔离测试配置 `~/.cache/split-search-e2e/profile`（`--disable-sync`，不登录 Chrome 账号），全程经 `scripts/e2e` 的模块：`display.mjs` 起私有 Xvfb，`browser.mjs` 启动，`ext-source.mjs` 改装本检出（feat/v0.2）的 `src/`，`settings-se.mjs` 加网站搜索并设默认，`xinput.mjs` 真实拖拽和键盘输入，`teardown.mjs` 的恢复步骤收尾：`storage.sync` 读回与快照一致，默认搜索引擎改回运行前的那个、删掉 `sse2e` 条目，扩展改回运行前装自的目录。测试配置的 Accept-Language 是 `en-US,en,zh-CN`，DuckDuckGo 和 Bing 都返回英文页面，没有加 `kl`、`setlang` 之类的参数。
- 扩展版本 0.2（带 c6 正式图标），`storage.sync` 临时写成 `uiLocale: "en"`、默认组合 DuckDuckGo ｜ Bing、引擎排序 DuckDuckGo、Bing、Google、Kagi、Perplexity。测试配置里五个预置引擎都已授权，所以设置页里全部显示“Access granted”。
- 网站搜索：名称 `DuckDuckGo | Bing`（设置页建议的名称）、网址 `https://duckduckgo.com/?q=%s&_ss=ddg,bing`、快捷字词 `sse2e`，设为默认。右侧全部是预置的 Bing，没有百度。

| 文件 | 内容 |
|---|---|
| `en/options-top.png` | 设置页首屏（英文界面，2026-10-27 第四次重拍，见下文“设置页三张的重拍”）：标题、语言下拉框、“Get started”卡（第 1 步“DuckDuckGo: access granted”，第 2 步的三个编号小步：`chrome://settings/searchEngines` 带“Copy address”、触发网址 `https://duckduckgo.com/?q=%s&_ss=ddg,bing` 带“Copy”、在 ⋮ 菜单里选“Make default”，第 3 步“Try it”）、“Default pair”卡开头的左右两个窗格 |
| `en/options-engines.png` | 设置页滚动到“Search engines”卡片，卡片上缘在视口顶下约 8 CSS 像素（原图 y≈143）；五个引擎都是“Access granted”，DuckDuckGo、Bing 带“Default left/Default right”和“默认组合在用，不能隐藏”的说明，说明只占一行；在 x=700 处，行分隔线在原图 y 304、460、616、734、853（2026-10-27 第四次重拍） |
| `en/options-fullpage.png` | 设置页整页（CDP `Page.captureScreenshot`），2376×4343（2026-10-27 第四次重拍） |
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
- 模板裁切随之改了：商店截图 4 是 `648,308,1120,600`，顶部宣传图是 `640,310,678,290`（见 `assets/templates-v2/README.md`）。

第二次重拍（同一天，整体审查后的修正）：“不能隐藏”的说明放宽到一行（`options.css` 的 `.row-reason` 改为 `max-width: 56ch`），引擎卡片和整页随之变矮，所以重拍了这三张。用同一个脚本、同一套环境和状态（私有 Xvfb :131、全新临时配置、五个预置引擎在授权框里点“允许”、没有 `setupDone`），扩展是修正后的工作区。设置页的静态 HTML 这时已改成 `lang="en"`，不会再弹翻译气泡；关掉翻译的参数和 Preferences 仍然照旧加着。`options-top.png` 与上一版只差右边滚动条滑块（页面变矮了），画面内容相同；`options-engines.png` 里 DuckDuckGo、Bing 两行各矮了一行。重新渲染后只有商店截图 4 和顶部宣传图变了；商店截图 4 的裁切只到引擎行的左半边，说明文字在右半边、不在画面里，所以这两行的复选框下面仍有一行高的空白（比上一版少一行）。

第三次重拍（2026-10-26，v0.4.0 打标签前的“开始使用”第 2 步改版）：第 2 步拆成三个编号小步（复制设置地址、粘贴触发网址、设为默认，每步只带自己的复制按钮），只有画面里有这张卡的 `options-top.png` 和 `options-fullpage.png` 换了。同一个脚本、同一套环境和状态（私有 Xvfb :131、全新临时配置、五个预置引擎在授权框里点“允许”、没有 `setupDone`）。`options-fullpage.png` 变成 2376×4637（第 2 步比原来的“说明 + 两个带标签的复制框”矮了一点）。`options-engines.png` 也重拍过对比：内容相同，只有文字抗锯齿的像素差（页面高度变了，滚动位置不同），所以保留上一版不换。商店图和宣传图只用 `options-engines.png`，重新渲染后没有变化。工具栏弹窗不在任何原始截图里，弹窗分屏外的三档不用补拍。

第四次重拍（2026-10-27，v0.4 界面收尾）：没授权的非必需引擎改成中性样式、“开始使用”卡显示时“添加到 Chrome”卡里的默认组合一段和“其他组合”收进折叠区、以图搜图列表加了小标题和写明对象的按钮。三张 `en/options-*.png` 都用同一个脚本、同一套环境和状态重拍（私有 Xvfb :131、Chrome 156.0.8078.47、全新临时配置、五个预置引擎在授权框里点“允许”、没有 `setupDone`），扩展是当时 main 上的 `src/`。`options-top.png` 与上一版只差右边滚动条滑块（整页变矮了），画面内容相同；`options-engines.png` 内容相同，滚动位置差约 1 原图像素；`options-fullpage.png` 变成 2376×4343，“添加到 Chrome”卡里是收起的“Trigger URL for the default pair”和“Other pairs”，“右键查询”卡里有“Image search engines”小标题和“Add from image search catalog”“Add image search engine”两个按钮。界面里没授权的引擎都授权了，所以截图里看不到新的中性“未授权”样式。

每张都逐一看过：没有中文、没有账号头像（右上角是未登录的默认图标）、没有 Kagi 或其他网站的令牌、IP 和浏览历史。网页内容是网站当时实际返回的结果，没有改过。
