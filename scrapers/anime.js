const cheerio = require("cheerio");
const { get } = require("../utils/http");

const BASE_URL = "https://tioanime.com";

/**
 * Extracts a JS variable array from raw HTML script content.
 * e.g. var episodes = [10,9,8,1] → [10,9,8,1]
 */
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

/**
 * Fetches /anime/[slug] and returns full anime detail including episode list.
 * @param {string} slug
 * @returns {Promise<{slug, title, description, posterUrl, genres, year, episodes}>}
 */
async function fetchAnimeDetail(slug) {
  const url = `${BASE_URL}/anime/${slug}`;
  const html = await get(url);
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();

  const imgEl = $("img[src*='/uploads/portadas/']").first();
  const imgSrc = imgEl.attr("src") || "";
  const posterUrl = imgSrc.startsWith("http")
    ? imgSrc
    : `${BASE_URL}${imgSrc}`;

  // Synopsis: look for a <p> inside description/synopsis container
  // Try common selectors
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

  // Year: try to find a p/span that looks like a year
  let year = null;
  $("p, span").each((_, el) => {
    const text = $(el).text();
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    if (yearMatch && !year) {
      year = parseInt(yearMatch[0], 10);
    }
  });

  // Extract episode numbers from JS variable
  // var episodes = [10,9,8,7,...,1]
  const episodesArr = extractJsVar(html, "episodes") || [];
  // var anime_info = ["id","slug","title","..."]
  const animeInfo = extractJsVar(html, "anime_info") || [];
  const animeSlug = animeInfo[1] || slug;

  // Sort episodes ascending
  const sortedEpisodes = [...episodesArr].sort((a, b) => a - b);

  const episodes = sortedEpisodes.map((num) => ({
    number: num,
    title: `Episodio ${num}`,
    // Episode URL = /ver/{animeSlug}-{num}
    slug: `${animeSlug}-${num}`
  }));

  return {
    slug,
    title,
    description,
    posterUrl,
    genres,
    year,
    episodes
  };
}

module.exports = { fetchAnimeDetail };
