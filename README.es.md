# Split Search

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **Español**

Busca una vez y compara los resultados de dos buscadores uno junto a otro en la vista dividida de Chrome.

![Vista dividida de Chrome con DuckDuckGo a la izquierda y Bing a la derecha, ambos con resultados de «rust programming»](assets/readme/es/hero.png)

## Funciones

- Busca desde la barra de direcciones o arrastra texto a la barra de pestañas para comparar dos buscadores en paralelo. Añade tus propios buscadores y crea varias combinaciones, cada una con su atajo.
- Haz clic derecho en un texto seleccionado o en una imagen para buscar sin salir de la página que estás leyendo.
- En la página de resultados de uno de tus buscadores, pulsa el icono de la barra de herramientas para abrir un segundo buscador a la derecha, o cámbialo en cualquier momento desde ahí o con un acceso directo de teclado sin volver a escribir.
- Cambia automáticamente el buscador derecho según palabras clave o sistema de escritura (por ejemplo, usa YouTube cuando buscas «video», con opción de quitar esa palabra).

## Instalación

Requiere Chrome 155 o posterior.

**[Instalar desde Chrome Web Store](https://chromewebstore.google.com/detail/Split%20Search/ebefmgpipceocigodihbbbhdiagmjdak)**

Instalación manual:

1. Descarga `split-search-<versión>.zip` desde [Releases](https://github.com/pine2D/split-search/releases/latest) y descomprímelo.
2. Abre `chrome://extensions`, activa «Modo Desarrollador» («Modo de desarrollador») arriba a la derecha, haz clic en «Cargar descomprimida» («Cargar extensión sin empaquetar») y elige la carpeta descomprimida.
3. Al instalarla se abrirá la página de configuración.

Para actualizar, descomprime la nueva versión en la misma carpeta y pulsa «Volver a cargar» en la tarjeta de la extensión. Si cambias de carpeta, Chrome la tomará como otra extensión y no conservará tu configuración.

## Primeros pasos

Úsala directamente en páginas de resultados: abre los resultados de Google o Bing, pulsa Split Search en la barra de herramientas y elige un segundo buscador. Tu buscador predeterminado no cambia. También puedes ir a «Primeros pasos» en la configuración, dar acceso al buscador izquierdo y pulsar «Probar ejemplo».

Para dividir búsquedas directamente desde la barra de direcciones, añade una búsqueda en el sitio en Chrome:

1. Elige tus dos buscadores en «Combinaciones» (da acceso al buscador izquierdo si se solicita), abre «Añadir a Chrome», copia la URL de la combinación y pulsa «Abrir los ajustes de búsqueda de Chrome».
2. Haz clic en «Añadir» («Agregar») junto a «Búsquedas en el sitio» («Búsqueda en sitios»), escribe un nombre y un atajo (como `gb`), pega la URL en el campo con `%s` y confirma con «Añadir» («Agregar»).
3. Escribe el atajo en la barra de direcciones, pulsa Tab y escribe tu búsqueda. Si también quieres usar esta combinación al buscar directamente o arrastrar texto a la barra de pestañas, abre su menú ⋮ y elige «Elegir como predeterminado» («Configurar como predeterminado»); al hacerlo, dejarán de mostrarse las sugerencias en la barra de direcciones.

## Notas

- En «Combinaciones» puedes activar «Cerrar ambas pestañas al cerrar una» (desactivado por defecto). Solo se aplica a vistas divididas de búsqueda abiertas por Split Search en la sesión actual, incluso tras abrir enlaces; las búsquedas con clic derecho y las pestañas contiguas en ventanas estrechas no se cierran juntas. Si separas una vista dividida y cierras una pestaña al instante, la otra aún podría cerrarse.
- En ventanas de menos de 960 px de ancho, los resultados se abren en pestañas contiguas: las búsquedas abren el segundo buscador en segundo plano y las búsquedas con clic derecho cambian a la pestaña de resultados.
- En ventanas de incógnito, en otros dispositivos sin la extensión o antes de dar acceso al buscador izquierdo, la URL de la combinación abre una búsqueda normal en el buscador izquierdo.

## Privacidad

Lo que buscas, el texto seleccionado y las URL de imágenes solo se envían a los buscadores que elijas, nunca al desarrollador ni a terceros. Split Search no tiene servidores, analíticas ni publicidad: lee en tu dispositivo la URL de búsqueda y la de la pestaña activa para abrir la vista dividida sin guardarlas; solo lee el texto seleccionado o la URL de una imagen cuando usas su menú contextual; y mantiene las consultas activas únicamente en la memoria del navegador hasta que lo cierras. Consulta la [política de privacidad](https://pine2d.github.io/split-search/privacy) (en inglés).
