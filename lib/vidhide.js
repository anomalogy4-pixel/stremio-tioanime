// Resolve vidhide-mirror embeds (e.g. morencius.com/embed/<id>) to a direct HLS URL.
// Page hides a packed (obfuscated) script defining links={hls2,hls3,...}; unpack and pick best.
const unpacker = require("unpacker");
const { fetchTimeout } = require("./sololatino");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function resolveVidhideMirror(embedUrl) {
  const html = await fetchTimeout(embedUrl, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*", Referer: "https://embed69.org/" },
  }).then((r) => {
    if (!r.ok) throw Error(`vidhide mirror HTTP ${r.status}`);
    return r.text();
  });
  const evals = [...html.matchAll(/eval\(function\(p,a,c,k,e,d.*?\)\)\)/gs)].map((m) => m[0]);
  for (const e of evals) {
    let up;
    try {
      up = unpacker.unpack(e);
    } catch (_) {
      continue;
    }
    // Prefer hls2/hls4 (m3u8), fallback to any m3u8/mp4 URL in unpacked code.
    const hls =
      /"(hls\d)"\s*:\s*"(https:[^"]+)"/g;
    const found = [...up.matchAll(hls)].map((m) => ({ k: m[1], url: m[2].replace(/\\\//g, "/") }));
    const m3u8 = [...up.matchAll(/https:\/\/[^"'\\\s]+?\.m3u8[^"'\\\s]*/gi)].map((m) => m[0]);
    const mp4 = [...up.matchAll(/https:\/\/[^"'\\\s]+?\.mp4[^"'\\\s]*/gi)].map((m) => m[0]);
    const pick =
      found.find((f) => f.k === "hls2")?.url ||
      found.find((f) => f.k === "hls4")?.url ||
      m3u8[0] ||
      mp4[0];
    if (pick) return { url: pick, referer: new URL(embedUrl).origin + "/" };
  }
  throw Error("vidhide mirror: no playable URL found");
}

module.exports = { resolveVidhideMirror };
