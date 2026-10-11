import type { Catalogue } from "@/lib/i18n/catalogue";

/**
 * Albanian for the “Needs your attention” items.
 *
 * An item's title and body are written in English when the condition is found
 * (lib/core/notifications/attention.conditions.ts) and stored that way — the reconciler compares the stored
 * text with fresh English, so nothing translated is ever written back. They are put into the reader's language
 * when read (lib/i18n/system). A key is never edited by hand: tests/unit/i18n/system-text.test.ts holds the two in step.
 */
export const rows = {
  // OVERDUE_TASK
  "Overdue: {title}": "Me vonesë: {title}",
  "Due {isoDate}": { sq: "Afati {isoDate}", slots: { isoDate: "date!" } },
  // ASSIGNED_APPROVAL_SOURCES
  "Review “{name}” v{versionNumber}": "Rishikoni “{name}” v{versionNumber}",
  "Leave request waiting for your approval": "Kërkesa për leje pret miratimin tuaj",
  "Starts {isoDate}": { sq: "Fillon më {isoDate}", slots: { isoDate: "date!" } },
  "Timesheet from {firstName} {lastName} waiting for your approval": "Fleta e orëve nga {firstName} {lastName} pret miratimin tuaj",
  "Week of {isoDate}": { sq: "Java e datës {isoDate}", slots: { isoDate: "date!" } },
  // PROCUREMENT_ACTION_REQUIRED
  "Purchase order needs the {label} decision": { sq: "Porosia e blerjes pret vendimin në hapin {label}", slots: { label: "approvalStep" } },
  "Step {stepNumber} of {length}": "Hapi {stepNumber} nga {length}",
  // APPROVAL_OVERDUE
  "Overdue review: “{name}”": "Rishikim me vonesë: “{name}”",
  "Leave began without a decision": "Leja filloi pa vendim",
  "Started {isoDate}": { sq: "Filloi më {isoDate}", slots: { isoDate: "date!" } },
  "Proposal {proposalNumber} lapsed while waiting for approval": "Oferta {proposalNumber} skadoi ndërkohë që priste miratim",
  "Valid until {isoDate}": { sq: "E vlefshme deri më {isoDate}", slots: { isoDate: "date!" } },
  "Permit {permitNumber} was due to start without approval": "Leja e punës {permitNumber} duhej të fillonte, por nuk është miratuar",
  "From {isoDate}": { sq: "Nga data {isoDate}", slots: { isoDate: "date!" } },
  // TIMESHEET_NOT_SUBMITTED
  "Submit your timesheet for {weekLabel}": { sq: "Dorëzoni fletën tuaj të orëve për {weekLabel}", slots: { weekLabel: "date" } },
  "The submission deadline has passed.": "Afati i dorëzimit ka kaluar.",
  // TIMESHEET_RETURNED
  "Your timesheet was rejected": "Fleta juaj e orëve u refuzua",
  "Your timesheet was returned for correction": "Fleta juaj e orëve u kthye për korrigjim",
  // TIMESHEET_APPROVAL_OVERDUE
  "A timesheet has waited for your decision for over three days": "Një fletë orësh pret vendimin tuaj prej më shumë se tri ditësh",
  "Submitted {isoDate}": { sq: "Dorëzuar më {isoDate}", slots: { isoDate: "date!" } },
  // DAILY_LOG_MISSING
  "No daily log for {projectName}": "Nuk ka ditar kantieri për {projectName}",
  "{dateLabel}": { sq: "{dateLabel}", slots: { dateLabel: "date!" } },
  // DAILY_LOG_RETURNED
  "Daily log for {name} needs correcting": "Ditari i kantierit për {name} kërkon korrigjim",
  "Work date {isoDate}": { sq: "Data e punës {isoDate}", slots: { isoDate: "date!" } },
  // DAILY_LOG_AWAITING_REVIEW
  "Review the daily log for {name}": "Shqyrtoni ditarin e kantierit për {name}",
  // MILESTONE_OVERDUE
  "Milestone overdue: {name}": "Pikë kyçe me vonesë: {name}",
  "{name} · due {dateLabel}": { sq: "{name} · afati {dateLabel}", slots: { dateLabel: "date!" } },
  // MILESTONE_AT_RISK
  "Milestone at risk: {name}": "Pikë kyçe në rrezik: {name}",
  // CRITICAL_MILESTONE_BLOCKED
  "Critical blocker on {name}": "Pengesë kritike te {name}",
  "{title} and {count1} more · {name}": "{title} dhe {count1} më shumë · {name}",
  // ANNOUNCEMENT_ACK_REQUIRED
  "Acknowledge: {title}": "Konfirmoni: {title}",
  "Critical announcement": "Njoftim kritik",
  "Important announcement": "Njoftim i rëndësishëm",
  // (key parameter)
  "Missing: {title}": "Mungon: {title}",
  "Expired: {title}": "Skaduar: {title}",
  "Expiring: {title}": "Në skadim: {title}",
  "{contractorName} · expired {dateLabel}": { sq: "{contractorName} · skadoi më {dateLabel}", slots: { dateLabel: "date!" } },
  "{contractorName} · expires {dateLabel}": { sq: "{contractorName} · skadon më {dateLabel}", slots: { dateLabel: "date!" } },
  "Expired {credentialDateLabel}": { sq: "Skadoi më {credentialDateLabel}", slots: { credentialDateLabel: "date!" } },
  "Expires {credentialDateLabel}": { sq: "Skadon më {credentialDateLabel}", slots: { credentialDateLabel: "date!" } },
  "To verify: {label} · {personName}": { sq: "Për t'u verifikuar: {label} · {personName}", slots: { label: "credential" } },
  "Expired: {label} · {personName}": { sq: "Skaduar: {label} · {personName}", slots: { label: "credential" } },
  "Expiring: {label} · {personName}": { sq: "Në skadim: {label} · {personName}", slots: { label: "credential" } },
  // RFI_OVERDUE
  "RFI overdue: {rfiNumber}": "RFI me vonesë: {rfiNumber}",
  "{subject} · {name} · due {dateLabel}": { sq: "{subject} · {name} · afati {dateLabel}", slots: { dateLabel: "date!" } },
  // RFI_RESPONSE_REQUIRED
  "Clarify RFI {rfiNumber}": "Sqaroni RFI {rfiNumber}",
  "Answer RFI {rfiNumber}": "Jepni përgjigje për RFI {rfiNumber}",
  // SUBMITTAL_REVIEW_OVERDUE
  "Review overdue: submittal {submittalNumber}": "Rishikim me vonesë: dorëzimi teknik {submittalNumber}",
  "{title} · due {dateLabel}": { sq: "{title} · afati {dateLabel}", slots: { dateLabel: "date!" } },
  // SUBMITTAL_REVISION_REQUIRED
  "Revision required: submittal {submittalNumber}": "Kërkohet revizion: dorëzimi teknik {submittalNumber}",
  // ENGINEERING_REVIEW_OVERDUE
  "Review overdue: {documentNumber} Rev {revisionCode}": "Rishikim me vonesë: {documentNumber} Rev {revisionCode}",
  "Review overdue: {documentNumber}": "Rishikim me vonesë: {documentNumber}",
  // CONTRACT_EXPIRING
  "Contract {contractNumber} expires {isoDate}": { sq: "Kontrata {contractNumber} skadon më {isoDate}", slots: { isoDate: "date" } },
  // OVERDUE_CONTRACT_OBLIGATION
  "Overdue obligation: {title}": "Detyrim me vonesë: {title}",
  "Contract {contractNumber} · due {isoDate}": { sq: "Kontrata {contractNumber} · afati {isoDate}", slots: { isoDate: "date" } },
  // UNRESOLVED_NCR
  "NCR {ncrNumber} is unresolved": "NCR {ncrNumber} nuk është zgjidhur",
  // OVERDUE_QA_ACTION
  "Corrective action {actionNumber} is overdue": "Veprimi korrigjues {actionNumber} është me vonesë",
  // CRITICAL_HSE_ITEM
  "Critical hazard {hazardNumber} is open": "Rreziku kritik {hazardNumber} është i hapur",
  "Critical incident {incidentNumber} is open": "Incidenti kritik {incidentNumber} është i hapur",
  "Stop-work {stopWorkNumber} is in force": "Ndalimi i punës {stopWorkNumber} është në fuqi",
  // OVERDUE_HSE_ACTION
  "HSE action {actionNumber} is overdue": "Veprimi HSE {actionNumber} është me vonesë",
  // OVERDUE_INVOICE
  "Invoice {invoiceNumber} is overdue": "Fatura {invoiceNumber} është me vonesë",
  "Due {isoDate} · {id} {currency} outstanding": { sq: "Afati {isoDate} · {id} {currency} pa paguar", slots: { isoDate: "date" } },
  // MEETING_ACTION_OVERDUE
  "Meeting action overdue: {title}": "Veprim takimi me vonesë: {title}",
  "From {title} · due {isoDate}": { sq: "Nga {title} · afati {isoDate}", slots: { isoDate: "date!" } },
  // What the dashboard says under an item that has no second line (lib/modules/dashboard/dashboard.service.ts).
  "Waiting on you.": "Pret veprimin tuaj.",
} satisfies Catalogue;

/** The record an approval is about, as the subject of “{noun} {verb}”. */
export const approvalNouns = {
  "Invoice": "Fatura",
  "Expense": "Shpenzimi",
  "Budget": "Buxheti",
  "Commitment": "Angazhimi",
  "Proposal": "Oferta",
  "Unit": "Njësia",
  "Contract": "Kontrata",
  "Amendment": "Shtojca e kontratës",
  "Inspection": "Inspektimi",
  "NCR": "NCR",
  "HSE inspection": "Inspektimi HSE",
  "Risk assessment": "Vlerësimi i rrezikut",
  "Work permit": "Leja e punës",
  "Incident closure": "Mbyllja e incidentit",
  "Purchase request": "Kërkesa e blerjes",
  "Purchase order": "Porosia e blerjes",
} satisfies Record<string, string>;

/** What is asked of the reader, as the predicate of “{noun} {verb}”. */
export const approvalVerbs = {
  "waiting for your approval": "pret miratimin tuaj",
  "needs a procurement decision": "pret vendim prokurimi",
} satisfies Record<string, string>;
