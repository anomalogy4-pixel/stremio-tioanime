const { fetchEpisodeSources } = require("../scrapers/episode");
const { decodeVideoId } = require("../utils/idScheme");
const { resolveAll } = require("../utils/extractors");
const { proxyUrl, baseUrl } = require("../proxy");
const cache = require("../cache");

// Routing through the local proxy makes the CDN headers invisible to the player,
// which is what lets clients that ignore proxyHeaders (Stremio Web, some TV
// builds) play these files. Set PROXY_STREAMS=0 to hand out raw CDN links.
const USE_PROXY = process.env.PROXY_STREAMS !== "0";

// Host tokens expire, so never cache a playable URL longer than they live.
const TTL_STREAM = 30 * 60 * 1000;
// A failure is usually transient (rate limit, host hiccup) - retry soon.
const TTL_EMPTY = 60 * 1000;

async function streamHandler({ type, id }) {
  if (type !== "series") return { streams: [] };

  const { source, slug, epNum } = decodeVideoId(id);
  if (!source || !slug || epNum === null) return { streams: [] };

  // Proxied URLs embed the public base, so cache per base - otherwise a link
  // learned on localhost would be served to a request that arrived elsewhere.
  const cacheKey = USE_PROXY ? `stream:${baseUrl()}:${id}` : `stream:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return { streams: cached };

  let sources = [];
  try {
    sources = await fetchEpisodeSources(source, slug, epNum);
  } catch (err) {
    console.error(`[stream] fetch failed for ${id}: ${err.message}`);
    cache.set(cacheKey, [], TTL_EMPTY);
    return { streams: [] };
  }

  const { streams: resolved, external } = await resolveAll(sources);

  const streams = [
    ...resolved.map((s) => {
      const isHls = s.quality === "HLS";

      if (USE_PROXY) {
        return {
          url: proxyUrl(s.url, s.headers, { hls: isHls }),
          name: "My anime",
          title: `${s.host} · ${s.quality}`
        };
      }

      return {
        url: s.url,
        name: "My anime",
        title: `${s.host} · ${s.quality}`,
        behaviorHints: {
          // Remote files behind hotlink protection, not web-ready URLs.
          notWebReady: true,
          // Without this Stremio sends no Referer and the CDN answers 403.
          proxyHeaders: { request: s.headers }
        }
      };
    }),
    ...external.map((e) => ({
      externalUrl: e.embedUrl,
      name: "My anime",
      title: `${e.host} (abrir fuera) · ${e.reason}`
    }))
  ];

  cache.set(cacheKey, streams, resolved.length > 0 ? TTL_STREAM : TTL_EMPTY);
  return { streams };
}

module.exports = streamHandler;
