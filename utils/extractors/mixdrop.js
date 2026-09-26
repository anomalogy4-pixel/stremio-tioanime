const { getEmbed, USER_AGENT } = require("../http");
const { unpack } = require("../packer");

// MixDrop hides MDCore.wurl (the signed mp4) inside a P.A.C.K.E.R block.
const WURL = /MDCore\.wurl\s*=\s*["']([^"']+)["']/;

async function resolve(embedUrl, { referer }) {
  const html = await getEmbed(embedUrl, { headers: { Referer: referer } });
  const source = unpack(String(html));
  if (!source) return [];

  const match = source.match(WURL);
  if (!match) return [];

  const url = match[1].startsWith("//") ? `https:${match[1]}` : match[1];
  const origin = new URL(embedUrl).origin + "/";

  return [
    {
      url,
      quality: "MP4",
      headers: { "User-Agent": USER_AGENT, Referer: origin }
    }
  ];
}

module.exports = { resolve };
