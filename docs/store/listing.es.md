# 商店详情：Español

> 状态：v0.2.0 版已于 2026-10-25 提交；详细说明已按 v0.4 改写（2026-10-25），2026-10-27 按 v0.5 在 FUNCIONES 加了 reglas de palabras clave 一条，下次上传时更新控制台。其余必做项见 `listing.zh-CN.md`“提交前必做”。
> 源文案：`listing.zh-CN.md` 的详细说明（2026-10-24 定稿）。中性国际西语，用 tú；Chrome 菜单名在 es 与 es-419 不同时写作 «es» («es-419»)，与 `src/_locales/es/messages.json` 一致。已过 content-l10n 本地化质检和母语标准审校，未经西语母语者审阅。
> 字数按 Unicode 字符计。

## Nombre (máx. 75)

```text
Split Search
```

字数：12 / 75

## Descripción breve (máx. 132)

```text
Busca en la barra de direcciones o arrastra texto a la barra de pestañas y compara dos buscadores en la vista dividida de Chrome.
```

字数：129 / 132（即 `src/_locales/es/messages.json` 的 `ext_description`，由 manifest 决定，不在控制台填写）

## Descripción detallada

```text
Busca una vez y compara los resultados de dos buscadores uno junto a otro en la vista dividida de Chrome.

FUNCIONES
• Busca desde la barra de direcciones o arrastra texto a la barra de pestañas para comparar dos buscadores en paralelo. Añade tus propios buscadores y crea varias combinaciones, cada una con su atajo.
• Haz clic derecho en un texto seleccionado o en una imagen para buscar sin salir de la página que estás leyendo.
• En la página de resultados de uno de tus buscadores, pulsa el icono de la barra de herramientas para abrir un segundo buscador a la derecha, o cámbialo en cualquier momento desde ahí o con un acceso directo de teclado sin volver a escribir.
• Cambia automáticamente el buscador derecho según palabras clave o sistema de escritura (por ejemplo, usa YouTube cuando buscas «video», con opción de quitar esa palabra).

PRIMEROS PASOS
1. Úsala en páginas de resultados: en los resultados de Google o Bing, pulsa Split Search en la barra de herramientas y elige un segundo buscador. Tu buscador predeterminado no cambia.
2. Busca desde la barra de direcciones: da acceso al buscador izquierdo en la configuración de la extensión, copia la URL de la combinación, pulsa «Abrir los ajustes de búsqueda de Chrome» y añádela a «Búsquedas en el sitio» («Búsqueda en sitios»). Escribe su atajo, pulsa Tab y escribe tu búsqueda, o elige «Elegir como predeterminado» («Configurar como predeterminado») para usarla también en búsquedas directas y al arrastrar texto.

NOTAS
• Requiere Chrome 155 o posterior
• Si se elige como buscador predeterminado, la barra de direcciones deja de mostrar sugerencias
• En ventanas de incógnito, en otros dispositivos sin la extensión o antes de dar acceso al buscador izquierdo, la URL de la combinación abre una búsqueda normal en el buscador izquierdo

PRIVACIDAD
Lo que buscas, el texto seleccionado y las URL de imágenes solo se envían a los buscadores que elijas, nunca al desarrollador ni a terceros. Split Search no tiene servidores, analíticas ni publicidad: lee en tu dispositivo la URL de búsqueda y la de la pestaña activa para abrir la vista dividida sin guardarlas; solo lee el texto seleccionado o la URL de una imagen cuando usas su menú contextual; y mantiene las consultas activas únicamente en la memoria del navegador hasta que lo cierras.
```

字数：2313（含换行）

措辞说明：2026-10-28 按用户要求精简为核心内容：四条功能、两步设置、三条须知，次要功能和实现细节不写。隐私段仍写明本机读取哪些网址且不保存、只在用户用右键菜单时读选区和图片网址、查询只暂存在内存；不说“不收集”“不读取网页内容”，与 privacy.md 和数据使用披露（网页浏览记录、网站内容）一致，再删要先对照 privacy.md。术语沿用此前各版核实过的 Chrome 界面叫法。
