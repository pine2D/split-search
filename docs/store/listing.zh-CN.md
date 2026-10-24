# 商店详情：简体中文（草稿）

> 状态：草稿，待审。
> 名称和简介不在控制台里填写，由打包上传的 `src/manifest.json` 的 `name` / `description` 决定。详细说明、类别和语言在控制台的“商品详情”页填写。
> 字数按 Unicode 字符计（中文、英文字母、标点、空格各算 1 个）。

## 提交前必做（上架阻塞项）

提交时机：**v0.3 时提交（2026-10-24 用户决定）**，v0.1、v0.2 不提交。提交时带 4 种语言的详情：`en`（默认）、`zh_CN`、`zh_TW`、`es`，见 `docs/superpowers/specs/2026-10-24-i18n-design.md`。

- [ ] `npm run pack -- --smoke` 生成上传包（`dist/split-search-<版本>.zip`）。首次上传不带 key；之后的版本加 `--store-key <商店公钥文件>`。
- [x] manifest 图标：方案 3 形状 + c6 pine-fog 配色，已接入 `src/icons/` 并在 manifest 声明；宣传图已用它重渲（见 `assets-spec.md` 第 1 节）。商店图标上传 `src/icons/icon-128.png`。
- [x] ~~按 4 种语言重拍截图~~ 宣传截图暂时只做英文（2026-10-24 用户决定）：`assets/raw/en/` 已用带新图标的 v0.2 扩展、英文 Chrome 界面重拍，`--locale en` 已重渲（见 `assets-spec.md` 第 4 节）。
- [ ] 上传截图、小宣传图、顶部宣传图时只用 `assets/store/en/`。CWS 对所有语言显示同一组截图，除非为某种语言另行上传本地化截图；其他语言（zh_CN、zh_TW、es）的截图暂不维护，`assets/store/zh_CN|zh_TW|es/` 里仍是中文浏览器界面，不要上传。
- [x] manifest 简介：v0.2 起是各语言的 `ext_description`（`__MSG_ext_description__`），4 种语言已定稿（各 ≤132 字符）。
- [x] 详细说明【使用限制】已把“界面仅提供简体中文”改为一句“设置页可以切换语言”；`listing.en.md` 的两处同改。
- [x] `listing.en.md`、`listing.zh-TW.md`、`listing.es.md` 已按精炼版中文写好（2026-10-24 用户确认）。
- [x] 隐私政策已托管（2026-10-24）：公开仓库 `pine2D/split-search`，GitHub Pages 发布 main 分支的 `/docs`；`https://pine2d.github.io/split-search/privacy`、`…/privacy.zh-CN.html` 和仓库 Issues 页均已确认可访问，内部文档（superpowers、store、验收文档）返回 404。
- [ ] 上架后在 `docs/index.md` 末尾加商店链接（`[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/<商店 ID>)`）。
- [ ] 隐私做法标签页：数据使用披露**一项都不勾（含“网页浏览记录”）**，并附上 `privacy.md` (d) 的英文审核说明。
- [x] 面向用户的文案统一润色：zh-CN 的简介和详细说明已过 lieflat-less-ai-tone 和 humanizer-zh（2026-10-24）。其他语言按 CLAUDE.md“文案”一节各自润色。

## 名称（上限 75）

```text
Split Search
```

字数：12 / 75

已定（2026-10-24 用户决定）：所有语言都叫 Split Search，商店名称不加本地副标题。改名需要同时改 manifest，`test/manifest.test.js` 也断言了 `name === "Split Search"`。

## 简介（上限 132）

**采用（已过 lieflat-less-ai-tone 和 humanizer-zh，待用户审定）**：

```text
在地址栏搜索，或把文字拖到标签栏，用两个搜索引擎打开 Chrome 拆分视图，左右对比结果。
```

字数：46 / 132

商店简介由 manifest 决定。v0.2 起 `src/manifest.json` 的 `description` 是 `__MSG_ext_description__`，zh_CN 的 `ext_description` 已改成上面这句（原为“地址栏或拖拽搜索，一键用两个搜索引擎打开原生分屏对比”，26 字）。

## 详细说明

```text
在地址栏搜索，或把选中的文字拖到标签栏，Split Search 会用 Chrome 拆分视图左右打开两个搜索引擎的结果，方便对比。

【功能】
• 地址栏搜索、拖拽文字到标签栏、右键“使用X搜索‘…’”都能用
• 预置 Google、Bing、DuckDuckGo、Perplexity、Kagi，也可以添加其他搜索引擎
• 可以设多组引擎，各用一个快捷字词，例如输入“gb 关键词”对比 Google 和 Bing
• 两侧都是普通标签页，登录状态和网站设置照常

【设置】
1. 在设置页给要用的搜索引擎授权
2. 选好左右两个引擎，复制生成的网址
3. 在 Chrome 设置的“网站搜索”里添加这个网址，并设为默认选项
设置页里有逐步说明。

【须知】
• 需要 Chrome 155 或更高版本
• 在无痕式窗口、其他设备上，或扩展没有生效时，就是一次普通搜索
• 设为默认后，地址栏不再显示搜索联想

【隐私】
不收集任何数据：没有服务器，不含统计和广告。搜索词只发给你选的两个搜索引擎。扩展只在本机读取你这次搜索的网址和拆分视图另一侧标签页的网址，用来打开拆分视图，不保存，也不读取浏览记录和网页内容。
```

字数：509（含换行）

措辞说明：

- 右键“使用X搜索‘…’”指 Chrome 自带的菜单项，扩展自身没有右键菜单。它和拖拽到标签栏都只走默认搜索引擎，所以【设置】第 3 步要求设为默认选项。
- 实现细节（触发网址的 `_ss` 参数、授权不随同步、Service Worker 退化等）不写进详情，留给设置页的逐步说明和内部文档（CLAUDE.md“文案”一节）。
- 不写“一键”“最好用”等评价性词语，也不提其他扩展，避免触及关键词堆砌和误导性宣传条款。
- 【隐私】段与 `privacy.md` 一致：说“不收集”，同时写明本机读取了什么；不说“不处理任何数据”。数据使用披露不勾选任何类别（含“网页浏览记录”），这一段是对此的公开说明，不要删减。

## 类别

- 主类别建议：**工具（Tools）**。它是通用的浏览器效率工具，用户会在这里找“搜索”类扩展。
- 备选：**功能与界面（Functionality & UI）**。如果更想强调“增强 Chrome 拆分视图”，可以选它。

## 语言

- v0.3 提交时控制台有 4 种语言的详情：英文 `en`（默认语言）、简体中文 `zh-CN`、繁体中文 `zh-TW`、西班牙语 `es`，对应 v0.2 加入扩展包的 `_locales/en|zh_CN|zh_TW|es`。
- 设置页可切换这 4 种语言；扩展简介、工具栏按钮的提示跟随浏览器语言，不随设置页选择。
- 繁体中文和西班牙语详情尚未写（见“提交前必做”的待办）。
