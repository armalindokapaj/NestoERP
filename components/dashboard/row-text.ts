import type { MessageKey, MessageValues, Translate } from "@/lib/i18n/translator";

/**
 * The words the dashboard's service builds into a row, a figure's hint or an
 * alert ("2 waiting · oldest 22 days", "3 critical hazards open"), said in the
 * reader's language. The service keeps writing English (the group list's JSON
 * answer and the tests read it); each phrase here is found by its shape, with
 * the figures and names it carries put back in. A phrase no rule knows passes
 * through unchanged, so a name or a date is never touched.
 */
type T = Translate<"dashboard">;
type Rule = [pattern: RegExp, key: string, values: (match: RegExpExecArray, t: T) => MessageValues];

const SEPARATOR = " · ";

const rules: Rule[] = [
  [/^(\d+) overdue tasks?$/, "overdueTasks", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) blocked tasks?$/, "blockedTasks", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) projects? at risk$/, "atRisk", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) stop-works? in force$/, "stopWorks", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) critical hazards? open$/, "criticalHazards", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) serious incidents? open$/, "seriousIncidents", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) open NCRs?$/, "openNcrs", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) contracts? expiring$/, "expiring", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) items? at or below reorder level$/, "reorder", (m) => ({ count: Number(m[1]) })],
  [/^(.+) could not be loaded, so this may be incomplete\.$/, "incompleteNote", (m, t) => ({ list: names(t, m[1]) })],
  [/^Incomplete: (.+) could not be loaded\.( The total may be higher\.)?$/, "incompleteHint", (m, t) => ({ list: names(t, m[1]) })],
  [/^(.+) could not be loaded$/, "notLoaded", (m, t) => ({ list: names(t, m[1]) })],
  [/^(\d+\+?) waiting$/, "waiting", (m) => ({ n: m[1] })],
  [/^oldest (\d+) days?$/, "oldest", (m) => ({ count: Number(m[1]) })],
  [/^(.+) overdue$/, "overdueCount", (m) => ({ n: m[1] })],
  [/^(\d+) awaiting approval$/, "awaitingApproval", (m) => ({ n: m[1] })],
  [/^(\d+) sent$/, "sent", (m) => ({ n: m[1] })],
  [/^(\d+) open$/, "open", (m) => ({ n: m[1] })],
  [/^(\d+) blocked$/, "blocked", (m) => ({ n: m[1] })],
  [/^(\d+) days? late$/, "lateDays", (m) => ({ count: Number(m[1]) })],
  [/^answer (.+)$/, "answer", (m, t) => ({ when: rowText(t, m[1]) })],
  [/^review (.+)$/, "review", (m, t) => ({ when: rowText(t, m[1]) })],
  [/^Forecast (.+)$/, "forecast", (m) => ({ date: m[1] })],
  [/^(\d+) on site$/, "onSite", (m) => ({ n: m[1] })],
  [/^(\d+) activities$/, "activities", (m) => ({ n: m[1] })],
  [/^(\d+) delays?$/, "delays", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) photos$/, "photos", (m) => ({ n: m[1] })],
  [/^Due (.+)$/, "due", (m) => ({ date: m[1] })],
  [/^(.+) of (.+) logged$/, "loggedOf", (m) => ({ logged: m[1], expected: m[2] })],
  [/^(.+) logged$/, "logged", (m) => ({ logged: m[1] })],
  [/^Budget (.+)$/, "budget", (m) => ({ amount: m[1] })],
  [/^Step (\d+) of (\d+)$/, "step", (m) => ({ current: m[1], total: m[2] })],
  [/^(.+) on hand$/, "onHand", (m) => ({ stock: m[1] })],
  [/^reorder at (.+)$/, "reorderAt", (m) => ({ level: m[1] })],
  [/^(\d+) active projects?$/, "activeProjects", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) (?:person|people)$/, "people", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) open deals?$/, "openDeals", (m) => ({ count: Number(m[1]) })],
  [/^(\d+) active$/, "activeCount", (m) => ({ n: m[1] })],
  [/^(\d+) suspended$/, "suspendedCount", (m) => ({ n: m[1] })],
  [/^of (\d+) projects? in the portfolio$/, "inPortfolio", (m) => ({ count: Number(m[1]) })],
  [/^in (\d+) (?:company|companies)$/, "inCompanies", (m) => ({ count: Number(m[1]) })],
  [/^\+(\d+) more$/, "more", (m) => ({ n: m[1] })],
  [/^([+-])(\d+) days?$/, "variance", (m) => ({ sign: m[1], count: Number(m[2]) })],
];

function find(t: T, key: string, values?: MessageValues): string | null {
  const full = `rows.${key}` as MessageKey<"dashboard">;
  const text = t(full, values as never);
  return text === full ? null : text;
}

/** A list of names ("Finance and HR", "Finance, HR and Legal"): each module name in the reader's language. */
function names(t: T, list: string): string {
  const items = list.split(/, | and /).map((item) => rowText(t, item));
  const and = (find(t, "listAnd") ?? " and ").trim();
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

function one(t: T, text: string): string | null {
  const word = find(t, `words.${text.replace(/\./g, "")}`);
  if (word) return word;
  for (const [pattern, key, values] of rules) {
    const match = pattern.exec(text);
    if (match) {
      const said = find(t, key, values(match, t));
      if (said) return match[0].endsWith(" The total may be higher.") ? `${said} ${(find(t, "totalHigher") ?? "").trim()}` : said;
    }
  }
  return null;
}

/** One phrase, or a ` · `-joined line of them, in the reader's language; what no rule knows is left as it is. */
export function rowText(t: T, text: string): string;
export function rowText(t: T, text: string | undefined): string | undefined {
  if (!text) return text;
  if (!text.includes(SEPARATOR)) return one(t, text) ?? text;
  return text
    .split(SEPARATOR)
    .map((part) => one(t, part) ?? part)
    .join(SEPARATOR);
}
