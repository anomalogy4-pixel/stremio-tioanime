const { get } = require("../utils/http");

const BASE_URL = "https://tioanime.com";

/**
 * Extracts the videos JS array from episode page HTML.
 * Format: var videos = [["Provider","https://...",0,0], ...]
 */
function extractVideosArray(html) {
  const match = html.match(/var\s+videos\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

/**
 * Fetches an episode page and returns all available embed sources.
 * @param {string} episodeSlug  e.g. "nanatsu-no-taizai-1"
 * @returns {Promise<Array<{host, embedUrl}>>}
 */
async function fetchEpisodeSources(episodeSlug) {
  const url = `${BASE_URL}/ver/${episodeSlug}`;
  const html = await get(url);

  const videos = extractVideosArray(html);
  // videos[i] = [providerName, embedUrl, unknown, hasAds]
  const sources = videos
    .filter(([, embedUrl]) => embedUrl && embedUrl.startsWith("http"))
    .map(([provider, embedUrl]) => ({
      host: provider,
      embedUrl
    }));

  return sources;
}

module.exports = { fetchEpisodeSources };
