// Series ID:  "tio:slug"  or  "lat:slug"
// Video ID:   "tio:slug:epNum"  or  "lat:slug:epNum"

function encodeSeriesId(source, slug) {
  return `${source}:${slug}`;
}

function decodeSeriesId(id) {
  const colonIdx = String(id || "").indexOf(":");
  if (colonIdx === -1) return { source: null, slug: null };
  return { source: id.slice(0, colonIdx), slug: id.slice(colonIdx + 1) || null };
}

function encodeVideoId(source, slug, epNum) {
  return `${source}:${slug}:${epNum}`;
}

// Returns { source, slug, epNum }. epNum is null when the id carries no episode.
function decodeVideoId(id) {
  const { source, slug: rest } = decodeSeriesId(id);
  if (!source || !rest) return { source: null, slug: null, epNum: null };

  const lastColon = rest.lastIndexOf(":");
  // No trailing ":N" - this is a series id, not a video id.
  if (lastColon === -1) return { source, slug: rest, epNum: null };

  const epNum = Number.parseInt(rest.slice(lastColon + 1), 10);
  if (!Number.isFinite(epNum)) return { source, slug: rest, epNum: null };

  return { source, slug: rest.slice(0, lastColon), epNum };
}

module.exports = { encodeSeriesId, decodeSeriesId, encodeVideoId, decodeVideoId };
