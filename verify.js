// Live smoke test: walks catalog -> meta -> stream for both sources and
// actually range-requests every resolved URL with the headers the add-on
// hands to Stremio. Run with: node verify.js
// Bypass the proxy so this tests extraction against the real CDNs rather than
// a local server that may not be running.
process.env.PROXY_STREAMS = "0";

const axios = require("axios");
const catalogHandler = require("./handlers/catalog");
const metaHandler = require("./handlers/meta");
const streamHandler = require("./handlers/stream");

const CATALOGS = [
  ["tioanime-directorio", "TioAnime"],
  ["latanime-directorio", "LatAnime"]
];

async function probe(stream) {
  const headers = { ...(stream.behaviorHints?.proxyHeaders?.request || {}), Range: "bytes=0-200" };
  try {
    const res = await axios.get(stream.url, {
      headers,
      timeout: 45000,
      responseType: "arraybuffer",
      validateStatus: () => true,
      maxRedirects: 5
    });
    return `${res.status} ${res.headers["content-type"] || ""}`;
  } catch (err) {
    return `ERR ${err.message}`;
  }
}

(async () => {
  let playable = 0;
  let checked = 0;

  for (const [catalogId, label] of CATALOGS) {
    console.log(`\n===== ${label} =====`);
    const { metas } = await catalogHandler({ type: "series", id: catalogId, extra: {} });
    console.log(`catalog: ${metas.length} items`);
    if (!metas.length) continue;

    for (const candidate of metas.slice(0, 3)) {
      const { meta } = await metaHandler({ type: "series", id: candidate.id });
      if (!meta || !meta.videos.length) {
        console.log(`  ${candidate.id}: no episodes, skipping`);
        continue;
      }
      const videoId = meta.videos[0].id;
      const { streams } = await streamHandler({ type: "series", id: videoId });
      const direct = streams.filter((s) => s.url);
      console.log(`  ${meta.name} (${meta.videos.length} eps) -> ${videoId}`);
      console.log(`    ${direct.length} directos, ${streams.length - direct.length} externos`);

      for (const s of direct) {
        checked++;
        const status = await probe(s);
        const ok = /^(200|206)/.test(status);
        if (ok) playable++;
        console.log(`    ${ok ? "PLAY" : "FAIL"}  ${s.title}  ${status}`);
      }
      for (const s of streams.filter((x) => x.externalUrl)) {
        console.log(`    EXT   ${s.title}`);
      }
      break; // one anime per source is enough for a smoke test
    }
  }

  console.log(`\n${playable}/${checked} direct streams answered 200/206`);
  process.exit(playable > 0 ? 0 : 1);
})();
