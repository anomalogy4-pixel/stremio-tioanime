const cheerio = require("cheerio");

const BASE = "https://sololatino.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REQ_TIMEOUT = 20000;

// fetch with an abort timeout: without it a hung site request pins an
// Express handler open forever (Stremio just spins).
async function fetchTimeout(url, opts = {}, ms = REQ_TIMEOUT) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: c.signal });
  } catch (e) {
    if (e.name === "AbortError") throw Error(`timeout after ${ms}ms for ${url}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function siteFetch(url, opts = {}) {
  return fetchTimeout(url, {
    headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9,en;q=0.8", ...(opts.headers || {}) },
    ...opts,
  }).then((resp) => {
    if (!resp.ok) throw Error(`HTTP error! Status: ${resp.status} for ${url}`);
    return resp;
  });
}

function html(url) {
  return siteFetch(url, { headers: { Accept: "text/html,application/xhtml+xml" } }).then((r) => r.text());
}

// ---------- LD+JSON helpers ----------
function extractGraphs(pageHtml) {
  const $ = cheerio.load(pageHtml);
  const graphs = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text());
      const arr = json["@graph"] ? json["@graph"] : [json];
      for (const g of arr) graphs.push(g);
    } catch (_) {}
  });
  return graphs;
}

function findGraph(graphs, type) {
  return graphs.find((g) => g["@type"] === type);
}

function tmdbIdFromSameAs(sameAs = []) {
  for (const u of sameAs) {
    const m = /themoviedb\.org\/(movie|tv)\/(\d+)/.exec(u || "");
    if (m) return { kind: m[1], id: m[2] };
  }
  return null;
}

function imdbIdFromSameAs(sameAs = []) {
  for (const u of sameAs) {
    const m = /imdb\.com\/title\/(tt\d+)/.exec(u || "");
    if (m) return m[1];
  }
  return null;
}

// ---------- search ----------
async function searchSuggest(query, limit = 25) {
  const url = `${BASE}/api/search/suggest?q=${encodeURIComponent(query)}`;
  const resp = await siteFetch(url, { headers: { Accept: "application/json", Referer: `${BASE}/` } });
  const data = await resp.json();
  return Array.isArray(data) ? data.slice(0, limit) : [];
}

function suggestToPreview(item) {
  // item: {type,title,year,poster,url}
  const url = item.url || "";
  const slugMatch = /\/(pelicula|serie)\/([a-z0-9\-]+)/i.exec(url);
  if (!slugMatch) return null;
  const kind = slugMatch[1].toLowerCase();
  const slug = slugMatch[2];
  const isMovie = kind === "pelicula" || item.type === "movie";
  return {
    id: isMovie ? `sololatino:pelicula:${slug}` : `sololatino:serie:${slug}`,
    type: isMovie ? "movie" : "series",
    name: item.title,
    poster: item.poster,
    releaseInfo: item.year ? String(item.year) : undefined,
  };
}

// ---------- catalog cards ----------
function parseCards(pageHtml) {
  const $ = cheerio.load(pageHtml);
  const out = [];
  $("div.movies-grid div.card").each((_, el) => {
    const a = $(el).find("a").first();
    const href = a.attr("href") || "";
    const m = /\/(pelicula|serie)\/([a-z0-9\-]+)/i.exec(href);
    if (!m) return;
    const kind = m[1].toLowerCase();
    const slug = m[2];
    const img = $(el).find("img.card__poster").first();
    const title = ($(el).find(".card__caption .card__title").first().text() || img.attr("alt") || "").trim();
    const year = ($(el).find(".card__caption .card__year").first().text() || "").trim();
    const badge = ($(el).find(".card__badge").first().text() || "").trim().toLowerCase();
    const poster = img.attr("src") || undefined;
    if (!title || !slug) return;
    const isMovie = kind === "pelicula" || badge.includes("pel");
    out.push({
      id: isMovie ? `sololatino:pelicula:${slug}` : `sololatino:serie:${slug}`,
      type: isMovie ? "movie" : "series",
      name: title,
      poster,
      releaseInfo: year || undefined,
    });
  });
  return out;
}

async function scrapeList(path, page = 1) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}page=${page}`;
  const pageHtml = await html(url);
  return parseCards(pageHtml);
}

// ---------- meta ----------
async function getMovieMeta(slug) {
  const pageUrl = `${BASE}/pelicula/${slug}`;
  const pageHtml = await html(pageUrl);
  const graphs = extractGraphs(pageHtml);
  const movie = findGraph(graphs, "Movie") || {};
  const poster = movie.image || movie.thumbnailUrl;
  const $ = cheerio.load(pageHtml);
  const bg = $('meta[property="og:image"]').attr("content") || poster;
  const genres = Array.isArray(movie.genre) ? movie.genre : movie.genre ? [movie.genre] : [];
  const year = (movie.datePublished || "").slice(0, 4) || undefined;
  const imdb = imdbIdFromSameAs(movie.sameAs || []);
  const tmdb = tmdbIdFromSameAs(movie.sameAs || []);
  return {
    id: `sololatino:pelicula:${slug}`,
    type: "movie",
    name: movie.name || slug,
    poster: poster || undefined,
    background: bg || undefined,
    description: movie.description || $('meta[name="description"]').attr("content"),
    genres: genres.length ? genres : undefined,
    releaseInfo: year,
    imdbRating: movie.aggregateRating ? String(movie.aggregateRating.ratingValue) : undefined,
    website: pageUrl,
    behaviorHints: { defaultVideoId: `sololatino:pelicula:${slug}` },
    ...(imdb ? { imdb_id: imdb } : {}),
    ...(tmdb ? { tmdb_id: tmdb.kind === "movie" ? tmdb.id : undefined } : {}),
  };
}

// Each a.ep-item on a series page carries the episode's own title, overview,
// still and air date. Reading only the href threw all of that away: every
// episode came back as "T1 E1" with the series poster and the series' own
// release date, so Stremio could show neither episode names nor air dates.
function parseDmy(txt) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(txt || "");
  if (!m) return undefined;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return isNaN(d.getTime()) ? undefined : d;
}

function parseEpisodes($, slug, tv, poster) {
  const epRe = new RegExp(`/serie/${slug}/temporada-(\\d+)/episodio-(\\d+)`, "i");
  const byKey = new Map();

  $("a.ep-item").each((_, el) => {
    const $el = $(el);
    const m = epRe.exec($el.attr("href") || "");
    if (!m) return;
    const s = Number(m[1]);
    const e = Number(m[2]);
    const ps = $el.find("p");
    // p[0] = "E1", p[1] = title, p[2] = overview, p[last] = dd/mm/yyyy
    const title = (ps.eq(1).text() || "").trim();
    const overview = (ps.eq(2).text() || "").trim();
    const released = parseDmy(ps.last().text());
    const thumb = $el.find("img.ep-thumb").attr("src");
    byKey.set(`${s}:${e}`, {
      s,
      e,
      title: title || undefined,
      overview: overview || undefined,
      released,
      thumbnail: thumb || poster,
    });
  });

  // Fallback for a page that no longer uses .ep-item: recover season/episode
  // numbers from any matching link so the series stays playable.
  if (!byKey.size) {
    $("a[href]").each((_, el) => {
      const m = epRe.exec($(el).attr("href") || "");
      if (!m) return;
      const key = `${m[1]}:${m[2]}`;
      if (!byKey.has(key))
        byKey.set(key, { s: Number(m[1]), e: Number(m[2]), thumbnail: poster });
    });
  }

  const seriesDate = tv.datePublished ? new Date(tv.datePublished) : undefined;
  return [...byKey.values()]
    .sort((a, b) => a.s - b.s || a.e - b.e)
    .map((v) => ({
      id: `sololatino:serie:${slug}:${v.s}:${v.e}`,
      title: v.title || `T${v.s} E${v.e}`,
      season: v.s,
      episode: v.e,
      overview: v.overview,
      released: v.released || seriesDate,
      available: true,
      thumbnail: v.thumbnail,
    }));
}

async function getSerieMeta(slug) {
  const pageUrl = `${BASE}/serie/${slug}`;
  const pageHtml = await html(pageUrl);
  const graphs = extractGraphs(pageHtml);
  const tv = findGraph(graphs, "TVSeries") || {};
  const $ = cheerio.load(pageHtml);
  const poster = tv.image || tv.thumbnailUrl;
  const bg = $('meta[property="og:image"]').attr("content") || poster;
  const genres = Array.isArray(tv.genre) ? tv.genre : tv.genre ? [tv.genre] : [];
  const year = (tv.datePublished || "").slice(0, 4) || undefined;

  const videos = parseEpisodes($, slug, tv, poster);

  return {
    id: `sololatino:serie:${slug}`,
    type: "series",
    name: tv.name || slug,
    poster,
    background: bg || undefined,
    description: tv.description || $('meta[name="description"]').attr("content"),
    genres: genres.length ? genres : undefined,
    releaseInfo: year,
    imdbRating: tv.aggregateRating ? String(tv.aggregateRating.ratingValue) : undefined,
    website: pageUrl,
    videos: videos.length ? videos : undefined,
  };
}

// ---------- player ----------
// POST /api/player-url needs sanctum csrf cookie + X-XSRF-TOKEN header.
async function getXsrfSession(referer) {
  const csrfResp = await fetchTimeout(`${BASE}/sanctum/csrf-cookie`, {
    headers: { "User-Agent": UA, Accept: "*/*", Referer: referer || `${BASE}/` },
  });
  const setCookies = typeof csrfResp.headers.getSetCookie === "function" ? csrfResp.headers.getSetCookie() : [];
  const jar = {};
  for (const c of setCookies) {
    const m = /^([^=]+)=([^;]+)/.exec(c);
    if (m) jar[m[1]] = m[2];
  }
  await csrfResp.text().catch(() => "");
  return jar;
}

async function resolvePlayerToken(token, referer) {
  const jar = await getXsrfSession(referer);
  const xsrfRaw = jar["XSRF-TOKEN"];
  if (!xsrfRaw) throw Error("No XSRF-TOKEN cookie");
  const xsrf = decodeURIComponent(xsrfRaw);
  const cookieHeader = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const resp = await fetchTimeout(`${BASE}/api/player-url`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: referer,
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN": xsrf,
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ t: token }),
  });
  if (!resp.ok) throw Error(`player-url HTTP ${resp.status}`);
  return resp.json(); // {url, type}
}

async function getPagePlayerUrls(pageUrl) {
  const pageHtml = await html(pageUrl);
  const tokens = [...new Set([...pageHtml.matchAll(/data-player-token="([^"]+)"/g)].map((m) => m[1]))];
  if (!tokens.length) throw Error("No player tokens found (VIP-only or page changed?)");
  const results = [];
  for (const t of tokens) {
    try {
      const r = await resolvePlayerToken(t, pageUrl);
      if (r && r.url) results.push(r);
    } catch (e) {
      console.error("resolvePlayerToken failed:", e.message);
    }
  }
  return { pageHtml, embeds: results };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function embedsToStreams(embeds, pageUrl, label, base) {
  return embeds.map((e) => {
    const host = hostOf(e.url);
    if (e.type === "mp4") {
      const url = base
        ? `${base}/proxy/media?url=${encodeURIComponent(e.url)}&referer=${encodeURIComponent(pageUrl)}`
        : e.url;
      return {
        url,
        name: `SoloLatino\n${host}`,
        description: `${label}\n${host}\nLatino`,
        behaviorHints: { bingeGroup: `sololatino|${host}` },
      };
    }
    return {
      externalUrl: e.url,
      name: `SoloLatino\n${host} (ext)`,
      description: `${label}\nAbre ${host} en el navegador\n${e.url}`,
      behaviorHints: { bingeGroup: `sololatino|${host}|ext` },
    };
  });
}

module.exports = {
  BASE,
  fetchTimeout,
  html,
  searchSuggest,
  suggestToPreview,
  scrapeList,
  parseCards,
  getMovieMeta,
  getSerieMeta,
  getPagePlayerUrls,
  embedsToStreams,
  hostOf,
};
