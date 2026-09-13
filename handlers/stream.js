const { fetchEpisodeSources } = require("../scrapers/episode");
const { decodeVideoId } = require("../utils/idScheme");
const { resolveAll } = require("../utils/extractors");
const cache = require("../cache");

const TTL_STREAM = 4 * 60 * 60 * 1000; // 4 hours

async function streamHandler({ type, id }) {
  if (type !== "series") return { streams: [] };

  const cacheKey = `stream:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return { streams: cached };

  const { slug, epNum } = decodeVideoId(id);
  const episodeSlug = `${slug}-${epNum}`;

  let sources = [];
  try {
    sources = await fetchEpisodeSources(episodeSlug);
  } catch (err) {
    console.error(`[stream] Failed to fetch sources for ${episodeSlug}:`, err.message);
    return { streams: [] };
  }

  // Try to resolve embed URLs to direct stream URLs
  const resolved = await resolveAll(sources);

  // Fallback: if no extractors worked, offer embed URLs as external links
  // (Stremio can open some embeds via external player)
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
