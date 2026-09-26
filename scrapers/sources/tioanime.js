const cheerio = require("cheerio");
const { get } = require("../../utils/http");

const BASE_URL = "https://tioanime.com";
// Verified against the live directory listing: 20 cards per page.
const ITEMS_PER_PAGE = 20;

async function fetchDirectory({ search = null, skip = 0 }) {
  // The directory paginates search results too, so skip must always be honoured.
  const page = Math.floor(skip / ITEMS_PER_PAGE) + 1;
  const url = search
    ? `${BASE_URL}/directorio?q=${encodeURIComponent(search)}&p=${page}`
    : `${BASE_URL}/directorio?p=${page}`;

  const html = await get(url, { headers: { Referer: `${BASE_URL}/` } });
  const $ = cheerio.load(html);
  const results = [];

  $("li").each((_, el) => {
    const anchor = $(el).find("a[href^='/anime/']").first();
    if (!anchor.length) return;

    const href = anchor.attr("href") || "";
    const slug = href.replace("/anime/", "").replace(/^\//, "").trim();
    if (!slug) return;

    const title = anchor.find("h3").first().text().trim();
    const imgSrc = anchor.find("img").first().attr("src") || "";
    const posterUrl = imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`;

    if (slug && title) {
      results.push({ slug, title, posterUrl, type: "series" });
    }
  });

  return results;
}

function extractJsVar(html, varName) {
  const regex = new RegExp(`var\\s+${varName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`);
  const match = html.match(regex);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function fetchAnimeDetail(slug) {
  const url = `${BASE_URL}/anime/${slug}`;
  const html = await get(url, { headers: { Referer: `${BASE_URL}/` } });
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();

  const imgEl = $("img[src*='/uploads/portadas/']").first();
  const imgSrc = imgEl.attr("src") || "";
  const posterUrl = imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`;

  const description =
    $(".sinopsis p").first().text().trim() ||
    $("p.sinopsis").first().text().trim() ||
    $(".anime-info p").first().text().trim() ||
    $("p").not("[class]").first().text().trim() ||
    "";

  const genres = [];
  $("a[href*='/directorio?genero=']").each((_, el) => {
    const g = $(el).text().trim();
    if (g) genres.push(g);
  });

  // <span class="year">2018</span>. Later ones belong to the "related" cards and
  // the footer reads "2025 tioanime.com", so only the first is the anime's own.
  const year = extractYear($("span.year").first().text() || "");

  const episodesArr = extractJsVar(html, "episodes") || [];
  const animeInfo = extractJsVar(html, "anime_info") || [];
  const animeSlug = animeInfo[1] || slug;

  const episodes = episodesArr
    .map((num) => Number(num))
    .filter((num) => Number.isFinite(num))
    .sort((a, b) => a - b)
    .map((num) => ({
      number: num,
      title: `Episodio ${num}`,
      slug: `${animeSlug}-${num}`
    }));

  return { slug, title, description, posterUrl, genres, year, episodes };
}

function extractYear(text) {
  const match = text.match(/\b(?:19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
}

async function fetchEpisodeSources(slug, epNum) {
  const url = `${BASE_URL}/ver/${slug}-${epNum}`;
  const html = await get(url, { headers: { Referer: `${BASE_URL}/` } });

  const match = html.match(/var\s+videos\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];

  let videos = [];
  try {
    videos = JSON.parse(match[1]);
  } catch {
    return [];
  }

  return videos
    .filter(([, embedUrl]) => typeof embedUrl === "string" && embedUrl.startsWith("http"))
    .map(([provider, embedUrl]) => ({
      host: provider,
      embedUrl,
      referer: `${BASE_URL}/`
    }));
}

module.exports = { fetchDirectory, fetchAnimeDetail, fetchEpisodeSources, ITEMS_PER_PAGE };
