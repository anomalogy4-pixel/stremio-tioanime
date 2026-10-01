# My anime add-on

Stremio add-on for anime in Spanish, scraping [tioanime.com](https://tioanime.com) and [latanime.org](https://latanime.org).

Catalogs, episode lists and playable streams — resolved server-side and proxied so they play inside Stremio instead of opening a browser tab.

## Running locally

```bash
npm install
npm start
```

Install in Stremio from `http://127.0.0.1:7000/manifest.json`.

The same server also hosts a second add-on, SoloLatino (movies and series from
sololatino.net), installed separately from `http://127.0.0.1:7000/sololatino/manifest.json`.
Its code lives in `sololatino/` and can still run alone with `node sololatino/index.js`.

To play on a phone or TV on the same network, install from your LAN address instead
(`http://192.168.x.x:7000/manifest.json`) — the add-on learns the host from the
request, so stream links point back at the right place automatically.

## Deploying

Any Node host works. The add-on reads `PORT` and detects its own public URL from
the incoming request, so no configuration is required for a normal deployment.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7000` | Listen port. |
| `ADDON_BASE_URL` | auto-detected | Force the public base URL used in stream links. |
| `PROXY_SECRET` | random per restart | Signing key for proxy links. Set it if you run more than one instance, or links minted by one will be rejected by another. |
| `PROXY_STREAMS` | `1` | Set to `0` to hand Stremio raw CDN URLs with `proxyHeaders` instead of proxying. |

`GET /health` returns the base URL the add-on believes it is serving from.

## How streaming works

1. The scraper collects embed links for an episode from the source site.
2. An extractor turns each embed into a direct media URL.
3. Stream URLs are handed to Stremio as `/proxy/<signed-token>.mp4` (or `.m3u8`).
   The proxy replays the request upstream with the `Referer`/`User-Agent` the CDN
   requires, forwards `Range` so seeking works, and rewrites HLS playlists so
   segments are fetched through the proxy too.

Tokens are HMAC-signed, so the proxy only fetches URLs this add-on minted.

### Host support

| Host | Status |
|---|---|
| Voe | resolved (MP4 + HLS) |
| MixDrop | resolved |
| YourUpload | resolved |
| Mp4Upload | resolved |
| Mega | external link — decrypted client-side, cannot be resolved server-side |
| SaveFiles, DsvPlay, Hexload, Byse | external link — block server-side requests |

Unresolvable hosts are still offered as external links rather than being dropped,
with the reason shown in the stream title.

## Verifying

```bash
npm run verify
```

Walks catalog → meta → stream for both sources and range-requests every resolved
URL with the headers the add-on would use. Prints which hosts still work — run it
when something stops playing, since extractors break whenever a host changes its
player.
