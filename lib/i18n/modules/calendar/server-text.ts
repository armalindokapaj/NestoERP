import { compileCatalogue, translateText, type Catalogue, type TermLookup } from "@/lib/i18n/catalogue";
import { SOURCE_LOCALE, type Locale } from "@/lib/i18n/config";

import { calendarEn } from "./en";
import { calendarSq } from "./sq";

/**
 * Albanian for the text the Calendar providers build on the server, in
 * English, on every read: titles, subtitles and source names of the entries
 * that come from other modules (a document review, an invoice due, a permit
 * that expires). Entries people create carry their own text and are never
 * passed through here. The providers keep their English; whoever draws an
 * entry finds it here.
 *
 * A hole named `ref` carries a record number (it must hold a digit, so that
 * “Report due” typed by a person is not mistaken for “{ref} due”); `word` is
 * a name or kind that is translated when this file knows it and kept as it is
 * otherwise (a person, a document, a project).
 */
export const rows = {
  // Source names
  "Document review": "Rishikim dokumenti",
  Invoice: "Fatura",
  "Your documents": "Dokumentet tuaja",
  "Your qualifications": "Kualifikimet tuaja",
  "Employee documents": "Dokumentet e punonjësve",
  Qualifications: "Kualifikimet",
  Leave: "Leje",
  Contract: "Kontrata",
  Obligation: "Detyrimi",
  Amendment: "Shtojca e kontratës",
  "Purchase request": "Kërkesa e blerjes",
  RFQ: "RFQ",
  "Purchase order": "Porosia e blerjes",
  Inspection: "Inspektim",
  "Corrective action": "Veprim korrigjues",
  NCR: "NCR",
  Task: "Detyrë",
  "Critical milestone": "Pikë kyçe kritike",
  Milestone: "Pikë kyçe",
  Announcement: "Njoftim",
  "Draft meeting": "Takim në draft",
  Meeting: "Takim",
  "RFI response due": "Afati i përgjigjes për RFI",
  "Submittal review due": "Afati i shqyrtimit të dorëzimit",
  "Contractor compliance": "Përputhshmëria e kontraktorit",
  Timesheet: "Fletë orësh",

  // Kinds a title names
  "Annual leave": "Leje vjetore",
  "Sick leave": "Leje mjekësore",
  "Unpaid leave": "Leje pa pagesë",
  "Parental leave": "Leje prindërore",
  "HR document": "Dokument i BNj",
  "Identity document": "Dokument identiteti",
  Skill: "Aftësi",
  Diploma: "Diplomë",
  Degree: "Gradë akademike",
  "Professional certificate": "Certifikatë profesionale",
  "Skills certificate": "Certifikatë aftësish",
  "Language certificate": "Certifikatë gjuhe",
  "Professional licence": "Licencë profesionale",
  "Driving licence": "Patentë drejtimi",
  "Equipment licence": "Licencë pajisjesh",
  "Work permit": "Leje pune",
  "Safety certificate": "Certifikatë sigurie",
  "Training certificate": "Certifikatë trajnimi",
  "Other qualification": "Kualifikim tjetër",
  Insurance: "Sigurim",
  Licence: "Licencë",
  Certification: "Certifikim",
  "Performance guarantee": "Garanci ekzekutimi",
  "Advance payment guarantee": "Garanci parapagimi",
  Bond: "Garanci bankare",
  "Tax document": "Dokument tatimor",
  "HSE certification": "Certifikim HSE",
  "QA certification": "Certifikim QA",
  Other: "Tjetër",

  // Titles and subtitles
  "Review due: {word}": "Afati i rishikimit: {word}",
  "Awaiting review: {word}": "Pret rishikim: {word}",
  "Version {ref}": { sq: "Versioni {ref}", slots: { ref: "ref!" } },
  "Invoice {ref} due": { sq: "Afati i faturës {ref}", slots: { ref: "ref!" } },
  "{amount} {currency} outstanding": { sq: "{amount} {currency} pa paguar", slots: { amount: "ref!" } },
  "{word} expires": { sq: "{word} skadon", slots: { word: "word" } },
  "{name} — {word} expires": { sq: "{name} — {word} skadon", slots: { word: "word" } },
  "{name} — Unavailable": "{name} — Nuk disponohet",
  "{name} — {word}": { sq: "{name} — {word}", slots: { word: "word!" } },
  "HSE inspection {ref}": { sq: "Inspektimi HSE {ref}", slots: { ref: "ref!" } },
  "Toolbox talk: {word}": "Bisedë sigurie: {word}",
  "Permit {ref} expires": { sq: "Leja {ref} skadon", slots: { ref: "ref!" } },
  "Risk review: {word}": "Rishikimi i rrezikut: {word}",
  "{ref} due": { sq: "Afati: {ref}", slots: { ref: "ref!" } },
  "{ref} starts": { sq: "{ref} fillon", slots: { ref: "ref!" } },
  "{ref} terminates": { sq: "{ref} ndërpritet", slots: { ref: "ref!" } },
  "Obligation due: {word}": "Afati i detyrimit: {word}",
  "{ref} takes effect": { sq: "{ref} hyn në fuqi", slots: { ref: "ref!" } },
  "{ref} needed": { sq: "{ref} nevojitet", slots: { ref: "ref!" } },
  "{ref} responses due": { sq: "Afati i përgjigjeve për {ref}", slots: { ref: "ref!" } },
  "Delivery expected: {ref}": { sq: "Pritet dërgesa: {ref}", slots: { ref: "ref!" } },
  "Reinspection {ref}": { sq: "Riinspektimi {ref}", slots: { ref: "ref!" } },
  "Inspection {ref}": { sq: "Inspektimi {ref}", slots: { ref: "ref!" } },
  "Starts: {word}": "Fillon: {word}",
  "RFI {ref} due": { sq: "Afati i RFI {ref}", slots: { ref: "ref!" } },
  "Timesheet due {time}": { sq: "Afati i fletës së orëve {time}", slots: { time: "ref!" } },
  "{name} · {word}": { sq: "{name} · {word}", slots: { word: "word!" } },
} satisfies Catalogue;

const CATALOGUE = compileCatalogue(rows, { leastFixedLetters: 3 });

/** The calendar's own words for a stored value (“Team event”), English to Albanian. */
const OWN_WORDS = new Map<string, string>(
  (["eventType", "category"] as const).flatMap((group) =>
    Object.entries(calendarEn.labels[group]).map(([value, english]) => [english, (calendarSq.labels[group] as Record<string, string>)[value]] as const),
  ),
);

const terms: TermLookup = (kind, english) => {
  if (kind === "ref") return /\d/.test(english) ? english : undefined;
  if (kind === "word") return OWN_WORDS.get(english) ?? translateText(CATALOGUE, english);
  return undefined;
};

/**
 * An entry's title, subtitle or source name built by a provider, in the
 * reader's language; the text itself when the reader reads English or this
 * file has no row for it.
 */
export function calendarServerText(english: string, locale: Locale): string {
  if (locale === SOURCE_LOCALE || !english) return english;
  return OWN_WORDS.get(english) ?? translateText(CATALOGUE, english, terms) ?? english;
}
