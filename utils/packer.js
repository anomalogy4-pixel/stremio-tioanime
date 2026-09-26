// Unpacker for Dean Edwards' P.A.C.K.E.R obfuscation, used by several video hosts.

const PACKER_ARGS = /\}\s*\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s;

/**
 * Unpacks the first eval(function(p,a,c,k,e,d){...}) block found in the HTML.
 * @param {string} html
 * @returns {string|null} the unpacked source, or null when no packed block exists
 */
function unpack(html) {
  const match = html.match(PACKER_ARGS);
  if (!match) return null;

  const payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const dictionary = match[4].split("|");

  const lookup = {};
  for (let i = 0; i < dictionary.length; i++) {
    lookup[i] = dictionary[i] || String(i);
  }

  return payload.replace(/\b\w+\b/g, (word) =>
    lookup[word] !== undefined ? lookup[word] : word
  );
}

module.exports = { unpack };
