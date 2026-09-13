const tioanime = require("./sources/tioanime");
const latanime = require("./sources/latanime");

const SOURCES = { tio: tioanime, lat: latanime };

async function fetchAnimeDetail(source, slug) {
  const src = SOURCES[source];
  if (!src) throw new Error(`Unknown source: ${source}`);
  return src.fetchAnimeDetail(slug);
}

module.exports = { fetchAnimeDetail };
