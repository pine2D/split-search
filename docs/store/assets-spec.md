# 图片素材规格与清单

> 状态：草稿，待审。规格摘自 Chrome 开发者文档《Supplying images》和《Complete your listing information》（developer.chrome.com/docs/webstore/images、…/cws-dashboard-listing，2026-10-24 查阅）。上传前请再对一遍控制台的实时提示。

## 1. Chrome 网上应用店图片要求

| 素材 | 尺寸 | 格式 | 数量 | 是否必需 | 要点 |
|---|---|---|---|---|---|
| 商店图标 | 128×128 | PNG | 1 | 必需 | 图案 96×96，四周各留 16px 透明边。圆形图案直径约 112px，近方形图案约占宽度的 75–80%。不加外框，不加大投影（商店界面会自己加）；深色图案加一圈白色外发光，保证深色背景上可见。正面朝向，不用夸张透视。没有透明通道的图会被放进 12px 圆角框。同一个文件要打进扩展包，并在 manifest 的 `icons` 中声明 |
| 截图 | 1280×800（首选）或 640×400 | PNG 或 JPEG | 1–5 | 至少 1 张 | 建议放满 5 张。直角、无留白（满版）。建议导出为不带透明通道的 PNG 或 JPEG，避免透明区域在商店里显示异常。可按语言分别上传（前提是扩展有 `_locales`，见 `listing.en.md`） |
| 小宣传图 | 440×280 | PNG 或 JPEG | 1 | 控制台标为可选，按必做处理 | 没有它的条目排在有它的条目之后。少用文字；缩到一半大小仍要看得清；用饱和色，少用大面积白色和浅灰；铺满画面，边缘清晰。不能按语言区分 |
| 顶部宣传图（marquee） | 1400×560 | PNG 或 JPEG | 1 | 可选 | 只有被商店选作首页推荐时才会用到。要求同小宣传图，不能按语言区分 |
| 宣传视频 | — | YouTube 链接 | 1 | 可选 | 可按语言区分 |

另外，manifest 目前**没有 `icons` 字段**。上架前要在 `src/` 中加入 16、32、48、128 四个尺寸的图标，并在 `icons` 和 `action.default_icon` 中声明（16/32 用于工具栏，48 用于扩展管理页，128 用于安装对话框和商店）。这一步要改 manifest，需要另行确认。

## 2. 商店图片与 README 图片的区别

| | 商店图片（CWS） | README 图片（GitHub） |
|---|---|---|
| 看的人与时机 | 在商店搜索结果或详情页里扫一眼、决定要不要点进去和安装的人 | 已经点进仓库、想弄懂它怎么工作、怎么装的人 |
| 展示位置 | 搜索结果和分类页的缩略卡片（小宣传图、图标），详情页的截图轮播 | 正文内嵌，内容区宽约 880px，可点开看原图 |
| 尺寸 | 固定像素，不符合就无法上传 | 自由；按显示宽度 880px 的 2 倍导出（约 1760px 宽），保证高分屏清晰 |
| 文字量 | 尽量少；宣传图基本不放字，截图只配一行短标题 | 可以多：带标注的截图、流程图、步骤编号都合适 |
| 动画 | 不支持，只能是静态图（动态内容放 YouTube 视频） | 可以用 GIF（或 WebP 动图）演示拖拽和地址栏操作；控制在几 MB 内，循环短 |
| 明暗主题 | 商店页是浅色为主，按一套设计即可 | GitHub 有浅色和深色主题：用 `<picture>` 加 `prefers-color-scheme` 提供两套，或使用在两种背景上都清楚的透明底图 |
| 本地化 | 截图可按语言分别上传，宣传图不行 | 跟着 README 的语言走（当前为简体中文） |
| 可访问性 | 控制台不提供替代文字字段，信息要在详细说明里写全 | 每张图都写 `alt`，说清图里在演示什么 |
| 目的 | 营销：一眼看出“两个引擎、左右分屏” | 说明：讲清机制、设置步骤和降级行为 |

## 3. 计划文件清单

文件名是计划，制作时可以调整，但请同步更新本表。

### 商店（`docs/store/assets/`，图标除外）

| 文件 | 尺寸 | 内容 |
|---|---|---|
| `src/icons/icon-16.png`、`icon-32.png`、`icon-48.png`、`icon-128.png` | 16/32/48/128 | 扩展图标（候选方案选定后导出）；128 版同时作为商店图标 |
| `docs/store/assets/screenshot-1-split.png` | 1280×800 | 主图：Google ｜ Bing 原生分屏的结果页，顶部一行标题“一次搜索，两个引擎左右对比” |
| `docs/store/assets/screenshot-2-omnibox.png` | 1280×800 | 地址栏输入关键词（或“快捷字词 + 空格 + 关键词”）即将回车的瞬间 |
| `docs/store/assets/screenshot-3-drag.png` | 1280×800 | 选中网页文字拖到标签栏 |
| `docs/store/assets/screenshot-4-options.png` | 1280×800 | 设置页：默认组合、触发网址卡片、引擎列表和授权状态 |
| `docs/store/assets/screenshot-5-site-search.png` | 1280×800 | `chrome://settings/searchEngines` 中添加网站搜索、设为默认 |
| `docs/store/assets/promo-small-440x280.png` | 440×280 | 图标加左右分屏的抽象图形，不放字或只放产品名 |
| `docs/store/assets/promo-marquee-1400x560.png` | 1400×560 | 可选：与小宣传图同一视觉，横向展开 |

截图中出现的引擎结果页使用真实页面截图时，注意不要露出账号头像、个人信息或个性化推荐；搜索词选中性词语。

### README（`docs/images/`）

| 文件 | 建议尺寸 | 内容与 alt 草稿 |
|---|---|---|
| `docs/images/readme-hero-light.png` / `readme-hero-dark.png` | 1760×约 1000 | 浏览器窗口中两个引擎左右分屏的效果图。alt：“在 Chrome 原生分屏中，左侧 Google、右侧 Bing 同时显示同一关键词的搜索结果” |
| `docs/images/demo-drag.gif` | 宽 880–1280，几秒循环 | 拖拽文字到标签栏后打开分屏的过程。alt：“把选中的文字拖到标签栏，自动打开左右分屏” |
| `docs/images/how-it-works-light.svg` / `how-it-works-dark.svg` | 矢量 | 流程图：地址栏或拖拽 → 触发网址（左侧真实搜索网址 + `_ss`）→ 扩展重定向到 go.html → 左右分屏；另一条支线：其他设备或无痕窗口 → 普通左侧搜索。alt 用一句话复述流程 |
| `docs/images/setup-steps-light.png` / `setup-steps-dark.png` | 1760 宽 | 带编号标注的设置页截图，对应 README“三步上手”的授权、复制触发网址、添加网站搜索。alt：“设置页上的三个步骤：授权引擎、复制触发网址、添加到 Chrome 网站搜索” |

README 中的写法示例：

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme-hero-dark.png">
  <img src="docs/images/readme-hero-light.png" width="880"
       alt="在 Chrome 原生分屏中，左侧 Google、右侧 Bing 同时显示同一关键词的搜索结果">
</picture>
```
