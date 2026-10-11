import { compileCatalogue, translateText, type Catalogue, type TermLookup } from "@/lib/i18n/catalogue";
import { SOURCE_LOCALE, type Locale } from "@/lib/i18n/config";

/**
 * Albanian for the sentences of an employment timeline
 * (lib/modules/hr/employment/employment.query.ts builds them in English and
 * the service keeps them so). The timeline puts each into the reader's
 * language as it draws it; a name, a title or a company inside a sentence is
 * data and stays as written.
 */
const titles = {
  "Joined {company}": "U punësua te {company}",
  "Rejoined {company}": "U ripunësua te {company}",
  "Transferred to {company}": "U transferua te {company}",
  "Promoted to a new position": "U promovua në një pozicion të ri",
  "Promoted to {title}": "U promovua si {title}",
  "Became untitled": "U bë pa titull",
  "Became {title}": "U bë {title}",
  "Moved to {department}": "U zhvendos në {department}",
  "Left their department": "U largua nga departamenti",
  "Reports to {name}": "Raporton te {name}",
  "No longer has a manager": "Nuk ka më menaxher",
  "Works without a set location": "Punon pa vendndodhje të caktuar",
  "Works at {location}": { sq: "Punon në {location}", slots: { location: "place" } },
  "Now {type}": { sq: "Lloji i punësimit tani: {type}", slots: { type: "employmentType!" } },
  Reorganization: "Riorganizim",
  "Employment updated": "Punësimi u përditësua",
  "Left {company} for another group company": "U largua nga {company} drejt një kompanie tjetër të grupit",
  "Left {company}": "U largua nga {company}",
  "Back at work": "U rikthye në punë",
  Planned: "Planifikuar",
  Active: "Aktiv",
  "On leave": "Me leje",
  Suspended: "Pezulluar",
  Ended: "Përfunduar",
} satisfies Catalogue;

/** The reason a status changed, as the summary line of a status event. */
const statusReasons: Readonly<Record<string, string>> = {
  Hired: "Punësuar",
  Rehired: "U ripunësua",
  Leave: "Leje",
  Returned: "Kthyer",
  Suspension: "Pezullim",
  Resignation: "Dorëheqje",
  Dismissal: "Largim nga puna",
  "End of contract": "Përfundim kontrate",
  Retirement: "Pension",
  "Mutual agreement": "Marrëveshje e ndërsjellë",
  "Transferred to another company": "Transferuar në një kompani tjetër",
  Correction: "Korrigjim",
  Other: "Tjetër",
};

/** What a change row compares, and the values it can carry. */
const changeLabels: Readonly<Record<string, string>> = {
  "Job title": "Titulli i punës",
  Department: "Departamenti",
  Manager: "Menaxheri",
  Location: "Vendndodhja",
  "Employment type": "Lloji i punësimit",
  Status: "Statusi",
};

const places: Readonly<Record<string, string>> = { Office: "Zyrë", Site: "Kantier", Remote: "Në distancë", Hybrid: "Hibrid", Other: "Tjetër" };

const employmentTypes: Readonly<Record<string, string>> = {
  "Full time": "Kohë e plotë",
  "Part time": "Kohë e pjesshme",
  Contractor: "Kontraktor",
  Intern: "Praktikant",
  Temporary: "I përkohshëm",
  Other: "Tjetër",
};

const statuses: Readonly<Record<string, string>> = { Planned: "Planifikuar", Active: "Aktiv", "On leave": "Me leje", Suspended: "Pezulluar", Ended: "Përfunduar" };

const lowerCase = (words: Readonly<Record<string, string>>) => new Map(Object.entries(words).map(([english, albanian]) => [english.toLowerCase(), albanian.toLowerCase()] as const));
const lowerTypes = lowerCase(employmentTypes);

/** A location is "Office, Tirana": the type is a word, the place after it is data. */
function place(english: string): string {
  return english.split(", ").map((part) => places[part] ?? part).join(", ");
}

const TITLES = compileCatalogue(titles, { leastFixedLetters: 3 });

const terms: TermLookup = (kind, english) => {
  if (kind === "place") return place(english);
  if (kind === "employmentType") return lowerTypes.get(english);
  return undefined;
};

/** An event's title in the reader's language. */
export function timelineTitle(english: string, locale: Locale): string {
  return locale === SOURCE_LOCALE ? english : (translateText(TITLES, english, terms) ?? english);
}

/** One line of an event's summary: "Manager: {name}", or a status event's reason. */
export function timelineSummaryLine(english: string, status: boolean, locale: Locale): string {
  if (locale === SOURCE_LOCALE) return english;
  if (status) return statusReasons[english] ?? english;
  return english.startsWith("Manager: ") ? `Menaxheri: ${english.slice("Manager: ".length)}` : english;
}

/** What a change row names, in the reader's language. */
export function timelineChangeLabel(english: string, locale: Locale): string {
  return locale === SOURCE_LOCALE ? english : (changeLabels[english] ?? english);
}

/** What a change row says a field was or became: a location, an employment type or a status (a name or title stays as written). */
export function timelineChangeValue(label: string, english: string | null, locale: Locale): string | null {
  if (english === null || locale === SOURCE_LOCALE) return english;
  if (label === "Location") return place(english);
  if (label === "Employment type") return employmentTypes[english] ?? english;
  if (label === "Status") return statuses[english] ?? english;
  return english;
}
