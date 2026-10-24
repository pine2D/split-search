# 图片素材规格与清单

> 状态：定稿，随 v0.2.0 提交（2026-10-24）。规格摘自 Chrome 开发者文档《Supplying images》和《Complete your listing information》（developer.chrome.com/docs/webstore/images、…/cws-dashboard-listing，2026-10-24 查阅）。上传前请再对一遍控制台的实时提示。

## 1. Chrome 网上应用店图片要求

| 素材 | 尺寸 | 格式 | 数量 | 是否必需 | 要点 |
|---|---|---|---|---|---|
| 商店图标 | 128×128 | PNG | 1 | 必需 | 图案 96×96，四周各留 16px 透明边。圆形图案直径约 112px，近方形图案约占宽度的 75–80%。不加外框，不加大投影（商店界面会自己加）；深色图案加一圈白色外发光，保证深色背景上可见。正面朝向，不用夸张透视。没有透明通道的图会被放进 12px 圆角框。同一个文件要打进扩展包，并在 manifest 的 `icons` 中声明 |
| 截图 | 1280×800（首选）或 640×400 | PNG 或 JPEG | 1–5 | 至少 1 张 | 建议放满 5 张。直角、无留白（满版）。建议导出为不带透明通道的 PNG 或 JPEG，避免透明区域在商店里显示异常。可按语言分别上传；没有为某种语言上传本地化截图时，CWS 对所有语言显示同一组截图。**暂时只做英文一套**（2026-10-24 用户决定，见第 4 节） |
| 小宣传图 | 440×280 | PNG 或 JPEG | 1 | 控制台标为可选，按必做处理 | 没有它的条目排在有它的条目之后。少用文字；缩到一半大小仍要看得清；用饱和色，少用大面积白色和浅灰；铺满画面，边缘清晰。不能按语言区分 |
| 顶部宣传图（marquee） | 1400×560 | PNG 或 JPEG | 1 | 可选 | 只有被商店选作首页推荐时才会用到。要求同小宣传图，不能按语言区分 |
| 宣传视频 | — | YouTube 链接 | 1 | 可选 | 可按语言区分 |

### 选定图标：c6 松针绿（2026-10-24）

- 形状沿用方案 3（两块实心圆角窗格 + 白色搜索框横条），配色 c6 “pine-fog”：左格松针绿 `#507665`，右格暖雾灰 `#8C8881`。对比度等数据见 `notes.md`。
- 来源：`assets/icon-proposals/v3-colors/c6-pine-fog/`（`icon.svg` 是 128 母版，16/32 是按像素网格调整的版本）。`assets/icon-proposals/` 其余方案留作历史。
- 接入：`src/icons/icon-{16,32,48,128}.png`，在 manifest 的 `icons`（16/32/48/128）和 `action.default_icon`（16/32）中声明；`test/manifest.test.js` 核对文件存在且 PNG 尺寸与声明一致。`render-assets.mjs` 的默认图标已改为 c6 的 `icon.svg`，小宣传图、顶部宣传图和 README 首图已用它重渲。
- ~~提交前必做~~ 已解决（2026-10-24）：上架只用英文图，`assets/raw/en/` 已用带新图标的 v0.2 扩展重拍、`assets/store/en/` 已重渲；下面说的旧问题只留在不上传的 zh_CN/zh_TW/es 套图里。原记录：`assets/raw/` 的共用真实截图是装上图标之前拍的，设置页标签页的图标是 Chrome 生成的灰底字母“S”，地址栏扩展标识和授权框里是默认拼图图标。凡是画面里带“Split Search 设置”标签页、设置页地址栏或授权框的图都受影响（至少 `screenshot-1`、`screenshot-4`、marquee 和 README 首图）。~~上架前要用带新图标的扩展重拍~~ 英文已重拍（2026-10-24）：`assets/raw/en/` 用带 c6 图标的 v0.2 扩展拍摄，`--locale en` 的图片都用它，见第 4 节。其他语言的截图暂不维护，不重拍。
- ~~提交前待定：宣传图紫色渐变与橙色标注和 c6 不成一套~~ 已解决（2026-10-24）：定稿方向 d1「纸白 · 精排」，强调色就是图标左格的松针绿 `#507665`，见第 4 节。

## 2. 商店图片与 README 图片的区别

| | 商店图片（CWS） | README 图片（GitHub） |
|---|---|---|
| 看的人与时机 | 在商店搜索结果或详情页里扫一眼、决定要不要点进去和安装的人 | 已经点进仓库、想弄懂它怎么工作、怎么装的人 |
| 展示位置 | 搜索结果和分类页的缩略卡片（小宣传图、图标），详情页的截图轮播 | 正文内嵌，内容区宽约 880px，可点开看原图 |
| 尺寸 | 固定像素，不符合就无法上传 | 自由；按显示宽度 880px 的 2 倍导出（约 1760px 宽），保证高分屏清晰 |
| 文字量 | 尽量少；宣传图基本不放字，截图只配一行短标题 | 可以多：带标注的截图、流程图、步骤编号都合适 |
| 动画 | 不支持，只能是静态图（动态内容放 YouTube 视频） | 可以用 GIF（或 WebP 动图）演示拖拽和地址栏操作；控制在几 MB 内，循环短 |
| 明暗主题 | 商店页是浅色为主，按一套设计即可 | GitHub 有浅色和深色主题：用 `<picture>` 加 `prefers-color-scheme` 提供两套，或使用在两种背景上都清楚的透明底图 |
| 本地化 | 截图可按语言分别上传，宣传图不行；目前只维护英文截图（第 4 节） | 跟着 README 的语言走（当前为简体中文） |
| 可访问性 | 控制台不提供替代文字字段，信息要在详细说明里写全 | 每张图都写 `alt`，说清图里在演示什么 |
| 目的 | 营销：一眼看出“两个引擎、拆分视图” | 说明：讲清机制、设置步骤和降级行为 |

## 3. 文件清单（已生成）

全部图片由 `assets/templates/*.html` 经 `node scripts/store/render-assets.mjs` 渲染，画面里的浏览器和网页都是 `assets/raw/` 中的真实截图（见 `assets/raw/captions.md`），模板只做裁切、缩放、外框和标注。`en` 用 `assets/raw/en/` 的英文截图（英文 Chrome、英文扩展界面、右侧 Bing），其他语言用 `assets/raw/` 根下共用的中文截图。输出是不带透明通道的 PNG。

图标默认用选定的 c6（见第 1 节）。要试别的图标时：

```bash
node scripts/store/render-assets.mjs --icon assets/icon-proposals/<方案目录>/icon.svg
```

用到图标的是小宣传图、顶部宣传图（放在纸白圆角底板上）和 README 首图（直接放在纸底上）。d1 模板没有 `.tile` 白底板，`--no-tile` 对它不起作用。

### 商店（`assets/store/<locale>/`，现有 `zh_CN/`、`en/`、`zh_TW/`、`es/`）

| 文件 | 尺寸 | 模板 | 内容 |
|---|---|---|---|
| `screenshot-1.png` | 1280×800 | `store-1-split` | “一次搜索，两个引擎左右对比”：DuckDuckGo ｜ Bing（预置组合）拆分视图整窗 |
| `screenshot-2.png` | 1280×800 | `store-2-omnibox` | “地址栏照常搜索，回车就打开拆分视图”：上方是输入“rust ownership”时的下拉建议（只取下拉框，框出“DuckDuckGo ｜ 百度 搜索”），下方是回车后的拆分视图整窗（同一查询词）；右下角注明“百度”为自行添加的引擎 |
| `screenshot-3.png` | 1280×800 | `store-3-drag` | “选中文字，拖到标签栏”（副标题写明前提“触发网址设为默认后”）：拖拽中的真实画面加箭头，右下角小图是松手后的拆分视图；Xvfb 下黑底的插入箭头用修补图盖掉（见 `assets/raw/captions.md`“修补”） |
| `screenshot-4.png` | 1280×800 | `store-4-engines` | “引擎自己选，组合随意配”：设置页的引擎列表，叠一张放大到约 0.67 的“添加到 Chrome”默认组合块（触发网址 + 复制） |
| `screenshot-5.png` | 1280×800 | `store-5-fallback` | “其他设备与无痕窗口：自动退化为普通搜索”：同一个触发网址，装了扩展是拆分视图，没生效时是普通 DuckDuckGo 结果页（左图只取两个窗格上半部分，缩放约 0.31；右图只取网页区域，约 0.51） |
| `small-promo-440x280.png` | 440×280 | `promo-small` | 图标、产品名、“双引擎拆分视图搜索” |
| `marquee-1400x560.png` | 1400×560 | `promo-marquee` | 图标、产品名、“一次搜索 两个引擎左右对比”，右侧 DuckDuckGo ｜ Bing 拆分视图截图出血 |

商店图标 128×128 直接上传 `src/icons/icon-128.png`。

### README（`assets/readme/`；zh_CN 在根下，其他语言在 `assets/readme/<locale>/`）

| 文件 | 尺寸 | 模板 | 内容 |
|---|---|---|---|
| `hero.png` | 1760×880（显示 880 宽） | `readme-hero` | 一句话价值主张加 DuckDuckGo ｜ Bing 拆分视图截图。整张不透明的紫色底，GitHub 浅色和深色主题下都是一张完整卡片，所以不需要 `<picture>` 两套 |
| `how-it-works.png` | 1760×760（显示 880 宽） | `readme-how-it-works` | 地址栏或拖拽 → 触发网址（真实搜索网址 + `_ss`）→ Chrome 拆分视图，下方是“扩展未生效时”的降级支线。浅色不透明底 |

演示 GIF 暂缺：`assets/raw/` 里拖拽流程只有“拖拽中”和“松手后”两张静态图，没有连续帧，拼成 GIF 只是幻灯片，所以没有做。以后要做，先用屏幕录制拍下真实的拖拽过程，再用 ffmpeg（palettegen）转成 3 MB 以内的 GIF，放在 `assets/readme/demo.gif`。

## 4. 定稿方向 d1 与多语言出图（2026-10-24）

- **定稿方向**：d1「纸白 · 精排」。`assets/templates/` 就是 d1 模板（原 `assets/templates-d1-paper/`），设计说明在 `assets/templates/README.md`；三个备选方向和当时的渲染图留在 `assets/proposals/` 作历史。第 3 节表格“内容”一栏里的部分描述（紫色底、右下角脚注、截图 4 的叠加卡片等）是 d1 之前的版本，以 `assets/templates/README.md` 和实际图片为准。
- **多语言出图**：画面文字在 `assets/templates/i18n/<locale>.json`（`zh_CN` 是源语言，键集合由 `test/store-i18n.test.js` 检查）。

  ```bash
  node scripts/store/render-assets.mjs --locale zh_CN   # 默认；商店图 → assets/store/zh_CN/，README 图 → assets/readme/
  node scripts/store/render-assets.mjs --locale en      # → assets/store/en/、assets/readme/en/（zh_TW、es 同理）
  node scripts/store/render-assets.mjs --locale all     # i18n/ 里有 json 的全部语言
  ```

  四种语言都已出图（2026-10-24），每种 9 张：商店 7 张（截图 1–5、小宣传图、顶部宣传图）+ README 2 张（`hero.png`、`how-it-works.png`）。只有 `en` 的画面是英文截图（见下面“宣传截图暂时只做英文”），其他语言的图片里浏览器和网页仍是中文。

  | 语言 | 文案 | 商店图 | README 图 | 说明 |
  |---|---|---|---|---|
  | `zh_CN` | `i18n/zh_CN.json` | `assets/store/zh_CN/` | `assets/readme/` | 源语言 |
  | `en` | `i18n/en.json` | `assets/store/en/` | `assets/readme/en/` | 全球英文、美式拼写，sentence case |
  | `zh_TW` | `i18n/zh_TW.json` | `assets/store/zh_TW/` | `assets/readme/zh_TW/` | 台湾用语、繁体，术语照 Chrome zh-TW |
  | `es` | `i18n/es.json` + `i18n/es.css` | `assets/store/es/` | `assets/readme/es/` | 中性国际西语（tú）；`es.css` 把 marquee 标题降到 46px、小宣传图标签降到 20px |

  四种语言并排对照：`assets/proposals/locales-compare.png`（源文件 `locales-compare.html`，无头 Chrome 宽 1800 整页截图；图片改了要重截）。共用模板与 `base.css` 没有为译文改动，zh_CN 重渲后与提交的图逐字节一致。
- **宣传截图暂时只做英文（2026-10-24 用户决定）**：取代原来“4 种语言都要重拍真实截图”的计划。
  - `assets/raw/en/` 是英文的真实截图（拍法见 `assets/raw/captions.md`“英文截图”）：英文 Chrome 界面（`--lang=en-US`）、扩展界面语言 `en`、c6 正式图标、英文结果页，右侧全部是预置的 Bing，没有百度。`render-assets.mjs` 渲染某种语言时，`assets/raw/<语言>/` 里有同名截图就用它，没有就用 `assets/raw/` 根下共用的；画面位置不同的地方，模板用 `data-crop-en`、`data-box-en`、`data-d-en`、`data-text-en` 写英文截图的坐标和网址（`crop.js`）。目前只有 `en` 有自己的截图。
  - 上传：截图、小宣传图、顶部宣传图都用 `assets/store/en/`。CWS 对所有语言显示同一组截图，除非为某种语言另行上传本地化截图；这次不上传其他语言的截图。
  - 其他语言（zh_CN、zh_TW、es）的截图暂不维护：`assets/store/zh_CN|zh_TW|es/` 的画面仍是中文 Chrome、旧字母图标、右侧百度，不要上传。以后要做，再按 `en` 的办法为该语言拍 `assets/raw/<语言>/` 并补对应的 `data-*-<语言>` 坐标。
- **宣传图不能按语言区分**：CWS 的小宣传图（440×280）和顶部宣传图（1400×560）全站只有一张，但 d1 的这两张都带一句文案（`small.tag`、`marquee.*`），渲染会每种语言各出一张。i18n 方案第 11 节写的是“宣传图不分语言，图上尽量不放文字，必须放就只放英文产品名”。按上一条的决定上传 `en` 版本（与 `default_locale` 一致）；要完全不带文案，还得另做一版。

## Review fixes（2026-10-24）

按评审意见做的修改。图片都已用 `render-assets.mjs` / `build.mjs` 重新渲染。

已改：

1. **“手动建的分屏不会被覆盖”说得太绝对**：中英详细说明第 4 条改为“另一侧不是搜索引擎页面的分屏不会被改动”（英文 “splits whose other tab isn't one of your search engines are left untouched”），并在措辞说明里注明依据 `split-decision.js`。
2. **拖拽 / 右键只走默认搜索引擎**：中英【三步设置】第 3 步改为“设为默认后地址栏、拖拽、右键都会分屏；不设默认时只有快捷字词会分屏”；`privacy.md` 单一用途改为 “…and Chrome navigates to a trigger URL the user added as a site search (as default search engine or via its keyword)…”；`how-it-works.png` 第 2 步说明同步改写；`screenshot-3.png` 副标题改为“触发网址设为默认后，松手即用两个引擎打开分屏”。
3. **拖拽截图里的黑底“↑”方块**：它应该是 Chrome 的标签插入位置箭头，Xvfb 没有合成器，透明背景变成了黑色。新增修补图 `assets/raw/patches/drag-to-tabstrip-397-61.png`，`store-3-drag` 用 `<img class="patch">` 叠加（`crop.js` 支持 `.patch[data-box]`），被挡的“/wi”上半用同图像素补齐，原图不动；做法和命令写在 `captions.md`。`how-it-works.png` 改为局部裁切后不再包含这块区域。
4. **v3 / v5 在 16px 下撞车**：v3 的 16px 每格加 1px 白色横条（搜索框）；v5 的 16px 改为每块 6×10、错开 4px、对角圆角 5。对比图每行加了一条“16px 下长什么样”的说明，并注明宣传图里的图标是占位。
5. **隐私政策概要**与 Web history 披露矛盾：中英概要改为“只在你的设备上处理完成功能所需的数据，不发送给开发者或第三方，也不出售”。（这一条对应的“勾选 Web history”已被 2026-10-24 的决定取代：Web history 不勾，见 `privacy.md` (d)。）
6. **DNR 域名范围**：权限理由和代码事实速查改为“可作左侧的引擎的 hostname（及其子域名）”。
7. **百度不在预置引擎里**：`screenshot-1` 和 marquee 换成预置组合 DuckDuckGo ｜ Bing；`screenshot-2`、`screenshot-3` 仍用百度（中文场景 Bing 会弹人机验证），右下角加注“示例右侧‘百度’为自行添加的引擎”，中英详细说明的引擎条目也加了一句。
8. **manifest 缺 icons**：在 `listing.zh-CN.md` 开头新增“提交前必做”清单（manifest 图标、选定图标后重渲、隐私政策托管）。manifest 本身未改，需要你确认。
9. **v6 放在白色底板上成“板中板”**：`render-assets.mjs` 新增 `--no-tile`，去掉白底板并让图标自带的底板铺满；上文“任何一个方案都能用”的说法已更正。
10. **橙色对比度**：图标提案的橙色从 `#F26B3A` 加深到 `#E0561F`（对 `#f1f3f4` 约 3.4:1，对 `#202124` 约 4.2:1），v3/v4/v5 的 notes 都写明了；v5 的 128 母版仍用橙色渐变（大尺寸不受影响）。
11. **screenshot-2 查询词和结果对不上、比例不一**：改为上方只取地址栏下拉框（0.8 倍），下方放回车后的分屏整窗 `omnibox-result-split.png`（0.5 倍，和截图 1、3 同比例），查询词都是“rust ownership”，用“输入 / 回车后”两个标签串起来。
12. **how-it-works 第 1 步裁切不整齐**：地址栏裁切从下拉框内侧开始（不带分屏按钮和选中条）；拖拽改成两张局部图：“选中的文字”一行和“标签栏落点”，分别放大，中间加“拖到标签栏 ↑”。去掉了会穿过第 2 步说明文字的虚线连接。
13. **hero 底部标签压住网页内容**：截图底部加白色渐隐，标签居中放在各自窗格的渐隐带上。
14. **screenshot-4 第二张卡片字太小 / screenshot-5 两侧缩放差太多**：截图 4 只取“添加到 Chrome”的默认组合块，放大到约 0.67；截图 5 左图只取两个窗格的上半部分，缩放从 0.23 提到约 0.31。

未改及原因：

- **宣传图仍以方案 2 作占位**：要等你选定图标后用 `--icon`（方案 6 加 `--no-tile`）重渲，现在换哪一版都同样会影响选择；已在对比图和本文件里写明是占位。
- **marquee 里的第三方 Logo**：换成 DuckDuckGo ｜ Bing 后，两个 Logo 在画面里都很小（真实使用画面），没有再缩小截图占比；如果仍担心被理解为合作背书，可以改用不含 Logo 的局部，或在上架前再评估。
- **README 正文第 3 步**（“如不想替换默认引擎，可不设为默认，改用快捷字词触发”）同样没提拖拽需要设为默认。它是 README 原有文字，主仓库另有任务在改 README，这里只动图片，避免合并冲突；建议合并后补一句“拖拽只在设为默认时分屏”。
- **重拍截图**：screenshot-2 的问题用现有两张真实截图重新组合解决，没有重拍；拖拽黑块用修补图解决，也没有重拍。以后补拍时，在有合成器的显示环境里拍拖拽，就不会出现黑底箭头。
- `base.css` 的宣传图强调色 `--coral` 仍是 `#F26B3A`：它画在紫色底和截图上，不涉及工具栏对比度；选定图标后可以再统一。

