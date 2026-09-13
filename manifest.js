module.exports = {
  id: "community.tioanime.stremio",
  version: "1.0.0",
  name: "My anime add-on",
  description: "Anime en español desde tioanime.com",
  logo: "https://tioanime.com/favicon.ico",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  idPrefixes: ["tio:"],
  catalogs: [
    {
      type: "series",
      id: "tioanime-directorio",
      name: "TioAnime Directorio",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ]
};
