require("dotenv").config();

const express = require("express");
const app = express();
app.set("trust proxy", true);

function setCORS(_req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
}
app.use(setCORS);

const pkg = require("./package.json");
const { GENRES } = require("./routes/catalog");

const MANIFEST = {
  id: "com." + pkg.name.replaceAll("-", "."),
  version: pkg.version,
  name: "SoloLatino",
  logo: "https://sololatino.net/images/logo.png",
  background: "https://sololatino.net/images/logo.png",
  description: pkg.description,
  types: ["movie", "series"],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: ["sololatino:", "tt", "tmdb:"],
  catalogs: [
    {
      id: "sololatino-peliculas",
      type: "movie",
      name: "SoloLatino: Peliculas",
      extra: [{ name: "search", isRequired: false }, { name: "genre", options: GENRES, isRequired: false }, { name: "skip", isRequired: false }],
    },
    {
      id: "sololatino-series",
      type: "series",
      name: "SoloLatino: Series",
      extra: [{ name: "search", isRequired: false }, { name: "genre", options: GENRES, isRequired: false }, { name: "skip", isRequired: false }],
    },
  ],
  behaviorHints: { configurable: false },
};

app.get("/manifest.json", (_req, res) => {
  res.set("Cache-Control", "max-age=86400");
  res.json(MANIFEST);
});

// Render pings this to decide the instance is alive, and an external cron hits
// it on the free plan to hold off the 15-minute spin-down. Must stay cheap:
// no scraping, no upstream calls.
app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, version: pkg.version, uptime: Math.round(process.uptime()) });
});

app.get("/", (req, res) => {
  const b = req.baseUrl;
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<h1>SoloLatino Stremio Addon v${pkg.version}</h1>
<p>${pkg.description}</p>
<p>Manifiesto: <a href="${b}/manifest.json">/manifest.json</a></p>
<p>Instalar en Stremio (web): <code>https://&lt;tu-host&gt;${b}/manifest.json</code></p>
<ul>
<li>Catalogo peliculas: <a href="${b}/catalog/movie/sololatino-peliculas.json">/catalog/movie/sololatino-peliculas.json</a></li>
<li>Buscar: <a href="${b}/catalog/movie/sololatino-peliculas/search=ted%20lasso.json">/catalog/movie/sololatino-peliculas/search=ted lasso.json</a></li>
<li>Meta ejemplo: <a href="${b}/meta/movie/sololatino:pelicula:one-last-shot.json">/meta/movie/sololatino:pelicula:one-last-shot.json</a></li>
<li>Streams ejemplo: <a href="${b}/stream/movie/sololatino:pelicula:one-last-shot.json">/stream/movie/sololatino:pelicula:one-last-shot.json</a></li>
</ul>`);
});

app.use(require("./routes/catalog").catalog);
app.use(require("./routes/meta"));
app.use(require("./routes/proxy"));
app.use(require("./routes/streams"));

// Unknown paths: answer in the shape Stremio expects instead of Express' HTML.
app.use((req, res) => {
  res.status(404).json({ err: "not found", path: req.path });
});

module.exports = app;

// Standalone: `node sololatino/index.js`. In the combined server the root
// index.js mounts this app under /sololatino and owns the process guards.
if (require.main === module) {
  // A stray rejection (an abandoned scrape, a socket reset mid-proxy) terminates
  // the process under Node's default policy, which takes a 24/7 host down for an
  // error the request handler already reported. Log and keep serving.
  process.on("unhandledRejection", (err) => {
    console.error("unhandledRejection:", (err && err.message) || err);
  });
  process.on("uncaughtException", (err) => {
    console.error("uncaughtException:", (err && err.stack) || err);
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`sololatino-stremio-addon listening on ${PORT}`);
    console.log(`manifest: http://127.0.0.1:${PORT}/manifest.json`);
  });
}
