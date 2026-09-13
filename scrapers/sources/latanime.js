const cheerio = require("cheerio");
const { get } = require("../../utils/http");

const BASE_URL = "https://latanime.org";
const ITEMS_PER_PAGE = 24;

async function fetchDirectory({ search = null, skip = 0 }) {
  let url;
  if (search) {
    url = `${BASE_URL}/buscar?q=${encodeURIComponent(search)}`;
  } else {
    const page = Math.floor(skip / ITEMS_PER_PAGE) + 1;
    url = `${BASE_URL}/animes?p=${page}`;
  }

  const html = await get(url, { headers: { Referer: `${BASE_URL}/` } });
  const $ = cheerio.load(html);
  const results = [];

  // Cards: <a href="https://latanime.org/anime/slug"><div class="series"><img class="lozad" data-src="..." alt="Title">
  $("a[href*='/anime/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/anime\/([^/?#]+)/);
    if (!match) return;
    const slug = match[1];

    const img = $(el).find("img.lozad").first();
    if (!img.length) return;

    const title = img.attr("alt") || "";
    const posterUrl = img.attr("data-src") || img.attr("src") || "";

    if (slug && title) {
      results.push({ slug, title, posterUrl, type: "series" });
    }
  });

  return results;
}

async function fetchAnimeDetail(slug) {
  const url = `${BASE_URL}/anime/${slug}`;
  const html = await get(url, { headers: { Referer: `${BASE_URL}/` } });
  const $ = cheerio.load(html);

  const title = $("h2").first().text().trim();

  const imgEl = $(".serieimgficha img").first();
  const imgSrc = imgEl.attr("src") || "";
  const posterUrl = imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`;

  const description = $("p.opacity-75").first().text().trim() || "";

  const genres = [];
  $("a[href*='/genero/']").each((_, el) => {
    const g = $(el).text().trim();
    if (g) genres.push(g);
  });

  let year = null;
  $("p, span").each((_, el) => {
    const text = $(el).text();
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    if (yearMatch && !year) year = parseInt(yearMatch[0], 10);
  });

  // Episodes: <a href="https://latanime.org/ver/{slug}-episodio-{N}">
  const episodes = [];
  $("a[href*='/ver/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const epMatch = href.match(/-episodio-(\d+)$/);
    if (!epMatch) return;
    const num = parseInt(epMatch[1], 10);
    if (!isNaN(num)) {
      episodes.push({ number: num, title: `Episodio ${num}` });
    }
  });

  // Sort ascending, deduplicate
  const seen = new Set();
  const sortedEpisodes = episodes
    .filter((ep) => { if (seen.has(ep.number)) return false; seen.add(ep.number); return true; })
    .sort((a, b) => a.number - b.number);

  return { slug, title, description, posterUrl, genres, year, episodes: sortedEpisodes };
}

async function fetchEpisodeSources(slug, epNum) {
  const url = `${BASE_URL}/ver/${slug}-episodio-${epNum}`;
  const html = await get(url, { headers: { Referer: `${BASE_URL}/` } });
  const $ = cheerio.load(html);

  const sources = [];
  // <a class="play-video repro-item cap" data-player="BASE64_ENCODED_URL">providerName</a>
  $("a.play-video[data-player]").each((_, el) => {
    const encoded = $(el).attr("data-player") || "";
    const host = $(el).text().trim();
    try {
      const embedUrl = Buffer.from(encoded, "base64").toString("utf-8");
      if (embedUrl.startsWith("http")) {
        sources.push({ host, embedUrl });
      }
    } catch {
      // skip malformed base64
    }
  });

  return sources;
}

module.exports = { fetchDirectory, fetchAnimeDetail, fetchEpisodeSources };
