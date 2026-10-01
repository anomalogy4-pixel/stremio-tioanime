// Resolver for player.pelisserieshoy.com embeds ("/f/<tt...>[-SxEE]").
//
// Page protocol (reverse-engineered from the player JS):
//   GET  /f/<id>            -> HTML with `const _t = '<tok>'`
//   POST /s.php {a:'click', tok}            -> {ok:true}            (must precede scan/resolve)
//   POST /s.php {a:'1', tok}                -> scan: {s:[[lbl,url]...], meta, langs_s, dl, dl_s, src}
//                                            or {error:'rate_limited'|'not_found'} or {type:'error',msg}
//   POST /s.php {a:'2', v:url, tok}         -> resolve, one of:
//                                            - stream: {u:<origin hls>, sig}      -> play via /p.php?url=&sig=
//                                            - {type:'iframe', url}               -> iframe embed
//                                            - {type:'mp4', u}                    -> direct mp4
//                                            - {error:'busy', retry}              -> scrape queue, wait+retry once
//                                            - {error:'retry_once'}               -> transient, retry once
//                                            - {error:'rate_limited'|'not_found'} / {dead} / 403 no_click -> skip
//
// The addon is gentle by design (server bans IPs on request storms):
// sequential resolves, max 3 LAT-preferred servers, stop at first direct hit,
// short TTL caches for scans and resolves.
const BASE = "https://player.pelisserieshoy.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_SERVERS = 3;
const SCAN_TTL = 20 * 60 * 1000; // 20 min
const RESOLVE_TTL = 6 * 60 * 60 * 1000; // 6 h
const REQ_TIMEOUT = 25000;

const scanCache = new Map(); // embedUrl -> {at, data}
const resolveCache = new Map(); // serverUrl -> {at, data}

function cacheGet(map, key, ttl) {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() - e.at > ttl) { map.delete(key); return null; }
  return e.data;
}
function cacheSet(map, key, data) {
  if (map.size > 200) { const k = map.keys().next().value; map.delete(k); }
  map.set(key, { at: Date.now(), data });
}

async function fetchTimeout(url, opts = {}, ms = REQ_TIMEOUT) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

function post(params, referer) {
  return fetchTimeout(`${BASE}/s.php`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "application/json,*/*",
      Referer: referer,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  }).then(async (r) => {
    const txt = await r.text();
    let json = null;
    try { json = JSON.parse(txt); } catch (_) {}
    return { status: r.status, json, raw: txt.slice(0, 200) };
  });
}

async function getToken(embedUrl) {
  const html = await fetchTimeout(embedUrl, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*", Referer: "https://sololatino.net/" },
  }).then((r) => {
    if (!r.ok) throw Error(`pss page HTTP ${r.status}`);
    return r.text();
  });
  const tok = /const\s+_t\s*=\s*'([^']+)'/.exec(html)?.[1];
  if (!tok) throw Error("pss: no _t token (page format changed?)");
  return tok;
}

// Servers preferred LAT-first when langs_s is present; capped to MAX_SERVERS.
function pickServers(scan) {
  const seen = new Set();
  const out = [];
  const push = (lbl, url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push([lbl, url]);
  };
  const langs = scan.langs_s || {};
  const langNames = Object.keys(langs);
  const latFirst = [...langNames].sort((a) => (/lat/i.test(a) ? -1 : 1));
  for (const ln of latFirst) {
    for (const [lbl, url] of langs[ln] || []) {
      push(`${ln} ${lbl}`, url);
      if (out.length >= MAX_SERVERS) return out;
    }
  }
  for (const [lbl, url] of scan.s || []) {
    push(lbl, url);
    if (out.length >= MAX_SERVERS) return out;
  }
  return out;
}

async function resolveServer(serverUrl, tok, referer, retried = {}) {
  const cached = cacheGet(resolveCache, serverUrl, RESOLVE_TTL);
  if (cached) return cached;
  const params = { a: "2", v: serverUrl, tok };
  if (retried.rfx) params.r = "1";
  if (retried.fbx) params.fb = "1";
  const { status, json } = await post(params, referer);
  const d = json || {};
  if (status === 403 || d.dead) throw Error("pss token dead/no_click, aborting");
  if (d.error === "busy") {
    if (retried.busy) return null;
    const wait = Math.min(parseInt(d.retry || "25", 10) || 25, 30) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return resolveServer(serverUrl, tok, referer, { ...retried, busy: true });
  }
  if (d.error === "retry_once") {
    if (retried.once) return null;
    return resolveServer(serverUrl, tok, referer, { ...retried, once: true });
  }
  if (d.error) return null; // rate_limited / not_found / other
  if (d.type === "iframe" && d.url) {
    const res = { kind: "iframe", url: d.url };
    cacheSet(resolveCache, serverUrl, res);
    return res;
  }
  if (d.type === "mp4" && d.u) {
    const res = { kind: "mp4", url: d.u };
    cacheSet(resolveCache, serverUrl, res);
    return res;
  }
  if (d.u) {
    // HLS stream, played by the site via /p.php?url=&sig=
    const proxied = `${BASE}/p.php?url=${encodeURIComponent(d.u)}&sig=${encodeURIComponent(d.sig || "")}`;
    const res = { kind: "hls", url: proxied, origin: d.u };
    cacheSet(resolveCache, serverUrl, res);
    return res;
  }
  return null;
}

// Returns {servers:[[lbl,url]], resolved:[{kind,url,lbl}]} — resolved may be
// empty when the backend has no streaming servers (graceful: caller falls back).
async function scanAndResolve(embedUrl) {
  const cached = cacheGet(scanCache, embedUrl, SCAN_TTL);
  let scan = cached;
  let tok = null;
  if (!scan) {
    tok = await getToken(embedUrl);
    await post({ a: "click", tok }, embedUrl).catch(() => null);
    const { json } = await post({ a: "1", tok }, embedUrl);
    if (!json || json.error || json.type === "error" || !json.s || !json.s.length) {
      return { servers: [], resolved: [], note: (json && (json.msg || json.error)) || "no servers" };
    }
    scan = json;
    cacheSet(scanCache, embedUrl, scan);
  }
  if (!tok) tok = await getToken(embedUrl);
  const servers = pickServers(scan);
  const resolved = [];
  for (const [lbl, url] of servers) {
    try {
      const r = await resolveServer(url, tok, embedUrl);
      if (r) {
        resolved.push({ ...r, lbl });
        if (r.kind === "hls" || r.kind === "mp4") break; // stop at first direct hit
      }
    } catch (e) {
      if (/dead\/no_click/.test(e.message)) break;
    }
  }
  return { servers, resolved };
}

function toStreams(result, label, base) {
  const out = [];
  for (const r of result.resolved) {
    if (r.kind === "iframe") {
      out.push({
        externalUrl: r.url,
        name: "SoloLatino\nPSS " + r.lbl + " (ext)",
        description: `${label}\nAbre mirror en el navegador\n${r.url}`,
        behaviorHints: { bingeGroup: "sololatino|pss|ext" },
      });
    } else {
      const isHls = r.kind === "hls" || /\.m3u8/i.test(r.url);
      const proxied = base
        ? `${base}${isHls ? "/proxy/hls" : "/proxy/media"}?url=${encodeURIComponent(r.url)}&referer=${encodeURIComponent(BASE + "/")}`
        : r.url;
      out.push({
        url: proxied,
        name: `SoloLatino\nPSS ${r.lbl}`,
        description: `${label}\nDirecto Latino (HLS via proxy)\n${r.url}`,
        behaviorHints: {
          bingeGroup: "sololatino|pss",
          notWebReady: true,
        },
      });
    }
  }
  return out;
}

module.exports = { scanAndResolve, toStreams, pickServers, BASE };
