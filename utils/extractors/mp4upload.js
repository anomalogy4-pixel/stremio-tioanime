const { getEmbed, USER_AGENT } = require("../http");
const { unpack } = require("../packer");

// mp4upload's player config is sometimes plain, sometimes inside a P.A.C.K.E.R block.
const SRC = /(?:src|file)\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i;
const ANY_MP4 = /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i;

async function resolve(embedUrl, { referer }) {
  const html = String(await getEmbed(embedUrl, { headers: { Referer: referer } }));
  const haystack = `${html}\n${unpack(html) || ""}`;

  const match = haystack.match(SRC) || haystack.match(ANY_MP4);
  if (!match) return [];

  return [
    {
      url: match[1],
      quality: "MP4",
      // The CDN returns 403 without this Referer.
      headers: { "User-Agent": USER_AGENT, Referer: "https://www.mp4upload.com/" }
    }
  ];
}

module.exports = { resolve };
