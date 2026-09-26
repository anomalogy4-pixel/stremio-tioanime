const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const catalogHandler = require("./handlers/catalog");
const metaHandler = require("./handlers/meta");
const streamHandler = require("./handlers/stream");
const { createProxyRouter, rememberBase, baseUrl } = require("./proxy");

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
app.use(getRouter(builder.getInterface()));
app.get("/", (_, res) => res.redirect("/manifest.json"));
app.get("/health", (_, res) => res.json({ ok: true, base: baseUrl() }));

app.listen(PORT, () => {
  console.log(`My anime add-on listening on port ${PORT}`);
  console.log(`Install URL: ${baseUrl()}/manifest.json`);
});
