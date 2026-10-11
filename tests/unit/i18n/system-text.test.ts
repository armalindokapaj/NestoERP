import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { notificationEventDefinitions } from "@/lib/core/notifications/notification.events";
import { holesOf, type Catalogue, type CatalogueRow } from "@/lib/i18n/catalogue";
import { localizeActivity, localizeAttention, localizeNotification } from "@/lib/i18n/system";
import { ACTIVITY_ACTION_KEYS } from "@/lib/i18n/system/activity-actions";
import { SLOT_KINDS, slotText, slotWords } from "@/lib/i18n/system/slots";
import { approvalNouns, approvalVerbs, rows as attentionRows } from "@/lib/i18n/system/sq/attention";
import { fallbackWords, notifications, sentences, standing } from "@/lib/i18n/system/sq/notifications";

import { ACTION_INDEX_FILE, ACTIVITY_ROWS, buildActionIndex, phrasesOf, renderActionIndex, scanActivity } from "../../../scripts/i18n/activity-actions";
import { parse, walk } from "../../../scripts/security/source";

/**
 * System-written text in the reader's language (lib/i18n/system): the bell,
 * the “Needs your attention” list and the activity feeds.
 *
 * The English is written by the services and stored; the Albanian is found by
 * that English when a row is read. Nothing ties the two together but these
 * checks: they derive the English from where it is written — the notification
 * definitions, the attention conditions, every place an activity line is
 * recorded — and hold each catalogue to it. A sentence the code gains, loses
 * or rewords fails here, with the sentence named.
 */

const ROOT = process.cwd();
const letters = (text: string) => text.replace(/\{\w+\}/g, "").replace(/[^\p{L}]/gu, "").length;
const shape = (text: string) => text.replace(/\{\w+\}/g, "{}");
const albanianOf = (row: CatalogueRow) => (typeof row === "string" ? row : row.sq);
const slotsOf = (row: CatalogueRow): Readonly<Record<string, string>> => (typeof row === "string" ? {} : (row.slots ?? {}));

const groups = notifications as Record<string, Catalogue>;
const nested = sentences as Record<string, Catalogue>;
const activityRows = ACTIVITY_ROWS as Catalogue;

/** Every catalogue this piece reads, with a name to report a row by. */
const CATALOGUES: [name: string, rows: Catalogue][] = [
  ...Object.entries(groups).map(([event, rows]): [string, Catalogue] => [`notifications.${event}`, rows]),
  ["notifications.standing", standing],
  ...Object.entries(nested).map(([kind, rows]): [string, Catalogue] => [`sentences.${kind}`, rows]),
  ["attention", attentionRows],
  ["activity", activityRows],
];

/* -------------------------------------------------------------------------- */
/* A sample of a row, and what it should come back as                          */
/* -------------------------------------------------------------------------- */

/** What a hole of each written kind can hold. */
const WRITTEN_SAMPLES: Record<string, string> = {
  date: "14 Sep 2026",
  record: "Invoice INV-2026-0012",
  approvalSteps: "Procurement, Finance",
  workLocation: "office, Tirana HQ",
  credential: "Driving licence",
};
const FREE = ["Alpha", "Bravo 7", "Charlie", "Delta", "Echo"];

type Sample = { english: string; albanian: string };

/**
 * One row as a sentence and as it must be answered: free holes filled with
 * plain values, every other hole with a word of its kind and that word's own
 * Albanian. `phrases` are the action's rows without holes, for a hole that is
 * finished with one of them.
 */
function sampleOf(key: string, row: CatalogueRow, phrases: [english: string, albanian: string][] = []): Sample {
  const slots = slotsOf(row);
  const english = new Map<string, string>();
  const albanian = new Map<string, string>();
  holesOf(key).forEach((hole, index) => {
    const kind = slots[hole]?.replace(/!$/, "");
    let value: Sample = { english: FREE[index % FREE.length], albanian: FREE[index % FREE.length] };
    if (kind === "phrase") value = { english: phrases[0][0], albanian: phrases[0][1] };
    else if (kind && kind in nested) value = sampleOf(...(Object.entries(nested[kind])[0] as [string, CatalogueRow]));
    else if (kind) {
      const word = slotWords(kind)?.[0] ?? WRITTEN_SAMPLES[kind];
      value = { english: word, albanian: slotText(kind, word)! };
    }
    english.set(hole, value.english);
    albanian.set(hole, value.albanian);
  });
  const fill = (text: string, values: Map<string, string>) => text.replace(/\{(\w+)\}/g, (_whole, hole: string) => values.get(hole)!);
  return { english: fill(key, english), albanian: fill(albanianOf(row), albanian) };
}

/* -------------------------------------------------------------------------- */
/* The two promises                                                            */
/* -------------------------------------------------------------------------- */

describe("an English reader", () => {
  it("is handed back exactly what was stored", () => {
    const notification = { id: "n1", eventType: "TASK_ASSIGNED", title: "You were assigned “Pour level 3 slab”", body: "On Riverside Residences" };
    const item = { id: "a1", conditionKey: "OVERDUE_TASK", title: "Overdue: Pour level 3 slab", body: "Due 2026-09-14" };
    expect(localizeNotification("en", notification)).toBe(notification);
    expect(localizeAttention("en", item)).toBe(item);
    expect(localizeActivity("en", { action: "FINANCE_INVOICE_APPROVED", message: "approved invoice INV-2026-0012" })).toBe("approved invoice INV-2026-0012");
    expect(localizeActivity("en", { action: "FINANCE_INVOICE_APPROVED", message: null })).toBeNull();
  });
});

describe("a text the catalogues do not hold", () => {
  it("comes back as it was stored", () => {
    // A phrase with no row, a code nothing indexes, an event nobody defined.
    expect(localizeActivity("sq", { action: "FINANCE_INVOICE_APPROVED", message: "filed the invoice under miscellaneous" })).toBe("filed the invoice under miscellaneous");
    expect(localizeActivity("sq", { action: "INVOICE_CREATED", message: "raised INV-001" })).toBe("raised INV-001");
    expect(localizeActivity("sq", { action: "TASK_UPDATED", message: null })).toBeNull();
    const unknown = { eventType: "SOMETHING_NEW", title: "A thing happened to “the slab”", body: "Somewhere" };
    expect(localizeNotification("sq", unknown)).toBe(unknown);
    const odd = { conditionKey: "OVERDUE_TASK", title: "Something nobody wrote a row for", body: null };
    expect(localizeAttention("sq", odd)).toBe(odd);
  });

  it("is never half translated where a word decides what the sentence is", () => {
    // "frobnicated" is no contractor status, so this is not that sentence.
    expect(localizeActivity("sq", { action: "CONTRACTOR_STATUS_CHANGED", message: "marked Alfa Group shpk frobnicated" })).toBe("marked Alfa Group shpk frobnicated");
    expect(localizeNotification("sq", { eventType: "MEETING_RESPONSE_CHANGED", title: "Arben Hoxha rescheduled Weekly site meeting", body: null }).title).toBe("Arben Hoxha rescheduled Weekly site meeting");
  });

  it("keeps a free second line that only looks like a short one", () => {
    // An RFI's subject is shown as the body; "due …" is this event's sentence only before a date.
    const rfi = localizeNotification("sq", { eventType: "RFI_ASSIGNED", title: "RFI RFI-014 is waiting for your response", body: "due diligence report missing" });
    expect(rfi).toEqual({ eventType: "RFI_ASSIGNED", title: "RFI RFI-014 pret përgjigjen tuaj", body: "due diligence report missing" });
    expect(localizeAttention("sq", { conditionKey: "CONTRACT_EXPIRING", title: "Contract CTR-2026-014 expires 2026-10-01", body: "Due diligence pack" }).body).toBe("Due diligence pack");
  });

  it("leaves what it was given untouched", () => {
    const item = Object.freeze({ conditionKey: "OVERDUE_TASK", title: "Overdue: Pour level 3 slab", body: "Due 2026-09-14" });
    expect(localizeAttention("sq", item)).toEqual({ conditionKey: "OVERDUE_TASK", title: "Me vonesë: Pour level 3 slab", body: "Afati 2026-09-14" });
    expect(item.title).toBe("Overdue: Pour level 3 slab");
  });
});

/* -------------------------------------------------------------------------- */
/* Every row                                                                   */
/* -------------------------------------------------------------------------- */

describe("the catalogues", () => {
  const kinds = new Set([...SLOT_KINDS, ...Object.keys(nested), "phrase"]);

  it("say every sentence with the holes its English has", () => {
    const wrong: string[] = [];
    for (const [name, rows] of CATALOGUES) {
      for (const [key, row] of Object.entries(rows)) {
        const albanian = albanianOf(row);
        if (!albanian || albanian.includes("__TODO__")) wrong.push(`${name}: not translated — ${key}`);
        if (holesOf(key).sort().join() !== holesOf(albanian).sort().join()) wrong.push(`${name}: holes differ — ${key} ⇒ ${albanian}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("name only kinds of word that exist, on holes the sentence has", () => {
    const wrong: string[] = [];
    for (const [name, rows] of CATALOGUES) {
      for (const [key, row] of Object.entries(rows)) {
        for (const [hole, kind] of Object.entries(slotsOf(row))) {
          if (!holesOf(key).includes(hole)) wrong.push(`${name}: no hole {${hole}} — ${key}`);
          if (!kinds.has(kind.replace(/!$/, ""))) wrong.push(`${name}: unknown kind ${kind} — ${key}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("answer for every word a kind says a hole can be", () => {
    for (const kind of SLOT_KINDS) for (const word of slotWords(kind) ?? []) expect(slotText(kind, word), `${kind}: ${word}`).toBeTruthy();
  });

  it("are never reached from the browser", () => {
    const client = ["app", "components", "lib"].flatMap((directory) => walk(join(ROOT, directory), (file) => /\.tsx?$/.test(file)))
      .filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")))
      .filter((file) => readFileSync(file, "utf8").includes("@/lib/i18n/system"));
    expect(client.map((file) => file.slice(ROOT.length + 1))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

const MARK = /⟦([A-Za-z]+)⟧/g;
/** The dispatcher fills `recordName` with the record's own label, and a producer may send `recordLabel`: one hole. */
const SAME_HOLE: Record<string, string> = { recordname: "record", recordlabel: "record" };

type Wording = (payload: Record<string, unknown>) => string | null;

/**
 * Every sentence a title or body function can write: it is called with a
 * payload that answers each key with a mark of itself, then again with every
 * combination of keys missing — which is how the fallback words ("a task",
 * "Someone") and the shorter sentences show themselves. A sentence left with a
 * gap where a value was missing (`Inspection  is assigned to you`) is not one
 * anybody is sent.
 */
function wordings(write: Wording | undefined): string[] {
  if (!write) return [];
  const asked = new Set<string>();
  const payload = (missing: ReadonlySet<string>) =>
    new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key !== "string") return undefined;
          asked.add(key);
          return missing.has(key) ? undefined : `⟦${key}⟧`;
        },
      },
    );
  const subsets = (keys: string[]) => Array.from({ length: 1 << keys.length }, (_unused, mask) => new Set(keys.filter((_key, index) => mask & (1 << index))));
  write(payload(new Set()));
  for (let before = -1; before !== asked.size; ) {
    before = asked.size;
    for (const missing of subsets([...asked])) write(payload(missing));
  }
  const full = write(payload(new Set()));
  // The keys whose absence leaves a hole in the sentence rather than another sentence or a fallback word.
  const gaps = [...asked].filter((key) => full !== null && full.includes(`⟦${key}⟧`) && write(payload(new Set([key]))) === full.replaceAll(`⟦${key}⟧`, ""));
  const found = new Set<string>();
  for (const missing of subsets([...asked])) {
    if (gaps.some((key) => missing.has(key))) continue;
    const text = write(payload(missing));
    if (text === null || text === undefined) continue;
    found.add(text.replace(MARK, (_whole, key: string) => `{${SAME_HOLE[key.toLowerCase()] ?? key.toLowerCase()}}`));
  }
  return [...found];
}

/** The row of a group that writes this sentence: the same sentence, or one whose holes took fallback words in it. */
function rowFor(rows: Catalogue, sentence: string): { key: string; words: [hole: string, word: string][] } | undefined {
  if (sentence in rows) return { key: sentence, words: [] };
  for (const key of Object.keys(rows)) {
    const holes = holesOf(key);
    const pattern = new RegExp(`^${key.split(/\{\w+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)")}$`, "s");
    const match = pattern.exec(sentence);
    if (!match) continue;
    const taken = holes.map((hole, index): [string, string] => [hole, match[index + 1]]);
    // A hole holds itself, or plain words; never some other hole.
    if (taken.every(([hole, text]) => text === `{${hole}}` || !text.includes("{"))) return { key, words: taken.filter(([hole, text]) => text !== `{${hole}}`) };
  }
  return undefined;
}

describe("notification titles and bodies", () => {
  const definitions = notificationEventDefinitions();
  const written = new Map(definitions.map((definition) => [definition.eventType, [...wordings(definition.title), ...wordings(definition.body as Wording | undefined)]]));

  it("have a row for every sentence an event can write, and a word for every fallback", () => {
    const missing: string[] = [];
    for (const [event, sentences] of written) {
      for (const sentence of sentences) {
        // A value passed through alone ("{note}") is data; where it is wording ("{when}") the event has a row for it, checked below.
        if (/^\{\w+\}$/.test(sentence) && !(sentence in (groups[event] ?? {}))) continue;
        const row = rowFor(groups[event] ?? {}, sentence);
        if (!row) {
          missing.push(`${event}: no row — ${sentence}`);
          continue;
        }
        const slots = slotsOf(groups[event][row.key]);
        for (const [hole, word] of row.words) {
          const kind = slots[hole]?.replace(/!$/, "");
          const said = (kind && !(kind in nested) ? slotText(kind, word) : undefined) ?? (fallbackWords as Record<string, string>)[word];
          if (!said) missing.push(`${event}: “${word}” in {${hole}} has no Albanian — ${sentence}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("hold no row for a sentence no event writes", () => {
    const stale: string[] = [];
    for (const [event, rows] of Object.entries(groups)) {
      if (!written.has(event)) stale.push(`${event}: no such event`);
      for (const key of Object.keys(rows)) if (!written.get(event)?.includes(key)) stale.push(`${event}: ${key}`);
    }
    expect(stale).toEqual([]);
  });

  it("find every row again from a sentence of its own", () => {
    for (const [event, rows] of Object.entries(groups)) {
      for (const [key, row] of Object.entries(rows)) {
        const sample = sampleOf(key, row);
        expect(localizeNotification("sq", { eventType: event, title: sample.english, body: sample.english }), `${event}: ${key}`).toEqual({ eventType: event, title: sample.albanian, body: sample.albanian });
      }
    }
  });

  it("say what the events write, from their own payloads", () => {
    const say = (eventType: string, payload: Record<string, unknown>) => {
      const definition = definitions.find((candidate) => candidate.eventType === eventType)!;
      const { title, body } = localizeNotification("sq", { eventType, title: definition.title(payload), body: definition.body?.(payload) ?? null });
      return body === null ? title : `${title} | ${body}`;
    };
    expect(say("TASK_ASSIGNED", { title: "Pour level 3 slab", projectName: "Riverside Residences" })).toBe("Ju u caktua “Pour level 3 slab” | Në Riverside Residences");
    // No title on the payload: the fallback word, in the form its sentence needs.
    expect(say("TASK_ASSIGNED", {})).toBe("Ju u caktua “një detyrë”");
    expect(say("TASK_STATUS_CHANGED", { title: "Pour level 3 slab", statusLabel: "In Progress", actorName: "Arben Hoxha" })).toBe("“Pour level 3 slab” kaloi në statusin Në proces | Nga Arben Hoxha");
    // A record's label is the registry's noun and the record's own number.
    expect(say("APPROVAL_REQUESTED", { recordName: "Purchase order PO-0007", stepLabel: "Finance", submittedByName: "Elira Meta" })).toBe("Porosi blerjeje PO-0007 pret miratimin tuaj në hapin Financë | Dorëzuar nga Elira Meta");
    expect(say("APPROVAL_DECIDED", { recordName: "Invoice INV-2026-0012", decision: "RETURNED", reason: "Totals do not match the order." })).toBe("Faturë INV-2026-0012 është kthyer | Totals do not match the order.");
    expect(say("COMMENT_MENTIONED", { actorName: "Elira Meta", recordLabel: "Daily log · Riverside Residences · 14 Sep 2026" })).toBe("Elira Meta ju përmendi te Ditar kantieri · Riverside Residences · 14 sht 2026");
    // Three holes and no fixed text: the verb is one of four, and carries the predicate.
    expect(say("MEETING_RESPONSE_CHANGED", { responderName: "Arben Hoxha", verb: "tentatively accepted", recordName: "Weekly site coordination" })).toBe("Arben Hoxha iu përgjigj me “ndoshta” ftesës për Weekly site coordination");
    expect(say("MEETING_RESPONSE_CHANGED", {})).toBe("Dikush iu përgjigj ftesës për takimin tuaj");
    expect(say("MEETING_INVITED", { actorName: "Elira Meta", recordName: "Weekly site coordination", when: "Mon 14 Sept, 09:00–10:00", series: "Repeats weekly · 12 meetings scheduled" })).toBe(
      "Elira Meta ju ftoi në Weekly site coordination | hën 14 sht, 09:00–10:00 · Përsëritet çdo javë · takime të planifikuara: 12",
    );
    expect(say("CALENDAR_REMINDER", { recordName: "Crane inspection", when: "Mon 14 Sep (all day)" })).toBe("Kujtesë: Crane inspection | hën 14 sht (gjithë ditën)");
    expect(say("UNIT_INSTALLMENT_DUE_SOON", { installmentLabel: "Këst 2", unitCode: "A-201", dueLabel: "in 3 days", contractNumber: "CTR-2026-041" })).toBe("Këst 2 për A-201 e ka afatin pas 3 ditësh | Kontrata CTR-2026-041");
    expect(say("UNIT_INSTALLMENT_DUE_SOON", { installmentLabel: "Këst 2", unitCode: "A-201", dueLabel: "tomorrow" })).toBe("Këst 2 për A-201 e ka afatin nesër");
    expect(say("UNIT_RESERVATION_EXPIRING", { unitCode: "A-203", whenLabel: "in about 5 hours" })).toBe("Rezervimi për A-203 skadon pas rreth 5 orësh");
    expect(say("UNIT_CONTRACT_CANCELLED", { contractNumber: "CTR-2026-041", unitCode: "A-201", verb: "terminated" })).toBe("Kontrata CTR-2026-041 për A-201 është e ndërprerë");
    expect(say("TIMESHEET_SUBMITTED", { memberName: "Arben Hoxha", weekLabel: "28 Sep – 4 Oct 2026", totalLabel: "38h 30m" })).toBe("Arben Hoxha dorëzoi fletën e orëve për 28 sht – 4 tet 2026 | U regjistruan 38h 30m");
    expect(say("TRANSMITTAL_ISSUED", { number: "TR-0004", purposeLabel: "For construction", count: 12 })).toBe("Transmetimi TR-0004 u lëshua | Për zbatim · dokumente: 12");
    expect(say("SUBMITTAL_REVISION_REQUIRED", { number: "SUB-0007", revisionCode: "B" })).toBe("Dorëzimi teknik SUB-0007 Rev B kërkon një revizion të ri");
    expect(say("QUALIFICATION_EXPIRING", { typeLabel: "Safety certificate", title: "Working at height", personName: "Arben Hoxha", dateLabel: "14 Sep 2026", days: 12 })).toBe(
      "Certifikatë sigurie “Working at height” për Arben Hoxha skadon 14 sht 2026 | Edhe 12 ditë.",
    );
  });

  it("say a sentence carried inside another: an employment change, a milestone's", () => {
    const title = (eventType: string, text: string) => localizeNotification("sq", { eventType, title: text, body: null }).title;
    const body = (eventType: string, text: string) => localizeNotification("sq", { eventType, title: "", body: text }).body;
    // Everything that changed, each part on its own.
    expect(title("EMPLOYMENT_CHANGE_EFFECTIVE", "Promoted to Senior Architect; Manager is now Ana Hoxha")).toBe("U promovuat në pozicionin Senior Architect; Menaxheri juaj tani është Ana Hoxha");
    expect(title("EMPLOYMENT_CHANGE_EFFECTIVE", "Works at site, Riverside; Employment type is now part time")).toBe("Vendi juaj i punës: kantier, Riverside; Lloji juaj i punësimit tani është “kohë e pjesshme”");
    // One part with no row, and the title stays whole in English.
    expect(title("EMPLOYMENT_CHANGE_EFFECTIVE", "Promoted to Senior Architect; Desk moved to floor 3")).toBe("Promoted to Senior Architect; Desk moved to floor 3");
    expect(title("EMPLOYMENT_CHANGE_FAILED", "A scheduled change could not be applied: Department transfer for Arben Hoxha")).toBe("Një ndryshim i planifikuar nuk u zbatua dot: Transferim departamenti për Arben Hoxha");
    expect(body("MILESTONE_UPDATED", "Forecast 14 Sep 2026 → 21 Sep 2026 by Arben Hoxha")).toBe("Parashikimi: 14 sht 2026 → 21 sht 2026 nga Arben Hoxha");
    expect(body("MILESTONE_UPDATED", "Now At Risk by Arben Hoxha")).toBe("Tani: Në rrezik nga Arben Hoxha");
    expect(body("BASELINE_CHANGED", "14 Sep 2026 → 21 Sep 2026 — client change")).toBe("14 sht 2026 → 21 sht 2026 — client change");
    expect(body("DEPARTMENT_ASSIGNMENT_CHANGED", "Your appointment as head of Finance ended.")).toBe("Emërimi juaj për të drejtuar Finance përfundoi.");
  });

  it("say the title that stands in for a record the reader can no longer open", () => {
    expect(localizeNotification("sq", { eventType: "TASK_ASSIGNED", title: "About a record you can no longer open", body: null }).title).toBe("Për një regjistrim që nuk mund ta hapni më");
  });

  it("keep the sentences carried inside others in step with the services that write them", () => {
    const writers: Record<string, string> = {
      employmentChange: "lib/modules/hr/employment/employment.change.service.ts",
      employmentChangeLine: "lib/modules/hr/employment/employment.change.service.ts",
      scheduledChange: "lib/modules/hr/employment/employment.schedule.ts",
      milestoneChange: "lib/modules/project-planning/planning.milestones.ts",
      meetingSeries: "lib/modules/meetings/meeting.service.ts",
      departmentChange: "lib/modules/organization/departments/department.assignment.service.ts",
    };
    expect(Object.keys(nested).sort()).toEqual(Object.keys(writers).sort());
    const gone: string[] = [];
    for (const [kind, rows] of Object.entries(nested)) {
      const source = readFileSync(join(ROOT, writers[kind]), "utf8");
      // The fixed words of each sentence are still written there, in that order of wording if not in one piece (a fallback word sits in its own string).
      for (const key of Object.keys(rows)) for (const word of key.replace(/\{\w+\}/g, " ").match(/\p{L}{3,}/gu) ?? []) if (!source.includes(word)) gone.push(`${kind}: “${word}” of ${key}`);
    }
    expect(gone).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Attention                                                                   */
/* -------------------------------------------------------------------------- */

describe("attention items", () => {
  const CONDITIONS = join(ROOT, "lib/core/notifications/attention.conditions.ts");
  const source = parse(CONDITIONS);
  /** Every title and body of a candidate, as the sentences it can be. */
  const written: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ["title", "body"].includes(node.name.getText(source)) && ts.isObjectLiteralExpression(node.parent) && node.parent.properties.some((entry) => entry.name?.getText(source) === "episode")) {
      written.push(...phrasesOf(node.initializer, source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  /** Rows the conditions do not write themselves, and who does. */
  const ELSEWHERE: Record<string, string> = {
    "Waiting on you.": "lib/modules/dashboard/dashboard.service.ts",
  };

  it("have a row for every sentence a condition writes", () => {
    expect(written.length).toBeGreaterThan(60);
    const rows = new Set(Object.keys(attentionRows).map(shape));
    // “{noun} {verb}” is the approvals sentence, held as nouns and verbs.
    expect(written.filter((sentence) => letters(sentence) > 0 && !rows.has(shape(sentence)))).toEqual([]);
  });

  it("hold no row for a sentence no condition writes", () => {
    const shapes = new Set(written.map(shape));
    const stale = Object.keys(attentionRows).filter((key) => !shapes.has(shape(key)) && !(key in ELSEWHERE));
    expect(stale).toEqual([]);
    for (const [key, file] of Object.entries(ELSEWHERE)) expect(readFileSync(join(ROOT, file), "utf8"), key).toContain(JSON.stringify(key));
  });

  it("name every record an approval can be about, and both things asked of the reader", () => {
    const nouns = [...source.text.matchAll(/noun: "([^"]+)"/g)].map((match) => match[1]);
    expect(Object.keys(approvalNouns).sort()).toEqual([...new Set(nouns)].sort());
    for (const verb of Object.keys(approvalVerbs)) expect(source.text, verb).toContain(`"${verb}"`);
    expect(localizeAttention("sq", { conditionKey: "PENDING_APPROVAL", title: "Invoice waiting for your approval", body: null }).title).toBe("Fatura pret miratimin tuaj");
    expect(localizeAttention("sq", { conditionKey: "PROCUREMENT_ACTION_REQUIRED", title: "Purchase order needs a procurement decision", body: null }).title).toBe("Porosia e blerjes pret vendim prokurimi");
    for (const noun of Object.keys(approvalNouns)) for (const verb of Object.keys(approvalVerbs)) expect(localizeAttention("sq", { conditionKey: "PENDING_APPROVAL", title: `${noun} ${verb}`, body: null }).title).not.toBe(`${noun} ${verb}`);
  });

  it("find every row again from a sentence of its own", () => {
    for (const [key, row] of Object.entries(attentionRows as Catalogue)) {
      const sample = sampleOf(key, row);
      expect(localizeAttention("sq", { conditionKey: "X", title: sample.english, body: sample.english }), key).toEqual({ conditionKey: "X", title: sample.albanian, body: sample.albanian });
    }
  });

  it("say dates, steps and credentials in Albanian", () => {
    const say = (title: string, body: string | null = null) => {
      const item = localizeAttention("sq", { conditionKey: "X", title, body });
      return item.body === null ? item.title : `${item.title} | ${item.body}`;
    };
    expect(say("Purchase order needs the Finance decision", "Step 2 of 3")).toBe("Porosia e blerjes pret vendimin në hapin Financë | Hapi 2 nga 3");
    expect(say("Submit your timesheet for 7–13 Sep 2026", "The submission deadline has passed.")).toBe("Dorëzoni fletën tuaj të orëve për 7–13 sht 2026 | Afati i dorëzimit ka kaluar.");
    expect(say("Milestone overdue: Roof Watertight", "Riverside Residences · due 14 Sep 2026")).toBe("Pikë kyçe me vonesë: Roof Watertight | Riverside Residences · afati 14 sht 2026");
    expect(say("No daily log for Riverside Residences", "14 Sep 2026")).toBe("Nuk ka ditar kantieri për Riverside Residences | 14 sht 2026");
    expect(say("To verify: Driving licence · Arben Hoxha")).toBe("Për t'u verifikuar: Patentë drejtimi · Arben Hoxha");
    expect(say("Expiring: Safety certificate: Working at height · Arben Hoxha", "Expires 14 Sep 2026")).toBe("Në skadim: Certifikatë sigurie: Working at height · Arben Hoxha | Skadon më 14 sht 2026");
    // A contractor's compliance item is named by its own title.
    expect(say("Expired: Liability insurance", "Alfa Group shpk · expired 14 Sep 2026")).toBe("Skaduar: Liability insurance | Alfa Group shpk · skadoi më 14 sht 2026");
    expect(say("Invoice INV-2026-0012 is overdue", "Due 2026-09-14 · 1200.00 EUR outstanding")).toBe("Fatura INV-2026-0012 është me vonesë | Afati 2026-09-14 · 1200.00 EUR pa paguar");
  });
});

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

describe("activity lines", () => {
  const scan = scanActivity(ROOT);
  const index = buildActionIndex(scan);

  it("are read from every place the source writes one", () => {
    expect(scan.sites.length).toBeGreaterThan(450);
    // A place the scan cannot read is a sentence nobody will translate: teach scripts/i18n/activity-actions.ts to read it, or list it there with what it writes.
    expect(scan.unread).toEqual([]);
  });

  it("have a row for every phrase the source writes", () => {
    expect(index.missing.map((gap) => `${gap.file}:${gap.line} ${gap.phrase}`)).toEqual([]);
  });

  it("hold no row for a phrase nothing writes", () => {
    const indexed = new Set(Object.values(index.keys).flat());
    expect(Object.keys(activityRows).filter((key) => !indexed.has(key))).toEqual([]);
  });

  it("are indexed by action code exactly as the source says", () => {
    // Regenerate with: npx tsx scripts/i18n/activity-actions.ts --write
    expect(ACTIVITY_ACTION_KEYS).toEqual(index.keys);
    expect(readFileSync(ACTION_INDEX_FILE, "utf8")).toBe(renderActionIndex(index));
  });

  it("find every row again from a phrase of its own, under each code that writes it", () => {
    for (const [code, keys] of Object.entries(index.keys)) {
      const action = code.endsWith("*") ? `${code.slice(0, -1)}SAMPLE` : code;
      const phrases = keys.filter((key) => holesOf(key).length === 0).map((key): [string, string] => [key, albanianOf(activityRows[key])]);
      for (const key of keys) {
        const sample = sampleOf(key, activityRows[key], phrases);
        expect(localizeActivity("sq", { action, message: sample.english }), `${code}: ${key}`).toBe(sample.albanian);
      }
    }
  });

  it("tell look-alike phrases apart by the code stored beside them", () => {
    const say = (action: string, message: string) => localizeActivity("sq", { action, message });
    // "marked {a} {b}": a contractor, a candidate, a work package, a milestone.
    expect(say("CONTRACTOR_STATUS_CHANGED", "marked Alfa Group shpk suspended")).toBe("shënoi Alfa Group shpk si “pezulluar”");
    expect(say("HR_CANDIDATE_OFFERED", "marked Arben Hoxha offered")).toBe("shënoi Arben Hoxha si “ofertuar”");
    expect(say("WORK_PACKAGE_STATUS_CHANGED", "marked WP-014 on hold")).toBe("shënoi WP-014 si “pezulluar”");
    expect(say("MILESTONE_AT_RISK", "marked Roof Watertight at risk")).toBe("shënoi pikën kyçe Roof Watertight si “në rrezik”");
    // "added {x} to {y}": a floor to a building, a person to a project.
    expect(say("FLOOR_CREATED", "added Level 3 to Tower A")).toBe("shtoi katin Level 3 në ndërtesën Tower A");
    expect(say("PROJECT_MEMBER_ADDED", "added Anna Rossi to the project")).toBe("shtoi Anna Rossi në projekt");
    // "completed {x}" is a milestone, and only under a milestone's code.
    expect(say("MILESTONE_COMPLETED", "completed Foundation Complete")).toBe("përfundoi pikën kyçe Foundation Complete");
    expect(say("CONTRACTOR_ARCHIVED", "completed Foundation Complete")).toBe("completed Foundation Complete");
    // A short phrase is safe among one code's own rows.
    expect(say("QAQC_NCR_CREATED", "raised NCR-2026-0004")).toBe("ngriti NCR-2026-0004");
    expect(say("DOCUMENT_UPLOADED", "added Site Report — Week 32.pdf")).toBe("shtoi Site Report — Week 32.pdf");
  });

  it("say the statuses, results and dates a phrase carries", () => {
    const say = (action: string, message: string) => localizeActivity("sq", { action, message });
    // Raw stored values, labels as written, and lower-cased labels.
    expect(say("TASK_STATUS_CHANGED", "changed the status from TODO to IN_PROGRESS")).toBe("ndryshoi statusin nga “Për t'u bërë” në “Në proces”");
    expect(say("PROJECT_STATUS_CHANGED", "changed the status from Pending to Active")).toBe("ndryshoi statusin nga “Në pritje” në “Aktiv”");
    expect(say("SALES_OPPORTUNITY_STAGE_CHANGED", "moved the opportunity from DISCOVERY to PROPOSAL")).toBe("kaloi mundësinë nga faza “Analizë nevojash” në fazën “Ofertë”");
    expect(say("HSE_HAZARD_CREATED", "reported hazard HAZ-0007 at high risk")).toBe("raportoi rrezikun HAZ-0007 me nivel rreziku “i lartë”");
    expect(say("HSE_INCIDENT_PERSON_ADDED", "recorded a person injured in INC-0003")).toBe("regjistroi një person si “i lënduar” në incidentin INC-0003");
    expect(say("QAQC_INSPECTION_SUBMITTED", "submitted inspection INS-0012 as fail")).toBe("dorëzoi inspektimin INS-0012 me rezultatin “nuk kalon”");
    expect(say("DAILY_LOG_MAJOR_DELAY", "recorded a critical-impact delay")).toBe("regjistroi një vonesë me ndikim “kritik”");
    expect(say("REVISION_REVIEWED", "reviewed DRW-A-101 Rev B: approved with comments")).toBe("rishikoi DRW-A-101 Rev B: miratuar me komente");
    expect(say("REVISION_REVIEWED", "reviewed DRW-A-101 Rev B: revision required")).toBe("rishikoi DRW-A-101 Rev B: kërkohet revizion");
    expect(say("HR_ATTENDANCE_RECORDED", "recorded present on site for 2026-09-14")).toBe("regjistroi “i pranishëm” në kantier për datën 2026-09-14");
    expect(say("HR_ATTENDANCE_RECORDED", "recorded on leave for 2026-09-14")).toBe("regjistroi “me leje” për 2026-09-14");
    expect(say("HR_LEAVE_CREATED", "drafted 5.00 days of annual leave")).toBe("hartoi një kërkesë për 5.00 ditë leje të llojit “leje vjetore”");
    expect(say("MEMBER_ROLE_CHANGED", "changed the role from Engineer to Project Manager")).toBe("ndryshoi rolin nga “Inxhinier” në “Menaxher projekti”");
    // A role the company named itself is data.
    expect(say("MEMBER_ROLE_CHANGED", "changed the role from Engineer to Site Lead")).toBe("ndryshoi rolin nga “Inxhinier” në “Site Lead”");
    expect(say("DAILY_LOG_CREATED", "started the daily log for 14 Sep 2026")).toBe("nisi ditarin e kantierit për datën 14 sht 2026");
    expect(say("MILESTONE_BASELINE_CHANGED", "changed the baseline of Structure Complete from 14 Sep 2026 to 21 Oct 2026")).toBe("ndryshoi bazën e pikës kyçe Structure Complete nga 14 sht 2026 në 21 tet 2026");
    expect(say("TIMESHEET_SUBMITTED", "submitted the timesheet for 28 Dec 2026 – 3 Jan 2027")).toBe("dorëzoi fletën e orëve për javën 28 dhj 2026 – 3 jan 2027");
    expect(say("PROCUREMENT_ORDER_SUBMITTED", "sent order PO-0007 for approval in 3 steps (Procurement, Finance, Executive)")).toBe("dërgoi porosinë PO-0007 për miratim në 3 hapa (Prokurim, Financë, Ekzekutiv)");
  });

  it("finish a sentence with the verb its code chose", () => {
    const say = (action: string, message: string) => localizeActivity("sq", { action, message });
    expect(say("LEGAL_AMENDMENT_MARKED_SENT", "marked as sent amendment AM-2026-003")).toBe("shënoi si të dërguar shtojcën AM-2026-003");
    expect(say("LEGAL_OBLIGATION_COMPLETED", 'completed obligation "Performance bond" on contract CTR-2026-014')).toBe("përfundoi detyrimin “Performance bond” në kontratën CTR-2026-014");
    expect(say("TIMESHEET_RETURNED", "returned the timesheet for 7–13 Sep 2026")).toBe("ktheu mbrapsht fletën e orëve për javën 7–13 sht 2026");
    // The verb of another code is not this one's.
    expect(say("LEGAL_AMENDMENT_MARKED_SENT", "recorded as signed amendment AM-2026-003")).toBe("recorded as signed amendment AM-2026-003");
  });

  it("say the sentences put together from a table", () => {
    const say = (action: string, message: string) => localizeActivity("sq", { action, message });
    expect(say("UNIT_COMMERCIAL_STATUS_CHANGED", "put A-202 on hold")).toBe("mbajti njësinë A-202");
    expect(say("UNIT_CONTRACT_MARK_SIGNED", "recorded sale contract CTR-2026-041 as signed")).toBe("regjistroi kontratën e shitjes CTR-2026-041 si të nënshkruar");
    expect(say("UNIT_CONTRACT_SUBMIT_REVIEW", "moved sale contract CTR-2026-041 to Under review")).toBe("kaloi kontratën e shitjes CTR-2026-041 në statusin “Në shqyrtim”");
    expect(say("PAYMENT_RECORDED", "recorded a payment of EUR 17,600.00 against contract CTR-2026-041")).toBe("regjistroi një pagesë prej EUR 17,600.00 ndaj kontratës CTR-2026-041");
    expect(say("PROVISIONING_REQUEST_RETURN", "returned the account request to HR for Arben Hoxha")).toBe("ia ktheu BNj-së kërkesën për llogari për Arben Hoxha");
    expect(say("TASK_BLOCKED", "marked the task blocked: waiting for the crane permit")).toBe("shënoi detyrën si të bllokuar: waiting for the crane permit");
    expect(say("HR_EMPLOYMENT_POSITION_CHANGE", "Promoted to Senior Architect; Moved to Design, effective 2026-09-14")).toBe("e promovoi në pozicionin Senior Architect; e kaloi në departamentin Design, në fuqi nga 2026-09-14");
  });
});

/* -------------------------------------------------------------------------- */
/* Words in holes                                                              */
/* -------------------------------------------------------------------------- */

describe("words carried in holes", () => {
  it("writes the dates the label helpers write, in every shape", () => {
    const dates: [english: string, albanian: string][] = [
      ["14 Sep 2026", "14 sht 2026"],
      ["7–13 Sep 2026", "7–13 sht 2026"],
      ["28 Sep – 4 Oct 2026", "28 sht – 4 tet 2026"],
      ["Mon 14 Sep", "hën 14 sht"],
      ["Monday 14 Sep 2026", "e hënë 14 sht 2026"],
      ["Mon 14 Sep, 18:00", "hën 14 sht, 18:00"],
      // `Intl` spells the month its own way on the server.
      ["Mon 14 Sept, 09:00–10:00", "hën 14 sht, 09:00–10:00"],
      ["Mon 14 Sep 22:00 – Tue 15 Sep 02:00", "hën 14 sht 22:00 – mar 15 sht 02:00"],
      ["Mon 14 Sep – Wed 16 Sep (all day)", "hën 14 sht – mër 16 sht (gjithë ditën)"],
      ["1 May 2027", "1 maj 2027"],
      ["today", "sot"],
      ["tomorrow", "nesër"],
      ["in 3 days", "pas 3 ditësh"],
      ["in about 2 hours", "pas rreth 2 orësh"],
      ["in about 1 hour", "pas rreth 1 ore"],
      // Already right in any language.
      ["2026-09-14", "2026-09-14"],
    ];
    for (const [english, albanian] of dates) expect(slotText("date", english), english).toBe(albanian);
    // Anything else is not a date, and is left to be shown as stored.
    for (const other of ["soon", "Tower A", "14 Sep 2026 at the latest", "Level 3"]) expect(slotText("date", other), other).toBeUndefined();
  });

  it("finds a status by its stored value, its label and its label in lower case", () => {
    expect(slotText("taskStatus", "IN_PROGRESS")).toBe("Në proces");
    expect(slotText("taskStatus", "In Progress")).toBe("Në proces");
    expect(slotText("status", "in progress")).toBe("në proces");
    expect(slotText("status", "pending_approval")).toBe("në pritje të miratimit");
    expect(slotText("contractorStatus", "offboarded")).toBe("larguar");
    // An acronym keeps its capitals.
    expect(slotText("status", "ncr")).toBe("NCR");
    expect(slotText("status", "frobnicated")).toBeUndefined();
  });

  it("names a record by the registry's noun and the record's own number", () => {
    expect(slotText("record", "Invoice INV-2026-0012")).toBe("Faturë INV-2026-0012");
    expect(slotText("record", "HSE inspection HI-0002")).toBe("Inspektim HSE HI-0002");
    expect(slotText("record", "Receipt GRN-0004")).toBe("Pranim GRN-0004");
    expect(slotText("record", "Payment of 1200.00 EUR")).toBe("Pagesë prej 1200.00 EUR");
    expect(slotText("record", "Timesheet · Arben Hoxha · 7–13 Sep 2026")).toBe("Fletë orësh · Arben Hoxha · 7–13 sht 2026");
    expect(slotText("record", "Leave request")).toBe("Kërkesë për leje");
    // A record labelled by its own title is data, whatever word it starts with.
    expect(slotText("record", "Inspection of the level 3 slab")).toBeUndefined();
    expect(slotText("record", "Pour level 3 slab")).toBeUndefined();
  });

  it("starts every numbered label the registry writes from a noun it knows", () => {
    const registry = readFileSync(join(ROOT, "lib/core/records/record.registry.ts"), "utf8");
    // label: `Invoice ${row.invoiceNumber}` — the words before the first value.
    const nouns = [...registry.matchAll(/label: `([A-Z][A-Za-z ]*?) (?:· )?\$\{/g)].map((match) => match[1]);
    expect(nouns.length).toBeGreaterThan(8);
    for (const noun of new Set(nouns)) expect(slotText("record", `${noun} X-1`) ?? slotText("record", `${noun} · Alpha · 14 Sep 2026`), noun).toBeTruthy();
  });
});
