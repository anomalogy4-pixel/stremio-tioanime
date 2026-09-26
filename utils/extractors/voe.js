const { getEmbed, USER_AGENT } = require("../http");

// Voe serves a tiny bootstrap page that JS-redirects to a rotating mirror domain.
// The real player config sits in a <script type="application/json"> blob behind a
// fixed obfuscation chain: rot13 -> junk removal -> base64 -> charcode shift -> reverse -> base64.
const JUNK = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
const REDIRECT = /window\.location\.href\s*=\s*['"]([^'"]+)['"]/;
const JSON_BLOB = /<script\s+type="application\/json">\s*(\[[\s\S]*?\])\s*<\/script>/;

function rot13(input) {
  return input.replace(/[a-zA-Z]/g, (ch) => {
    const limit = ch <= "Z" ? 90 : 122;
    const shifted = ch.charCodeAt(0) + 13;
    return String.fromCharCode(limit >= shifted ? shifted : shifted - 26);
  });
}

function deobfuscate(raw) {
  let s = rot13(raw);
  for (const junk of JUNK) s = s.split(junk).join("");
  s = Buffer.from(s, "base64").toString("utf-8");
  s = s.replace(/[\s\S]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 3));
  s = s.split("").reverse().join("");
  return JSON.parse(Buffer.from(s, "base64").toString("utf-8"));
}

async function resolve(embedUrl, { referer }) {
  let html = await getEmbed(embedUrl, { headers: { Referer: referer } });

  const redirect = String(html).match(REDIRECT);
  let pageUrl = embedUrl;
  if (redirect) {
    pageUrl = new URL(redirect[1], embedUrl).toString();
    html = await getEmbed(pageUrl, { headers: { Referer: new URL(embedUrl).origin + "/" } });
  }

  const blob = String(html).match(JSON_BLOB);
  if (!blob) return [];

  const config = deobfuscate(JSON.parse(blob[1])[0]);
  const origin = new URL(pageUrl).origin + "/";
  const streams = [];

  // Voe signs its CDN URLs, so no Referer is required - but keep the UA consistent.
  if (config.direct_access_url) {
    streams.push({
      url: config.direct_access_url,
      quality: "MP4",
      headers: { "User-Agent": USER_AGENT, Referer: origin }
    });
  }
  if (config.source) {
    streams.push({
      url: config.source,
      quality: "HLS",
      headers: { "User-Agent": USER_AGENT, Referer: origin }
    });
  }

  return streams;
}

module.exports = { resolve };
