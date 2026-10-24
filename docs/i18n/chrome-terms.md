# Chrome 术语表

- Chrome 版本：155.0.8059.84（`/opt/google/chrome/google-chrome --version`）
- 生成命令：`node scripts/i18n/chrome-terms.mjs [--chrome-dir /opt/google/chrome]`（读 `locales/*.pak`，以 en-US 原文为锚对齐资源 id，去掉 `&` 加速键标记）
- 生成日期：2026-10-24
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

## 说明

- “地址栏”“标签栏”在 Chrome 里没有独立标签，只在句中出现，已用句子确认（例如 zh-CN“在地址栏中输入相应的快捷字词”、“试试收起标签栏”；zh-TW「網址列」「分頁列」；es「barra de direcciones」「barra de pestañas」）。zh-TW 个别句子写作「分頁標籤列」，以「分頁列」为主流。
- es 与 es-419 的差异：Make default（Elegir / Configurar como predeterminado）、Site search（Búsquedas en el sitio / Búsqueda en sitios）、Add site search（Añadir / Agrega）、Developer mode、Load unpacked、Site access、Search $1 for “$2”（es 为 `Buscar $2 en $1`，参数顺序与 en 相反，翻译占位符时要留意）。本项目只出 es（中性国际西语），es-419 仅供对照。
- 同一英文原文命中多个资源 id（如 Site search 6890/6896、Make default 6478/6907/7658、Reload 共 16 处）时各 id 译文一致，表中只列一行；完整 id 列表用生成命令查看。
- `Search $1 for “$2”` 在 zh-CN 中占位符紧贴汉字（`使用$1搜索“$2”`），没有空格。
