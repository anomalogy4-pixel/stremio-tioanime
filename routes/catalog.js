const express = require("express");
const catalog = express.Router();
const SL = require("../lib/sololatino");

const PAGE_SIZE = 24; // what we hand back to Stremio per request
const MAX_SITE_PAGES = 12; // hard cap on site fetches for one catalog request
const GENRES = [
  "accion", "action-adventure", "animacion", "anime", "aventura", "belica",
  "ciencia-ficcion", "comedia", "crimen", "documental", "drama", "familia",
  "fantasia", "historia", "kids", "misterio", "musica", "pelicula-de-tv",
  "romance", "sci-fi-fantasy", "suspense", "terror", "war-politics", "western",
];

// Walk site pages until we hold skip+PAGE_SIZE matching items, then slice.
// The site's own page size is not ours and is not even constant (/peliculas
// serves 36 cards, /genero/<slug> serves 24), so deriving a site page number
// from `skip` silently skipped or repeated titles on every page after the
// first. Accumulating makes the window exact whatever the site does.
async function collect(path, wantedType, skip) {
  const s = parseInt(skip || "0", 10) || 0;
  const need = s + PAGE_SIZE;
  const seen = new Set();
  const matched = [];
  const all = [];
  for (let page = 1; page <= MAX_SITE_PAGES && matched.length < need; page++) {
    let items;
    try {
      items = await SL.scrapeList(path, page);
    } catch (err) {
      if (page === 1) throw err;
      break; // partial results beat none
    }
    if (!items.length) break;
    let fresh = 0;
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      fresh++;
      all.push(it);
      if (it.type === wantedType) matched.push(it);
    }
    if (!fresh) break; // site repeated a page: we are past the end
  }
  // If the page's badges never matched the requested type, fall back to the raw
  // cards rather than showing an empty catalog.
  const list = matched.length ? matched : all;
  return list.slice(s, s + PAGE_SIZE);
}

function browseCatalog(kind, wantedType, genre, skip) {
  // /genero/<slug> mixes movies and series; collect() filters by type.
  const path = genre ? `/genero/${genre}` : kind === "pelicula" ? "/peliculas" : "/series";
  return collect(path, wantedType, skip);
}

async function searchCatalog(query, wantedType, skip) {
  const s = parseInt(skip || "0", 10) || 0;
  // The site has no HTML search page (/?s= just returns the home page), so the
  // suggest API is all there is; it caps out around 10 results.
  const suggestions = await SL.searchSuggest(query, 25);
  let metas = suggestions.map(SL.suggestToPreview).filter(Boolean);
  if (wantedType) metas = metas.filter((m) => m.type === wantedType);
  return metas.slice(s, s + PAGE_SIZE);
}

function handleCatalog(kind, wantedType) {
  return async (req, res) => {
    try {
      const extra = res.locals.extraParams || {};
      const { search, skip, genre } = extra;
      let metas;
      if (search) {
        metas = await searchCatalog(search, wantedType, skip);
      } else {
        metas = await browseCatalog(kind, wantedType, genre, skip);
      }
      res.set("Cache-Control", "max-age=3600, stale-while-revalidate=86400");
      res.json({ metas });
    } catch (err) {
      console.error("catalog error:", err.message);
      if (!res.headersSent) res.json({ metas: [], message: "Error: " + err.message });
    }
  };
}

function parseExtra(extraParams) {
  if (!extraParams) return {};
  const out = {};
  for (const kv of extraParams.split("&")) {
    if (!kv) continue;
    // Split on the FIRST '=' only: a query like "search=a=b" lost everything
    // after the second '=' when this used a plain split.
    const i = kv.indexOf("=");
    const k = i === -1 ? kv : kv.slice(0, i);
    const v = i === -1 ? "" : kv.slice(i + 1);
    if (k === "search" || k === "skip" || k === "genre") {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function withExtra(req, res, next) {
  res.locals.extraParams = parseExtra(req.params[0]);
  next();
}

catalog.get("/catalog/movie/sololatino-peliculas/*.json", withExtra, handleCatalog("pelicula", "movie"));
catalog.get("/catalog/movie/sololatino-peliculas.json", handleCatalog("pelicula", "movie"));
catalog.get("/catalog/series/sololatino-series/*.json", withExtra, handleCatalog("serie", "series"));
catalog.get("/catalog/series/sololatino-series.json", handleCatalog("serie", "series"));

module.exports = { catalog, GENRES };
