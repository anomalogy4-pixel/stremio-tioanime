const voe = require("./voe");
const yourupload = require("./yourupload");
const mixdrop = require("./mixdrop");
const mp4upload = require("./mp4upload");

// An extractor turns an embed page into zero or more direct, playable URLs.
// Each returns [{ url, quality, headers }].
const EXTRACTORS = [
  // Voe rotates mirror domains constantly; match the stable ones it links from.
  { match: /voe\.sx|voe-un-block|voeun-?blo?c?k|voeunbl|voe-?network/i, label: "Voe", extractor: voe },
  { match: /yourupload\.com/i, label: "YourUpload", extractor: yourupload },
  { match: /mixdrop\.(to|top|co|club|bz|ps|sx)|mxdrop\./i, label: "MixDrop", extractor: mixdrop },
  { match: /mp4upload\.com/i, label: "Mp4Upload", extractor: mp4upload }
];

// Hosts that can never be resolved to a direct URL (client-side decryption,
// aggressive bot protection, or a JS-only player). They are offered as
// external links instead of being silently dropped.
const EXTERNAL_ONLY = [
  { match: /mega\.(nz|co\.nz)/i, label: "Mega", reason: "cifrado en el navegador" },
  { match: /savefiles\.com|streamwish|filelions/i, label: "SaveFiles", reason: "protegido por Cloudflare" },
  { match: /hexload\.com/i, label: "Hexload", reason: "requiere el reproductor web" },
  { match: /dsvplay\.com/i, label: "DsvPlay", reason: "bloquea peticiones externas" },
  { match: /bysekoze\.com|byse/i, label: "Byse", reason: "reproductor solo JS" }
];

function findExtractor(embedUrl) {
  return EXTRACTORS.find(({ match }) => match.test(embedUrl)) || null;
}

function isExternalOnly(embedUrl) {
  return EXTERNAL_ONLY.find(({ match }) => match.test(embedUrl)) || null;
}

/**
 * Resolves one embed source to direct streams.
 * @param {{ host: string, embedUrl: string, referer?: string }} source
 * @returns {Promise<Array<{url: string, quality: string, headers: object}>>}
 */
async function resolve(source) {
  const entry = findExtractor(source.embedUrl);
  if (!entry) return [];

  const streams = await entry.extractor.resolve(source.embedUrl, {
    referer: source.referer || new URL(source.embedUrl).origin + "/"
  });

  return (streams || [])
    .filter((s) => s && typeof s.url === "string" && s.url.startsWith("http"))
    .map((s) => ({ ...s, host: entry.label }));
}

/**
 * Resolves every source concurrently.
 * @param {Array<{host: string, embedUrl: string, referer?: string}>} sources
 * @returns {Promise<{ streams: Array, external: Array }>}
 */
async function resolveAll(sources) {
  const results = await Promise.allSettled(
    sources.map(async (source) => ({ source, streams: await resolve(source) }))
  );

  const streams = [];
  const external = [];
  const seen = new Set();

  results.forEach((result, i) => {
    const source = sources[i];
    const resolved = result.status === "fulfilled" ? result.value.streams : [];

    for (const stream of resolved) {
      if (seen.has(stream.url)) continue;
      seen.add(stream.url);
      streams.push(stream);
    }

    if (resolved.length > 0) return;

    const known = isExternalOnly(source.embedUrl);
    const entry = findExtractor(source.embedUrl);
    let reason;

    if (known) {
      reason = known.reason;
    } else if (result.status === "rejected") {
      // Matched an extractor but the host refused - usually a dead or expired embed.
      const status = result.reason?.response?.status;
      console.error(`[extractor] ${source.host} failed: ${result.reason?.message}`);
      reason = status ? `no disponible (${status})` : "no disponible";
    } else if (entry) {
      reason = "el enlace ya no sirve";
    } else {
      reason = "sin extractor";
    }

    external.push({
      host: known?.label || entry?.label || source.host,
      embedUrl: source.embedUrl,
      reason
    });
  });

  return { streams, external };
}

module.exports = { resolve, resolveAll, findExtractor, isExternalOnly };
