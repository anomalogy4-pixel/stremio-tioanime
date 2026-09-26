const express = require("express");
const metas = express.Router();
const SL = require("../lib/sololatino");
const fuzzysort = require("fuzzysort");

function parseSoloId(id) {
  // sololatino:pelicula:<slug> | sololatino:serie:<slug>[:S:E]
  const parts = (id || "").split(":");
  if (parts[0] !== "sololatino") return null;
  if (parts[1] === "pelicula" && parts[2]) return { kind: "pelicula", slug: parts[2] };
  if (parts[1] === "serie" && parts[2])
    return { kind: "serie", slug: parts[2], season: parts[3], episode: parts[4] };
  // legacy short form sololatino:<slug>
  if (parts[1] && !parts[2]) return { kind: "unknown", slug: parts[1] };
  return null;
}

async function titleFromCinemeta(type, id) {
  const url = `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(id)}.json`;
  const resp = await SL.fetchTimeout(url, {}, 10000);
  if (!resp.ok) throw Error("cinemeta " + resp.status);
  const json = await resp.json();
  return json.meta && json.meta.name;
}

// Pick the closest title, preferring entries of the type Stremio asked for:
// a title search can return a movie and a series of the same name, and taking
// the raw best match sent a series request to a movie page.
function bestPreview(title, previews, wantedType) {
  const pool = previews.filter((p) => p.type === wantedType);
  const candidates = pool.length ? pool : previews;
  return fuzzysort.go(title, candidates, { key: "name", limit: 1 })[0]?.obj || candidates[0];
}

async function resolveForeignId(type, id) {
  // tt... / tmdb:... -> search sololatino by title from cinemeta
  const title = await titleFromCinemeta(type, id);
  if (!title) throw Error("no title for " + id);
  const suggestions = await SL.searchSuggest(title, 10);
  const previews = suggestions.map(SL.suggestToPreview).filter(Boolean);
  if (!previews.length) throw Error("no sololatino match for " + title);
  return parseSoloId(bestPreview(title, previews, type).id);
}

// Stremio matches the returned meta against the id it asked for. Handing back
// our internal sololatino: id for a tt/tmdb request made the response look
// like a different item, so echo the requested id and rebase episode ids onto
// it (tt1234:1:2 — the form the stream route already parses).
function rebaseToRequestedId(meta, requestedId) {
  if (!meta || meta.id === requestedId) return meta;
  const out = { ...meta, id: requestedId };
  if (out.behaviorHints && out.behaviorHints.defaultVideoId)
    out.behaviorHints = { ...out.behaviorHints, defaultVideoId: requestedId };
  if (Array.isArray(out.videos))
    out.videos = out.videos.map((v) => ({ ...v, id: `${requestedId}:${v.season}:${v.episode}` }));
  return out;
}

async function handleMeta(req, res) {
  const { type, videoId } = req.params;
  try {
    let parsed = parseSoloId(videoId);
    if (!parsed) {
      // foreign id (tt, tmdb:, kitsu:...) -> resolve via cinemeta title search
      parsed = await resolveForeignId(type === "movie" ? "movie" : "series", videoId);
    }
    let meta;
    if (parsed.kind === "pelicula") {
      meta = await SL.getMovieMeta(parsed.slug);
    } else if (parsed.kind === "serie") {
      meta = await SL.getSerieMeta(parsed.slug);
    } else {
      // unknown: try movie then serie
      try {
        meta = await SL.getMovieMeta(parsed.slug);
      } catch {
        meta = await SL.getSerieMeta(parsed.slug);
      }
    }
    res.set("Cache-Control", "max-age=86400, stale-while-revalidate=86400");
    res.json({ meta: rebaseToRequestedId(meta, videoId) });
  } catch (err) {
    console.error("meta error:", err.message);
    if (!res.headersSent) res.json({ meta: {}, message: "Error: " + err.message });
  }
}

metas.get("/meta/:type/:videoId.json", handleMeta);

module.exports = metas;
