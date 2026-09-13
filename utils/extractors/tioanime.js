const { get } = require("../http");

/**
 * Resolves v.tioanime.com/embed.php URLs to direct stream URLs.
 * These are custom tioanime proxy embeds that redirect to actual streams.
 */
async function resolve(embedUrl) {
  try {
    const html = await get(embedUrl, {
      headers: {
        Referer: "https://tioanime.com/"
      }
    });

    // Look for m3u8 playlists
    const m3u8Match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*?)["']/);
    if (m3u8Match) return m3u8Match[1];

    // Look for mp4 URLs
    const mp4Match = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*?)["']/);
    if (mp4Match) return mp4Match[1];

    // Look for source src in video tags
    const srcMatch = html.match(/<source[^>]+src=["']([^"']+)["']/i);
    if (srcMatch) return srcMatch[1];
  } catch {
    // Silent fail
  }
  return null;
}

module.exports = { resolve };
