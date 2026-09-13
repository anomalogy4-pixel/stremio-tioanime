const axios = require("axios");

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  Referer: "https://tioanime.com/",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

async function get(url, options = {}) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.get(url, {
        headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
        timeout: options.timeout || 15000,
        responseType: options.responseType || "text"
      });
      return res.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 429 || status === 503) {
        await sleep(1000 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function getJson(url, options = {}) {
  return get(url, { ...options, responseType: "json" });
}

async function post(url, data, options = {}) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.post(url, data, {
        headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
        timeout: options.timeout || 15000
      });
      return res.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 429 || status === 503) {
        await sleep(1000 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { get, getJson, post };
