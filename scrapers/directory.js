const cheerio = require("cheerio");
const { get } = require("../utils/http");

const BASE_URL = "https://tioanime.com";
const ITEMS_PER_PAGE = 24;

/**
 * Fetches the /directorio page and returns anime stubs.
 * @param {object} opts
 * @param {string|null} opts.search
 * @param {number} opts.skip
 * @returns {Promise<Array<{slug, title, posterUrl, type}>>}
 */
async function fetchDirectory({ search = null, skip = 0 }) {
  let url;
  if (search) {
    url = `${BASE_URL}/directorio?q=${encodeURIComponent(search)}`;
  } else {
    const page = Math.floor(skip / ITEMS_PER_PAGE) + 1;
    url = `${BASE_URL}/directorio?p=${page}`;
  }

  const html = await get(url);
  const $ = cheerio.load(html);
  const results = [];

  // Anime cards: <li><a href="/anime/slug"><img src="..."><h3>Title</h3></a></li>
  $("li").each((_, el) => {
    const anchor = $(el).find("a[href^='/anime/']").first();
    if (!anchor.length) return;

    const href = anchor.attr("href") || "";
    const slug = href.replace("/anime/", "").replace(/^\//, "").trim();
    if (!slug) return;

    const title = anchor.find("h3").first().text().trim();
    const imgSrc = anchor.find("img").first().attr("src") || "";
    const posterUrl = imgSrc.startsWith("http")
      ? imgSrc
      : `${BASE_URL}${imgSrc}`;

    if (slug && title) {
      results.push({ slug, title, posterUrl, type: "series" });
    }
  });

  return results;
}

module.exports = { fetchDirectory };
