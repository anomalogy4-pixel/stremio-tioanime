const { get, post } = require("../http");

/**
 * Extracts a direct stream URL from a StreamSB embed.
 * StreamSB embed URLs: https://embedsb.com/e/{id}.html or similar
 */
async function resolve(embedUrl) {
  try {
    // Extract file ID from the embed URL
    const idMatch = embedUrl.match(/\/e\/([a-zA-Z0-9]+)(?:\.html)?/);
    if (!idMatch) return null;
    const fileId = idMatch[1];

    // StreamSB API endpoint (may need updating if they change it)
    const apiHost = new URL(embedUrl).hostname;
    const apiUrl = `https://${apiHost}/api/source/${fileId}`;

    const data = await post(
      apiUrl,
      `hash=${fileId}&r=https://tioanime.com/&d=${apiHost}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          watchsb: "streamsb",
          Referer: embedUrl,
          Origin: `https://${apiHost}`
        }
      }
    );

    // Response: { success: true, data: [{ file: "url", label: "720p", type: "mp4" }] }
    if (data?.success && Array.isArray(data.data)) {
      // Prefer highest quality
      const sorted = data.data.sort((a, b) => {
        const qa = parseInt(a.label) || 0;
        const qb = parseInt(b.label) || 0;
        return qb - qa;
      });
      if (sorted[0]?.file) return sorted[0].file;
    }
  } catch {
    // Silent fail - extractor may be outdated
  }
  return null;
}

module.exports = { resolve };
