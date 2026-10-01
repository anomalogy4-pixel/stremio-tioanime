# Session Recall - SoloLatino Stremio Addon

Path: `C:\Users\josal\Desktop\sololatino addon`
Last updated: 2026-09-26 (full audit + fixes)

## Project
- Name: sololatino-stremio-addon v1.0.0
- Stremio addon for sololatino.net: catalogo, metadata, streams en espanol latino
- Stack: Node.js 24 + Express 4.22, cheerio, fuzzysort, unpacker, dotenv
- Entry: `index.js` (PORT env or 3000)
- Start: `npm start` / `npm run dev` (node --watch) / `start.bat`

## Git (changed 2026-09-26)
- **Now its own repo.** Was previously untracked inside the `C:\Users\josal` home repo, which blocked the Koyeb deploy plan.
- 15 files tracked. `node_modules/`, `.env`, `example-animeflv/` excluded via .gitignore.
- Commits:
  - `02702ee` fix: repair proxy, pagination and episode metadata
  - `c3b197b` feat: surface every resolvable vidhide rendition
- **Not pushed anywhere yet.** No remote configured.

## Structure
- `index.js` — manifest, CORS *, trust proxy, dotenv, process crash guards, JSON 404, mounts routes
- `routes/catalog.js` — catalogs + GENRES, page accumulation, parseExtra
- `routes/meta.js` — meta, cinemeta fallback for tt/tmdb, id rebasing
- `routes/streams.js` — stream resolution, language grouping, PSS + embed69 orchestration
- `routes/proxy.js` — `/proxy/hls` + `/proxy/media`, SSRF guard, streaming pipe
- `lib/sololatino.js` — site scraping, LD+JSON, episodes, player-url token flow, fetchTimeout
- `lib/embed69.js` — PoW SHA-256 + AES-256-CBC link decryption
- `lib/vidhide.js` — packed-eval unpack to HLS URL
- `lib/pss.js` — player.pelisserieshoy.com a=click/a=1/a=2 protocol

## Audit 2026-09-26 — 13 defects found and fixed

All verified live against sololatino.net before and after.

**Playback-breaking**
1. `/proxy/hls` called `.text()` then `.arrayBuffer()` on the same Response -> always threw "Body is unusable"; every non-playlist upstream became 502.
2. Both proxy routes buffered entire body in memory -> OOM risk on full mp4; segment TTFB **21.7s -> 1.1s** after switching to `Readable.fromWeb().pipe()`.
3. Proxy fetched any caller-supplied URL (open proxy / SSRF; cloud metadata reachable). Now DNS-resolves and rejects private ranges, re-checked after redirects.

**Wrong data**
4. Catalog paging assumed 24-item site pages. Real: `/peliculas` = **36**, `/genero/<slug>` = **24**. Pages after the first skipped and repeated titles. Now accumulates site pages until the window is filled (verified 0 overlap across skip=0/24/48).
5. Episodes built from hrefs only — discarded per-episode title, overview, still, air date sitting in `a.ep-item`. Now parsed: 42/42 real titles, 42 stills, 40 distinct dates (was 1).
6. Meta for a `tt`/`tmdb` request echoed the internal `sololatino:` id. Now echoes requested id, rebases episode ids to `tt10986410:1:1`.
7. Foreign-id lookup ignored requested type — a series request could resolve to a same-named movie and silently drop season/episode.

**Robustness**
8. No request timeouts anywhere. Added 20s (10s cinemeta) abort timeouts.
9. embed69 PoW loop was unbounded `for(;;)` with page-controlled difficulty. Capped.
10. `parseExtra` split on every `=`, truncating values containing one.
11. `dotenv` declared but never required — any `.env` silently ignored.
12. Dead code: `poster.replace("/w500/","/w500/")`, `parts[0] === "tt"` (never true).
13. No process-level handlers — a stray rejection killed the process (fatal for 24/7 host). Added + JSON 404.

## Feature 2026-09-26 — multi-language streams
`tryDirectStreams` returned the first mirror that resolved and dropped the rest. embed69 decrypts **12 links** for a typical movie; the addon used **1**.
Now groups by language, resolves one mirror per language in parallel, falls through that language's mirrors, dedupes by resolved CDN URL, per-language `bingeGroup`.

Result: UNABOMBER 1 -> **2** in-app streams (Latino + Subtitulado), proven distinct (different file ids, different segment md5).

## Verified working (2026-09-26)
16-endpoint sweep, 0 failures. Catalogs, genre, skip=200, search, meta (native + tt), streams (native + tt, movie + series).

Playback: master -> variant -> segment all 200, `Range` -> **206**, first byte `0x47` (valid TS sync), TTFB ~0.9s, 8-way abort storm survived, SSRF blocked.

## Key endpoints
- `/manifest.json`
- `/catalog/movie/sololatino-peliculas.json` (+ `/genre=accion&skip=24.json`)
- `/catalog/series/sololatino-series/search=ted%20lasso.json`
- `/meta/movie/sololatino:pelicula:unabomber.json`, `/meta/series/tt10986410.json`
- `/stream/movie/sololatino:pelicula:unabomber.json`, `/stream/series/sololatino:serie:ted-lasso:1:1.json`
- `/proxy/hls?url=&referer=`, `/proxy/media?url=&referer=`

## Stremio install
- `http://127.0.0.1:3000/manifest.json` — paste into Stremio **desktop** Addons search box.
- Stremio **Web will reject it**: HTTPS page cannot load an HTTP addon.
- Start detached: `nohup node index.js > "$TEMP/sololatino-addon.log" 2>&1 &`
- Stop: `taskkill /F /IM node.exe`
- Port check: `netstat -ano | grep ":3000 "`

## Known limitations (re-verified 2026-09-26)
- **streamwish (hglink.to) and voe (voe.sx) cannot be resolved in Node.** Both serve ~800-byte bot-gate stubs: streamwish is Cloudflare + a 71KB `main.js` that builds the player client-side; voe is DDoS-Guard + a JS redirect to a rotating domain (`jeremyparticipantanything.com`). Need a headless browser, not a better regex.
- PSS backend returns "No hay servidores disponibles" — external fallbacks only. Code path is correct and graceful.
- `sololatino.xyz` embed appears on some episodes; **never probed**, possible extra source.
- **Site has no HTML search page** — `/?s=` returns the home page. The suggest API is the only search and caps at ~9 results. Not a bug, do not "fix".
- embed69 HLS is signed, ~36h expiry, IP-tied — the `/proxy` design exists precisely to make fetch IP == resolve IP.
- acek-cdn.com may be ISP-blocked in some networks.
- Some titles are VIP-only (no `data-player-token`).
- Season 4 of Ted Lasso (8 eps) is legitimate site data, not over-capture — the season selector lists it.

## Stremio protocol notes (learned)
Only four playable stream shapes: `url` (direct mp4/mkv/m3u8/magnet), `infoHash`, `ytId`, `externalUrl`. `externalUrl` opens the OS browser and is **never** playable in-app. There is no iframe/embed field, so no universal wrapper for embed pages exists — each host needs its own extractor, or a headless browser that intercepts the player's media request.

## Deploy to Koyeb (pending, unblocked)
Repo now exists, so step 1 is possible.
1. Add remote, push to GitHub.
2. Koyeb > Create Service > GitHub repo > Node.js runtime.
3. Build `npm install`, run `npm start`. Health check `/manifest.json`. Port auto (PORT env).
4. UptimeRobot on `/manifest.json` every 10min.
5. Verify first stream url contains `/proxy/hls?url=...acek-cdn...`.
- If the datacenter gets 403 from acek-cdn: change Koyeb region, or move the same code to Oracle Always Free (pm2 + caddy). No code change needed.
- **Do NOT use Vercel/Netlify** — 10s timeout kills the PoW + scraping chain.
- Alternative for best playback: keep local + `cloudflared tunnel --url http://localhost:3000`.

## Useful verification one-liners
```bash
# enumerate every decrypted mirror for a title
node -e "const SL=require('./lib/sololatino');const{unwrapEmbed69}=require('./lib/embed69');(async()=>{const{embeds}=await SL.getPagePlayerUrls('https://sololatino.net/pelicula/unabomber');for(const e of embeds.filter(x=>/embed69/.test(x.url)))console.log((await unwrapEmbed69(e.url)).map(l=>[l.lang,l.servername,l.kind,l.url].join(' | ')).join('\n'))})()"

# prove two streams are distinct renditions (compare segment md5)
# see git log c3b197b for the full check
```
