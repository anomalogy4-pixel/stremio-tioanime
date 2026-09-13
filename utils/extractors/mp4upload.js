const { get } = require("../http");

/**
 * Resolves mp4upload.com embed URLs to direct mp4 stream URLs.
 */
async function resolve(embedUrl) {
  try {
    const html = await get(embedUrl, {
      headers: {
        Referer: "https://tioanime.com/"
      }
    });

    // mp4upload typically embeds the source in a jwplayer setup call
    const match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*?)["']/i);
    if (match) return match[1];

    // Fallback: any mp4 URL
    const fallback = html.match(/["'](https?:\/\/[^"']*mp4upload[^"']+\.mp4[^"']*?)["']/i);
    if (fallback) return fallback[1];
  } catch {
    // Silent fail
  }
  return null;
}

module.exports = { resolve };
