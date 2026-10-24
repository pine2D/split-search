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
