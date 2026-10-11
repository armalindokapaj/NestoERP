import { DATE_NAMES, monthName, weekdayName } from "@/lib/i18n/format";
import { messages } from "@/lib/i18n/messages";
import { moduleMessages } from "@/lib/i18n/modules";
import { CONTRACTOR_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";
import { UNIT_CONTRACT_STATUS_LABELS } from "@/lib/modules/contracts/units/unit-contract.types";
import { REVIEW_DECISION_LABELS, TRANSMITTAL_PURPOSE_LABELS } from "@/lib/modules/engineering/engineering.types";
import { changeTypeLabels } from "@/lib/modules/hr/employment/employment.labels";
import { QUALIFICATION_TYPE_RULES } from "@/lib/modules/hr/qualifications/qualification.types";
import { STATUS_LABELS as MILESTONE_STATUS_LABELS } from "@/lib/modules/project-planning/planning.types";
import { projectStatusLabels } from "@/lib/modules/projects/project.status";

import { fallbackWords } from "./sq/notifications";

/**
 * The English words that arrive inside a stored sentence, in Albanian.
 *
 * A notification or an activity line is stored whole, and some of what fills
 * its holes is not data but wording the writer chose: a status ("blocked", or a
 * raw "IN_PROGRESS"), a date as a label helper spelled it ("14 Sep 2026",
 * "in 3 days"), a record's label ("Invoice INV-2026-0012"). The catalogue row
 * says which kind of word a hole carries (`slots`), and this file answers for
 * each kind.
 *
 * Nothing is translated twice: the Albanian for a status is the one the
 * module's own pages show (its dictionary, found through the English label the
 * code wrote), and month and weekday names are the tables of lib/i18n/format.ts.
 * A word no kind knows is answered with `undefined`, and the sentence keeps it
 * as it was stored.
 *
 * Server-only, like the catalogues it serves.
 */

const en = moduleMessages.en;
const sq = moduleMessages.sq;

/* -------------------------------------------------------------------------- */
/* Enumerations                                                                */
/* -------------------------------------------------------------------------- */

type Words = {
  /** Every English form the code writes, for a hole that must be one of them. */
  english: readonly string[];
  find(english: string): string | undefined;
};

/** "Në proces" inside a sentence: "në proces". An acronym keeps its capitals ("NCR", "HSE …"). */
function lowerFirst(text: string): string {
  return /^\p{Lu}(?=\p{Ll}|\s|$)/u.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

const isLowerCase = (text: string) => text === text.toLowerCase() && /\p{Ll}/u.test(text);

/**
 * One enumeration's words. `english` is how the code labels each value (its
 * exported label map, or the English dictionary where the code has none);
 * `albanian` is the same values as the module's pages show them. A sentence
 * carries a value as its label ("In Progress"), lower-cased ("in progress") or
 * raw ("IN_PROGRESS", "in_progress"); every form finds the same word, and one
 * that arrived in lower case is answered in lower case.
 */
function enumeration(english: Readonly<Record<string, string>>, albanian: Readonly<Record<string, string | undefined>>, own: Readonly<Record<string, string>> = {}): Words {
  const byForm = new Map<string, string>();
  const forms: string[] = [];
  for (const [value, label] of Object.entries(english)) {
    const word = own[value] ?? albanian[value];
    if (!word) continue;
    const raw = value.toLowerCase();
    for (const form of [label, label.toLowerCase(), value, raw, raw.replace("_", " "), raw.replaceAll("_", " ")]) {
      if (!forms.includes(form)) forms.push(form);
      if (!byForm.has(form.toLowerCase())) byForm.set(form.toLowerCase(), word);
    }
  }
  return {
    english: forms,
    find(text) {
      const word = byForm.get(text.toLowerCase());
      if (word === undefined) return undefined;
      return isLowerCase(text) ? lowerFirst(word) : word;
    },
  };
}

/** A few fixed words, each as the sentence writes it. */
function words(table: Readonly<Record<string, string>>): Words {
  return { english: Object.keys(table), find: (text) => table[text] };
}

const qualificationTypes = Object.fromEntries(Object.entries(QUALIFICATION_TYPE_RULES).map(([type, rule]) => [type, rule.label]));

const ENUMERATIONS: Readonly<Record<string, Words>> = {
  // Any stored status, priority or result, by the table every status badge reads.
  status: enumeration(en.common.status, sq.common.status),
  taskStatus: enumeration(en.tasks.status, sq.tasks.status),
  projectStatus: enumeration(projectStatusLabels, sq.projects.status),
  milestoneStatus: enumeration(MILESTONE_STATUS_LABELS, sq.projects.milestoneStatus),
  opportunityStage: enumeration(en.sales.labels.stage, sq.sales.labels.stage),
  contractorStatus: enumeration(CONTRACTOR_STATUS_LABELS, sq.contractors.labels.contractorStatus),
  contractStatus: enumeration(UNIT_CONTRACT_STATUS_LABELS, sq.contracts.labels.contractStatus),
  // "Revision required" is a new numbered revision, not another review: the system text says revizion throughout.
  reviewDecision: enumeration(REVIEW_DECISION_LABELS, sq.engineering.labels.decision, { REVISION_REQUIRED: "Kërkohet revizion" }),
  transmittalPurpose: enumeration(TRANSMITTAL_PURPOSE_LABELS, sq.engineering.labels.purpose),
  changeType: enumeration(changeTypeLabels, sq.hr.labels.changeType),
  leaveType: enumeration(en.hr.labels.leaveType, sq.hr.labels.leaveType),
  employmentType: enumeration(en.hr.labels.employmentType, sq.hr.labels.employmentType),
  attendanceStatus: enumeration(en.hr.labels.attendanceStatus, sq.hr.labels.attendanceStatus),
  qualificationType: enumeration(qualificationTypes, sq.people.labels.qualificationType),
  // A professional document is named by its qualification type; three categories have none.
  documentCategory: enumeration(
    { ...qualificationTypes, TRANSCRIPT: "Transcript", CV: "CV", OTHER_PROFESSIONAL: "Other professional document" },
    { ...sq.people.labels.qualificationType, TRANSCRIPT: "Transkript", CV: "CV", OTHER_PROFESSIONAL: "Dokument tjetër profesional" },
  ),
  involvement: enumeration(en.hse.people.involvementLabel, sq.hse.people.involvementLabel),
  riskLevel: enumeration(en.hse.labels.riskLevel, sq.hse.labels.riskLevel),
  hseResult: enumeration(en.hse.labels.inspectionResult, sq.hse.labels.inspectionResult),
  qaqcResult: enumeration(en.qaqc.labels.inspectionResult, sq.qaqc.labels.inspectionResult),
  delayImpact: enumeration(en.dailyLogs.labels.delayImpact, sq.dailyLogs.labels.delayImpact),
  role: enumeration(
    Object.fromEntries(Object.entries(messages.en.roles).map(([key, role]) => [key, role.label])),
    Object.fromEntries(Object.entries(messages.sq.roles).map(([key, role]) => [key, role.label])),
  ),
  // An approval's outcome as its notification words it: "was approved", "was returned".
  decision: enumeration({ APPROVED: "Approved", REJECTED: "Rejected", RETURNED: "Returned" }, sq.common.status),
  // The steps of a purchase order's approval chain (lib/modules/procurement/approvals/approval.policy.ts).
  approvalStep: words({ Procurement: "Prokurim", Finance: "Financë", Executive: "Ekzekutiv" }),
  // How often a series of meetings repeats, as its invitation says it ("Repeats weekly · 12 meetings scheduled"); the Albanian is the meeting page's whole label.
  repeat: words({ daily: sq.meetings.labels.repeat.DAILY, weekly: sq.meetings.labels.repeat.WEEKLY, monthly: sq.meetings.labels.repeat.MONTHLY, yearly: sq.meetings.labels.repeat.YEARLY }),
  // How somebody answered a meeting invitation; the Albanian carries the whole predicate: "{name} {verb} {meeting}".
  meetingResponse: words({
    accepted: "pranoi ftesën për",
    declined: "refuzoi ftesën për",
    "tentatively accepted": "iu përgjigj me “ndoshta” ftesës për",
    "replied to": "iu përgjigj ftesës për",
  }),
};

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

/** An English month or weekday name, as any label helper or `Intl` spells it → what to look up in the Albanian tables. */
const DATE_WORDS = new Map<string, { month: number } | { weekday: number; width: "short" | "long" }>();
DATE_NAMES.en.monthShort.forEach((name, index) => DATE_WORDS.set(name.toLowerCase(), { month: index + 1 }));
DATE_NAMES.en.monthLong.forEach((name, index) => DATE_WORDS.set(name.toLowerCase(), { month: index + 1 }));
// en-GB's own abbreviation, which `Intl` writes where the label helpers write "Sep".
DATE_WORDS.set("sept", { month: 9 });
DATE_NAMES.en.weekdayShort.forEach((name, index) => DATE_WORDS.set(name.toLowerCase(), { weekday: index + 1, width: "short" }));
DATE_NAMES.en.weekdayLong.forEach((name, index) => DATE_WORDS.set(name.toLowerCase(), { weekday: index + 1, width: "long" }));

const RELATIVE: Readonly<Record<string, string>> = { today: "sot", tomorrow: "nesër", yesterday: "dje" };
const ALL_DAY = "all day";

/** "in 3 days", "in about 2 hours" — the forms lib/i18n/format.ts gives "pas …". */
function relative(english: string): string | undefined {
  const days = /^in (\d+) days?$/.exec(english);
  if (days) return Number(days[1]) === 1 ? "pas 1 dite" : `pas ${days[1]} ditësh`;
  const hours = /^in about (\d+) hours?$/.exec(english);
  if (hours) return Number(hours[1]) === 1 ? "pas rreth 1 ore" : `pas rreth ${hours[1]} orësh`;
  return undefined;
}

/**
 * A date as a label helper wrote it — "14 Sep 2026", "7–13 Sep 2026",
 * "28 Sep – 4 Oct 2026", "Mon 14 Sep, 09:00–10:00", "Mon 14 Sep (all day)",
 * "14 Sep 2026 → 21 Sep 2026" — or "today", "tomorrow", "in 3 days".
 *
 * Only the names change; the order and the punctuation are the label's own,
 * which is also how `dayText` writes an Albanian day. A text with any other
 * word in it is not a date, and is left alone; a date with no word in it
 * ("2026-09-14", "09:00") is already right.
 */
function dateWording(english: string): string | undefined {
  const fixed = RELATIVE[english] ?? relative(english);
  if (fixed) return fixed;
  if (!/\d/.test(english)) return undefined;
  let other = false;
  const text = english.replaceAll(ALL_DAY, "\u0000").replace(/\p{L}+/gu, (word) => {
    const name = DATE_WORDS.get(word.toLowerCase());
    if (!name) {
      other = true;
      return word;
    }
    return "month" in name ? monthName(name.month, "short", "sq") : weekdayName(name.weekday, name.width, "sq");
  });
  return other ? undefined : text.replaceAll("\u0000", sq.calendar.allDayLower);
}

/* -------------------------------------------------------------------------- */
/* Record labels                                                               */
/* -------------------------------------------------------------------------- */

const nouns = sq.common.recordTypes;

/**
 * The record types whose label the registry starts with a noun
 * (`Invoice ${row.invoiceNumber}`, lib/core/records/record.registry.ts), each
 * with the Albanian noun the same pages use. Stock documents go by their short
 * name there: "Receipt GRN-0004".
 */
const LABEL_NOUNS: Readonly<Record<string, string>> = {
  Invoice: nouns.invoice,
  Payment: nouns.payment,
  Expense: nouns.expense,
  Commitment: nouns.commitment,
  "Purchase order": nouns.purchase_order,
  "Goods receipt": nouns.goods_receipt,
  Receipt: "Pranim",
  Issue: "Dalje",
  Adjustment: "Rregullim",
  Inspection: nouns.quality_inspection,
  "HSE inspection": nouns.hse_inspection,
  Timesheet: nouns.timesheet,
  "Daily log": nouns.daily_log,
};
const LABEL_NOUNS_LONGEST_FIRST = Object.keys(LABEL_NOUNS).sort((a, b) => b.length - a.length);

/**
 * Labels that are words and nothing else: a record type's own noun, which a
 * producer names a record by when its label cannot be read ("Purchase order
 * needs approval"), and the few labels the registry writes whole.
 */
const WHOLE_LABELS = new Map<string, string>(Object.entries(en.common.recordTypes).map(([type, noun]) => [noun, nouns[type as keyof typeof nouns]]));
WHOLE_LABELS.set("Project budget", "Buxhet projekti");
WHOLE_LABELS.set("Expense draft", "Shpenzim në draft");
WHOLE_LABELS.set("Untitled", "Pa titull");

/**
 * A record's label where the registry builds it from its noun: "Invoice
 * INV-2026-0012" → "Faturë INV-2026-0012", "Daily log · Riverside · 14 Sep
 * 2026" → "Ditar kantieri · Riverside · 14 sht 2026". A record labelled by its
 * own title is data and is not touched — so the noun must be followed by one
 * number or code, not by more words ("Inspection of the level 3 slab" is
 * somebody's task).
 */
function recordLabel(english: string): string | undefined {
  const whole = WHOLE_LABELS.get(english);
  if (whole) return whole;
  const payment = /^Payment of (\S+ \S+)$/.exec(english);
  if (payment) return `${LABEL_NOUNS.Payment} prej ${payment[1]}`;
  for (const noun of LABEL_NOUNS_LONGEST_FIRST) {
    if (!english.startsWith(`${noun} `)) continue;
    const rest = english.slice(noun.length + 1);
    if (rest.startsWith("· ")) {
      // "Timesheet · Arben Hoxha · 7–13 Sep 2026": the last part is the week or the day.
      const parts = rest.slice(2).split(" · ");
      const last = parts.length > 1 ? dateWording(parts[parts.length - 1]) : undefined;
      if (last) parts[parts.length - 1] = last;
      return `${LABEL_NOUNS[noun]} · ${parts.join(" · ")}`;
    }
    return /^\S*\d\S*$/.test(rest) ? `${LABEL_NOUNS[noun]} ${rest}` : undefined;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Lists and places                                                            */
/* -------------------------------------------------------------------------- */

/** "Procurement, Finance, Executive": every step, or none. */
function approvalSteps(english: string): string | undefined {
  const steps = english.split(", ").map((step) => ENUMERATIONS.approvalStep.find(step));
  return steps.every((step): step is string => step !== undefined) ? steps.join(", ") : undefined;
}

/** "office, Tirana HQ" — where somebody works: the kind of place, then its own name. */
function workLocation(english: string): string | undefined {
  if (english === "no set location") return "pa vend të caktuar";
  const [kind, ...place] = english.split(", ");
  const word = WORK_LOCATIONS.find(kind);
  return word === undefined ? undefined : [word, ...place].join(", ");
}
const WORK_LOCATIONS = enumeration(en.hr.labels.workLocationType, sq.hr.labels.workLocationType);

/**
 * What an attention item calls an employee document or a qualification: the
 * document's category ("Driving licence", or "HR document" for one that is not
 * professional), a qualification's type before its own title ("Safety
 * certificate: Working at height").
 */
function credential(label: string): string | undefined {
  if (label === "HR document") return fallbackWords["HR document"];
  const category = ENUMERATIONS.documentCategory.find(label);
  if (category) return category;
  const [type, ...title] = label.split(": ");
  const word = title.length ? ENUMERATIONS.qualificationType.find(type) : undefined;
  return word === undefined ? undefined : [word, ...title].join(": ");
}

const WRITTEN: Readonly<Record<string, (english: string) => string | undefined>> = {
  date: dateWording,
  record: recordLabel,
  approvalSteps,
  workLocation,
  credential,
};

/* -------------------------------------------------------------------------- */
/* The two questions a catalogue asks                                          */
/* -------------------------------------------------------------------------- */

/** One word of a kind, in Albanian; `undefined` when the kind does not know it. */
export function slotText(kind: string, english: string): string | undefined {
  return ENUMERATIONS[kind]?.find(english) ?? WRITTEN[kind]?.(english);
}

/** The English words a kind can be, where they are a known set: what a hole of that kind is matched against. */
export function slotWords(kind: string): readonly string[] | undefined {
  return ENUMERATIONS[kind]?.english;
}

/** Every kind a catalogue row may name. */
export const SLOT_KINDS: readonly string[] = [...Object.keys(ENUMERATIONS), ...Object.keys(WRITTEN)];
