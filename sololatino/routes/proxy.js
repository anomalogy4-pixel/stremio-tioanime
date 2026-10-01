const express = require("express");
const dns = require("node:dns").promises;
const net = require("node:net");
const { Readable, pipeline } = require("node:stream");
const proxy = express.Router();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Time allowed for the upstream to send *headers*. Body transfer is not capped
// (a segment or mp4 may legitimately take minutes).
const HEADERS_TIMEOUT = 30000;

function proxyUrl(req, path, targetUrl, referer) {
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}${path}?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer || "")}`;
}

function resolveAgainst(base, ref) {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

function isPlaylistUrl(u) {
  return /\.m3u8(\?|$)/i.test(u);
}

// ---------- SSRF guard ----------
// These endpoints fetch a caller-controlled URL, so they must never be pointed
// at the host itself or at anything on a private network (cloud metadata
// services such as 169.254.169.254 being the classic target).
function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true; // not an IP literal: caller resolves DNS first
}

async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Error("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw Error("scheme not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw Error("host not allowed");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw Error("private address not allowed");
    return u.toString();
  }
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw Error("dns lookup failed for " + host);
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address)))
    throw Error("private address not allowed");
  return u.toString();
}

// Rewrite m3u8 so every segment/key/map/nested playlist points back to us.
function rewritePlaylist(req, text, upstreamUrl, referer) {
  const lines = text.split(/\r?\n/);
  return lines
    .map((line) => {
      if (!line) return line;
      // Rewrite URI="..." attributes (KEY, MAP, MEDIA)
      if (line.startsWith("#") && line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
          const abs = resolveAgainst(upstreamUrl, uri);
          const dest = isPlaylistUrl(abs) ? `/proxy/hls` : `/proxy/media`;
          return `URI="${proxyUrl(req, dest, abs, referer)}"`;
        });
      }
      if (line.startsWith("#")) return line;
      // Plain segment / nested playlist line
      const abs = resolveAgainst(upstreamUrl, line.trim());
      const dest = isPlaylistUrl(abs) ? `/proxy/hls` : `/proxy/media`;
      return proxyUrl(req, dest, abs, referer);
    })
    .join("\n");
}

async function fetchUpstream(url, referer, reqHeaders = {}) {
  const headers = { "User-Agent": UA, Accept: "*/*" };
  if (referer) headers.Referer = referer;
  // Forward Range for seeking (Stremio/ExoPlayer sends it for mp4/ts)
  if (reqHeaders.range) headers.Range = reqHeaders.range;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), HEADERS_TIMEOUT);
  let upstream;
  try {
    upstream = await fetch(url, { headers, signal: c.signal, redirect: "follow" });
  } catch (e) {
    if (e.name === "AbortError") throw Error(`upstream timeout for ${url.slice(0, 120)}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
  if (!upstream.ok && upstream.status !== 206)
    throw Error(`upstream HTTP ${upstream.status} for ${url.slice(0, 120)}`);
  // A redirect can land on a private address even when the original host was public.
  if (upstream.url && upstream.url !== url) await assertPublicUrl(upstream.url);
  return upstream;
}

function copyPassthroughHeaders(upstream, res) {
  const ct = upstream.headers.get("content-type");
  if (ct) res.set("Content-Type", ct);
  const cl = upstream.headers.get("content-length");
  if (cl) res.set("Content-Length", cl);
  const ar = upstream.headers.get("accept-ranges");
  if (ar) res.set("Accept-Ranges", ar);
  const cr = upstream.headers.get("content-range");
  if (cr) res.set("Content-Range", cr);
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "no-store");
  if (upstream.status === 206) res.status(206);
}

// Stream the body through instead of buffering it: a full-length mp4 read into
// a Buffer is an OOM on a small cloud instance, and buffering a .ts segment
// delays the first byte until the whole segment has landed.
function pipeBody(upstream, req, res) {
  // The client may already be gone (Stremio abandons segments when seeking).
  if (req.destroyed || res.destroyed || res.writableEnded) {
    if (upstream.body) upstream.body.cancel().catch(() => {});
    return;
  }
  if (!upstream.body) return res.end();
  const src = Readable.fromWeb(upstream.body);
  req.on("close", () => src.destroy());
  pipeline(src, res, (err) => {
    if (err && !res.headersSent) res.status(502).end("proxy error: " + err.message);
  });
}

// GET /proxy/hls?url=<upstream m3u8>&referer=<...>
proxy.get("/proxy/hls", async (req, res) => {
  try {
    const referer = req.query.referer || "";
    const target = await assertPublicUrl(req.query.url || "");
    const upstream = await fetchUpstream(target, referer, req.headers);
    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    // Only a playlist can be rewritten; anything else (some servers hand back an
    // mp4 here) is streamed straight through. The type is decided without
    // consuming the body twice: the previous code called .text() and then
    // .arrayBuffer() on the same response, which always threw
    // "Body is unusable" and turned every non-playlist into a 502.
    const looksPlaylist =
      isPlaylistUrl(target) || ct.includes("mpegurl") || ct.includes("m3u") || ct.includes("text/plain");
    if (!looksPlaylist) {
      copyPassthroughHeaders(upstream, res);
      return pipeBody(upstream, req, res);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const text = buf.toString("utf8");
    if (!text.includes("#EXTM3U")) {
      copyPassthroughHeaders(upstream, res);
      return res.send(buf);
    }
    const out = rewritePlaylist(req, text, target, referer);
    res.set("Content-Type", "application/vnd.apple.mpegurl");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "no-store");
    res.send(out);
  } catch (e) {
    console.error("proxy/hls failed:", e.message);
    if (!res.headersSent) res.status(502).send("proxy error: " + e.message);
  }
});

// GET /proxy/media?url=<ts|mp4|key>&referer=<...>
proxy.get("/proxy/media", async (req, res) => {
  try {
    const referer = req.query.referer || "";
    const target = await assertPublicUrl(req.query.url || "");
    const upstream = await fetchUpstream(target, referer, req.headers);
    copyPassthroughHeaders(upstream, res);
    pipeBody(upstream, req, res);
  } catch (e) {
    console.error("proxy/media failed:", e.message);
    if (!res.headersSent) res.status(502).send("proxy error: " + e.message);
  }
});

module.exports = proxy;
