# Split Search

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **Español**

Busca en la barra de direcciones o arrastra texto a la barra de pestañas, y Split Search abrirá los resultados de dos buscadores en la vista dividida de Chrome, uno al lado del otro, para que los compares.

![Vista dividida de Chrome con DuckDuckGo a la izquierda y Bing a la derecha, ambos con resultados de «rust programming»](assets/readme/es/hero.png)

## Funciones

- Compara dos buscadores desde la barra de direcciones o arrastrando texto a la barra de pestañas. Elige tus buscadores, añade otros y crea varias combinaciones, cada una con su propio atajo
- Haz clic con el botón derecho en un texto seleccionado o en una imagen para buscarlo junto a la página que estás viendo
- Haz clic en el botón de la barra de herramientas para cambiar el buscador de la derecha sin volver a buscar
- El buscador de la derecha puede cambiar solo según lo que busques; por ejemplo, a YouTube cuando tu búsqueda contiene «video»

## Instalación

Requiere Chrome 155 o posterior.

1. Descarga este repositorio, abre `chrome://extensions` y activa el «Modo Desarrollador» («Modo de desarrollador») en la esquina superior derecha.
2. Haz clic en «Cargar descomprimida» («Cargar extensión sin empaquetar») y selecciona la carpeta `src` del repositorio.
3. Al terminar la instalación, se abrirá automáticamente la configuración de Split Search.

## Configuración

La primera vez que abras la configuración de Split Search, la tarjeta «Primeros pasos» de la pestaña «Añadir a Chrome» te guiará por estos pasos y terminará con una búsqueda de prueba.

1. **Da acceso**: en la pestaña «Buscadores» de la configuración de Split Search, haz clic en «Dar acceso» junto a cada buscador que vayas a usar.
2. **Copia la URL**: en la pestaña «Combinaciones», elige el buscador de la izquierda y el de la derecha de la combinación predeterminada. Luego copia la URL generada en la pestaña «Añadir a Chrome».
3. **Añádela y elígela como predeterminada**: escribe `chrome://settings/searchEngines` en la barra de direcciones. En la sección «Búsquedas en el sitio» («Búsqueda en sitios»), haz clic en «Añadir» («Agregar»). En «Nombre», pon lo que quieras; en «Atajo», el que prefieras (por ejemplo, `gb`); en «URL con %s en el lugar de la consulta» («URL con %s en lugar de la consulta»), pega la URL que copiaste. Haz clic en «Añadir» («Agregar»). Por último, en el menú ⋮ a la derecha de esa entrada, selecciona «Elegir como predeterminado» («Configurar como predeterminado»).

## Ten en cuenta

- Mientras uses Split Search como buscador predeterminado, la barra de direcciones no muestra sugerencias de búsqueda.
- En ventanas de incógnito o en otros dispositivos, se hace una búsqueda normal.

## Privacidad

Lo que buscas solo llega a los buscadores que elijas, nunca al desarrollador ni a otros terceros. Split Search no usa servidores propios ni incluye estadísticas de uso ni publicidad. Para abrir la vista dividida, lee en tu dispositivo la URL de tu búsqueda y la de la pestaña actual, y no las guarda. Solo lee el texto seleccionado o la dirección de una imagen cuando usas su menú contextual. Tus búsquedas se guardan en la memoria del navegador y se borran al cerrarlo. Más información en la [política de privacidad](https://pine2d.github.io/split-search/privacy) (en inglés).
