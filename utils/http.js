const axios = require("axios");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

// Hosts answer differently when the request looks like a real <iframe> navigation.
const EMBED_HEADERS = {
  ...DEFAULT_HEADERS,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Sec-Fetch-Dest": "iframe",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "cross-site",
  "Upgrade-Insecure-Requests": "1"
};

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE"
]);

function isRetryable(err) {
  const status = err.response?.status;
  if (status !== undefined) return RETRY_STATUS.has(status);
  return RETRY_CODES.has(err.code);
}

async function request(config, options) {
  const maxRetries = options.retries ?? 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios({
        ...config,
        headers: { ...(options.baseHeaders || DEFAULT_HEADERS), ...(options.headers || {}) },
        timeout: options.timeout || 15000,
        responseType: options.responseType || "text",
        maxRedirects: options.maxRedirects ?? 5
      });
      return options.withResponse ? res : res.data;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isRetryable(err)) {
        await sleep(500 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function get(url, options = {}) {
  return request({ method: "get", url }, options);
}

async function getJson(url, options = {}) {
  return get(url, { ...options, responseType: "json" });
}

/** GET an embed page with headers that mimic an iframe navigation. */
async function getEmbed(url, options = {}) {
  return get(url, { ...options, baseHeaders: EMBED_HEADERS });
}

async function post(url, data, options = {}) {
  return request({ method: "post", url, data }, options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { get, getJson, getEmbed, post, sleep, USER_AGENT, DEFAULT_HEADERS, EMBED_HEADERS };
