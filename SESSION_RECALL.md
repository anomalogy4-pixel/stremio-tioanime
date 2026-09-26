# Session Recall - SoloLatino Stremio Addon
Date: 2026-09-23
Path: C:\Users\josal\Desktop\sololatino addon

## Project
- Name: sololatino-stremio-addon v1.0.0
- Description: Stremio addon for SoloLatino.Net (sololatino.net): catalogo, metadata y streams en espanol latino.
- Stack: Node.js + Express 4.21.1, cheerio, fuzzysort, unpacker, dotenv
- Entry: index.js (PORT env or 3000)
- Start scripts:
  - `npm start` -> `node index.js`
  - `npm run dev` -> `node --watch index.js`
  - `start.bat` -> checks node, npm install if needed, runs node index.js

## Structure
- index.js: manifest + mounts routes/catalog, routes/meta, routes/proxy, routes/streams, CORS *, trust proxy true
- routes/catalog.js: catalogs sololatino-peliculas (movie), sololatino-series (series), GENRES export
- routes/meta.js, routes/streams.js (returns proxied URLs via base), routes/proxy.js (NEW)
- lib/: sololatino.js (embedsToStreams supports base->/proxy/media for mp4), embed69.js (PoW SHA-256 + AES-256-CBC), vidhide.js (HLS Vidhide mirror), pss.js (player.pelisserieshoy.com a=1/a=2, toStreams supports base->/proxy/hls|media)
- example-animeflv/: ignored via .gitignore (reference addon)

## Manifest (verified 2026-09-23)
- id: com.sololatino.stremio.addon
- name: SoloLatino
- types: [movie, series], resources: [catalog, meta, stream]
- idPrefixes: [sololatino:, tt, tmdb:]
- catalogs: sololatino-peliculas, sololatino-series (extras: search, genre, skip)

## Server Run (last session)
- Command: Start-Process node index.js in project dir (detached)
- Verified:
  - GET http://127.0.0.1:3000/manifest.json -> OK (id, version 1.0.0, name SoloLatino)
  - GET http://127.0.0.1:3000/catalog/movie/sololatino-peliculas.json -> OK (e.g. sololatino:pelicula:one-last-shot, ocho-hombres, kangaroo-una-aventura-en-australia)
- Install URL for Stremio: http://127.0.0.1:3000/manifest.json (Addons -> Add addon)
- Stop: Stop-Process -Name node
- Port check: Get-NetTCPConnection -LocalPort 3000
- Note: port 3000 was free before start.

## Key endpoints
- /manifest.json
- /catalog/movie/sololatino-peliculas.json
- /catalog/series/sololatino-series/search=ted%20lasso.json
- /meta/movie/sololatino:pelicula:one-last-shot.json
- /stream/movie/sololatino:pelicula:one-last-shot.json (returns /proxy/hls?url=... for Vidhide Latino)
- /stream/series/sololatino:serie:ted-lasso:1:1.json
- /stream/movie/tt37971717.json
- /proxy/hls?url=<upstream m3u8>&referer=<...> (rewrites segments/keys to /proxy/media, Content-Type mpegurl, CORS *, no-store)
- /proxy/media?url=<ts|mp4|key>&referer=<...> (pipes bytes, forwards Range, CORS *, no-store)

## Cloud-ready proxy (added 2026-09-23 for 24/7 Koyeb)
- Problem: embed69 HLS signed asn= tied to resolver IP. Direct URL breaks when server IP != client IP.
- Fix: server fetches + serves via self-proxy so fetch IP = resolve IP. Stremio only talks to addon host.
- Verified local: /stream/movie/sololatino:pelicula:one-last-shot.json first stream = http://127.0.0.1:3000/proxy/hls?url=https%3A%2F%2F...acek-cdn...
- Files: routes/proxy.js NEW, index.js trust proxy true + mount proxy, routes/streams.js base param, lib/pss.js toStreams(label,base), lib/sololatino.js embedsToStreams(...,base)

## Known limitations (from README)
- embed69 HLS signed, ~36h expiry, tied to IP/network, best local via start.bat. CDN acek-cdn.com may be ISP-blocked.
- pss backend currently "No hay servidores disponibles", only external fallbacks.
- No TMDB_API_KEY: metadata from SoloLatino only.
- Some titles VIP-only (no data-player-token).

## Next to recall
- Server runs detached; if port busy, kill old node process.
- Don't commit node_modules/, .env, example-animeflv/ (gitignored).

## Hosting 24/7 free (saved 2026-09-23)
- Avoid Vercel/Netlify hobby: 10s timeout kills embed69 PoW + scraping (10-30s). Need persistent Node.
- 1. Koyeb Free (easiest, RECOMMENDED for deploy later): native Node, GitHub deploy, npm start, auto PORT. Test /stream/... after deploy - now via /proxy so IP-mismatch fixed, datacenter IP block still possible.
- 2. Render Free: 750h/mo, sleeps ~15min idle, 30-50s cold start. Build npm install, Start node index.js. UptimeRobot ping /manifest.json every 10min.
- 3. Oracle Always Free (only true 24/7): 2x AMD + 4x ARM OCPU/24GB forever. Needs CC + Ubuntu + pm2 + caddy. Pick US/Latam-close region.
- 4. Home + Cloudflare Tunnel (most reliable for streams): keep local (start.bat proven, acek-cdn ISP note), expose via cloudflared tunnel --url http://localhost:3000. Free, no port forward.
- Recommendation 2026-09-23: Koyeb for public share, Oracle for true 24/7 control, local+Tunnel for best in-Stremio playback.

## Deploy to Koyeb later (pending - user asked to save)
- Decision 2026-09-23: user wants 24/7 live, keep links playable internally. Recommendation = Koyeb Free first.
- Prereqs: code already cloud-ready (proxy done). package.json start = node index.js, PORT env supported, trust proxy true.
- Steps:
  1. Push to GitHub (node_modules/, .env, example-animeflv/ ignored).
  2. Koyeb > Create Service > GitHub repo > Runtime Node.js.
  3. Build command: npm install. Run command: npm start.
  4. Health check path: /manifest.json. Port: auto (app uses process.env.PORT).
  5. Deploy -> get https://<app>-<user>.koyeb.app/manifest.json -> Add in Stremio.
  6. UptimeRobot: monitor https://<app>.koyeb.app/manifest.json every 10min.
  7. Verify: /stream/movie/sololatino:pelicula:one-last-shot.json first url must contain /proxy/hls?url=...acek-cdn...
- If Koyeb datacenter 403 on acek-cdn: change Koyeb region or migrate same code to Oracle US-East (pm2 + caddy). No code change needed.
- Do NOT use Vercel/Netlify (timeout).
