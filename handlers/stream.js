const { fetchEpisodeSources } = require("../scrapers/episode");
const { decodeVideoId } = require("../utils/idScheme");
const { resolveAll } = require("../utils/extractors");
const cache = require("../cache");

const TTL_STREAM = 4 * 60 * 60 * 1000;

async function streamHandler({ type, id }) {
  if (type !== "series") return { streams: [] };

  const cacheKey = `stream:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return { streams: cached };

  const { source, slug, epNum } = decodeVideoId(id);

  let sources = [];
  try {
    sources = await fetchEpisodeSources(source, slug, epNum);
  } catch (err) {
    console.error(`[stream] Failed to fetch sources for ${source}:${slug}:${epNum}:`, err.message);
    return { streams: [] };
  }

  const resolved = await resolveAll(sources);

  const streams =
    resolved.length > 0
      ? resolved
      : sources
          .filter((s) => s.embedUrl)
          .map((s) => ({
            externalUrl: s.embedUrl,
            title: `${s.host} (externo)`
          }));

  cache.set(cacheKey, streams, TTL_STREAM);
  return { streams };
}

module.exports = streamHandler;
