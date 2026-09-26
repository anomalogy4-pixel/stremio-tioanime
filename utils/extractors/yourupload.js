const { getEmbed, USER_AGENT } = require("../http");

// YourUpload embeds expose the CDN file straight in the jwplayer setup call.
const FILE = /file\s*:\s*['"](https?:\/\/[^'"]+)['"]/;

async function resolve(embedUrl, { referer }) {
  const html = await getEmbed(embedUrl, { headers: { Referer: referer } });
  const match = String(html).match(FILE);
  if (!match) return [];

  return [
    {
      url: match[1],
      quality: "MP4",
      headers: { "User-Agent": USER_AGENT, Referer: "https://www.yourupload.com/" }
    }
  ];
}

module.exports = { resolve };
