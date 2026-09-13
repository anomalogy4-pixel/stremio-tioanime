const tioanime = require("./sources/tioanime");
const latanime = require("./sources/latanime");

const SOURCES = { tio: tioanime, lat: latanime };

async function fetchEpisodeSources(source, slug, epNum) {
  const src = SOURCES[source];
  if (!src) throw new Error(`Unknown source: ${source}`);
  return src.fetchEpisodeSources(slug, epNum);
}

module.exports = { fetchEpisodeSources };
