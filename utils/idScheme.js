// Series ID:  "tio:slug"  or  "lat:slug"
// Video ID:   "tio:slug:epNum"  or  "lat:slug:epNum"

function encodeSeriesId(source, slug) {
  return `${source}:${slug}`;
}

function decodeSeriesId(id) {
  const colonIdx = id.indexOf(":");
  const source = id.slice(0, colonIdx);
  const slug = id.slice(colonIdx + 1);
  return { source, slug };
}

function encodeVideoId(source, slug, epNum) {
  return `${source}:${slug}:${epNum}`;
}

// Returns { source, slug, epNum }
function decodeVideoId(id) {
  const colonIdx = id.indexOf(":");
  const source = id.slice(0, colonIdx);
  const rest = id.slice(colonIdx + 1);
  const lastColon = rest.lastIndexOf(":");
  const slug = rest.slice(0, lastColon);
  const epNum = parseInt(rest.slice(lastColon + 1), 10);
  return { source, slug, epNum };
}

module.exports = { encodeSeriesId, decodeSeriesId, encodeVideoId, decodeVideoId };
