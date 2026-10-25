# 商店详情：Español

> 状态：v0.2.0 版已于 2026-10-25 提交；详细说明已按 v0.3 改写（2026-10-25），随 v0.3.0 上传时更新控制台。其余必做项见 `listing.zh-CN.md`“提交前必做”。
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
Busca en la barra de direcciones o arrastra texto seleccionado a la barra de pestañas, y Split Search abrirá los resultados de dos buscadores en la vista dividida de Chrome, uno al lado del otro, para que los compares.

FUNCIONES
• Funciona al buscar en la barra de direcciones, al arrastrar texto a la barra de pestañas y con la opción «Buscar … en X» («Buscar “…” en X») del menú contextual
• Incluye Google, Bing, DuckDuckGo, Perplexity y Kagi; también puedes añadir otros buscadores
• El catálogo de buscadores incluye sitios de traducción, enciclopedias, video, mapas y más, pensados para el lado derecho y listos para añadir
• Puedes crear varias combinaciones, cada una con su propio atajo; por ejemplo, escribe «gb palabras clave» para comparar Google y Bing
• Haz clic en el botón de la barra de herramientas para cambiar el buscador de la derecha sin volver a buscar
• También puedes pulsar un acceso directo de teclado para pasar el lado derecho al siguiente buscador. No viene configurado: elígelo en la página Accesos directos de Chrome (chrome://extensions/shortcuts)
• Si la ventana es estrecha, el lado derecho se abre en una pestaña en segundo plano junto a la de la izquierda. Puedes desactivarlo
• Los dos lados son pestañas normales, así que conservas tus sesiones iniciadas y la configuración de cada sitio

CONFIGURACIÓN
1. En la configuración de Split Search, da acceso a los sitios de los buscadores que vayas a usar
2. Elige el buscador de la izquierda y el de la derecha, y copia la URL que se genera
3. En la configuración de Chrome, añade esa URL en «Búsquedas en el sitio» («Búsqueda en sitios») y selecciona «Elegir como predeterminado» («Configurar como predeterminado»)
En la configuración de Split Search encontrarás instrucciones paso a paso.

TEN EN CUENTA
• Requiere Chrome 155 o posterior
• En ventanas de incógnito, en otros dispositivos o si la extensión no está activa, se hace una búsqueda normal
• Mientras uses Split Search como buscador predeterminado, la barra de direcciones no muestra sugerencias de búsqueda

PRIVACIDAD
Tus datos se quedan en tu dispositivo: Split Search no usa servidores propios, no incluye estadísticas de uso ni publicidad y no envía nada al desarrollador ni a terceros. Tus términos de búsqueda solo llegan a los buscadores que elijas, incluido el que pongas a la derecha desde la ventana emergente o con el acceso directo. Para abrir la vista dividida, la extensión lee en tu dispositivo la URL de tu búsqueda y, si hace falta, la de la otra pestaña; no guarda esas URL. Los términos de búsqueda y los dos buscadores solo se guardan en la memoria del navegador, para mostrarlos en la ventana emergente y cambiar el lado derecho, y se borran al cerrar el navegador. Split Search no lee tu historial ni el contenido de las páginas.
```

字数：2800（含换行）

用词说明（v0.3，2026-10-25）：

- 网站搜索的快捷字词是 Chrome 的 «Atajo»；扩展的键盘快捷键照 Chrome es 界面写 «acceso directo»（快捷键页面名 «Accesos directos»，未设置为 «Sin configurar»），两者不混用。
- 弹窗写 «ventana emergente»，工具栏写 «barra de herramientas»。v0.3 新增条目和隐私段已过 content-l10n 本地化质检，未经西语母语者审阅。
