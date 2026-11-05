# Club de Videos Sakila

Aplicación de una sola página (`index.html`) con Vue 3.5.45, HTML y CSS modular. El catálogo consulta 24 películas reales mediante la API pública de Cinemeta. No necesita claves ni un proceso de compilación.

## Abrir el proyecto

Desde esta carpeta, ejecuta:

```sh
npm run dev
```

Abre **http://127.0.0.1:8765**. También puedes utilizar Live Server de Visual Studio Code. Utiliza siempre la misma dirección y puerto para conservar el mismo almacenamiento local. La primera carga del catálogo requiere conexión a Internet.

La navegación cambia las vistas sin recargar el documento. Puedes compartir enlaces como `index.html#/catalogo` o `index.html#/pelicula?id=tt0111161`; los botones atrás y adelante conservan el recorrido. HTML reunido en `index.html`, con CSS y JavaScript organizados en archivos separados.

## Funciones

- Búsqueda por título o reparto, géneros, clasificación disponible, orden y paginación.
- Fichas con cartel, sinopsis, duración, reparto y tráiler cuando la fuente lo proporciona.
- Favoritos, carrito editable y reservas guardados en este navegador.
- Devoluciones, historial y multas simuladas, con fechas de Bolivia.
- Caché de metadatos durante 24 horas, reintentos y recuperación de datos ya descargados si falla la conexión.

La política de demostración es **Bs 10 por día**, entre **1 y 30 días**. La multa es **Bs 5 por día calendario de retraso**. No hay pagos, autenticación ni sincronización entre dispositivos. La disponibilidad es una simulación local; no representa inventario de un negocio real.

Cinemeta puede entregar títulos y sinopsis en inglés y no siempre informa clasificación o idioma. Los datos ausentes se indican como no disponibles. El filtro por clasificación solo utiliza datos informados, sin asignar clasificaciones inventadas.

## Código

- `js/domain.js`: precios, fechas, validaciones y normalización.
- `js/store.js`: carrito, favoritos, reservas y persistencia.
- `js/api.js`: consultas y caché de Cinemeta.
- `js/main.js`: aplicación Vue, navegación interna y coordinación de las vistas.
- `js/vendor/`: distribución local de Vue y su licencia MIT.
- `css/`: variables, base, distribución, componentes y animaciones.

## Verificación

Requiere Node.js compatible con jsdom: 22.22.2+, 24.15.0+ o 26+.

```sh
npm ci
npm test
```

Las pruebas cubren reglas de alquiler, recuperación del almacenamiento, respuestas de la API y flujos sobre las plantillas reales con Vue en un DOM de pruebas. No reemplazan una revisión visual en dispositivos reales.

## Fuentes

- [Vue: uso directo sin compilación](https://vuejs.org/guide/quick-start.html#using-vue-from-cdn).
- [Stremio: documentación del servicio de metadatos Cinemeta](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md).

Los carteles y las fichas se consultan desde la API. La imagen ambiental de la portada fue generada para este proyecto.
