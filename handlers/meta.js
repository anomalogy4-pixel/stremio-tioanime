const { fetchAnimeDetail } = require("../scrapers/anime");
const { decodeSeriesId, encodeVideoId } = require("../utils/idScheme");
const cache = require("../cache");

const TTL_META = 30 * 60 * 1000; // 30 min

async function metaHandler({ type, id }) {
  if (type !== "series") return { meta: null };

  const slug = decodeSeriesId(id);
  const cacheKey = `meta:${slug}`;

  const cached = cache.get(cacheKey);
  if (cached) return { meta: cached };

  const detail = await fetchAnimeDetail(slug);

  const videos = detail.episodes.map((ep) => ({
    id: encodeVideoId(slug, ep.number),
    title: ep.title,
    season: 1,
    episode: ep.number
  }));

  const meta = {
    id,
    type: "series",
    name: detail.title,
    poster: detail.posterUrl,
    description: detail.description,
    genres: detail.genres,
    releaseInfo: detail.year ? String(detail.year) : undefined,
    videos
  };

  cache.set(cacheKey, meta, TTL_META);
  return { meta };
}

module.exports = metaHandler;
