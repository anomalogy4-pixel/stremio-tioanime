const express = require("express");
const axios = require("axios");
const zlib = require("zlib");
const { promisify } = require("util");
const { packTarget, unpackTarget } = require("./utils/signing");

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotli = promisify(zlib.brotliDecompress);

// Public base URL the Stremio player will call back on. Must be reachable from
// the device that plays - 127.0.0.1 only works when Stremio runs on this machine.
// Explicit config wins; otherwise it is learned from the first request, so a
// deployment does not have to know its own domain up front.
function configuredBase() {
  return process.env.ADDON_BASE_URL ? process.env.ADDON_BASE_URL.replace(/\/$/, "") : null;
}

// Only a hint: a platform can advertise a domain that no longer routes, which
// would make every stream link point at a dead host.
function platformBase() {
  return process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null;
}

const FALLBACK_BASE = `http://127.0.0.1:${process.env.PORT || 7000}`;
let learnedBase = null;

/** Records the host Stremio actually reached us on. */
function rememberBase(req) {
  if (configuredBase()) return;
  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) return;
  const proto = (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
  learnedBase = `${proto}://${host}`;
}

// The host a request actually arrived on is proven reachable by that client,
// so it beats anything the platform advertises.
function baseUrl() {
  return configuredBase() || learnedBase || platformBase() || FALLBACK_BASE;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade"
]);

const PASS_THROUGH = [
  "content-type",
  "content-length",
  "content-range",
  "content-encoding",
  "accept-ranges",
  "last-modified",
  "etag"
];

const HLS_TYPES = /mpegurl|m3u8/i;

/**
 * Media bytes are piped through untouched (decompress: false), so a playlist
 * arrives still gzipped and must be decoded before it can be rewritten.
 */
async function decodeBody(buffer, encoding) {
  try {
    if (/\bgzip\b/i.test(encoding)) return await gunzip(buffer);
    if (/\bdeflate\b/i.test(encoding)) return await inflate(buffer);
    if (/\bbr\b/i.test(encoding)) return await brotli(buffer);
  } catch (err) {
    console.error(`[proxy] failed to decode ${encoding}: ${err.message}`);
  }
  return buffer;
}

/** Builds the proxied URL Stremio should play instead of the raw CDN link. */
function proxyUrl(url, headers, { hls = false } = {}) {
  const ext = hls ? "m3u8" : "mp4";
  return `${baseUrl()}/proxy/${packTarget(url, headers)}.${ext}`;
}

/**
 * Rewrites a playlist so every variant and segment is fetched through the proxy
 * too - otherwise the player would request segments without the required headers.
 */
function rewritePlaylist(body, playlistUrl, headers) {
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // URI="..." attributes (keys, media renditions, I-frame playlists)
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (full, uri) => {
          const abs = new URL(uri, playlistUrl).toString();
          return `URI="${proxyUrl(abs, headers, { hls: /\.m3u8/i.test(uri) })}"`;
        });
      }

      const abs = new URL(trimmed, playlistUrl).toString();
      return proxyUrl(abs, headers, { hls: /\.m3u8(\?|$)/i.test(trimmed) });
    })
    .join("\n");
}

function createProxyRouter() {
  const router = express.Router();

  router.get("/proxy/:token", async (req, res) => {
    // The .mp4 / .m3u8 suffix is only there so players sniff the right container.
    const suffix = (req.params.token.match(/\.(mp4|m3u8|ts)$/i) || [])[1] || "";
    const token = req.params.token.replace(/\.(mp4|m3u8|ts)$/i, "");
    const target = unpackTarget(token);
    if (!target) return res.status(403).end("invalid token");

    const expectPlaylist = /m3u8/i.test(suffix);

    const upstreamHeaders = { ...target.headers };
    // Seeking depends on the Range header reaching the CDN untouched - but a
    // partial playlist would be rewritten into truncated, broken URLs.
    if (req.headers.range && !expectPlaylist) upstreamHeaders.Range = req.headers.range;

    let upstream;
    try {
      upstream = await axios.get(target.url, {
        headers: upstreamHeaders,
        responseType: "stream",
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: () => true,
        decompress: false
      });
    } catch (err) {
      console.error(`[proxy] upstream failed: ${err.message}`);
      return res.status(502).end("upstream error");
    }

    if (upstream.status >= 400) {
      upstream.data.destroy();
      return res.status(upstream.status).end("upstream rejected");
    }

    const contentType = upstream.headers["content-type"] || "";
    const isPlaylist =
      expectPlaylist || HLS_TYPES.test(contentType) || /\.m3u8(\?|$)/i.test(target.url);

    if (isPlaylist) {
      const chunks = [];
      for await (const chunk of upstream.data) chunks.push(chunk);
      const decoded = await decodeBody(
        Buffer.concat(chunks),
        upstream.headers["content-encoding"] || ""
      );
      const body = rewritePlaylist(
        decoded.toString("utf-8"),
        upstream.request?.res?.responseUrl || target.url,
        target.headers
      );
      res.status(200);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.end(body);
    }

    res.status(upstream.status);
    for (const name of PASS_THROUGH) {
      const value = upstream.headers[name];
      if (value && !HOP_BY_HOP.has(name)) res.setHeader(name, value);
    }
    if (!upstream.headers["accept-ranges"]) res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");

    upstream.data.on("error", (err) => {
      console.error(`[proxy] stream error: ${err.message}`);
      res.destroy();
    });
    // Stop pulling bytes from the CDN when the player seeks away or closes.
    res.on("close", () => upstream.data.destroy());

    upstream.data.pipe(res);
  });

  return router;
}

module.exports = { createProxyRouter, proxyUrl, baseUrl, rememberBase };
