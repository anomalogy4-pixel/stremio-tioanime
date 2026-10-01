// Unwrap embed69.org links: PoW + AES-256-CBC (see inline player script).
// dataLink[].sortedEmbeds[].link (base64: iv[16] + ciphertext) decrypts to
// the real server embed URL (vidhide/streamwish/voe mirrors).
const crypto = require("node:crypto");
const { fetchTimeout } = require("./sololatino");

// solvePow is a blocking hash loop; at difficulty 3 it is ~4k hashes, but the
// page controls the number, so cap it rather than freezing the event loop.
const MAX_POW_ITERATIONS = 50_000_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function sha256hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function solvePow(challenge, difficulty) {
  const prefix = "0".repeat(difficulty);
  for (let nonce = 0; nonce < MAX_POW_ITERATIONS; nonce++) {
    if (sha256hex(challenge + nonce).startsWith(prefix)) return nonce;
  }
  throw Error(`embed69: PoW difficulty ${difficulty} not solvable in budget`);
}

function decryptLink(linkB64, key) {
  const raw = Buffer.from(linkB64, "base64");
  const iv = raw.subarray(0, 16);
  const ct = raw.subarray(16);
  const dec = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([dec.update(ct), dec.final()]).toString("utf8");
}

// Returns [{ file_id, lang, servername, url, kind }] for LAT first, then others.
async function unwrapEmbed69(embedUrl) {
  const html = await fetchTimeout(embedUrl, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*", Referer: "https://sololatino.net/" },
  }).then((r) => {
    if (!r.ok) throw Error(`embed69 HTTP ${r.status}`);
    return r.text();
  });
  const challenge = /POW_CHALLENGE\s*=\s*'([^']+)'/.exec(html)?.[1];
  const difficulty = parseInt(/POW_DIFFICULTY\s*=\s*(\d+)/.exec(html)?.[1] || "3", 10);
  const salt = /POW_SALT\s*=\s*'([^']+)'/.exec(html)?.[1];
  const dataLinkSrc = /let dataLink = (\[.+?\]);/s.exec(html)?.[1];
  if (!challenge || !salt || !dataLinkSrc) throw Error("embed69 page format changed");
  const dataLink = JSON.parse(dataLinkSrc);

  const nonce = solvePow(challenge, difficulty);
  const key = crypto.createHash("sha256").update(challenge + nonce + salt).digest();

  const out = [];
  const files = [...dataLink].sort((a, b) =>
    a.video_language === "LAT" ? -1 : b.video_language === "LAT" ? 1 : 0
  );
  for (const file of files) {
    for (const emb of [...(file.sortedEmbeds || []), ...(file.downloadEmbeds || [])]) {
      try {
        out.push({
          file_id: file.file_id,
          lang: file.video_language,
          servername: emb.servername,
          kind: emb.type,
          url: decryptLink(emb.link, key),
        });
      } catch (_) {}
    }
  }
  if (!out.length) throw Error("embed69: no links decrypted");
  return out;
}

module.exports = { unwrapEmbed69 };
