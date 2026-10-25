# Chrome 术语表

- Chrome 版本：156.0.8078.47（`/opt/google/chrome/google-chrome --version`；2026-10-25 重新生成，首版取自 155.0.8059.84）
- 生成命令：`node scripts/i18n/chrome-terms.mjs [--chrome-dir /opt/google/chrome]`（读 `locales/*.pak`，以 en-US 原文为锚对齐资源 id，去掉 `&` 加速键标记）
- 生成日期：2026-10-24；2026-10-25 用 Chrome 156.0.8078.47 重新生成，原有各行结果不变，新增“键盘快捷键”一行（`chrome://extensions/shortcuts` 页标题，资源 8097；单数 Keyboard shortcut 另有 2116/6866/6906，zh-CN、zh-TW、es 相同，es-419 为 Combinación de teclas）。同日为 v0.4 右键菜单再补“使用 X 搜索图片”“标签页”“工具栏”三行，并在“说明”里记下右键菜单、以图搜图、Google Lens 的写法；原有各行不变。
- 用途：各语言的功能术语与 Chrome 对应语言界面一字不差，以本表为准。
- 加粗：项目现有写法与 Chrome 不符、必须改的词。
- 计划里预先核实的值与生成结果全部一致，无需改动。

## 项目用语对照

| 项目里的叫法 | en-US | zh-CN | zh-TW | es | es-419 |
|---|---|---|---|---|---|
| 分屏 | Split view | **拆分视图** | 分割畫面 | Vista dividida | Vista dividida |
| 标签右键“新分屏”（1） | Add tab to new split view | 在拆分视图中显示标签页 | 將分頁加入新分割畫面 | Añadir pestaña a nueva vista dividida | Agregar pestaña a la nueva vista dividida |
| 标签右键“新分屏”（2） | New split view with current tab | 使用当前标签页创建新的拆分视图 | 使用目前分頁建立新的分割畫面 | Nueva vista dividida con la pestaña actual | Nueva vista dividida con la pestaña actual |
| 链接右键 | Open link in split view | 在拆分视图中打开链接 | 在分割畫面開啟連結 | Abrir enlace en vista dividida | Abrir vínculo en vista dividida |
| 网站搜索 | Site search | 网站搜索 | 網站搜尋 | Búsquedas en el sitio | Búsqueda en sitios |
| 添加网站搜索对话框 | Add site search | 添加网站搜索引擎 | 新增網站搜尋引擎 | Añadir búsqueda en el sitio | Agrega búsquedas en el sitio |
| ⋮ 菜单“设为默认” | Make default | **设为默认选项** | 設為預設 | Elegir como predeterminado | Configurar como predeterminado |
| 搜索引擎 | Search engines | 搜索引擎 | 搜尋引擎 | Buscadores | Motores de búsqueda |
| 设置页入口 | Manage search engines and site search | 管理搜索引擎和网站搜索 | 管理搜尋引擎和網站搜尋 | Gestionar buscadores y búsquedas en el sitio | Administrar la búsqueda en sitios y los motores de búsqueda |
| 快捷字词 | Shortcut | 快捷字词 | 搜尋捷徑 | Atajo | Atajo |
| 地址栏 | address bar | 地址栏 | 網址列 | barra de direcciones | barra de direcciones |
| 标签栏 | tab strip | 标签栏 | 分頁列 | barra de pestañas | barra de pestañas |
| 开发者模式 | Developer mode | 开发者模式 | 開發人員模式 | Modo Desarrollador | Modo de desarrollador |
| 加载已解压 | Load unpacked | **加载未打包的扩展程序** | 載入未封裝項目 | Cargar descomprimida | Cargar extensión sin empaquetar |
| 重新加载 | Reload | 重新加载 | 重新載入 | Volver a cargar | Volver a cargar |
| 网站访问权限 | Site access | **有权访问的网站** | 網站存取權 | Acceso a sitios | Acceso al sitio |
| 右键“在 X 中搜索” | Search $1 for “$2” | **使用$1搜索“$2”** | 透過 $1 搜尋「$2」 | Buscar $2 en $1 | Buscar "$2" en $1 |
| 键盘快捷键（快捷键页） | Keyboard shortcuts | 键盘快捷键 | 鍵盤快速鍵 | Accesos directos | Accesos directos |
| 图片右键“使用 X 搜索图片” | Search image with $1 | 使用 $1搜索图片 | 使用 $1搜尋圖片 | Buscar imagen con $1 | Buscar imagen con $1 |
| 标签页（图片右键“在新标签页中打开图片”） | Open image in new tab | 在新标签页中打开图片 | 在新分頁中開啟圖片 | Abrir imagen en una pestaña nueva | Abrir imagen en una pestaña nueva |
| 工具栏 | Toolbar | 工具栏 | 工具列 | Barra de herramientas | Barra de herramientas |

## 说明

- “地址栏”“标签栏”在 Chrome 里没有独立标签，只在句中出现，已用句子确认（例如 zh-CN“在地址栏中输入相应的快捷字词”、“试试收起标签栏”；zh-TW「網址列」「分頁列」；es「barra de direcciones」「barra de pestañas」）。zh-TW 个别句子写作「分頁標籤列」，以「分頁列」为主流。
- es 与 es-419 的差异：Make default（Elegir / Configurar como predeterminado）、Site search（Búsquedas en el sitio / Búsqueda en sitios）、Add site search（Añadir / Agrega）、Developer mode、Load unpacked、Site access、Search $1 for “$2”（es 为 `Buscar $2 en $1`，参数顺序与 en 相反，翻译占位符时要留意）。本项目只出 es（中性国际西语），es-419 仅供对照。
- 同一英文原文命中多个资源 id（如 Site search 6890/6896、Make default 6478/6907/7658、Reload 共 16 处）时各 id 译文一致，表中只列一行；完整 id 列表用生成命令查看。
- 键盘快捷键：页面标题（复数 Keyboard shortcuts）zh-CN“键盘快捷键”、zh-TW「鍵盤快速鍵」、es「Accesos directos」；单个快捷键 es 是「Acceso directo」。项目里“快捷键”指键盘快捷键，网站搜索的关键字叫“快捷字词”（zh-TW「搜尋捷徑」、es「Atajo」），两者不混用。资源 7611 各语言都是英文原文（未翻译的内部字符串），不作依据。
- `Search $1 for “$2”` 在 zh-CN 中占位符紧贴汉字（`使用$1搜索“$2”`），没有空格。
- 右键菜单：Chrome 没有单独的“右键菜单”标签。资源 49962 等无障碍提示写作 zh-CN“上下文菜单”、zh-TW「內容選單」、es「menú contextual」；界面里的操作提示写作 zh-CN“右键点击”、zh-TW「按一下滑鼠右鍵」、es「haz clic con el botón derecho」（资源 11442、11620）。项目沿用 zh_CN“右键菜单”、zh_TW「右鍵選單」、en “right-click menu”、es «menú contextual»，动作写“右键”/「按右鍵」/“right-click”/«haz clic con el botón derecho»。
- 以图搜图：Chrome 没有这个词，原生菜单项是“使用 $1搜索图片”（资源 9027，en `Search image with $1`；9029 为复数 images，zh-CN、zh-TW 相同，es 为 Buscar imágenes con $1）。“以图搜图”“以圖搜圖”只作本扩展的功能名（设置页卡片、引擎类别）；菜单项照原生项写“用 X 搜索图片”/「使用 X 搜尋圖片」/“Search image with X”/«Buscar imagen con X»（`test/i18n-pak.test.js` 核对）。es 写 «buscador para imágenes»或 «buscador de imágenes»，en 写 “image search engine”。
- Google Lens：Chrome zh-CN 界面叫“Google 智能镜头”、zh-TW「Google 智慧鏡頭」（资源 1374），es 不译。本扩展的以图搜图预置引擎名是代码里的引擎数据 `Google Lens`，和其他引擎名一样不随界面语言变，界面文案里也不另起译名。
- 本扩展菜单项的 `%s` 由 Chrome 换成选中的文字，外面的引号按各语言写：zh_CN “”、zh_TW「」、en “”、es «»（与 `src/_locales/es` 其他文案一致；Chrome es 原生项不加引号）。
