import type { Catalogue } from "@/lib/i18n/catalogue";

/**
 * Albanian for zod's own English, the sentences a validator says when its schema gave it none
 * (node_modules/zod/v4/locales/en.js; zod ships no Albanian locale, and a locale map is process-wide).
 *
 * The same shape as the other catalogue files: each key is the English exactly as zod writes it. The
 * size and range sentences differ only in the word zod names the value by, so they are written once
 * for each and put into the table below.
 */

/** What zod calls a value, with the unit it counts it in (where it counts at all) and the Albanian for both. */
const SIZED = {
  string: { subject: "Teksti", unit: "characters", sqUnit: "karaktere" },
  array: { subject: "Lista", unit: "items", sqUnit: "elemente" },
  set: { subject: "Bashkësia", unit: "items", sqUnit: "elemente" },
  map: { subject: "Harta", unit: "entries", sqUnit: "hyrje" },
  file: { subject: "Skedari", unit: "bytes", sqUnit: "bajte" },
} as const;

const MEASURED = {
  number: "Numri",
  int: "Numri",
  bigint: "Numri",
  date: "Data",
} as const;

/** zod's comparison words and the Albanian each one reads as, for a minimum and for a maximum. */
const MINIMUM = { ">=": "të paktën", ">": "më shumë se", "exactly ": "saktësisht" } as const;
const MAXIMUM = { "<=": "jo më shumë se", "<": "më pak se", "exactly ": "saktësisht" } as const;

function sizeRows(): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const [origin, { subject, unit, sqUnit }] of Object.entries(SIZED)) {
    for (const [adj, words] of Object.entries(MINIMUM)) rows[`Too small: expected ${origin} to have ${adj}{0} ${unit}`] = `${subject} duhet të ketë ${words} {0} ${sqUnit}`;
    for (const [adj, words] of Object.entries(MAXIMUM)) rows[`Too big: expected ${origin} to have ${adj}{0} ${unit}`] = `${subject} duhet të ketë ${words} {0} ${sqUnit}`;
  }
  for (const [origin, subject] of Object.entries(MEASURED)) {
    for (const [adj, words] of Object.entries(MINIMUM)) rows[`Too small: expected ${origin} to be ${adj}{0}`] = `${subject} duhet të jetë ${words} {0}`;
    for (const [adj, words] of Object.entries(MAXIMUM)) rows[`Too big: expected ${origin} to be ${adj}{0}`] = `${subject} duhet të jetë ${words} {0}`;
  }
  return rows;
}

/** The formats zod names (`FormatDictionary`), as the whole of its sentence "Invalid …". */
const FORMATS: Readonly<Record<string, string>> = {
  "Invalid email address": "Adresë e-mail e pavlefshme",
  "Invalid URL": "URL e pavlefshme",
  "Invalid UUID": "UUID i pavlefshëm",
  "Invalid UUIDv4": "UUIDv4 i pavlefshëm",
  "Invalid UUIDv6": "UUIDv6 i pavlefshëm",
  "Invalid GUID": "GUID i pavlefshëm",
  "Invalid cuid": "cuid i pavlefshëm",
  "Invalid cuid2": "cuid2 i pavlefshëm",
  "Invalid ULID": "ULID i pavlefshëm",
  "Invalid ISO datetime": "Datë dhe orë ISO e pavlefshme",
  "Invalid ISO date": "Datë ISO e pavlefshme",
  "Invalid ISO time": "Orë ISO e pavlefshme",
  "Invalid ISO duration": "Kohëzgjatje ISO e pavlefshme",
  "Invalid IPv4 address": "Adresë IPv4 e pavlefshme",
  "Invalid IPv6 address": "Adresë IPv6 e pavlefshme",
  "Invalid base64-encoded string": "Varg i koduar base64 i pavlefshëm",
  "Invalid JSON string": "Varg JSON i pavlefshëm",
  "Invalid JWT": "JWT i pavlefshëm",
  "Invalid emoji": "Emoji i pavlefshëm",
  "Invalid input": "Vlerë e pavlefshme",
};

export const rows = {
  ...sizeRows(),
  ...FORMATS,
  "Invalid input: expected {0}, received {1}": { sq: "Vlerë e pavlefshme: pritej {0}, por u mor {1}", slots: { 0: "type", 1: "type" } },
  "Invalid input: expected {0}": "Vlerë e pavlefshme: pritej {0}",
  "Invalid input: more than one option matched": "Vlerë e pavlefshme: përputhen më shumë se një opsione",
  "Invalid option: expected one of {0}": "Opsion i pavlefshëm: pritej një nga {0}",
  "Invalid string: must start with \"{0}\"": "Varg i pavlefshëm: duhet të fillojë me “{0}”",
  "Invalid string: must end with \"{0}\"": "Varg i pavlefshëm: duhet të mbarojë me “{0}”",
  "Invalid string: must include \"{0}\"": "Varg i pavlefshëm: duhet të përfshijë “{0}”",
  "Invalid string: must match pattern {0}": "Varg i pavlefshëm: duhet të përputhet me modelin {0}",
  "Invalid number: must be a multiple of {0}": "Numër i pavlefshëm: duhet të jetë shumëfish i {0}",
  "Unrecognized key: {0}": "Çelës i panjohur: {0}",
  "Unrecognized keys: {0}": "Çelësa të panjohur: {0}",
  "Invalid key in {0}": "Çelës i pavlefshëm në {0}",
  "Invalid value in {0}": "Vlerë e pavlefshme në {0}",
  "Invalid discriminator value. Expected {0}": "Vlerë dallimi e pavlefshme. Pritej {0}",
} satisfies Catalogue;
