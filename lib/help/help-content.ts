/**
 * Module Help (AUD-05 §7, UX-16): checked-in, versioned help for every module —
 * what it is for, the words it uses, what somebody can do in it and what
 * decides who may.
 *
 * It describes the product as it is, in the words of docs/ux/glossary.md. When
 * a label, status or action changes, the help changes in the same commit and
 * HELP_VERSION moves on; tests/unit/ux/help-registry.test.ts holds every
 * module to having an entry, and every action to naming a real permission and
 * a real page.
 *
 * The modules the acceptance journeys walk through — Tasks, Approvals,
 * Finance (invoices and expenses), Projects and Daily Logs — are written out;
 * every other module has the short standard section: its purpose, its terms
 * and its everyday action.
 *
 * Nothing here grants anything. The help page shows an action only to
 * somebody who holds its permission, and the page it names checks again.
 * Client-safe data: no server imports.
 */
import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";

/** Moves on whenever a module's help is rewritten; dismissed guidance keyed on it comes back once. */
export const HELP_VERSION = "2026-09-27.1";

export type HelpTerm = { term: string; meaning: string };

export type HelpAction = {
  /** The button's own label, as the module page shows it. */
  label: string;
  description: string;
  /** Shown only to somebody who holds it. */
  permission: Permission;
  /** The canonical page the action starts on. */
  href?: string;
};

export type ModuleHelp = {
  /** Why the module exists, in a sentence or two. */
  purpose: string;
  terms: HelpTerm[];
  actions: HelpAction[];
  /** What decides who sees and does what, without naming anybody's records. */
  permissions: string;
  /** The written-out entries of the acceptance journeys; the rest are the short standard. */
  detailed?: true;
};

const STANDARD_PERMISSIONS =
  "Your role decides which sections you see and which actions you are offered; the company decides whether the module is switched on. Every page checks again when it opens, so a link somebody shares with you opens only what you may see.";

export const MODULE_HELP: Record<ModuleKey, ModuleHelp> = {
  tasks: {
    detailed: true,
    purpose:
      "Tasks are the work somebody has to do, with an owner and a due date. A task can stand on its own or belong to a project, and can be linked to the record it came from.",
    terms: [
      { term: "Task", meaning: "One piece of work with a title, an assignee, a priority and a due date." },
      { term: "Assignee", meaning: "The person responsible for the task. Assigning somebody notifies them." },
      { term: "Status", meaning: "To do, In progress, Blocked, Completed or Archived. Blocked means work cannot continue until something else happens." },
      { term: "Priority", meaning: "Low, Medium, High or Critical." },
      { term: "Overdue", meaning: "Open (not Completed) and past its due date." },
      { term: "My Tasks", meaning: "Tasks assigned to you. All Tasks shows every task your role may see." },
    ],
    actions: [
      { label: "New task", description: "Opens the task form. From a project, the project is filled in for you.", permission: "task.create", href: "/tasks/new" },
      { label: "Assign", description: "Choose or change who is responsible, from the task's page.", permission: "task.assign" },
      { label: "Change status", description: "Move a task between To do, In progress and Blocked as work goes.", permission: "task.status.update" },
      { label: "Complete", description: "Marks the task Completed; it moves to the Completed section.", permission: "task.complete" },
      { label: "Archive", description: "Takes a task out of the working lists without deleting it. Restore brings it back.", permission: "task.archive" },
    ],
    permissions:
      "Some roles see every task in the company, others only tasks on their projects or assigned to them. Creating, assigning, completing and archiving are separate permissions, so you may be able to update a task you cannot archive.",
  },
  approvals: {
    detailed: true,
    purpose:
      "One place for every decision waiting on you — invoices, expenses, purchase requests, contracts, quality and safety records and more — whichever module they come from.",
    terms: [
      { term: "Approval", meaning: "A request for a decision on a record, raised when somebody submits it." },
      { term: "Waiting for me", meaning: "Decisions that are yours to make now." },
      { term: "Requested by me", meaning: "Records you submitted and their progress." },
      { term: "Step", meaning: "Some approvals go through several approvers in turn; Approve step 1 passes it to the next." },
      { term: "Return", meaning: "Sends the record back to its author for changes. It needs a reason." },
      { term: "Delegation", meaning: "Lets somebody decide for you while you are away, for the period you set." },
    ],
    actions: [
      { label: "Approve", description: "Accepts the record at your step. You can add a note.", permission: "approvals.view" },
      { label: "Reject", description: "Refuses the record. A reason is required and the author sees it.", permission: "approvals.view" },
      { label: "Return", description: "Asks the author for changes. A reason is required.", permission: "approvals.view" },
      { label: "Delegate", description: "Hands your decisions to a colleague for a period.", permission: "approvals.delegation.manage" },
    ],
    permissions:
      "You only see approvals you are an approver for or submitted yourself. Whether Approve, Reject or Return is offered on an item depends on the source module's own approval permission for that record type, and is checked again when you decide.",
  },
  finance: {
    detailed: true,
    purpose:
      "The company's money: invoices to clients, payments, expenses, budgets and commitments, with approvals before anything leaves the company.",
    terms: [
      { term: "Invoice", meaning: "A bill to a client. Draft → Pending approval → Approved → Sent; it can also be Rejected, Cancelled or Archived." },
      { term: "Expense", meaning: "A cost the company has incurred, optionally against a project. Draft → Pending approval → Approved, or Rejected." },
      { term: "Submit for approval", meaning: "Sends a draft invoice or expense to its approvers. It can no longer be edited freely while it waits." },
      { term: "Payment", meaning: "Money received against an invoice or paid out." },
      { term: "Budget", meaning: "The planned amount for a project or cost category." },
      { term: "Commitment", meaning: "Money already promised — for example by a purchase order — but not yet spent." },
    ],
    actions: [
      { label: "New invoice", description: "Opens the invoice form. From a project or client, that context is filled in.", permission: "finance.invoice.create", href: "/finance/invoices/new" },
      { label: "New expense", description: "Records a cost, with its receipt if you have one.", permission: "finance.expense.create", href: "/finance/expenses/new" },
      { label: "Submit for approval", description: "Sends a draft invoice to its approvers.", permission: "finance.invoice.submit" },
      { label: "Submit for approval", description: "Sends a draft expense to its approvers.", permission: "finance.expense.submit" },
      { label: "Export", description: "Downloads the list you are looking at, with its filters.", permission: "finance.invoice.view" },
    ],
    permissions:
      "Finance sections appear one by one: somebody with only project budget access sees the Overview and nothing else. Creating, submitting, approving and archiving invoices and expenses are separate permissions.",
  },
  projects: {
    detailed: true,
    purpose:
      "Projects hold everything about one piece of work: its team, tasks, documents, daily logs, milestones, buildings and units, and its costs.",
    terms: [
      { term: "Project", meaning: "A development or job the company runs. Its status is Pending, Active or Finished; archived projects move to Archived." },
      { term: "Project manager", meaning: "The person responsible for the project; project members work on it." },
      { term: "Milestone", meaning: "A planned date in the project's plan, tracked for delay." },
      { term: "Unit", meaning: "A sellable space in a building — an apartment, shop or parking space." },
      { term: "Project type", meaning: "The company's own classification of projects." },
    ],
    actions: [
      { label: "New project", description: "Opens the project form. The project starts Pending.", permission: "project.create", href: "/projects/new" },
      { label: "Add member", description: "Adds a colleague to the project team from its Team tab.", permission: "project.member.add" },
      { label: "Archive", description: "Moves a finished project out of the working list. Restore brings it back.", permission: "project.archive" },
    ],
    permissions:
      "Some roles see every project in the company, others only the projects they are a member of. A project's tabs follow your permissions for tasks, documents, finance and the rest.",
  },
  dailyLogs: {
    detailed: true,
    purpose:
      "The daily site record of each project: who was on site, what was done, deliveries, delays, weather and photos — written on the day and reviewed afterwards.",
    terms: [
      { term: "Daily log", meaning: "One project's record for one day." },
      { term: "Status", meaning: "Draft → Submitted → Reviewed → Locked. A reviewer can return it as Correction required; a log can be Voided." },
      { term: "To Review", meaning: "Submitted logs waiting for a reviewer." },
      { term: "Locked", meaning: "The day is closed; changing it needs the correct-locked permission and leaves a trail." },
    ],
    actions: [
      { label: "Start today's log", description: "Starts today's log from the project's Daily Logs tab; Log an earlier day covers a missed day within the allowed window. + Create asks for the project first.", permission: "daily_log.create" },
      { label: "Submit log", description: "Sends the day's log for review.", permission: "daily_log.submit" },
      { label: "Mark reviewed", description: "Accepts a submitted log.", permission: "daily_log.review" },
      { label: "Lock", description: "Closes the day so it can no longer change.", permission: "daily_log.lock" },
    ],
    permissions:
      "You see the logs of projects you can open. Writing, submitting, reviewing and locking are separate permissions, so the site team writes and the project manager reviews.",
  },

  // ─── The short standard section ─────────────────────────────────────────────
  dashboard: {
    purpose: "Your starting point: the figures, lists and shortcuts that matter to your role, in the workspace you are in.",
    terms: [
      { term: "Workspace", meaning: "The Group (every company you may enter) or one Company. The dashboard shows the workspace named under its title." },
      { term: "Widget", meaning: "One panel of live figures or records; each links to the filtered list behind it." },
    ],
    actions: [],
    permissions: "Every figure and list is filtered by your permissions. A widget whose module is off, or that you may not see, is not shown.",
  },
  calendar: {
    purpose: "Deadlines, events and schedules from every module you can open, in one calendar.",
    terms: [{ term: "Event", meaning: "A calendar entry of its own; other entries come from tasks, meetings, milestones and other records." }],
    actions: [{ label: "New event", description: "Adds an event to the calendar.", permission: "calendar.event.create" }],
    permissions: STANDARD_PERMISSIONS,
  },
  announcements: {
    purpose: "Company, department and project notices, some needing your acknowledgment. You read them in the Activity bell.",
    terms: [{ term: "Acknowledge", meaning: "Confirms you have read an announcement that asks for it." }],
    actions: [{ label: "New announcement", description: "Writes a notice for an audience you choose.", permission: "announcement.create", href: "/announcements/new" }],
    permissions: STANDARD_PERMISSIONS,
  },
  meetings: {
    purpose: "Agendas, minutes, decisions and the actions that follow a meeting.",
    terms: [{ term: "Action", meaning: "A follow-up agreed in a meeting, with an owner and a due date." }],
    actions: [{ label: "New meeting", description: "Schedules a meeting and its agenda.", permission: "meeting.create", href: "/meetings/new" }],
    permissions: STANDARD_PERMISSIONS,
  },
  timesheets: {
    purpose: "How working time is spent across projects, tasks and internal work, week by week.",
    terms: [{ term: "Timesheet", meaning: "One person's week of time entries, submitted for approval." }],
    actions: [],
    permissions: "Everyone keeps their own timesheet; team and project views need their own permissions.",
  },
  workforce: {
    purpose: "Everyone the company employs on its projects, with or without a NESTO login: crews, sites, assignments and attendance.",
    terms: [
      { term: "Worker", meaning: "A person employed on site. Not everyone here has a NESTO account." },
      { term: "Crew", meaning: "A team of workers assigned together." },
    ],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
  contractors: {
    purpose: "The organisations building with you: their assignments, work packages, compliance documents and contracts.",
    terms: [
      { term: "Contractor", meaning: "An external company working on your projects." },
      { term: "Work package", meaning: "A defined scope of work given to a contractor." },
    ],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
  engineering: {
    purpose: "The technical record of every project: drawings and revisions, RFIs, submittals and transmittals.",
    terms: [
      { term: "RFI", meaning: "Request for information — a technical question that needs a formal answer." },
      { term: "Submittal", meaning: "Material or drawings sent for review and approval." },
      { term: "Transmittal", meaning: "A record of documents formally sent to somebody." },
    ],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
  clients: {
    purpose: "The companies and people your company works with, and their projects, contacts and documents.",
    terms: [{ term: "Client", meaning: "A company or person you do work for or sell to." }],
    actions: [{ label: "New client", description: "Adds a client.", permission: "client.create", href: "/clients/new" }],
    permissions: STANDARD_PERMISSIONS,
  },
  documents: {
    purpose: "Company, project and client documents in one place, with versions and access control.",
    terms: [{ term: "Document", meaning: "A file with its details, attached to a project, client or other record, or to the company." }],
    actions: [{ label: "Add document", description: "Uploads a document and files it.", permission: "document.create", href: "/documents/new" }],
    permissions: STANDARD_PERMISSIONS,
  },
  hr: {
    purpose: "People operations: employment records, leave, attendance, recruitment and HR documents.",
    terms: [
      { term: "Employee", meaning: "A person's employment with the company, kept by HR." },
      { term: "Leave request", meaning: "A request for time off, approved by the person's manager or HR." },
    ],
    actions: [{ label: "Request leave", description: "Asks for time off.", permission: "hr.leave.create", href: "/hr/leave/new" }],
    permissions: "HR sees the whole module. With self-service alone you see your own employment, leave, attendance and documents, named as yours.",
  },
  sales: {
    purpose: "Leads, opportunities, the pipeline and proposals — from first contact to won work.",
    terms: [
      { term: "Lead", meaning: "A possible client not yet qualified." },
      { term: "Opportunity", meaning: "A qualified deal with a value and a stage in the pipeline." },
      { term: "Proposal", meaning: "The offer sent to the client for an opportunity." },
    ],
    actions: [
      { label: "New lead", description: "Records a new lead.", permission: "sales.lead.create", href: "/sales/leads/new" },
      { label: "New opportunity", description: "Opens an opportunity.", permission: "sales.opportunity.create", href: "/sales/opportunities/new" },
    ],
    permissions: STANDARD_PERMISSIONS,
  },
  contracts: {
    purpose: "Legal: contracts, their approvals, amendments and obligations, and requests for unit contracts from Sales.",
    terms: [
      { term: "Contract", meaning: "A legal agreement with a client, supplier or contractor." },
      { term: "Amendment", meaning: "A signed change to an existing contract." },
    ],
    actions: [{ label: "New contract", description: "Drafts a contract.", permission: "legal.contract.create", href: "/contracts/new" }],
    permissions: STANDARD_PERMISSIONS,
  },
  procurement: {
    purpose: "Buying for the company and its projects: purchase requests, enquiries to suppliers, purchase orders and suppliers.",
    terms: [
      { term: "Purchase request", meaning: "An internal request to buy something. It is approved before anything is ordered." },
      { term: "Enquiry (RFQ)", meaning: "A request for quotation sent to suppliers." },
      { term: "Purchase order", meaning: "The order placed with a supplier, raised from an approved request or an enquiry — not the same thing as a purchase request." },
    ],
    actions: [{ label: "New purchase request", description: "Asks for something to be bought.", permission: "procurement.request.create", href: "/procurement/requests/new" }],
    permissions: STANDARD_PERMISSIONS,
  },
  inventory: {
    purpose: "Materials, stock levels by warehouse, and every movement in and out.",
    terms: [
      { term: "Receipt", meaning: "Stock arriving into a warehouse." },
      { term: "Issue", meaning: "Stock leaving a warehouse for use." },
      { term: "Movement", meaning: "The ledger line every receipt, issue, return, transfer and adjustment writes." },
    ],
    actions: [{ label: "New receipt", description: "Records stock arriving.", permission: "inventory.receipt.create", href: "/inventory/receipts/new" }],
    permissions: STANDARD_PERMISSIONS,
  },
  qaqc: {
    purpose: "Quality control: inspections, defects, non-conformance reports and corrective actions.",
    terms: [
      { term: "Inspection", meaning: "A quality check against a template." },
      { term: "NCR", meaning: "Non-conformance report — work that does not meet the specification." },
    ],
    actions: [
      { label: "New inspection", description: "Starts a quality inspection.", permission: "qaqc.inspection.create", href: "/qaqc/inspections/new" },
      { label: "New NCR", description: "Raises a non-conformance.", permission: "qaqc.ncr.create", href: "/qaqc/ncrs/new" },
    ],
    permissions: STANDARD_PERMISSIONS,
  },
  hse: {
    purpose: "Health, safety and environment: hazards, incidents, inspections, permits and the actions that follow.",
    terms: [
      { term: "Hazard", meaning: "Something on site that could cause harm, reported before it does." },
      { term: "Incident", meaning: "Something that happened — an injury, damage or a near miss." },
    ],
    actions: [
      { label: "Report a hazard", description: "Reports a hazard, from wherever you are.", permission: "hse.hazard.create", href: "/hse/hazards/new" },
      { label: "Report an incident", description: "Records an incident.", permission: "hse.incident.create", href: "/hse/incidents/new" },
    ],
    permissions: STANDARD_PERMISSIONS,
  },
  people: {
    purpose: "Everyone in your group as colleagues know them: who they are, where they work and how to reach them.",
    terms: [{ term: "Person", meaning: "One human being across the group; their employments sit with HR." }],
    actions: [],
    permissions: "Every internal role can open People. Nothing HR keeps private is shown here.",
  },
  team: {
    purpose: "Everyone with a login in this company workspace, their departments and invitations.",
    terms: [{ term: "Member", meaning: "A person with access to this company, with a role." }],
    actions: [{ label: "Invite member", description: "Invites somebody and gives them a role.", permission: "team.member.invite", href: "/team/invite" }],
    permissions: STANDARD_PERMISSIONS,
  },
  organization: {
    purpose: "Your parent group: its companies, group departments, people and account requests.",
    terms: [
      { term: "Group", meaning: "The parent organisation above the companies." },
      { term: "Company", meaning: "One legal company in the group, with its own workspace and modules." },
    ],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
  company: {
    purpose: "This company's identity, details and the modules switched on for it.",
    terms: [{ term: "Module", meaning: "A part of NESTO the company can switch on or off." }],
    actions: [],
    permissions: "Everyone can read the company's details; changing them and its modules needs company management.",
  },
  settings: {
    purpose: "Your own profile and preferences, and — for administrators — the company's configuration.",
    terms: [],
    actions: [],
    permissions: "Your profile, appearance and notifications are always yours; company settings need settings management.",
  },
  support: {
    purpose: "Internal support requests and this help.",
    terms: [],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
};
