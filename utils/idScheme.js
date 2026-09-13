const PREFIX = "tio:";

function encodeSeriesId(slug) {
  return PREFIX + slug;
}

function decodeSeriesId(id) {
  return id.replace(PREFIX, "");
}

// videoId = "tio:slug:epNum"
function encodeVideoId(slug, epNum) {
  return `${PREFIX}${slug}:${epNum}`;
}

// Returns { slug, epNum }
function decodeVideoId(id) {
  const withoutPrefix = id.replace(PREFIX, "");
  const lastColon = withoutPrefix.lastIndexOf(":");
  const slug = withoutPrefix.slice(0, lastColon);
  const epNum = parseInt(withoutPrefix.slice(lastColon + 1), 10);
  return { slug, epNum };
}

module.exports = { encodeSeriesId, decodeSeriesId, encodeVideoId, decodeVideoId };
