import { compileCatalogue, translateText, type Catalogue, type TermLookup } from "@/lib/i18n/catalogue";
import { SOURCE_LOCALE, type Locale } from "@/lib/i18n/config";
import type { MessageKey, Translate } from "@/lib/i18n/translator";

import { approvalsEn } from "./en";

/**
 * Albanian for the text the Approvals providers build on the server, in
 * English, on every read: summary labels, reasons, warnings, history lines,
 * blocked reasons and the "Open full …" link. The providers keep their English
 * (tests, exports and the English reader depend on it); the Approvals Center
 * finds each English text here as it draws it (components/approvals/approvals-text.tsx).
 */
export const rows = {
  // Summary field labels
  Document: "Dokumenti",
  Version: "Versioni",
  File: "Skedari",
  Size: "Madhësia",
  Project: "Projekti",
  Due: "Afati",
  Client: "Klienti",
  "Issue date": "Data e lëshimit",
  "Payment due": "Afati i pagesës",
  Subtotal: "Nëntotali",
  Tax: "Tatimi",
  Total: "Totali",
  Payee: "Përfituesi",
  Category: "Kategoria",
  "Expense date": "Data e shpenzimit",
  Net: "Neto",
  "Total budget": "Buxheti total",
  "Approved v{version}": "Miratuar v{version}",
  Counterparty: "Pala tjetër",
  Expected: "Pritet",
  Amount: "Shuma",
  Employee: "Punonjësi",
  "Leave type": "Lloji i lejes",
  From: "Nga",
  To: "Deri",
  Days: "Ditë",
  "Remaining {year}": "Të mbetura {year}",
  Type: "Lloji",
  Result: "Rezultati",
  Location: "Vendndodhja",
  Inspected: "Inspektuar",
  Activity: "Aktiviteti",
  Hazards: "Rreziqet",
  "Highest remaining risk": "Rreziku më i lartë i mbetur",
  Assessed: "Vlerësuar",
  Valid: "Vlefshmëria",
  "Risk assessment": "Vlerësimi i rrezikut",
  PPE: "PMP",
  Severity: "Ashpërsia",
  Occurred: "Ndodhi",
  "Root cause": "Shkaku rrënjësor",
  Effective: "Në fuqi",
  Expires: "Skadon",
  Value: "Vlera",
  Contract: "Kontrata",
  "Value change": "Ndryshimi i vlerës",
  "Value before": "Vlera para",
  "Value after": "Vlera pas",
  "New expiry": "Skadenca e re",
  Department: "Departamenti",
  Priority: "Prioriteti",
  "Needed by": "Nevojitet deri më",
  Lines: "Rreshta",
  "Estimated total": "Totali i vlerësuar",
  Supplier: "Furnitori",
  "Purchase request": "Kërkesa e blerjes",
  "Order date": "Data e porosisë",
  "Delivery required": "Dërgesa e kërkuar",
  "PO total": "Totali i porosisë",
  Quotes: "Ofertat",
  Status: "Statusi",
  "Published version": "Versioni i botuar",
  Readiness: "Gatishmëria",
  "Sales Plan": "Plani i shitjes",
  Inspector: "Inspektori",
  "Corrective action": "Veprimi korrigjues",
  "Action due": "Afati i veprimit",
  Opportunity: "Mundësia",
  "Valid until": "E vlefshme deri më",
  Week: "Java",
  Billable: "E faturueshme",
  "Non-billable": "Jo e faturueshme",
  Overtime: "Orë shtesë",
  "Daily totals": "Totalet ditore",
  "Agreed price": "Çmimi i rënë dakord",
  "Asking price": "Çmimi i kërkuar",
  "Reserved until": "E rezervuar deri më",

  // "Open full …" links
  "Open full leave request": "Hap kërkesën e plotë për leje",
  "Open full document": "Hap dokumentin e plotë",
  "Open full invoice": "Hap faturën e plotë",
  "Open full expense": "Hap shpenzimin e plotë",
  "Open full budget": "Hap buxhetin e plotë",
  "Open full commitment": "Hap angazhimin e plotë",
  "Open full hse inspection": "Hap inspektimin e plotë HSE",
  "Open full risk assessment": "Hap vlerësimin e plotë të rrezikut",
  "Open full work permit": "Hap lejen e plotë të punës",
  "Open full incident closure": "Hap mbylljen e plotë të incidentit",
  "Open full contract": "Hap kontratën e plotë",
  "Open full amendment": "Hap shtojcën e plotë të kontratës",
  "Open full purchase request": "Hap kërkesën e plotë të blerjes",
  "Open full purchase order": "Hap porosinë e plotë të blerjes",
  "Open full unit": "Hap njësinë e plotë",
  "Open full quality inspection": "Hap inspektimin e plotë të cilësisë",
  "Open full ncr": "Hap NCR-në e plotë",
  "Open full proposal": "Hap ofertën e plotë",
  "Open full timesheet": "Hap fletën e plotë të orëve",
  "Open full unit sale": "Hap shitjen e plotë të njësisë",

  // Why this needs approval
  "A version is approved before it is relied on as the current document.": "Një version miratohet para se të përdoret si dokumenti aktual.",
  "Every invoice is approved before it goes to the client.": "Çdo faturë miratohet para se t’i dërgohet klientit.",
  "An expense counts as project cost only once it is approved.": "Një shpenzim llogaritet si kosto projekti vetëm pasi të miratohet.",
  "A project budget is approved before project cost is measured against it.": "Buxheti i projektit miratohet para se kostoja e projektit të matet kundrejt tij.",
  "Money promised to a counterparty is approved before it counts against the budget.": "Paratë e premtuara një pale tjetër miratohen para se të llogariten kundrejt buxhetit.",
  "Leave is approved before it starts, so the team and the attendance record agree on who is in.": "Leja miratohet para se të fillojë, që ekipi dhe regjistri i pjesëmarrjes të përputhen për kë është në punë.",
  "A submitted safety inspection is approved before its findings are final.": "Një inspektim sigurie i dorëzuar miratohet para se gjetjet e tij të jenë përfundimtare.",
  "Work planned against a risk assessment waits for the assessment's approval.": "Puna e planifikuar mbi një vlerësim rreziku pret miratimin e vlerësimit.",
  "Hazardous work starts only under an approved permit.": "Puna e rrezikshme fillon vetëm me një leje të miratuar.",
  "An incident is closed only once its investigation and actions are signed off.": "Një incident mbyllet vetëm pasi hetimi dhe veprimet e tij të jenë miratuar.",
  "A reviewed contract is approved before it is sent for signature.": "Një kontratë e shqyrtuar miratohet para se të dërgohet për nënshkrim.",
  "An amendment changes a signed agreement, so it is approved before it is sent.": "Një shtojcë ndryshon një marrëveshje të nënshkruar, ndaj miratohet para se të dërgohet.",
  "A purchase request is approved before anybody asks suppliers for prices.": "Një kërkesë blerjeje miratohet para se dikush t’u kërkojë çmime furnitorëve.",
  "A purchase order commits money to a supplier, so it is approved before it is issued.": "Një porosi blerjeje angazhon para te një furnitor, ndaj miratohet para se të lëshohet.",
  "A unit is published before Sales, Finance or the 3D explorer rely on it.": "Një njësi botohet para se Shitjet, Financa ose eksploruesi 3D të mbështeten tek ajo.",
  "A submitted inspection is approved before its result counts.": "Një inspektim i dorëzuar miratohet para se rezultati i tij të llogaritet.",
  "A non-conformance report's disposition is approved before corrective work proceeds on it.": "Zgjidhja e një raporti mospërputhjeje miratohet para se të vazhdojë puna korrigjuese.",
  "A proposal's price is approved before it is sent to the client.": "Çmimi i një oferte miratohet para se t’i dërgohet klientit.",
  "A week's time is approved before it counts in project reporting.": "Koha e një jave miratohet para se të llogaritet në raportimin e projektit.",
  "This company approves a sale before the unit is marked Sold.": "Kjo kompani miraton një shitje para se njësia të shënohet si e shitur.",

  // Warnings
  "You requested this, so somebody else has to decide it.": "Këtë e keni kërkuar ju, ndaj duhet ta vendosë dikush tjetër.",
  "You would decide this on behalf of {name}, under their delegation.": "Do ta vendosnit këtë në emër të {name}, sipas delegimit të tij.",
  "The review was due {date}.": "Shqyrtimi kishte afat {date}.",
  "A newer approved version has replaced this one.": "Një version më i ri i miratuar e ka zëvendësuar këtë.",
  "The assigned reviewer is no longer active. Reassign the review from the document.": "Shqyrtuesi i caktuar nuk është më aktiv. Ricaktojeni shqyrtimin nga dokumenti.",
  "Payment was due {date}, before this invoice was approved.": "Pagesa kishte afat {date}, para se kjo faturë të miratohej.",
  "Raises the approved budget by {amount}.": "Rrit buxhetin e miratuar me {amount}.",
  "This leave began {date} without a decision.": "Kjo leje filloi më {date} pa vendim.",
  "Only {remaining} days of this leave remain for {year}.": "Për {year} kanë mbetur vetëm {remaining} ditë leje.",
  "This is your own leave, so somebody else decides it.": "Kjo është leja juaj, ndaj e vendos dikush tjetër.",
  "At least one hazard remains critical after controls.": "Të paktën një rrezik mbetet kritik pas masave kontrolluese.",
  "The permit was due to start {date}.": "Leja duhej të fillonte më {date}.",
  "Its risk assessment {number} is not approved yet.": "Vlerësimi i rrezikut {number} nuk është miratuar ende.",
  "It was due to take effect {date}, before approval.": "Duhej të hynte në fuqi më {date}, para miratimit.",
  "It expires {date}.": "Skadon {date}.",
  "Needed by {date} — little time is left to source it.": "Nevojitet deri më {date} — ka mbetur pak kohë për ta siguruar.",
  "{name} is {status}.": { sq: "Furnitori {name} është {status}.", slots: { status: "supplierStatus!" } },
  "Prices or quantities were changed from the selected quote.": "Çmimet ose sasitë janë ndryshuar nga oferta e zgjedhur.",
  "Approval limits are in {currency}; this order is in {other}.": "Kufijtë e miratimit janë në {currency}; kjo porosi është në {other}.",
  "A lower quote of {amount} was received.": "Është marrë një ofertë më e ulët prej {amount}.",
  "Cannot be published yet. Missing: {missing}.": "Ende nuk mund të botohet. Mungon: {missing}.",
  "The proposal's validity ended {date}.": "Vlefshmëria e ofertës përfundoi më {date}.",
  "The reservation has ended; this request can no longer be approved.": "Rezervimi ka përfunduar; kjo kërkesë nuk mund të miratohet më.",

  // History
  Requested: "Kërkuar",
  Resubmitted: "Ridorëzuar",
  Approved: "Miratuar",
  Rejected: "Refuzuar",
  "Returned for revision": "U kthye për rishikim",
  "{label} {verb}": { sq: "{label}: {verb}", slots: { label: "stepLabel", verb: "stepVerb!" } },
  "{label} pending": { sq: "{label}: në pritje", slots: { label: "stepLabel" } },
  "Awaiting decision": "Pret vendim",
  "Final approval": "Miratimi përfundimtar",
  Withdrawn: "Tërhequr",
  "Review of v{number} requested from {name}": "Rishikimi i v{number} u kërkua nga {name}",
  "v{number} approved": "v{number} u miratua",
  "v{number} rejected": "v{number} u refuzua",
  "Review withdrawn": "Rishikimi u tërhoq",

  // Chain steps
  Executive: "Drejtuesi ekzekutiv",

  // Why a decision is blocked
  "Your role cannot decide this, so it waits for somebody who can.": "Roli juaj nuk mund ta vendosë këtë, ndaj pret dikë që mundet.",
  "You requested this, so somebody else decides it.": "Këtë e keni kërkuar ju, ndaj e vendos dikush tjetër.",
  "You decided an earlier step, so somebody else takes this one.": "Keni vendosur një hap më të hershëm, ndaj këtë hap e merr dikush tjetër.",
  "You take a later step, so the {label} decision goes to somebody else.": { sq: "Merrni një hap më të vonë, ndaj vendimin e hapit “{label}” e merr dikush tjetër.", slots: { label: "stepLabel" } },
  "Waiting for the designated approver.": "Pret miratuesin e caktuar.",
  "Waiting for the {label} decision (step {number} of {total}).": { sq: "Pret vendimin e hapit “{label}” (hapi {number} nga {total}).", slots: { label: "stepLabel" } },
  "You are named on this record, so somebody else decides it.": "Jeni përmendur në këtë regjistrim, ndaj e vendos dikush tjetër.",
  "You carried out this inspection, so somebody else decides it.": "Këtë inspektim e keni kryer ju, ndaj e vendos dikush tjetër.",
  "You requested this permit, so somebody else decides it.": "Këtë leje e keni kërkuar ju, ndaj e vendos dikush tjetër.",
  "Waiting for an approver.": "Pret një miratues.",
  "You asked for this review, so somebody else decides it.": "Këtë shqyrtim e keni kërkuar ju, ndaj e vendos dikush tjetër.",
  "Assigned to {name}.": "Caktuar te {name}.",
} satisfies Catalogue;

/** A step's verb in a history line ("Finance approved"). */
export const stepVerbs: Readonly<Record<string, string>> = {
  approved: "miratuar",
  rejected: "refuzuar",
  returned: "kthyer mbrapsht",
};

/** A supplier's status in a warning ("… is inactive"), as it follows “Furnitori {name} është”. */
export const supplierStatuses: Readonly<Record<string, string>> = {
  active: "aktiv",
  inactive: "joaktiv",
  archived: "i arkivuar",
};

/** The providers' English module and source names, and the English messages the client knows, back to their keys. */
const ENGLISH_KEYS = new Map<string, MessageKey<"approvals">>([
  ...Object.entries(approvalsEn.providers).map(([key, text]) => [text, `providers.${key}` as MessageKey<"approvals">] as const),
  ...Object.entries(approvalsEn.sources).map(([key, text]) => [text, `sources.${key}` as MessageKey<"approvals">] as const),
  ...Object.entries(approvalsEn.errors).map(([key, text]) => [text, `errors.${key}` as MessageKey<"approvals">] as const),
]);

/** What the providers build on the server in English, found by its text; some of it is a sentence with values in it. */
const SERVER_TEXT = compileCatalogue(rows, { leastFixedLetters: 3 });

/** The words a hole of a server text can carry: a step's name, a step's verb, a supplier's status. */
const serverTerms = (t: Translate<"approvals">): TermLookup => (kind, english) => {
  if (kind === "stepVerb") return stepVerbs[english];
  if (kind === "supplierStatus") return supplierStatuses[english];
  if (kind === "stepLabel") {
    const key = ENGLISH_KEYS.get(english);
    return key ? t(key) : translateText(SERVER_TEXT, english);
  }
  return undefined;
};

/**
 * A provider's English label (a module or source name), a known English
 * message or a text the providers build on the server (summary labels,
 * reasons, warnings, history, blocked reasons), in the reader's language;
 * anything else passes through unchanged.
 */
export function approvalsWord(t: Translate<"approvals">, english: string, locale: Locale = SOURCE_LOCALE): string {
  const key = ENGLISH_KEYS.get(english);
  if (key) return t(key);
  if (locale === SOURCE_LOCALE) return english;
  return translateText(SERVER_TEXT, english, serverTerms(t)) ?? english;
}

