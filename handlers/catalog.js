const { fetchDirectory } = require("../scrapers/directory");
const { encodeSeriesId } = require("../utils/idScheme");
const cache = require("../cache");

const TTL_BROWSE = 15 * 60 * 1000;
const TTL_SEARCH = 5 * 60 * 1000;

const CATALOG_SOURCE = {
  "tioanime-directorio": "tio",
  "latanime-directorio": "lat"
};

async function catalogHandler({ type, id, extra }) {
  if (type !== "series") return { metas: [] };

  const source = CATALOG_SOURCE[id];
  if (!source) return { metas: [] };

  const search = extra?.search || null;
  const skip = parseInt(extra?.skip || "0", 10);
  const cacheKey = `catalog:${source}:${search || ""}:${skip}`;

  const cached = cache.get(cacheKey);
  if (cached) return { metas: cached };

  const stubs = await fetchDirectory(source, { search, skip });

  const metas = stubs.map((stub) => ({
    id: encodeSeriesId(source, stub.slug),
    type: "series",
    name: stub.title,
    poster: stub.posterUrl,
    posterShape: "poster"
  }));

  cache.set(cacheKey, metas, search ? TTL_SEARCH : TTL_BROWSE);
  return { metas };
}

module.exports = catalogHandler;
