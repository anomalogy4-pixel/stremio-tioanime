const express = require("express");
const stream = express.Router();
const SL = require("../lib/sololatino");
const { unwrapEmbed69 } = require("../lib/embed69");
const { resolveVidhideMirror } = require("../lib/vidhide");
const PSS = require("../lib/pss");
const fuzzysort = require("fuzzysort");

function parseSoloId(id) {
  const parts = (id || "").split(":");
  if (parts[0] !== "sololatino") return null;
  if (parts[1] === "pelicula" && parts[2]) return { kind: "pelicula", slug: parts[2] };
  if (parts[1] === "serie" && parts[2])
    return {
      kind: "serie",
      slug: parts[2],
      season: parts[3] ? parseInt(parts[3], 10) : 1,
      episode: parts[4] ? parseInt(parts[4], 10) : 1,
    };
  return null;
}

async function titleFromCinemeta(type, id) {
  const url = `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(id)}.json`;
  const resp = await SL.fetchTimeout(url, {}, 10000);
  if (!resp.ok) throw Error("cinemeta " + resp.status);
  const json = await resp.json();
  return json.meta && { name: json.meta.name, type: json.meta.type };
}

async function handleStream(req, res) {
  const { type, videoId } = req.params;
  try {
    let parsed = parseSoloId(videoId);
    if (!parsed) {
      // foreign id: tt1234[:S:E] | tmdb:123[:S:E]
      const parts = videoId.split(":");
      let season, episode, baseId = videoId;
      const stype = type;
      if (/^tt\d+$/.test(parts[0])) {
        baseId = parts[0];
        season = parts[1] ? parseInt(parts[1], 10) : undefined;
        episode = parts[2] ? parseInt(parts[2], 10) : undefined;
      } else if (parts[0] === "tmdb") {
        baseId = `tmdb:${parts[1]}`;
        season = parts[2] ? parseInt(parts[2], 10) : undefined;
        episode = parts[3] ? parseInt(parts[3], 10) : undefined;
      } else {
        throw Error("ID no soportado: " + videoId);
      }
      const info = await titleFromCinemeta(stype, baseId);
      if (!info || !info.name) throw Error("sin titulo para " + baseId);
      const suggestions = await SL.searchSuggest(info.name, 10);
      const previews = suggestions.map(SL.suggestToPreview).filter(Boolean);
      if (!previews.length) throw Error("sin resultados en SoloLatino para " + info.name);
      // Prefer a match of the requested type: picking the raw best match sent a
      // series request to a movie page, which silently dropped season/episode
      // and returned the wrong streams.
      const pool = previews.filter((p) => p.type === stype);
      const candidates = pool.length ? pool : previews;
      const best =
        fuzzysort.go(info.name, candidates, { key: "name", limit: 1 })[0]?.obj || candidates[0];
      parsed = parseSoloId(best.id);
      if (parsed && parsed.kind === "serie") {
        if (season) parsed.season = season;
        if (episode) parsed.episode = episode;
      }
    }
    if (!parsed) throw Error("ID no soportado");

    let pageUrl, label;
    if (parsed.kind === "pelicula") {
      pageUrl = `${SL.BASE}/pelicula/${parsed.slug}`;
      label = parsed.slug;
    } else {
      const s = parsed.season || 1;
      const e = parsed.episode || 1;
      pageUrl = `${SL.BASE}/serie/${parsed.slug}/temporada-${s}/episodio-${e}`;
      label = `${parsed.slug} T${s}E${e}`;
    }

    const { embeds } = await SL.getPagePlayerUrls(pageUrl);
    const base = `${req.protocol}://${req.get("host")}`;
    const [e69, pss] = await Promise.allSettled([
      tryDirectStreams(embeds, label, base),
      tryPssStreams(embeds, label, base),
    ]);
    let streams = [];
    if (e69.status === "fulfilled") streams = streams.concat(e69.value);
    else console.error("embed69 direct failed:", e69.reason?.message || e69.reason);
    if (pss.status === "fulfilled") streams = streams.concat(pss.value);
    else console.error("pss direct failed:", pss.reason?.message || pss.reason);
    streams = streams.concat(SL.embedsToStreams(embeds, pageUrl, label, base));
    // always add "watch on site" fallback
    streams.push({
      externalUrl: pageUrl,
      name: "SoloLatino\nVer en sitio",
      description: `${label}\nAbrir pagina original`,
      behaviorHints: { bingeGroup: "sololatino|site|ext" },
    });
    res.set("Cache-Control", "max-age=3600, stale-while-revalidate=86400");
    res.json({ streams });
  } catch (err) {
    console.error("stream error:", err.message);
    if (!res.headersSent) res.json({ streams: [], message: "Error: " + err.message });
  }
}

stream.get("/stream/:type/:videoId.json", handleStream);

// Tries to turn pelisserieshoy iframes into direct in-Stremio streams:
// click -> scan (a=1) -> resolve each server (a=2). Empty while the PSS
// backend has no streaming servers; then only external fallbacks remain.
// HLS/mp4 go through our /proxy so cloud IP = fetch IP (24/7 safe).
async function tryPssStreams(embeds, label, base) {
  const out = [];
  const targets = embeds.filter((e) => /pelisserieshoy\.com/i.test(e.url));
  for (const t of targets) {
    try {
      const res = await PSS.scanAndResolve(t.url);
      if (!res.resolved.length) {
        if (res.note) console.error("pss scan empty:", res.note);
        continue;
      }
      out.push(...PSS.toStreams(res, label, base));
    } catch (e) {
      console.error("pss embed skipped:", e.message || e);
    }
  }
  return out;
}

// Tries to turn embed69 iframes into direct in-Stremio HLS streams:
// embed69 page -> PoW + AES unwrap -> vidhide-mirror URL -> unpack -> m3u8.
// Anything that fails is skipped (external fallbacks still returned).
// Returned URL points to /proxy/hls so Stremio fetches via us (same IP that
// resolved the signed asn= URL) instead of hitting the CDN directly.
const LANG_LABELS = {
  LAT: "Latino",
  SUB: "Subtitulado",
  ESP: "Castellano",
  CAST: "Castellano",
  ENG: "Ingles",
};

function langLabel(lang) {
  return LANG_LABELS[lang] || lang || "Desconocido";
}

// LAT first, then SUB, then anything else — the order Stremio lists them in.
function langRank(lang) {
  return lang === "LAT" ? 0 : lang === "SUB" ? 1 : 2;
}

async function tryDirectStreams(embeds, label, base) {
  const e69 = embeds.filter((e) => /embed69\.org/i.test(e.url));
  const unwrapped = await Promise.allSettled(e69.map((e) => unwrapEmbed69(e.url)));

  // Group every decrypted vidhide video link by language. The previous version
  // returned the first link that resolved, so a title carrying both a LAT and a
  // SUB version (12 decrypted links for a typical movie) surfaced exactly one
  // playable stream and discarded the rest.
  const byLang = new Map();
  for (const r of unwrapped) {
    if (r.status !== "fulfilled") {
      console.error("embed69 unwrap failed:", r.reason?.message || r.reason);
      continue;
    }
    for (const link of r.value) {
      if (link.kind !== "video" || !/vidhide/i.test(link.servername)) continue;
      const lang = (link.lang || "").toUpperCase() || "???";
      if (!byLang.has(lang)) byLang.set(lang, []);
      byLang.get(lang).push(link);
    }
  }

  const langs = [...byLang.keys()].sort(
    (a, b) => langRank(a) - langRank(b) || a.localeCompare(b)
  );
  // One resolve per language, in parallel; within a language fall through the
  // mirrors until one unpacks.
  const settled = await Promise.allSettled(
    langs.map(async (lang) => {
      for (const link of byLang.get(lang)) {
        try {
          return { lang, direct: await resolveVidhideMirror(link.url) };
        } catch (_) {}
      }
      throw Error(`no resolvable vidhide link for ${lang}`);
    })
  );

  const out = [];
  const seen = new Set();
  for (const r of settled) {
    if (r.status !== "fulfilled") {
      if (r.reason) console.error("direct stream skipped:", r.reason.message || r.reason);
      continue;
    }
    const { lang, direct } = r.value;
    if (seen.has(direct.url)) continue; // two mirrors can land on one CDN URL
    seen.add(direct.url);
    const proxied = `${base}/proxy/hls?url=${encodeURIComponent(direct.url)}&referer=${encodeURIComponent(direct.referer || "")}`;
    const name = langLabel(lang);
    out.push({
      url: proxied,
      name: `SoloLatino\nVidhide ${name}`,
      description: `${label}\nDirecto ${name} (HLS via proxy)\n${direct.url}`,
      behaviorHints: {
        // Per-language group so binge-watching stays in the chosen language.
        bingeGroup: `sololatino|vidhide|${lang}`,
        notWebReady: true,
      },
    });
  }
  return out;
}

module.exports = stream;
