import { compileCatalogue, holesOf, translateText, type Catalogue, type CatalogueRow, type CompiledCatalogue, type TermLookup } from "@/lib/i18n/catalogue";
import { SOURCE_LOCALE, type Locale } from "@/lib/i18n/config";

import { ACTIVITY_ACTION_KEYS } from "./activity-actions";
import { slotText, slotWords } from "./slots";
import { rows as activityCommercial } from "./sq/activity-commercial";
import { rows as activityCoordination } from "./sq/activity-coordination";
import { rows as activityPeopleStructure } from "./sq/activity-people-structure";
import { rows as activitySite } from "./sq/activity-site";
import { approvalNouns, approvalVerbs, rows as attentionRows } from "./sq/attention";
import { fallbackWords, notifications, sentences, standing } from "./sq/notifications";

/**
 * System-written text in the reader's language: the bell, the “Needs your
 * attention” list and every activity feed.
 *
 * These texts are written once and kept: a notification's title and body, an
 * attention item's, an activity line. They are stored in English beside a code
 * (`eventType`, `conditionKey`, `action`) and stay that way — the attention
 * reconciler compares stored text with fresh English, jobs and exports read
 * it, people of both languages read the same row. Each function here is called
 * as a row is read for somebody, and finds the stored English in the Albanian
 * catalogues beside this file (lib/i18n/catalogue.ts says how).
 *
 * Two promises, the same for all three:
 *   - an English reader gets back exactly what was passed in — it is each
 *     function's first line, so English output cannot move;
 *   - a text the catalogues do not hold is shown as stored, never lost and
 *     never half translated.
 *
 * Nothing here writes: no Albanian ever reaches the database. Server-only —
 * about a thousand sentences that no page needs in its bundle; the reader's
 * locale is read by the caller (`getLocale`) and passed in, so a job or an
 * export that passes none stays English.
 */

/* -------------------------------------------------------------------------- */
/* Words inside a sentence                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A sentence carried inside another may list several things with “; ” between
 * them — an employment change says everything that changed. Each part is found
 * on its own, and the list is whole or not at all: one part with no row, and
 * the reader gets the stored English rather than half of it.
 */
function translateParts(catalogue: CompiledCatalogue, text: string, terms: TermLookup): string | undefined {
  const parts = text.split("; ").map((part) => translateText(catalogue, part, terms));
  return parts.every((part): part is string => part !== undefined) ? parts.join("; ") : undefined;
}

const nested = new Map<string, CompiledCatalogue>();

/** The table of whole sentences a kind of hole carries (`sentences`), if it is one. */
function sentencesOf(kind: string): CompiledCatalogue | undefined {
  if (!Object.hasOwn(sentences, kind)) return undefined;
  let compiled = nested.get(kind);
  if (!compiled) {
    compiled = compileCatalogue((sentences as Record<string, Catalogue>)[kind], { leastFixedLetters: 1, words: slotWords });
    nested.set(kind, compiled);
  }
  return compiled;
}

/** What a hole carries, in Albanian: a sentence of its own, or one of the words lib/i18n/system/slots.ts knows. */
const word: TermLookup = (kind, english) => {
  const table = sentencesOf(kind);
  return table ? translateParts(table, english, word) : slotText(kind, english);
};

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A title falls back to a word where its record has no name ("a task",
 * "Someone"); the word can land in any hole. So every hole of a notification
 * that names no kind of its own is one that may carry such a word.
 */
const FALLBACK = "fallback";

function withFallbacks(rows: Catalogue): Catalogue {
  return Object.fromEntries(
    Object.entries(rows).map(([key, row]): [string, CatalogueRow] => {
      const declared = typeof row === "string" ? {} : (row.slots ?? {});
      const slots = Object.fromEntries(holesOf(key).map((hole) => [hole, declared[hole] ?? FALLBACK]));
      return [key, { sq: typeof row === "string" ? row : row.sq, slots }];
    }),
  );
}

const notificationWord: TermLookup = (kind, english) => (kind === FALLBACK ? undefined : word(kind, english)) ?? (fallbackWords as Record<string, string>)[english];

const byEvent = new Map<string, CompiledCatalogue>();

/**
 * One event's own titles and bodies. Asked about nothing else, so even its
 * shortest second line ("By {actorname}") is safe to match.
 */
function eventCatalogue(eventType: string): CompiledCatalogue {
  let compiled = byEvent.get(eventType);
  if (!compiled) {
    const rows = Object.hasOwn(notifications, eventType) ? (notifications as Record<string, Catalogue>)[eventType] : {};
    compiled = compileCatalogue([standing, withFallbacks(rows)], { leastFixedLetters: 1, words: slotWords });
    // Event types are a closed list; a row carrying some other code is not worth remembering.
    if (Object.hasOwn(notifications, eventType)) byEvent.set(eventType, compiled);
  }
  return compiled;
}

export type NotificationText = { eventType: string; title: string; body: string | null };

/** A notification's title and body for this reader. Everything else on the row is passed through. */
export function localizeNotification<T extends NotificationText>(locale: Locale, notification: T): T {
  if (locale === SOURCE_LOCALE) return notification;
  const catalogue = eventCatalogue(notification.eventType);
  const title = translateText(catalogue, notification.title, notificationWord) ?? notification.title;
  const body = notification.body === null ? null : (translateText(catalogue, notification.body, notificationWord) ?? notification.body);
  return title === notification.title && body === notification.body ? notification : { ...notification, title, body };
}

/* -------------------------------------------------------------------------- */
/* Attention                                                                   */
/* -------------------------------------------------------------------------- */

/** “Invoice waiting for your approval”: every record an approval can be about, with what is asked of the reader. */
const approvals: Catalogue = Object.fromEntries(
  Object.entries(approvalNouns).flatMap(([noun, subject]) => Object.entries(approvalVerbs).map(([verb, predicate]) => [`${noun} ${verb}`, `${subject} ${predicate}`])),
);

/**
 * One table for every condition. Its short second lines ("Due {isoDate}")
 * name their hole a date that must be one, which is what keeps them from
 * taking a record's own title for theirs.
 */
const attention = compileCatalogue([attentionRows, approvals], { leastFixedLetters: 3, words: slotWords });

export type AttentionText = { conditionKey: string; title: string; body: string | null };

/** An attention item's title and body for this reader. */
export function localizeAttention<T extends AttentionText>(locale: Locale, item: T): T {
  if (locale === SOURCE_LOCALE) return item;
  const title = translateText(attention, item.title, word) ?? item.title;
  const body = item.body === null ? null : (translateText(attention, item.body, word) ?? item.body);
  return title === item.title && body === item.body ? item : { ...item, title, body };
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

const ACTIVITY_ROWS: Catalogue = { ...activitySite, ...activityCoordination, ...activityCommercial, ...activityPeopleStructure };

/** Codes built from a variable where they are written (`HR_CANDIDATE_${to}`) are indexed by their fixed start. */
const ACTION_PREFIXES = Object.keys(ACTIVITY_ACTION_KEYS)
  .filter((action) => action.endsWith("*"))
  .map((action) => ({ start: action.slice(0, -1), keys: ACTIVITY_ACTION_KEYS[action] }));

/**
 * A sentence finished with a verb chosen elsewhere ("{verb} amendment
 * {amendmentNumber}") names that hole a phrase: one of the action's own rows
 * that has no hole ("marked as sent").
 */
const PHRASE = "phrase";

type ActionScope = { catalogue: CompiledCatalogue; terms: TermLookup };

const byAction = new Map<string, ActionScope>();

/**
 * The phrases one action code can have written, and nothing else.
 *
 * Modules write phrases that look alike — "archived {name}" is a document, a
 * company and a unit; "marked {a} {b}" is a contractor, a candidate, a
 * milestone and a work package — and each is said differently in Albanian. The
 * stored code tells them apart, so the catalogue is cut down to that code's
 * rows (lib/i18n/system/activity-actions.ts, read from the source) before the
 * line is looked for. With so few candidates a short phrase is safe:
 * "raised {ncrNumber}" can only be an NCR.
 */
function actionScope(action: string): ActionScope | undefined {
  const known = byAction.get(action);
  if (known) return known;
  const keys = new Set(Object.hasOwn(ACTIVITY_ACTION_KEYS, action) ? ACTIVITY_ACTION_KEYS[action] : []);
  for (const prefix of ACTION_PREFIXES) if (action.startsWith(prefix.start)) for (const key of prefix.keys) keys.add(key);
  if (keys.size === 0) return undefined;
  const rows: Record<string, CatalogueRow> = {};
  const phrases = new Map<string, string>();
  for (const key of keys) {
    const row = ACTIVITY_ROWS[key];
    if (row === undefined) continue;
    rows[key] = row;
    if (holesOf(key).length === 0) phrases.set(key, typeof row === "string" ? row : row.sq);
  }
  const scope: ActionScope = {
    catalogue: compileCatalogue(rows, { leastFixedLetters: 4, words: (kind) => (kind === PHRASE ? [...phrases.keys()] : slotWords(kind)) }),
    terms: (kind, english) => (kind === PHRASE ? phrases.get(english) : word(kind, english)),
  };
  byAction.set(action, scope);
  return scope;
}

/**
 * An activity line's phrase for this reader — what follows the name of whoever
 * did it. `null` stays `null`: a row with no phrase is shown by its code, as
 * it is today.
 */
export function localizeActivity(locale: Locale, entry: { action: string; message: string }): string;
export function localizeActivity(locale: Locale, entry: { action: string; message: string | null }): string | null;
export function localizeActivity(locale: Locale, entry: { action: string; message: string | null }): string | null {
  if (locale === SOURCE_LOCALE || entry.message === null) return entry.message;
  const scope = actionScope(entry.action);
  return (scope && translateText(scope.catalogue, entry.message, scope.terms)) ?? entry.message;
}
