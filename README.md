# SoloLatino Stremio Addon

Stremio addon for **SoloLatino.Net** (`sololatino.net`): películas, series, animes y doramas en español latino.
Inspirado en [Pigamer37/animeflv-stremio-addon](https://github.com/Pigamer37/animeflv-stremio-addon). No afiliado a SoloLatino.

## Cómo funciona (análisis del sitio)

| Pieza | Hallazgo |
|---|---|
| Búsqueda | `GET /api/search/suggest?q=...` → `[{type,title,year,poster,url}]`. `url` es `/pelicula/<slug>` o `/serie/<slug>`. |
| Catálogo | Páginas SSR: `/peliculas?page=N`, `/series`, `/animes`, `/doramas`, `/genero/<slug>?page=N`, `/buscar?q=...`. Tarjetas en `div.movies-grid div.card > a[href]` con `img.card__poster`, `.card__badge` (Serie/Película), `.card__title`, `.card__year`. |
| Metadata | JSON-LD embebido (`Movie` / `TVSeries`): título, descripción, imagen TMDB, `datePublished`, `genre`, `aggregateRating`, `sameAs` (incluye **IMDb `tt...`** y **TMDB `movie/...` o `tv/...`**). Episodios de series como enlaces `/serie/<slug>/temporada-S/episodio-E`. |
| Reproductor | Botones `data-player-token="..."` (Laravel encrypted). Frontend hace `GET /sanctum/csrf-cookie` y luego `POST /api/player-url {t: token}` con cookies + header `X-XSRF-TOKEN` → `{url, type}`. |
| Embeds | URLs tipo `https://embed69.org/f/<tt...>`, `https://player.pelisserieshoy.com/f/<tt...-SxEE>`, `https://sololatino.xyz/v/...`. `embed69` cifra sus enlaces (AES + PoW), por eso este addon v1 devuelve los iframes como **streams externos** (se abren en el navegador), igual que los `externalStreams` del addon ejemplo. |

## Endpoints del addon

- `GET /manifest.json`
- `GET /catalog/movie/sololatino-peliculas[/search=...|/genre=...|/skip=N].json`
- `GET /catalog/series/sololatino-series[/search=...|/genre=...|/skip=N].json`
- `GET /meta/:type/:id.json`
- `GET /stream/:type/:id.json`

IDs nativos: `sololatino:pelicula:<slug>`, `sololatino:serie:<slug>[:temporada:episodio]`.
También acepta `tt...` y `tmdb:...` (resuelve el título vía Cinemeta y luego busca en SoloLatino con `fuzzysort`, como el addon ejemplo).

## Uso local

```bash
npm install
npm start   # http://127.0.0.1:3000/manifest.json
```

Instalar en Stremio (web/desktop): pegar `http://127.0.0.1:3000/manifest.json` en
*Addons → Add addon / pegar URL del manifiesto*. Para Stremio en otro dispositivo hay que exponer el puerto
o desplegar (Render/Railway/VPS) y usar la URL pública.

## Ejemplos

- Catálogo: `/catalog/movie/sololatino-peliculas.json`
- Buscar: `/catalog/series/sololatino-series/search=ted%20lasso.json`
- Meta: `/meta/movie/sololatino:pelicula:one-last-shot.json`
- Stream peli: `/stream/movie/sololatino:pelicula:one-last-shot.json`
- Stream episodio: `/stream/series/sololatino:serie:ted-lasso:1:1.json`
- Stream por IMDB: `/stream/movie/tt37971717.json`

## Limitaciones v1

- **Directo in-Stremio (embed69)**: el addon resuelve `embed69` (PoW SHA-256 + AES-256-CBC, ver
  `lib/embed69.js`) y extrae el HLS del mirror de Vidhide (`lib/vidhide.js`). Ese stream
  `Vidhide Latino` aparece primero y reproduce dentro de Stremio. Si falla, quedan los
  fallbacks externos (abren el host en el navegador).
- **Directo in-Stremio (pelisserieshoy)**: `lib/pss.js` implementa el protocolo del player
  `player.pelisserieshoy.com` (click → scan `a=1` → resolve `a=2` por servidor, HLS vía
  `/p.php?url=&sig=`). Hoy el backend devuelve `No hay servidores disponibles` en el scan
  para todos los títulos probados (el scan de descargas sí responde, así que no es baneo de
  IP), por lo que solo salen sus fallbacks externos. Cuando el backend tenga servidores, los
  streams directos `PSS ...` aparecen solos, sin cambiar código. Por diseño es conservador
  (máx. 3 servidores, secuencial, con caché) porque ese servidor banea IPs con tormentas de
  peticiones.
- Las URLs HLS van firmadas y con `asn=` (atadas a red/IP y con caducidad ~36h); se resuelven
  en cada pedido, y funcionan mejor con el addon corriendo en local (`start.bat`).
  En esta red el CDN `acek-cdn.com` ni siquiera conecta (posible bloqueo del ISP); si te pasa
  lo mismo, usa los enlaces externos.
- Sin `TMDB_API_KEY`: la metadata viene 100% de SoloLatino (suficiente: poster, fondo, sinopsis, géneros, rating).
- Algunos títulos pueden ser VIP-only (sin `data-player-token` público).
