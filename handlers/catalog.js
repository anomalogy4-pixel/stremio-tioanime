const { fetchDirectory } = require("../scrapers/directory");
const { encodeSeriesId } = require("../utils/idScheme");
const cache = require("../cache");

const TTL_BROWSE = 15 * 60 * 1000; // 15 min
const TTL_SEARCH = 5 * 60 * 1000;  // 5 min

async function catalogHandler({ type, id, extra }) {
  if (type !== "series" || id !== "tioanime-directorio") {
    return { metas: [] };
  }

  const search = extra?.search || null;
  const skip = parseInt(extra?.skip || "0", 10);
  const cacheKey = `catalog:${search || ""}:${skip}`;

  const cached = cache.get(cacheKey);
  if (cached) return { metas: cached };

  const stubs = await fetchDirectory({ search, skip });

  const metas = stubs.map((stub) => ({
    id: encodeSeriesId(stub.slug),
    type: "series",
    name: stub.title,
    poster: stub.posterUrl,
    posterShape: "poster"
  }));

  cache.set(cacheKey, metas, search ? TTL_SEARCH : TTL_BROWSE);
  return { metas };
}

module.exports = catalogHandler;
