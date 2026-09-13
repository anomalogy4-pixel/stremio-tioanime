const cheerio = require("cheerio");
const { get } = require("../../utils/http");

const BASE_URL = "https://tioanime.com";
const ITEMS_PER_PAGE = 24;

async function fetchDirectory({ search = null, skip = 0 }) {
  let url;
  if (search) {
    url = `${BASE_URL}/directorio?q=${encodeURIComponent(search)}`;
  } else {
    const page = Math.floor(skip / ITEMS_PER_PAGE) + 1;
    url = `${BASE_URL}/directorio?p=${page}`;
  }

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

  let year = null;
  $("p, span").each((_, el) => {
    const text = $(el).text();
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    if (yearMatch && !year) year = parseInt(yearMatch[0], 10);
  });

  const episodesArr = extractJsVar(html, "episodes") || [];
  const animeInfo = extractJsVar(html, "anime_info") || [];
  const animeSlug = animeInfo[1] || slug;

  const sortedEpisodes = [...episodesArr].sort((a, b) => a - b);
  const episodes = sortedEpisodes.map((num) => ({
    number: num,
    title: `Episodio ${num}`,
    slug: `${animeSlug}-${num}`
  }));

  return { slug, title, description, posterUrl, genres, year, episodes };
}

async function fetchEpisodeSources(slug, epNum) {
  const episodeSlug = `${slug}-${epNum}`;
  const url = `${BASE_URL}/ver/${episodeSlug}`;
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
    .filter(([, embedUrl]) => embedUrl && embedUrl.startsWith("http"))
    .map(([provider, embedUrl]) => ({ host: provider, embedUrl }));
}

module.exports = { fetchDirectory, fetchAnimeDetail, fetchEpisodeSources };
