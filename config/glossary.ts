/**
 * The copy and action glossary, as data (AUD-05 §4, UX-07).
 *
 * docs/ux/glossary.md explains it; this is the part a test can hold the
 * product to. tests/unit/ux/glossary.test.ts checks the sidebar, module
 * headings, section tabs, Quick Create and the dashboard shortcuts against it.
 *
 * Wording only: persisted enum values, permission keys, record types and API
 * fields keep their names whatever a label says (§4). Client-safe.
 */

export type GlossaryNoun = {
  /** How one record is named in running text, buttons and Quick Create: sentence case. */
  singular: string;
  plural: string;
  /** The module or tab that lists them, when it is named differently (a proper module name). */
  listLabel?: string;
};

/** Cross-module nouns, defined once (§4). */
export const GLOSSARY_NOUNS = {
  group: { singular: "Group", plural: "Groups" },
  company: { singular: "Company", plural: "Companies" },
  project: { singular: "Project", plural: "Projects" },
  client: { singular: "Client", plural: "Clients" },
  unit: { singular: "Unit", plural: "Units" },
  task: { singular: "Task", plural: "Tasks" },
  meeting: { singular: "Meeting", plural: "Meetings" },
  document: { singular: "Document", plural: "Documents" },
  expense: { singular: "Expense", plural: "Expenses" },
  invoice: { singular: "Invoice", plural: "Invoices" },
  approval: { singular: "Approval", plural: "Approvals" },
  dailyLog: { singular: "Daily log", plural: "Daily logs", listLabel: "Daily Logs" },
  opportunity: { singular: "Opportunity", plural: "Opportunities" },
  lead: { singular: "Lead", plural: "Leads" },
  contract: { singular: "Contract", plural: "Contracts" },
  purchaseRequest: { singular: "Purchase request", plural: "Purchase requests", listLabel: "Requests" },
  purchaseOrder: { singular: "Purchase order", plural: "Purchase orders", listLabel: "Orders" },
  rfq: { singular: "Enquiry", plural: "Enquiries" },
  receipt: { singular: "Receipt", plural: "Receipts" },
  inspection: { singular: "Inspection", plural: "Inspections" },
  ncr: { singular: "NCR", plural: "NCRs" },
  hseIncident: { singular: "HSE incident", plural: "HSE incidents", listLabel: "Incidents" },
  hseHazard: { singular: "HSE hazard", plural: "HSE hazards", listLabel: "Hazards" },
  hazard: { singular: "Hazard", plural: "Hazards" },
  member: { singular: "Member", plural: "Members" },
} as const satisfies Record<string, GlossaryNoun>;

export type GlossaryNounKey = keyof typeof GLOSSARY_NOUNS;

/**
 * Cross-module actions (§4): one label, one outcome, wherever it appears — a
 * module page, a row menu, Quick Create or the dashboard.
 */
export const GLOSSARY_ACTIONS = {
  /** A list's primary action and its dashboard shortcut: "New task". Quick Create lists the bare noun under "+ Create". */
  create: "New",
  save: "Save changes",
  submit: "Submit for approval",
  approve: "Approve",
  reject: "Reject",
  return: "Return",
  archive: "Archive",
  restore: "Restore",
  delete: "Delete",
  export: "Export",
} as const;

/**
 * Deliberate differences, kept because the business means different things
 * or the wording is established where the action happens (§4).
 */
export const GLOSSARY_EXCEPTIONS: Array<{ term: string; reason: string }> = [
  { term: "Purchase request / Purchase order", reason: "Different records: a request asks to buy and is approved; an order is placed with a supplier from an approved request or an enquiry." },
  { term: "Add document", reason: "Documents are uploaded or linked, not authored: Documents, its dialogs and the dashboard all say Add document." },
  { term: "Report a hazard / Report an incident", reason: "HSE reports what happened or what somebody saw; \"New incident\" would read as if it were planned." },
  { term: "Invite member", reason: "A member is invited and accepts; nobody is created on their behalf." },
  { term: "Request leave", reason: "A leave request asks for a decision; it is not a record the requester owns outright." },
  { term: "Legal (module) / Contract (record)", reason: "The module is Legal and lives at /contracts; its records are contracts." },
  { term: "People / Team / Workforce / Employees", reason: "Different views: People is the group directory, Team the company's logins, Workforce everyone employed on site, Employees HR's employment records." },
  { term: "Enquiry (RFQ)", reason: "Procurement calls a request for quotation an enquiry; RFQ stays as the abbreviation in favorites and search." },
];

/** Wordings replaced by the glossary, which no label may use again. */
export const GLOSSARY_AVOID: Array<{ wording: string; use: string }> = [
  { wording: "Add client", use: "New client" },
  { wording: "Create invoice", use: "New invoice (the form's own submit button may still say Create invoice)" },
  { wording: "Purchase Request", use: "Purchase request" },
  { wording: "Daily Log", use: "Daily log (a record); Daily Logs (the module)" },
  { wording: "HSE Incident", use: "HSE incident" },
  { wording: "Add team member", use: "Invite member" },
  { wording: "Record movement", use: "New receipt, New issue, New transfer…" },
];
