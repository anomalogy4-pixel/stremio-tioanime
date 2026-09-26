const crypto = require("crypto");

// Rotates on every restart unless pinned, so old links simply stop working.
const SECRET = process.env.PROXY_SECRET || crypto.randomBytes(32).toString("hex");

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/**
 * Packs a target URL plus the headers it needs into a single signed token.
 * The signature is what stops the proxy from being an open relay.
 */
function packTarget(url, headers = {}) {
  const payload = b64url(JSON.stringify({ url, headers }));
  return `${payload}.${sign(payload)}`;
}

/**
 * @returns {{url: string, headers: object}|null} null when the token is forged or malformed
 */
function unpackTarget(token) {
  const dot = String(token || "").lastIndexOf(".");
  if (dot === -1) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (typeof parsed.url !== "string" || !/^https?:\/\//i.test(parsed.url)) return null;
    return { url: parsed.url, headers: parsed.headers || {} };
  } catch {
    return null;
  }
}

module.exports = { packTarget, unpackTarget };
