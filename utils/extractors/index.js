const streamsbExtractor = require("./streamsb");
const tioanimeExtractor = require("./tioanime");
const mp4uploadExtractor = require("./mp4upload");

// Map host keywords to extractor modules
const EXTRACTORS = [
  { match: /embedsb\.com|streamsb\.com|sbembed\.com/i, extractor: streamsbExtractor, label: "StreamSB" },
  { match: /v\.tioanime\.com/i, extractor: tioanimeExtractor, label: "TioAnime" },
  { match: /mp4upload\.com/i, extractor: mp4uploadExtractor, label: "Mp4Upload" }
];

/**
 * Resolves an embed source to a direct streamable URL.
 * Returns null if no extractor matches or extraction fails.
 * @param {{ host: string, embedUrl: string }} source
 * @returns {Promise<string|null>}
 */
async function resolve(source) {
  const { embedUrl } = source;
  const entry = EXTRACTORS.find(({ match }) => match.test(embedUrl));
  if (!entry) return null;
  return entry.extractor.resolve(embedUrl);
}

/**
 * Resolves all sources and returns valid streams.
 * Skips sources that fail or have no extractor.
 * @param {Array<{host: string, embedUrl: string}>} sources
 * @returns {Promise<Array<{url: string, title: string}>>}
 */
async function resolveAll(sources) {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const url = await resolve(source);
      if (!url) return null;
      return { url, title: source.host };
    })
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);
}

module.exports = { resolve, resolveAll };
