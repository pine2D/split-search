# Split Search

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [Español](README.es.md)

在地址栏搜索，或把文字拖到标签栏，Split Search 会用 Chrome 拆分视图左右打开两个搜索引擎的结果，方便对比。

![Chrome 拆分视图中，左侧 DuckDuckGo、右侧 Bing 同时显示“rust programming”的搜索结果](assets/readme/hero.png)

## 功能

- 地址栏搜索、拖拽文字到标签栏都能左右对比；引擎可以自选、自己添加，也可以设多组，各用一个快捷字词
- 右键选中的文字或图片，可以在当前网页旁边查词、以图搜图
- 点工具栏按钮，把右侧换成别的引擎，不用重新搜索
- 右侧引擎可以按关键词自动换，例如搜索里有“视频”时换成 YouTube

## 安装

需要 Chrome 155 或更高版本。

**[从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/Split%20Search/ebefmgpipceocigodihbbbhdiagmjdak)**

手动安装：

1. 在 [Releases](https://github.com/pine2D/split-search/releases/latest) 下载 `split-search-<版本>.zip` 并解压。
2. 打开 `chrome://extensions`，开启右上角的“开发者模式”，点“加载未打包的扩展程序”，选择解压出的文件夹。
3. 安装后会自动打开设置页。

更新时把新版本解压到同一个文件夹，再点扩展卡片上的“重新加载”。换了文件夹会被当成另一个扩展，原来的设置不会带过去。

## 设置

第一次打开设置页时，“添加到 Chrome”里的“开始使用”卡会一步步带你完成下面的设置，做完还能当场试一下。

1. **授权**：在设置页的“搜索引擎”里给要用的搜索引擎点“授权”。
2. **复制网址**：在“搜索组合”里选好默认组合的左右两个引擎，再到“添加到 Chrome”复制生成的网址。
3. **添加并设为默认**：在地址栏打开 `chrome://settings/searchEngines`，在“网站搜索”旁点“添加”。名称随意，快捷字词自定（例如 `gb`），“网址格式”一栏粘贴刚复制的网址，再点“添加”。然后在这一条右侧的 ⋮ 菜单里选“设为默认选项”。

## 须知

- 设为默认后，地址栏不再显示搜索联想。
- 在无痕式窗口或其他设备上，就是一次普通搜索。

## 隐私

你查的内容只发给你选的搜索引擎，不发给开发者或其他第三方。扩展没有服务器，不含统计和广告。扩展在本机读取搜索网址和当前标签页的网址来打开拆分视图，不保存这些网址；只有你用它的右键菜单时，才读取选中的文字或图片网址。查询记录只暂存在浏览器内存里，关闭浏览器即清除。详见[隐私政策](https://pine2d.github.io/split-search/privacy.zh-CN.html)。
