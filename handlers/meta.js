const { fetchAnimeDetail } = require("../scrapers/anime");
const { decodeSeriesId, encodeVideoId } = require("../utils/idScheme");
const cache = require("../cache");

const TTL_META = 30 * 60 * 1000;

async function metaHandler({ type, id }) {
  if (type !== "series") return { meta: null };

  const { source, slug } = decodeSeriesId(id);
  if (!source || !slug) return { meta: null };

  const cacheKey = `meta:${source}:${slug}`;
  const cached = cache.get(cacheKey);
  if (cached) return { meta: cached };

  let detail;
  try {
    detail = await fetchAnimeDetail(source, slug);
  } catch (err) {
    console.error(`[meta] ${id} failed: ${err.message}`);
    return { meta: null };
  }

  const videos = detail.episodes.map((ep) => ({
    id: encodeVideoId(source, slug, ep.number),
    title: ep.title,
    season: 1,
    episode: ep.number
  }));

  const meta = {
    id,
    type: "series",
    name: detail.title,
    poster: detail.posterUrl,
    background: detail.posterUrl,
    description: detail.description,
    genres: detail.genres,
    releaseInfo: detail.year ? String(detail.year) : undefined,
    videos
  };

  cache.set(cacheKey, meta, TTL_META);
  return { meta };
}

module.exports = metaHandler;
