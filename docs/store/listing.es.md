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
Busca en la barra de direcciones o arrastra texto seleccionado a la barra de pestañas, y Split Search abrirá los resultados de dos buscadores en la vista dividida de Chrome, uno al lado del otro, para que los compares.

FUNCIONES
• Compara dos buscadores desde la barra de direcciones o arrastrando texto a la barra de pestañas. Elige tus buscadores, añade otros y crea varias combinaciones, cada una con su propio atajo
• Haz clic con el botón derecho en un texto seleccionado o en una imagen para buscarlo junto a la página que estás viendo
• Haz clic en el botón de la barra de herramientas para cambiar el buscador de la derecha sin volver a buscar
• El buscador de la derecha puede cambiar solo según lo que busques; por ejemplo, a YouTube cuando tu búsqueda contiene «video»

CONFIGURACIÓN
1. En la configuración de Split Search, da acceso a tus buscadores
2. Copia la URL que se genera, añádela en «Búsquedas en el sitio» («Búsqueda en sitios») de la configuración de Chrome y selecciona «Elegir como predeterminado» («Configurar como predeterminado»)
En la configuración de Split Search encontrarás instrucciones paso a paso.

TEN EN CUENTA
• Requiere Chrome 155 o posterior
• Mientras uses Split Search como buscador predeterminado, la barra de direcciones no muestra sugerencias de búsqueda
• En ventanas de incógnito o en otros dispositivos, se hace una búsqueda normal

PRIVACIDAD
Lo que buscas solo llega a los buscadores que elijas, nunca al desarrollador ni a otros terceros. Split Search no usa servidores propios ni incluye estadísticas de uso ni publicidad. Para abrir la vista dividida, lee en tu dispositivo la URL de tu búsqueda y la de la pestaña actual, y no las guarda. Solo lee el texto seleccionado o la dirección de una imagen cuando usas su menú contextual. Tus búsquedas se guardan en la memoria del navegador y se borran al cerrarlo.
```

字数：1863（含换行）

措辞说明：2026-10-28 按用户要求精简为核心内容：四条功能、两步设置、三条须知，次要功能和实现细节不写。隐私段仍写明本机读取哪些网址且不保存、只在用户用右键菜单时读选区和图片网址、查询只暂存在内存；不说“不收集”“不读取网页内容”，与 privacy.md 和数据使用披露（网页浏览记录、网站内容）一致，再删要先对照 privacy.md。术语沿用此前各版核实过的 Chrome 界面叫法。
