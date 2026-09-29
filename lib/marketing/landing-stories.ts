/**
 * The landing presentation's stories (Landing + Full View PRD §13-§39, §69,
 * §70). Data, not components: each story is an ordered list of slide ids and
 * the visual that explains each one. Words live in lib/i18n/site/landing.ts,
 * keyed by the same ids, so a translation can reword a slide but never reorder
 * a story.
 *
 * Everything here is illustrative client state (§42): nothing writes ERP data.
 */

export const LANDING_PERSONAS = ["DEVELOPER", "CONTRACTOR", "GROUP", "GENERIC"] as const;
export type LandingPersona = (typeof LANDING_PERSONAS)[number];

/** The URL form of a persona (§43): `/?story=developer&step=units`. */
export const personaSlug: Record<LandingPersona, string> = {
  DEVELOPER: "developer",
  CONTRACTOR: "contractor",
  GROUP: "group",
  GENERIC: "explore",
};

export type VisualKey =
  | "companyTree"
  | "projectCard"
  | "unitGrid"
  | "rozarisPlan"
  | "unitRecord"
  | "developerDashboard"
  | "procurementFlow"
  | "dailyLog"
  | "qaFlow"
  | "hseScope"
  | "costChain"
  | "contractorDashboard"
  | "groupTree"
  | "companiesTree"
  | "departmentScope"
  | "projectGallery"
  | "personScope"
  | "approvalFlow"
  | "groupControl"
  | "teamList"
  | "workList"
  | "approvalCard"
  | "managementDashboard";

export type StorySlide = { id: string; visual: VisualKey };

export const LANDING_STORIES: Record<LandingPersona, readonly StorySlide[]> = {
  DEVELOPER: [
    { id: "company", visual: "companyTree" },
    { id: "project", visual: "projectCard" },
    { id: "units", visual: "unitGrid" },
    { id: "rozaris", visual: "rozarisPlan" },
    { id: "sale", visual: "unitRecord" },
    { id: "legal", visual: "unitRecord" },
    { id: "finance", visual: "unitRecord" },
    { id: "control", visual: "developerDashboard" },
  ],
  CONTRACTOR: [
    { id: "company", visual: "companyTree" },
    { id: "project", visual: "projectCard" },
    { id: "procurement", visual: "procurementFlow" },
    { id: "site", visual: "dailyLog" },
    { id: "qaqc", visual: "qaFlow" },
    { id: "hse", visual: "hseScope" },
    { id: "finance", visual: "costChain" },
    { id: "control", visual: "contractorDashboard" },
  ],
  GROUP: [
    { id: "group", visual: "groupTree" },
    { id: "companies", visual: "companiesTree" },
    { id: "departments", visual: "departmentScope" },
    { id: "projects", visual: "projectGallery" },
    { id: "people", visual: "personScope" },
    { id: "approvals", visual: "approvalFlow" },
    { id: "control", visual: "groupControl" },
  ],
  GENERIC: [
    { id: "company", visual: "companyTree" },
    { id: "project", visual: "projectCard" },
    { id: "team", visual: "teamList" },
    { id: "work", visual: "workList" },
    { id: "approval", visual: "approvalCard" },
    { id: "management", visual: "managementDashboard" },
  ],
};

export type UnitStatus = "AVAILABLE" | "RESERVED" | "SOLD";

/** The one object the developer story carries from slide to slide (§41, §42). */
export type DemoState = {
  unitSelected: boolean;
  unitStatus: UnitStatus;
  rfqApproved: boolean;
  scopeShown: boolean;
};

export const INITIAL_DEMO_STATE: DemoState = {
  unitSelected: false,
  unitStatus: "AVAILABLE",
  rfqApproved: false,
  scopeShown: false,
};

export type StoryPosition = { persona: LandingPersona; index: number };

/** Reads `?story=&step=`; anything unknown falls back to persona selection (§43). */
export function parseStoryParams(story: string | null | undefined, step: string | null | undefined): StoryPosition | null {
  const persona = LANDING_PERSONAS.find((key) => personaSlug[key] === story);
  if (!persona) return null;
  const index = step ? LANDING_STORIES[persona].findIndex((slide) => slide.id === step) : 0;
  return { persona, index: index < 0 ? 0 : index };
}

export function storyHref({ persona, index }: StoryPosition): string {
  const slide = LANDING_STORIES[persona][index];
  return `/?story=${personaSlug[persona]}&step=${slide.id}`;
}

/**
 * The demo state a slide implies, so a shared link or a refresh deep inside a
 * story shows the object as it would be by then (A-204 is Reserved on Legal
 * even if the visitor never pressed Reserve in this tab).
 */
export function demoStateAt(persona: LandingPersona, index: number, current: DemoState): DemoState {
  const ids = LANDING_STORIES[persona].slice(0, index + 1).map((slide) => slide.id);
  const next = { ...current };
  if (persona === "DEVELOPER") {
    if (ids.includes("rozaris")) next.unitSelected = true;
    if (ids.includes("sale") && next.unitStatus === "AVAILABLE") next.unitStatus = "RESERVED";
  }
  if (persona === "CONTRACTOR" && ids.includes("site")) next.rfqApproved = true;
  return next;
}

/** A dependency-free analytics hook (§82): a DOM event, never PII, no third party. */
export type LandingEvent =
  | "landing_viewed"
  | "landing_persona_selected"
  | "landing_story_started"
  | "landing_story_step_viewed"
  | "landing_story_next"
  | "landing_story_back"
  | "landing_story_restarted"
  | "landing_story_completed"
  | "landing_full_view_clicked"
  | "landing_pricing_clicked"
  | "landing_request_access_clicked";

export function trackLanding(event: LandingEvent, props: { persona?: LandingPersona; stepId?: string; stepNumber?: number; totalSteps?: number } = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("nesto:landing", { detail: { event, ...props } }));
}
