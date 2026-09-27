import { quickActions, type QuickActionDefinition } from "@/config/quick-actions";
import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";

/**
 * "Start here" on the dashboard (AUD-05 §7, UX-15).
 *
 * At most three next steps, shown only when the reader's own view of the
 * company is genuinely empty — no project and no task they can read, archived
 * ones included — and only steps they are allowed to take. A populated
 * dashboard shows its real work instead, and somebody who may create nothing
 * is never told to create anything: they are told how records will reach them.
 *
 * Company workspace only: the Group workspace holds no records of its own, and
 * a create page there asks which company first.
 *
 * Pure: the reads live in dashboard.start-here.load.ts.
 *
 * Cost (§8, UX-18): two indexed existence reads, once per dashboard, scoped by
 * the same builders the lists use — never a query per step or per widget.
 */

export const START_HERE_VERSION = 1;
export const START_HERE_LIMIT = 3;

export type StartHereStep = { key: string; label: string; href: string; why: string };

export type StartHere =
  | { kind: "none" }
  | { kind: "steps"; steps: StartHereStep[] }
  /** Empty, and nothing here is the reader's to create: how records will arrive. */
  | { kind: "waiting" };

/** What the reader can see of the company: null when they cannot read it (their module is off or not theirs). */
export type StartHereFacts = { hasProjects: boolean | null; hasTasks: boolean | null };

type Candidate = { action: QuickActionDefinition; why: string; when?: (facts: StartHereFacts) => boolean };

/** In the order a new company needs them: somewhere for work to live, the work, the people, the paper. */
const CANDIDATES: Candidate[] = [
  { action: quickActions.newProject, why: "A project holds its team, tasks, documents and daily logs.", when: (facts) => facts.hasProjects === false },
  { action: quickActions.newTask, why: "Give somebody a piece of work with a due date." },
  { action: quickActions.inviteUser, why: "Bring your colleagues in, each with the role they need." },
  { action: quickActions.uploadDocument, why: "Keep drawings, contracts and reports where the team can find them." },
];

export type StartHereAccess = {
  scope: "GROUP" | "COMPANY";
  holds: (permission: Permission) => boolean;
  enabled: (module: ModuleKey) => boolean;
};

/** Pure: the steps for a reader, from their access and what they can see. */
export function startHereFor(access: StartHereAccess, facts: StartHereFacts): StartHere {
  if (access.scope !== "COMPANY") return { kind: "none" };
  const readable = [facts.hasProjects, facts.hasTasks].filter((value): value is boolean => value !== null);
  // Nothing readable, or anything there: no guidance — real work, or nothing to judge by.
  if (readable.length === 0 || readable.some(Boolean)) return { kind: "none" };

  const steps = CANDIDATES.filter(
    ({ action, when }) =>
      access.enabled(action.module) &&
      access.holds(action.permission) &&
      (action.alsoRequires ?? []).every((permission) => access.holds(permission)) &&
      (!when || when(facts)),
  )
    .slice(0, START_HERE_LIMIT)
    .map(({ action, why }) => ({ key: action.key, label: action.label, href: action.href, why }));

  return steps.length > 0 ? { kind: "steps", steps } : { kind: "waiting" };
}
