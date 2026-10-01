const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const catalogHandler = require("./handlers/catalog");
const metaHandler = require("./handlers/meta");
const streamHandler = require("./handlers/stream");
const { createProxyRouter, rememberBase, baseUrl } = require("./proxy");
const sololatino = require("./sololatino");

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(catalogHandler);
builder.defineMetaHandler(metaHandler);
builder.defineStreamHandler(streamHandler);

const PORT = process.env.PORT || 7000;

// serveHTTP() owns the whole app, so build it manually to mount the stream proxy
// alongside the add-on routes.
const app = express();

// Railway and friends terminate TLS upstream; trust their forwarding headers.
app.set("trust proxy", true);

// Learn the public host from real traffic so proxied stream URLs point back at
// whatever domain Stremio used to reach us.
app.use((req, _res, next) => {
  rememberBase(req);
  next();
});

app.use(createProxyRouter());
// Second add-on, installed from /sololatino/manifest.json. Mounted before the SDK
// router, whose /:resource/:type/:id/:extra?.json pattern would otherwise
// swallow /sololatino/catalog/... requests.
app.use("/sololatino", sololatino);
app.use(getRouter(builder.getInterface()));
app.get("/", (_, res) => res.redirect("/manifest.json"));
app.get("/health", (_, res) =>
  res.json({ ok: true, base: baseUrl(), sololatino: `${baseUrl()}/sololatino/manifest.json` })
);

// A stray rejection (an abandoned scrape, a socket reset mid-proxy) would
// otherwise kill the process and take both add-ons down with it.
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", (err && err.message) || err);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", (err && err.stack) || err);
});

app.listen(PORT, () => {
  console.log(`My anime add-on listening on port ${PORT}`);
  console.log(`Install URL: ${baseUrl()}/manifest.json`);
  console.log(`SoloLatino:  ${baseUrl()}/sololatino/manifest.json`);
});
