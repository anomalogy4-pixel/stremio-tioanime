const cheerio = require("cheerio");
const { get } = require("../../utils/http");

const BASE_URL = "https://latanime.org";
// Verified against the live listing: 30 cards per page.
const ITEMS_PER_PAGE = 30;

async function fetchDirectory({ search = null, skip = 0 }) {
  const page = Math.floor(skip / ITEMS_PER_PAGE) + 1;
  const url = search
    ? `${BASE_URL}/buscar?q=${encodeURIComponent(search)}&p=${page}`
    : `${BASE_URL}/animes?p=${page}`;

  const html = await get(url, { headers: { Referer: `${BASE_URL}/` } });
  return parseCards(html);
}

// Browse cards lazy-load (<img class="lozad" data-src alt="Title">) while search
// cards do not (<img src alt="">). Only the <h3> is present in both layouts.
function parseCards(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $("a[href*='/anime/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/anime\/([^/?#]+)/);
    if (!match) return;

    const slug = match[1];
    if (seen.has(slug)) return;

    const card = $(el);
    const img = card.find("img").last();
    const title = card.find(".seriedetails h3").first().text().trim() || img.attr("alt") || "";
    if (!title) return;

    // data-src holds the real poster; src is a placeholder while lazy-loading.
    const poster = img.attr("data-src") || img.attr("src") || "";
    const posterUrl = poster.startsWith("http") ? poster : `${BASE_URL}${poster}`;

    seen.add(slug);
    results.push({ slug, title, posterUrl, type: "series" });
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

  // <span class="span-tiempo">Estreno: 03 de Abril de 2026</span>
  const year =
    extractYear($(".span-tiempo").first().text() || "") ||
    extractYear($("*:contains('Estreno:')").last().text() || "");

  // Episodes: <a href="https://latanime.org/ver/{slug}-episodio-{N}">
  const episodes = [];
  const seen = new Set();
  $("a[href*='/ver/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const epMatch = href.match(/-episodio-(\d+)(?:[/?#]|$)/);
    if (!epMatch) return;
    const num = parseInt(epMatch[1], 10);
    if (Number.isNaN(num) || seen.has(num)) return;
    seen.add(num);
    episodes.push({ number: num, title: `Episodio ${num}` });
  });

  episodes.sort((a, b) => a.number - b.number);

  return { slug, title, description, posterUrl, genres, year, episodes };
}

function extractYear(text) {
  const match = text.match(/\b(?:19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
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
        sources.push({ host, embedUrl, referer: `${BASE_URL}/` });
      }
    } catch {
      // skip malformed base64
    }
  });

  return sources;
}

module.exports = { fetchDirectory, fetchAnimeDetail, fetchEpisodeSources, ITEMS_PER_PAGE };
