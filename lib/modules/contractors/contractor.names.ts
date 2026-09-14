/**
 * Contractor name normalisation for duplicate warnings (PRD #46 §16). Pure:
 * the seed and the browser can use it without the service behind it.
 */

const LEGAL_SUFFIXES = new Set(["ltd", "limited", "llc", "inc", "plc", "gmbh", "ag", "srl", "sa", "shpk", "sha", "co", "company", "corp", "corporation", "bv", "nv", "sarl", "spa"]);
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** "ABC Construction Sh.p.k." and "abc construction" are the same name. */
export function normalizeContractorName(value: string): string {
  const words = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}
