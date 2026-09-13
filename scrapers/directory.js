const tioanime = require("./sources/tioanime");
const latanime = require("./sources/latanime");

const SOURCES = { tio: tioanime, lat: latanime };

async function fetchDirectory(source, params) {
  const src = SOURCES[source];
  if (!src) throw new Error(`Unknown source: ${source}`);
  return src.fetchDirectory(params);
}

module.exports = { fetchDirectory };
