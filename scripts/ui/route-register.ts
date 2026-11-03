import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { pageContract, type PageSurface, type PageTemplate, type RulerPolicy } from "../../lib/ui/page-contract";

/**
 * UI-02 route register (PRD §5; acceptance UI02-01, UI02-16).
 *
 * One entry per `page.tsx` under `app`: where the page is filed, which surface and
 * shell it belongs to, its template, scroll region and ruler policy, what it
 * is built from and what it still draws by hand, its loading, error and empty
 * states, its phone presentation, and how far it is on version 2. Read from
 * the source tree, so it is right for whatever branch it runs on.
 *
 *   tsx scripts/ui/route-register.ts           # print a summary and what differs from the checked-in register
 *   tsx scripts/ui/route-register.ts --write   # regenerate docs/ui/UI-02-route-register.json
 *
 * Two kinds of field. Mechanical ones (pattern, file, shell, sharedComponents,
 * handRolled, states, phone, rulerWired) are scanned from each page and from
 * the module components it imports, up to three imports deep, stopping at the
 * shared layer. Judged ones are decisions made by reading the pages, and they
 * live in code so a regeneration keeps them: template, scroll region and ruler
 * policy in lib/ui/page-contract.ts, the module in `MODULE_KEYS` and
 * `PROJECT_AREA_MODULE`, the version-2 status in `STATUS` and `TEMPLATE_NEEDS`
 * here. The one field carried over from the file is `tickets`, the reverse
 * index of docs/ui/UI-02-tickets.json.
 *
 * tests/unit/ui/route-register.test.ts holds the invariant: no page without
 * an entry, and no entry whose contract differs from the rules.
 */

export const REGISTER_FILE = join(process.cwd(), "docs", "ui", "UI-02-route-register.json");

export type RegisterEntry = {
  pattern: string;
  file: string;
  surface: PageSurface;
  shell: string;
  module: string;
  template: PageTemplate;
  scrollRegion: string | null;
  rulerPolicy: RulerPolicy;
  rulerReason: string;
  rulerWired: boolean;
  sharedComponents: string[];
  domainComponents: number;
  handRolled: { page: string[]; components: string[] };
  states: { loading: string | null; error: string | null; empty: string | null };
  phone: { mode: "mobile-component" | "stacked-table" | "none"; evidence: string[] };
  v2Status: "migrated" | "token-only" | "needs-work" | "not-applicable";
  v2Reason: string;
  tickets: string[];
};

type Counts = Record<string, number>;

type Scan = {
  pattern: string;
  file: string;
  lines: number;
  redirectOnly: boolean;
  shared: string[];
  domain: string[];
  handRolledInPage: Counts;
  handRolledInDomain: Counts;
  domainHits: Record<string, Counts>;
  loading: string | null;
  error: string | null;
  empty: string[];
  phone: string[];
  wiresRuler: boolean;
};

/* ---- the scan ----------------------------------------------------------- */

function walk(dir: string, name: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".next")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, name, found);
    else if (entry.name === name) found.push(full);
  }
  return found;
}

/** Every page file under `app`, relative to the repository, sorted. */
export function pageFiles(root: string = process.cwd()): string[] {
  return walk(join(root, "app"), "page.tsx")
    .sort()
    .map((file) => relative(root, file));
}

/** The URL pattern of a page file: its folders, without route groups. */
export function urlPattern(file: string): string {
  return "/" + file.split("/").slice(1, -1).filter((part) => !/^\(.*\)$/.test(part)).join("/");
}

// The shared layer: primitives and patterns a page should be built from.
const SHARED_DIRS = ["components/ui/", "components/data/", "components/forms/", "components/detail/", "components/modules/", "components/unsaved/", "components/charts/"];
const SHARED_FILES: Record<string, string> = {
  "components/navigation/nav-link.tsx": "NavLink",
  "components/navigation/context-tabs.tsx": "ContextTabs",
  "components/navigation/context-tabs-frame.tsx": "ContextTabsFrame",
  "components/layout/page-sections.tsx": "PageSections(ruler)",
  "components/collaboration/collaboration-panel.tsx": "CollaborationPanel",
  "components/documents/record-documents.tsx": "RecordDocuments",
  "components/documents/document-uploader.tsx": "DocumentUploader",
  "components/documents/upload-queue.tsx": "UploadQueue",
  "components/people/person-link.tsx": "PersonLink",
  "components/activity/activity-view.tsx": "ActivityView",
  "components/access/permission-gate.tsx": "PermissionGate",
  "components/tasks/record-tasks.tsx": "RecordTasks",
  "components/productivity/record-favorite.tsx": "RecordFavorite",
  "components/workspace/company-tag.tsx": "CompanyTag",
  "components/help/what-is-this.tsx": "WhatIsThis",
};
/** A shared file whose component is not named after it. */
const NAMES: Record<string, string> = {
  "components/ui/button.tsx": "Button", "components/ui/icon-button.tsx": "IconButton", "components/ui/badge.tsx": "Badge", "components/ui/tag.tsx": "Tag",
  "components/ui/card.tsx": "Card", "components/ui/card-link.tsx": "CardLink", "components/ui/metric-strip.tsx": "MetricStrip", "components/ui/table.tsx": "Table",
  "components/ui/input.tsx": "Input", "components/ui/select.tsx": "Select", "components/ui/form-select.tsx": "FormSelect", "components/ui/search-field.tsx": "SearchField",
  "components/ui/textarea.tsx": "Textarea", "components/ui/password-input.tsx": "PasswordInput", "components/ui/label.tsx": "Label", "components/ui/checkbox.tsx": "Checkbox", "components/ui/radio.tsx": "Radio", "components/ui/switch.tsx": "Switch",
  "components/ui/page-header.tsx": "PageHeader", "components/ui/breadcrumbs.tsx": "Breadcrumbs", "components/ui/tabs.tsx": "Tabs", "components/ui/empty-state.tsx": "EmptyState",
  "components/ui/error-state.tsx": "ErrorState", "components/ui/loading-state.tsx": "LoadingState", "components/ui/skeleton.tsx": "Skeleton", "components/ui/dialog.tsx": "Dialog",
  "components/ui/drawer.tsx": "Drawer", "components/ui/confirm-dialog.tsx": "ConfirmDialog", "components/ui/dropdown-menu.tsx": "DropdownMenu", "components/ui/popover.tsx": "Popover",
  "components/ui/tooltip.tsx": "Tooltip", "components/ui/toast.tsx": "Toast", "components/ui/bottom-sheet.tsx": "BottomSheet", "components/ui/avatar.tsx": "Avatar",
  "components/ui/scroll-region.tsx": "ScrollRegion", "components/ui/scroll-ruler.tsx": "ScrollRuler", "components/ui/page-sections.tsx": "PageSections", "components/ui/sticky.tsx": "Sticky",
  "components/ui/copy-button.tsx": "CopyButton", "components/ui/glass-panel.tsx": "GlassPanel", "components/ui/responsive-grid.tsx": "ResponsiveGrid", "components/ui/stack.tsx": "Stack",
  "components/ui/page-container.tsx": "PageContainer", "components/ui/divider.tsx": "Divider", "components/ui/icon.tsx": "Icon", "components/ui/technical-viewport.tsx": "TechnicalViewport",
  "components/ui/table-stack-labels.tsx": "TableStackLabels", "components/ui/popup-pointer.tsx": "PopupPointer",
  "components/data/data-table.tsx": "DataTable", "components/data/list-toolbar.tsx": "ListToolbar", "components/data/pagination.tsx": "Pagination", "components/data/filter-chips.tsx": "FilterChips",
  "components/data/filter-sheet.tsx": "FilterSheet", "components/data/sort-header.tsx": "SortHeader", "components/data/table-columns.tsx": "TableColumns", "components/data/selection.tsx": "Selection",
  "components/data/mobile-record.tsx": "MobileRecord", "components/data/page-size-select.tsx": "PageSizeSelect", "components/data/table-sort-select.tsx": "TableSortSelect",
  "components/data/record-action-sheet.tsx": "RecordActionSheet", "components/data/list-refresh.tsx": "ListRefresh", "components/data/table-identity.tsx": "TableIdentity",
  "components/forms/record-form.tsx": "RecordForm", "components/forms/form-contract.tsx": "FormContract(Field)", "components/forms/form-steps.tsx": "FormSteps", "components/forms/relation-selector.tsx": "RelationSelector",
  "components/forms/unit-input.tsx": "UnitInput", "components/forms/upload-field.tsx": "UploadField", "components/forms/confirm-action.tsx": "ConfirmAction",
  "components/detail/detail-field.tsx": "DetailField", "components/detail/detail-section.tsx": "DetailSection", "components/detail/entity-detail-page.tsx": "EntityDetailPage", "components/detail/entity-action-sheet.tsx": "EntityActionSheet",
  "components/modules/module-page.tsx": "ModulePage", "components/modules/module-section-page.tsx": "ModuleSectionPage", "components/modules/module-record-page.tsx": "ModuleRecordPage",
  "components/modules/module-overview.tsx": "ModuleOverview", "components/modules/module-tabs.tsx": "ModuleTabs", "components/modules/record-header.tsx": "RecordHeader",
  "components/modules/record-list.tsx": "RecordList", "components/modules/status-badge.tsx": "StatusBadge", "components/modules/page-section.tsx": "PageSection",
  "components/modules/settings-page-header.tsx": "SettingsPageHeader", "components/modules/approval-actions.tsx": "ApprovalActions", "components/modules/assign-member-control.tsx": "AssignMemberControl",
  "components/modules/section-skeletons.tsx": "SectionSkeletons", "components/modules/tab-pending-dot.tsx": "TabPendingDot",
  "components/unsaved/guarded-root.tsx": "GuardedDialog/Drawer", "components/unsaved/use-unsaved.ts": "useUnsaved", "components/unsaved/use-editor-save.ts": "useEditorSave", "components/unsaved/editor-status.tsx": "EditorStatus",
  "components/charts/bar-chart.tsx": "BarChart", "components/charts/donut.tsx": "Donut", "components/charts/mini-bars.tsx": "MiniBars", "components/charts/progress-bar.tsx": "ProgressBar", "components/charts/sparkline.tsx": "Sparkline",
};

function sharedName(file: string): string | null {
  if (SHARED_FILES[file]) return SHARED_FILES[file];
  if (NAMES[file]) return NAMES[file];
  if (SHARED_DIRS.some((dir) => file.startsWith(dir))) return basename(file).replace(/\.tsx?$/, "");
  return null;
}

// Shell and plumbing a page reaches through providers: not page content, never traversed or counted.
const INFRA = /^components\/(navigation|i18n|layout|shell\/(account-panel|context-notifications)|security\/use-reauth|workspace\/(workspace-switch-provider|workspace-sync|use-open-record))/;
const isComponentFile = (file: string) =>
  file.startsWith("components/") || /^app\/.*\/_[^/]+\//.test(file) || (file.startsWith("app/") && !/\/(page|layout|loading|error|not-found)\.tsx$/.test(file) && /\.tsx$/.test(file));
const isComponent = (file: string) => !INFRA.test(file) && isComponentFile(file);

// Signals the tokens cannot answer: the element is drawn by hand, so the version-2 values never reach it.
export const STRONG = ["raw-table", "raw-field", "literal-text-px", "hover-motion", "card-shadow", "literal-radius", "raw-hex"];
// Signals the tokens answer only in part (a 36px control beside 40px ones, a card with its own padding, a gold fill).
export const MEDIUM = ["raw-button", "literal-control-size", "own-card", "nesto-card-class", "bg-accent", "font-serif"];
export const WEAK = ["rounded-full", "uppercase-label"];

const PATTERNS: Record<string, RegExp> = {
  "literal-control-size": /(?<![\w-:])(?:h-9|h-10|size-9|size-10)(?![\w-])/g,
  "rounded-full": /(?<![\w-])rounded-full(?![\w-])/g,
  "bg-accent": /(?<![\w-])bg-accent(?![\w-])/g,
  "font-serif": /(?<![\w-])font-serif(?![\w-])/g,
  "literal-text-px": /text-\[\d+(?:\.\d+)?(?:px|rem)\]/g,
  "raw-table": /<table[\s>]/g,
  "raw-button": /<button[\s>]/g,
  "card-shadow": /(?<![\w-:])shadow-(?:sm|md|lg|xl|2xl)(?![\w-])/g,
  "nesto-card-class": /(?<![\w-])nesto-card(?![\w-])/g,
  "hover-motion": /(?:hover|group-hover):(?:-?translate|scale|rotate)-/g,
  "raw-hex": /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?=[^\w])/g,
  "literal-radius": /(?<![\w-])rounded-\[\d[^\]]*\]/g,
  "uppercase-label": /(?<![\w-])uppercase(?![\w-])/g,
};
const MARKUP = new Set(["raw-table", "raw-button"]);
const OWN_CARD = /["'`][^"'`\n]*\brounded-[^"'`\n]*["'`]/g;

function scanPatterns(source: string | null): Counts {
  const counts: Counts = {};
  if (!source) return counts;
  // Comments mention class names too; they are not markup.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  // A class string that also carries a `ds2:` class has its version-2 answer written beside it: not counted.
  const unanswered = code.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, (literal) => (literal.includes("ds2:") ? '""' : literal));
  for (const [key, pattern] of Object.entries(PATTERNS)) {
    const hits = ((MARKUP.has(key) ? code : unanswered).match(pattern) ?? []).length;
    if (hits) counts[key] = hits;
  }
  // A raw field is a text-like control drawn by hand; hidden, checkbox, radio, file and range inputs are not.
  let fields = 0;
  for (const tag of code.match(/<(?:input|select|textarea)\b[^>]{0,400}/g) ?? []) {
    if (/^<input/.test(tag) && /type=["'{]*["']?(?:hidden|checkbox|radio|file|range|color)/.test(tag)) continue;
    fields += 1;
  }
  if (fields) counts["raw-field"] = fields;
  let cards = 0;
  for (const literal of unanswered.match(OWN_CARD) ?? []) {
    if (/\bborder(?:-line|-strong)?\b/.test(literal) && /\bbg-surface\b/.test(literal) && /\bp[xy]?-\d/.test(literal)) cards += 1;
  }
  if (cards) counts["own-card"] = cards;
  return counts;
}

function scanPages(root: string): Scan[] {
  const sources = new Map<string, string | null>();
  const read = (file: string) => {
    if (!sources.has(file)) sources.set(file, existsSync(file) ? readFileSync(file, "utf8") : null);
    return sources.get(file) ?? null;
  };
  const rel = (file: string) => relative(root, file);
  const resolveImport = (spec: string, from: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = join(root, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else return null;
    for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };
  const importsOf = (file: string): string[] => {
    const source = read(file);
    if (!source) return [];
    const found: string[] = [];
    const statement = /(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = statement.exec(source))) {
      if (/^import\s+type\s/.test(match[0])) continue;
      const resolved = resolveImport(match[1], file);
      if (resolved) found.push(resolved);
    }
    const dynamic = /import\(\s*["']([^"']+)["']\s*\)/g;
    while ((match = dynamic.exec(source))) {
      const resolved = resolveImport(match[1], file);
      if (resolved) found.push(resolved);
    }
    return [...new Set(found)];
  };
  // A page's render closure: the page, then the domain components it reaches (depth 3), stopping at the shared layer.
  const closure = (page: string) => {
    const shared = new Set<string>();
    const domain = new Set<string>();
    const queue: [string, number][] = [[page, 0]];
    const seen = new Set([page]);
    while (queue.length) {
      const [file, depth] = queue.shift()!;
      for (const dep of importsOf(file)) {
        const name = rel(dep);
        if (!isComponent(name)) continue;
        const sharedAs = sharedName(name);
        if (sharedAs) {
          shared.add(sharedAs);
          continue;
        }
        if (seen.has(dep)) continue;
        seen.add(dep);
        domain.add(name);
        if (depth < 3) queue.push([dep, depth + 1]);
      }
    }
    return { shared: [...shared].sort(), domain: [...domain].sort() };
  };
  const nearest = (page: string, name: string): string | null => {
    const stop = join(root, "app");
    for (let dir = dirname(page); dir.startsWith(stop); dir = dirname(dir)) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return rel(candidate);
      if (dir === stop) break;
    }
    return null;
  };

  return pageFiles(root).map((file) => {
    const page = join(root, file);
    const source = read(page) ?? "";
    const { shared, domain } = closure(page);
    const handRolledInDomain: Counts = {};
    const domainHits: Record<string, Counts> = {};
    let closureSource = source;
    for (const component of domain) {
      const componentSource = read(join(root, component));
      const counts = scanPatterns(componentSource);
      if (Object.keys(counts).length) domainHits[component] = counts;
      for (const [key, hits] of Object.entries(counts)) handRolledInDomain[key] = (handRolledInDomain[key] ?? 0) + hits;
      closureSource += `\n${componentSource}`;
    }
    const empty: string[] = [];
    if (shared.includes("EmptyState")) empty.push("EmptyState");
    if (shared.includes("DataTable")) empty.push("DataTable empty row");
    if (shared.includes("RecordList")) empty.push("RecordList");
    if (/emptyMessage|emptyLabel|empty=\{|<Empty|noResults|No .* yet/.test(closureSource) && empty.length === 0) empty.push("inline text");
    const phone: string[] = [];
    if (/<Table\b[^>]*\bstack\b/.test(closureSource) || /data-stack/.test(closureSource)) phone.push("stacked-table");
    if (shared.includes("DataTable") || shared.includes("MobileRecord")) phone.push("mobile-record");
    phone.push(...domain.filter((component) => /(^|\/)mobile[-.]|\/mobile\//.test(component)).map((component) => `mobile-component:${component}`));
    if (["BottomSheet", "FilterSheet", "RecordActionSheet", "EntityActionSheet"].some((name) => shared.includes(name))) phone.push("bottom-sheet");
    if (/useIsPhone|usePhone\(|PhoneOnly|md:hidden|max-md:/.test(source)) phone.push("page-breakpoint-classes");
    return {
      pattern: urlPattern(file),
      file,
      lines: source.split("\n").length,
      redirectOnly: /\bredirect\(/.test(source) && !/return\s*\(?\s*</.test(source) && !/=>\s*\(?\s*</.test(source),
      shared,
      domain,
      handRolledInPage: scanPatterns(source),
      handRolledInDomain,
      domainHits,
      loading: nearest(page, "loading.tsx"),
      error: nearest(page, "error.tsx"),
      empty,
      phone: [...new Set(phone)],
      wiresRuler: /<PageSections\b/.test(source),
    };
  });
}

/* ---- the decisions that are not the page's contract ---------------------- */

const MODULE_KEYS: Record<string, string> = {
  "daily-logs": "dailyLogs",
  "my-day": "productivity",
  "my-work": "productivity",
  favorites: "productivity",
  activity: "activity",
  notifications: "notifications",
  search: "search",
  help: "help",
  "whats-new": "help",
  "access-denied": "system",
  "module-unavailable": "system",
  workspace: "system",
};

// A project child route belongs to the module that owns its data.
const PROJECT_AREA_MODULE: Record<string, string> = {
  "": "projects", open: "projects", edit: "projects", activity: "projects", team: "projects", media: "projects", planning: "projects", units: "projects",
  "3d": "project-3d", calendar: "calendar", contractors: "contractors", "work-packages": "contractors", contracts: "contracts", "daily-logs": "dailyLogs",
  documents: "documents", engineering: "engineering", finance: "finance", hse: "hse", inventory: "inventory", meetings: "meetings", qaqc: "qaqc",
  sales: "sales", tasks: "tasks", workforce: "workforce",
};

function shellOf(file: string): string {
  if (file.startsWith("app/(nesto)/")) return "app-shell";
  if (file.startsWith("app/admin/")) return "platform-shell";
  if (file.startsWith("app/group/")) return "group-shell";
  if (file.startsWith("app/(public)/(site)/")) return "public-site";
  if (file.startsWith("app/(public)/")) return "auth";
  if (file.startsWith("app/(experience-editor)/")) return "experience-editor";
  if (file.startsWith("app/(platform-viewer)/") || file.startsWith("app/(project-viewer)/") || file.startsWith("app/(public-viewer)/")) return "viewer";
  if (file.startsWith("app/(offline)/")) return "offline";
  return "none";
}

function moduleOf(scan: Scan): string {
  const segs = scan.pattern.split("/").filter(Boolean);
  const file = scan.file;
  if (file.startsWith("app/admin/") || file.startsWith("app/(experience-editor)/") || file.startsWith("app/(platform-viewer)/")) return `platform:${segs[1] ?? "dashboard"}`;
  if (file.startsWith("app/group/")) return `group:${segs[1] ?? "overview"}`;
  if (file.startsWith("app/(public)/(site)/")) return "marketing";
  if (file.startsWith("app/(public-viewer)/")) return "project-3d";
  if (file.startsWith("app/(public)/")) return "auth";
  if (file.startsWith("app/dev/")) return "dev-catalog";
  if (file.startsWith("app/(offline)/")) return "offline";
  if (!file.startsWith("app/(nesto)/") && !file.startsWith("app/(project-viewer)/")) return "system";
  if (scan.pattern.startsWith("/projects/[projectId]")) return PROJECT_AREA_MODULE[segs[2] ?? ""] ?? "projects";
  return MODULE_KEYS[segs[0]] ?? segs[0];
}

/** A template that is not built on the shared patterns yet, whatever its pages are made of. */
const TEMPLATE_NEEDS: Partial<Record<PageTemplate, string>> = {
  overview: "overview is not on the §17 template: its figures are not MetricStrip cells and it registers no sections for the ruler",
  report: "report template (§21) is not built: no as-of time, no section navigation, no print rules",
  calendar: "calendar surface has its own controls and cards (§20.1)",
  board: "board has its own cards and drag targets (§20.2)",
  timeline: "planning timeline is a hand-drawn canvas (§20.3)",
  review: "review queue is built per module, not on one queue pattern (§18.2)",
  explorer: "document explorer has no grid view, card family or folder tree on the shared patterns (§19.1)",
  viewer: "viewer chrome is its own design (§19.3, §22.5)",
  "admin-canvas": "3D authoring canvas is its own tool layout (§22.5)",
};

/** Routes whose status was decided by looking at them, not by the scan. */
const STATUS: Record<string, [RegisterEntry["v2Status"], string]> = {
  "/admin": ["migrated", "restyled and ruler wired in the foundation stage; the leftovers in handRolled carry no version-2 answer yet"],
  "/dev/ui": ["migrated", "the version-2 component catalog itself"],
  "/dashboard": ["needs-work", "ruler wired and widgets restyled in the foundation stage; the §17 structure (three to five metrics on MetricStrip, role sections) is not built"],
  "/projects/[projectId]": ["needs-work", "ruler wired in the foundation stage; the canonical overview of §17.2 (summary metrics, financials, milestones, activity) is not built"],
  "/settings/appearance": ["migrated", "carries the version-2 preference controls built in the foundation stage (density, ruler, version switch); the leftovers in handRolled are theirs"],
  "/login": ["token-only", "restyled by tokens and captured in the foundation stage; §7.5 states (rate limit, show-password pressed state) not checked"],
};

function statusOf(scan: Scan, template: PageTemplate, surface: PageSurface): [RegisterEntry["v2Status"], string] {
  if (STATUS[scan.pattern]) return STATUS[scan.pattern];
  if (scan.redirectOnly) return ["not-applicable", "redirect only: renders no interface of its own"];
  if (surface === "public" && scan.file.startsWith("app/(public)/(site)/")) {
    return ["token-only", "public marketing site: outside UI-02's stated scope, but data-ds is set on <html> so the version-2 tokens reach it; unverified, see ticket"];
  }
  const strongPage = STRONG.filter((key) => scan.handRolledInPage[key]);
  const strongDomain = STRONG.filter((key) => scan.handRolledInDomain[key]);
  const medium = MEDIUM.filter((key) => scan.handRolledInPage[key] || scan.handRolledInDomain[key]);
  const needs = TEMPLATE_NEEDS[template];
  if (needs) return ["needs-work", needs];
  if (strongPage.length) return ["needs-work", `the page draws its own ${strongPage.join(", ")}`];
  if (strongDomain.length) {
    const files = Object.entries(scan.domainHits)
      .filter(([, counts]) => STRONG.some((key) => counts[key]))
      .map(([file]) => file.split("/").pop());
    return ["needs-work", `its components draw their own ${strongDomain.join(", ")} (${files.slice(0, 3).join(", ")}${files.length > 3 ? `, +${files.length - 3}` : ""})`];
  }
  if (scan.shared.length === 0 && scan.domain.length === 0 && scan.lines > 20) return ["needs-work", "built without any shared primitive"];
  if (medium.length) return ["token-only", `shared primitives, restyled by tokens; partly answered leftovers: ${medium.join(", ")}`];
  return ["token-only", "built from shared primitives only; restyled by tokens"];
}

/* ---- the register -------------------------------------------------------- */

const SIGNAL_ORDER = [...STRONG, ...MEDIUM, ...WEAK];
const signals = (counts: Counts) => SIGNAL_ORDER.filter((key) => counts[key]).map((key) => `${key}×${counts[key]}`);

/** The reverse index of the ticket file, as the checked-in register has it: the one field a scan cannot produce. */
function ticketsByPattern(): Map<string, string[]> {
  if (!existsSync(REGISTER_FILE)) return new Map();
  const current = JSON.parse(readFileSync(REGISTER_FILE, "utf8")) as { routes: { pattern: string; tickets?: string[] }[] };
  return new Map(current.routes.map((route) => [route.pattern, route.tickets ?? []]));
}

export function buildRouteRegister(root: string = process.cwd()): RegisterEntry[] {
  const tickets = ticketsByPattern();
  return scanPages(root).map((scan) => {
    const contract = pageContract(scan);
    const [v2Status, v2Reason] = statusOf(scan, contract.template, contract.surface);
    const components = Object.entries(scan.domainHits)
      .map(([file, counts]) => [file, signals(counts)] as const)
      .filter(([, hits]) => hits.length)
      .map(([file, hits]) => `${file}: ${hits.join(", ")}`);
    let mode: RegisterEntry["phone"]["mode"] = "none";
    if (scan.phone.some((item) => item.startsWith("mobile-component") || item === "mobile-record")) mode = "mobile-component";
    else if (scan.phone.includes("stacked-table")) mode = "stacked-table";
    return {
      pattern: scan.pattern,
      file: scan.file,
      surface: contract.surface,
      shell: shellOf(scan.file),
      module: moduleOf(scan),
      template: contract.template,
      scrollRegion: contract.scrollRegionId,
      rulerPolicy: contract.rulerPolicy,
      rulerReason: contract.rulerReason,
      rulerWired: scan.wiresRuler,
      sharedComponents: scan.shared,
      domainComponents: scan.domain.length,
      handRolled: { page: signals(scan.handRolledInPage), components },
      states: { loading: scan.loading, error: scan.error, empty: scan.redirectOnly ? null : scan.empty.length ? scan.empty.join(" + ") : null },
      phone: { mode, evidence: scan.phone.map((item) => (item === "mobile-record" ? "DataTable mobile record cards" : item.replace("mobile-component:", ""))) },
      v2Status,
      v2Reason,
      tickets: tickets.get(scan.pattern) ?? [],
    };
  });
}

function tally<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

export function registerTotals(routes: RegisterEntry[]) {
  return {
    routes: routes.length,
    bySurface: tally(routes, (route) => route.surface),
    byShell: tally(routes, (route) => route.shell),
    byTemplate: tally(routes, (route) => route.template),
    byV2Status: tally(routes, (route) => route.v2Status),
    rulerEligible: routes.filter((route) => route.rulerPolicy === "eligible").length,
    rulerWired: routes.filter((route) => route.rulerWired).length,
  };
}

function registerDocument(routes: RegisterEntry[], generated: string) {
  return {
    document: "UI-02 route register (PRD §5, WP-00 exit artifact)",
    generated,
    method:
      "One entry per app/**/page.tsx, listed from the file system by scripts/ui/route-register.ts. Mechanical fields (pattern, file, shell, sharedComponents, handRolled, states, phone, rulerWired) come from a scan of each page and of the module components it imports, up to three imports deep, stopping at the shared layer (components/ui, data, forms, detail, modules, unsaved, charts) and skipping shell plumbing (components/navigation, i18n, layout, shell, auth, offline). Judged fields come from decision tables written after reading the pages: surface, template, scrollRegion and rulerPolicy from lib/ui/page-contract.ts, module and v2Status from the script; v2Reason states the rule that applied.",
    fields: {
      surface: "platform | group | company | personal | project | portal | system | public. No route has the portal surface: the repository has no external portal.",
      shell: "which layout draws the chrome: app-shell (company and group workspace), platform-shell, group-shell, public-site, auth, viewer, experience-editor, offline, none",
      template: "one of the PageTemplate values of PRD §26.3",
      scrollRegion: "the id of the element the page's content scrolls in and a ruler would control (PRD §26.3); null outside the shells, where a page scrolls itself and never carries a ruler",
      rulerPolicy: "eligible | never, by PRD §8.1; the width, height and section conditions are checked at run time",
      rulerWired: "the page mounts PageSections today",
      sharedComponents: "shared primitives and patterns reached by the page or by its module components",
      handRolled:
        "what the page (page) and its module components (components) draw themselves, as signal×count. Strong signals, which tokens cannot answer: raw-table, raw-field, literal-text-px, hover-motion, card-shadow, literal-radius, raw-hex. Partly answered: raw-button, literal-control-size (h-9, h-10, size-9, size-10), own-card, nesto-card-class, bg-accent, font-serif. Weak: rounded-full, uppercase-label. A class string that also carries a ds2: class is not counted.",
      states: "loading and error: the nearest loading.tsx and error.tsx; empty: how an empty result is shown, null when the scan found nothing",
      phone: "mobile-component (a phone presentation of its own, including DataTable's record cards), stacked-table (Table stack), or none (responsive layout only)",
      v2Status: "migrated | token-only | needs-work | not-applicable",
      tickets: "ids in UI-02-tickets.json that cover the route",
    },
    totals: registerTotals(routes),
    routes,
  };
}

// One key per line inside a route, arrays inline: readable in a diff, small enough to scan.
function serialise(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== "object")) return JSON.stringify(value);
    return `[\n${value.map((item) => `${pad}  ${serialise(item, indent + 2)}`).join(",\n")}\n${pad}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined);
    const flat = keys.every((key) => {
      const item = record[key];
      return item === null || typeof item !== "object" || (Array.isArray(item) && item.every((inner) => typeof inner !== "object"));
    });
    if (flat && indent >= 6) return `{ ${keys.map((key) => `${JSON.stringify(key)}: ${serialise(record[key], indent)}`).join(", ")} }`;
    return `{\n${keys.map((key) => `${pad}  ${JSON.stringify(key)}: ${serialise(record[key], indent + 2)}`).join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}

/** The checked-in register's routes; `[]` when the file is absent. */
export function readRouteRegister(): RegisterEntry[] {
  if (!existsSync(REGISTER_FILE)) return [];
  return (JSON.parse(readFileSync(REGISTER_FILE, "utf8")) as { routes: RegisterEntry[] }).routes;
}

/** The fields a page edit can change without anybody having decided anything: counted, not judged. */
const COUNTED = new Set(["sharedComponents", "domainComponents", "handRolled", "phone", "v2Status", "v2Reason", "tickets"]);

/** What the checked-in register says differently from the tree, one line per difference. `counted: false` leaves the scan's counts out. */
export function registerDrift(built: RegisterEntry[], stored: RegisterEntry[], { counted = true }: { counted?: boolean } = {}): string[] {
  const drift: string[] = [];
  const byPattern = new Map(stored.map((route) => [route.pattern, route]));
  for (const route of built) {
    const was = byPattern.get(route.pattern);
    if (!was) {
      drift.push(`${route.pattern}: no entry (${route.file})`);
      continue;
    }
    byPattern.delete(route.pattern);
    for (const key of Object.keys(route) as (keyof RegisterEntry)[]) {
      if (!counted && COUNTED.has(key)) continue;
      if (JSON.stringify(route[key]) !== JSON.stringify(was[key])) drift.push(`${route.pattern}: ${key} is ${JSON.stringify(was[key])}, the tree says ${JSON.stringify(route[key])}`);
    }
  }
  for (const pattern of byPattern.keys()) drift.push(`${pattern}: entry without a page`);
  return drift;
}

if (process.argv[1]?.endsWith("route-register.ts")) {
  const routes = buildRouteRegister();
  const totals = registerTotals(routes);
  console.log(`Pages: ${totals.routes} · ruler eligible: ${totals.rulerEligible} · wired: ${totals.rulerWired}`);
  console.log(`Templates: ${Object.entries(totals.byTemplate).map(([key, count]) => `${key} ${count}`).join(", ")}`);
  console.log(`Version 2: ${Object.entries(totals.byV2Status).map(([key, count]) => `${key} ${count}`).join(", ")}`);
  if (process.argv.includes("--write")) {
    writeFileSync(REGISTER_FILE, `${serialise(registerDocument(routes, new Date().toISOString().slice(0, 10)))}\n`);
    console.log(`Wrote ${relative(process.cwd(), REGISTER_FILE)}`);
  } else {
    const drift = registerDrift(routes, readRouteRegister());
    console.log(drift.length ? `The checked-in register differs in ${drift.length} places (run with --write):\n${drift.slice(0, 40).join("\n")}${drift.length > 40 ? `\n… and ${drift.length - 40} more` : ""}` : "The checked-in register is up to date.");
  }
}
