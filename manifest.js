module.exports = {
  id: "community.tioanime.stremio",
  version: "1.2.0",
  name: "My anime add-on",
  description: "Anime en español desde tioanime.com y latanime.org",
  logo: "https://tioanime.com/favicon.ico",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  idPrefixes: ["tio:", "lat:"],
  catalogs: [
    {
      type: "series",
      id: "tioanime-directorio",
      name: "TioAnime",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "latanime-directorio",
      name: "LatAnime",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ]
};
