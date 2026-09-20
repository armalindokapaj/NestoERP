// GLTFLoader strips `[ ] . : /` from node names, so a name read at runtime can
// differ from the one the server read out of the same GLB. Keep both in sync.
const KNOWN_PREFIX_WORDS = ["Layer"] as const;

const KNOWN_NODE_NAME_PREFIXES: RegExp[] = KNOWN_PREFIX_WORDS.flatMap((word) => [
  new RegExp(`^${word}[:_]\\s*`, "i"),
  new RegExp(`^${word}(?=[A-Z_])`),
  new RegExp(`^${word}(?=unit_)`, "i"),
]);

export function cleanGlbNodeName(rawName: string): string {
  let name = rawName;
  for (const prefix of KNOWN_NODE_NAME_PREFIXES) {
    name = name.replace(prefix, "");
  }
  return name;
}

export function sanitizeGlbNodeName(rawName: string): string {
  return rawName.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
}

export function glbNodeNameKey(rawName: string): string {
  return sanitizeGlbNodeName(cleanGlbNodeName(rawName)).toLowerCase();
}

