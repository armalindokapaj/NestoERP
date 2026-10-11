import type { Catalogue } from "@/lib/i18n/catalogue";

/**
 * Albanian for notification titles and bodies, by event type.
 *
 * A notification is stored in English when it is sent (lib/core/notifications/notification.events.ts) and put
 * into the reader's language when it is read (lib/i18n/system). Each key is the English title or body as the
 * event writes it, `{holes}` standing for its values. A key is never edited by hand:
 * tests/unit/i18n/system-text.test.ts derives the English from the events and holds the two in step.
 */
export const notifications = {
  TASK_ASSIGNED: {
    "You were assigned “{title}”": "Ju u caktua “{title}”",
    "On {projectname}": "Në {projectname}",
  },
  TASK_STATUS_CHANGED: {
    "“{title}” moved to {statuslabel}": { sq: "“{title}” kaloi në statusin {statuslabel}", slots: { statuslabel: "taskStatus" } },
    "By {actorname}": "Nga {actorname}",
  },
  TASK_BLOCKED: {
    "“{title}” is blocked": "“{title}” është bllokuar",
  },
  TASK_COMPLETED: {
    "“{title}” was completed": "“{title}” u përfundua",
    "By {actorname}": "Nga {actorname}",
  },
  TASK_OVERDUE: {
    "“{title}” is overdue": "“{title}” është me vonesë",
    "It was due {duedate}": { sq: "Afati ishte më {duedate}", slots: { duedate: "date" } },
  },
  COMMENT_MENTIONED: {
    "{actorname} mentioned you on {record}": { sq: "{actorname} ju përmendi te {record}", slots: { record: "record" } },
  },
  COMMENT_REPLY: {
    "{actorname} replied to you on {record}": { sq: "{actorname} ju u përgjigj te {record}", slots: { record: "record" } },
  },
  COMMENT_ADDED: {
    "{actorname} commented on {record}": { sq: "{actorname} komentoi te {record}", slots: { record: "record" } },
  },
  APPROVAL_REQUESTED: {
    "{record} needs your {steplabel} approval": { sq: "{record} pret miratimin tuaj në hapin {steplabel}", slots: { record: "record", steplabel: "approvalStep" } },
    "{record} needs your approval": { sq: "{record} pret miratimin tuaj", slots: { record: "record" } },
    "Submitted by {submittedbyname}": "Dorëzuar nga {submittedbyname}",
  },
  APPROVAL_DECIDED: {
    "{record} was {decision}": { sq: "{record} është {decision}", slots: { record: "record", decision: "decision" } },
  },
  APPROVAL_APPROVED: {
    "{record} was approved": { sq: "{record} u miratua", slots: { record: "record" } },
    "By {actorname}": "Nga {actorname}",
  },
  APPROVAL_REJECTED: {
    "{record} was rejected": { sq: "{record} u refuzua", slots: { record: "record" } },
  },
  APPROVAL_RETURNED: {
    "{record} was returned for revision": { sq: "{record} u kthye për rishikim", slots: { record: "record" } },
  },
  APPROVAL_REASSIGNED: {
    "{record} was reassigned": { sq: "{record} u ricaktua", slots: { record: "record" } },
    "Now with {toname}": "Tani te {toname}",
  },
  APPROVAL_DELEGATED: {
    "{fromname} delegated approvals to {toname}": "{fromname} delegoi miratimet te {toname}",
  },
  APPROVAL_OVERDUE: {
    "{record} is overdue for a decision": { sq: "{record} pret vendim me vonesë", slots: { record: "record" } },
    "It was due {duedate}": { sq: "Afati ishte më {duedate}", slots: { duedate: "date" } },
  },
  TIMESHEET_SUBMITTED: {
    "{membername} submitted their timesheet for {weeklabel}": { sq: "{membername} dorëzoi fletën e orëve për {weeklabel}", slots: { weeklabel: "date" } },
    "{totallabel} logged": "U regjistruan {totallabel}",
  },
  TIMESHEET_APPROVAL_ASSIGNED: {
    "A timesheet was passed to you to approve": "Një fletë orësh ju kaloi për miratim",
  },
  TIMESHEET_APPROVED: {
    "Your timesheet for {weeklabel} was approved": { sq: "Fleta juaj e orëve për {weeklabel} u miratua", slots: { weeklabel: "date" } },
    "By {actorname}": "Nga {actorname}",
  },
  TIMESHEET_RETURNED: {
    "Your approved timesheet for {weeklabel} was reopened": { sq: "Fleta juaj e miratuar e orëve për {weeklabel} u rihap", slots: { weeklabel: "date" } },
    "Your timesheet for {weeklabel} was returned": { sq: "Fleta juaj e orëve për {weeklabel} u kthye mbrapsht", slots: { weeklabel: "date" } },
  },
  TIMESHEET_REJECTED: {
    "Your timesheet for {weeklabel} was rejected": { sq: "Fleta juaj e orëve për {weeklabel} u refuzua", slots: { weeklabel: "date" } },
  },
  TIMESHEET_REMINDER: {
    "Your timesheet for {weeklabel} is due": { sq: "Fleta juaj e orëve për {weeklabel} duhet dorëzuar", slots: { weeklabel: "date" } },
    "Due {deadlinelabel}": { sq: "Afati {deadlinelabel}", slots: { deadlinelabel: "date" } },
  },
  DAILY_LOG_SUBMITTED: {
    "{actorname} submitted the daily log for {projectname}, {datelabel}": { sq: "{actorname} dorëzoi ditarin e kantierit për {projectname}, {datelabel}", slots: { datelabel: "date" } },
    "Waiting for your review": "Pret shqyrtimin tuaj",
  },
  DAILY_LOG_RETURNED: {
    "The daily log for {projectname}, {datelabel} needs correcting": { sq: "Ditari i kantierit për {projectname}, {datelabel} kërkon korrigjim", slots: { datelabel: "date" } },
  },
  DAILY_LOG_REVIEWED: {
    "The daily log for {projectname}, {datelabel} was reviewed": { sq: "Ditari i kantierit për {projectname}, {datelabel} u shqyrtua", slots: { datelabel: "date" } },
    "By {actorname}": "Nga {actorname}",
  },
  DAILY_LOG_LOCKED: {
    "The daily log for {projectname}, {datelabel} is locked as the record": { sq: "Ditari i kantierit për {projectname}, {datelabel} është kyçur si regjistrimi zyrtar", slots: { datelabel: "date" } },
  },
  DAILY_LOG_CORRECTION_ADDED: {
    "An official correction was added to the daily log for {projectname}, {datelabel}": { sq: "Një korrigjim zyrtar iu shtua ditarit të kantierit për {projectname}, {datelabel}", slots: { datelabel: "date" } },
  },
  DAILY_LOG_MISSING_REMINDER: {
    "No daily log yet for {projectname}, {datelabel}": { sq: "Ende nuk ka ditar kantieri për {projectname}, {datelabel}", slots: { datelabel: "date" } },
    "Logs are required for this project's working days.": "Ditarët kërkohen për ditët e punës të këtij projekti.",
  },
  MILESTONE_ASSIGNED: {
    "You own the milestone “{milestonename}”": "Keni në ngarkim pikën kyçe “{milestonename}”",
    "On {projectname}": "Në {projectname}",
  },
  MILESTONE_UPDATED: {
    "“{milestonename}” on {projectname} changed": "“{milestonename}” në {projectname} ndryshoi",
    "{change} by {actorname}": { sq: "{change} nga {actorname}", slots: { change: "milestoneChange" } },
    "by {actorname}": "nga {actorname}",
    "{change}": { sq: "{change}", slots: { change: "milestoneChange!" } },
  },
  MILESTONE_DUE_SOON: {
    "“{milestonename}” is due {datelabel}": { sq: "“{milestonename}” e ka afatin {datelabel}", slots: { datelabel: "date" } },
    "On {projectname}": "Në {projectname}",
  },
  MILESTONE_OVERDUE: {
    "“{milestonename}” is overdue": "“{milestonename}” është me vonesë",
    "Due {datelabel} on {projectname}": { sq: "Afati {datelabel} në {projectname}", slots: { datelabel: "date" } },
  },
  MILESTONE_COMPLETED: {
    "“{milestonename}” was completed": "“{milestonename}” u përfundua",
    "On {projectname}, {datelabel}": { sq: "Në {projectname}, {datelabel}", slots: { datelabel: "date" } },
  },
  MILESTONE_BLOCKER_ASSIGNED: {
    "You own a blocker on “{milestonename}”": "Keni në ngarkim një pengesë te “{milestonename}”",
  },
  MILESTONE_BLOCKER_RESOLVED: {
    "A blocker on “{milestonename}” was resolved": "Një pengesë te “{milestonename}” u zgjidh",
  },
  BASELINE_CHANGED: {
    "The baseline of “{milestonename}” on {projectname} moved": "Baza e pikës kyçe “{milestonename}” në {projectname} u zhvendos",
    "{change} — {reason}": { sq: "{change} — {reason}", slots: { change: "date!" } },
    "{change}": { sq: "{change}", slots: { change: "date!" } },
  },
  ANNOUNCEMENT_PUBLISHED: {
    "Announcement: {title}": "Njoftim: {title}",
  },
  ANNOUNCEMENT_CRITICAL: {
    "Critical announcement: {title}": "Njoftim kritik: {title}",
    "Please read it and confirm you have.": "Ju lutemi lexojeni dhe konfirmoni që e keni lexuar.",
  },
  ANNOUNCEMENT_ACK_REQUIRED: {
    "Please read and acknowledge: {title}": "Ju lutemi lexoni dhe konfirmoni: {title}",
  },
  ANNOUNCEMENT_REMINDER: {
    "Reminder: acknowledge “{title}”": "Kujtesë: konfirmoni “{title}”",
    "It is still waiting for your confirmation.": "Ende pret konfirmimin tuaj.",
  },
  CONTRACTOR_ASSIGNED_TO_PROJECT: {
    "{contractorname} was assigned to {projectname}": "{contractorname} u caktua në {projectname}",
  },
  CONTRACTOR_STATUS_CHANGED: {
    "{contractorname} is now {statuslabel}": { sq: "{contractorname} tani është {statuslabel}", slots: { statuslabel: "contractorStatus" } },
    "A reason was recorded on the contractor.": "Te kontraktori u regjistrua një arsye.",
  },
  CONTRACTOR_COMPLIANCE_EXPIRING: {
    "{title} for {contractorname} expires {datelabel}": { sq: "{title} për {contractorname} skadon {datelabel}", slots: { datelabel: "date" } },
  },
  CONTRACTOR_COMPLIANCE_EXPIRED: {
    "{title} for {contractorname} has expired": "{title} për {contractorname} ka skaduar",
    "Expired {datelabel}": { sq: "Skadoi më {datelabel}", slots: { datelabel: "date" } },
  },
  RFI_OPENED: {
    "RFI {number} opened: {subject}": "RFI {number} u hap: {subject}",
  },
  RFI_ASSIGNED: {
    "RFI {number} is waiting for your response": "RFI {number} pret përgjigjen tuaj",
    "{subject} · due {datelabel}": { sq: "{subject} · afati {datelabel}", slots: { datelabel: "date" } },
    "due {datelabel}": { sq: "afati {datelabel}", slots: { datelabel: "date!" } },
  },
  RFI_DUE_SOON: {
    "RFI {number} is due {datelabel}": { sq: "RFI {number} e ka afatin {datelabel}", slots: { datelabel: "date" } },
  },
  RFI_OVERDUE: {
    "RFI {number} is overdue": "RFI {number} është me vonesë",
    "{subject} · was due {datelabel}": { sq: "{subject} · afati ishte më {datelabel}", slots: { datelabel: "date" } },
    "was due {datelabel}": { sq: "afati ishte më {datelabel}", slots: { datelabel: "date!" } },
  },
  RFI_ANSWERED: {
    "RFI {number} was answered": "RFI {number} mori përgjigje",
    "{subject} · by {actorname}": "{subject} · nga {actorname}",
    "by {actorname}": "nga {actorname}",
  },
  RFI_CLARIFICATION_REQUIRED: {
    "RFI {number} needs clarification": "RFI {number} kërkon sqarim",
  },
  RFI_CLOSED: {
    "RFI {number} was closed": "RFI {number} u mbyll",
  },
  SUBMITTAL_SUBMITTED: {
    "Submittal {number} Rev {revisioncode} was submitted for review": "Dorëzimi teknik {number} Rev {revisioncode} u dorëzua për rishikim",
    "{title} · review due {datelabel}": { sq: "{title} · afati i rishikimit {datelabel}", slots: { datelabel: "date" } },
    "review due {datelabel}": { sq: "afati i rishikimit {datelabel}", slots: { datelabel: "date!" } },
  },
  SUBMITTAL_REVIEW_ASSIGNED: {
    "You are reviewing submittal {number}": "Ju u caktua rishikimi i dorëzimit teknik {number}",
  },
  SUBMITTAL_DUE_SOON: {
    "Review of submittal {number} is due {datelabel}": { sq: "Rishikimi i dorëzimit teknik {number} e ka afatin {datelabel}", slots: { datelabel: "date" } },
  },
  SUBMITTAL_OVERDUE: {
    "Review of submittal {number} is overdue": "Rishikimi i dorëzimit teknik {number} është me vonesë",
    "{title} · was due {datelabel}": { sq: "{title} · afati ishte më {datelabel}", slots: { datelabel: "date" } },
    "was due {datelabel}": { sq: "afati ishte më {datelabel}", slots: { datelabel: "date!" } },
  },
  SUBMITTAL_APPROVED: {
    "Submittal {number} Rev {revisioncode}: {decisionlabel}": { sq: "Dorëzimi teknik {number} Rev {revisioncode}: {decisionlabel}", slots: { decisionlabel: "reviewDecision" } },
  },
  SUBMITTAL_REVISION_REQUIRED: {
    "Submittal {number} Rev {revisioncode} needs a new revision": "Dorëzimi teknik {number} Rev {revisioncode} kërkon një revizion të ri",
  },
  SUBMITTAL_REJECTED: {
    "Submittal {number} Rev {revisioncode} was rejected": "Dorëzimi teknik {number} Rev {revisioncode} u refuzua",
  },
  ENGINEERING_DOCUMENT_SUBMITTED: {
    "{number} Rev {revisioncode} is ready for review": "{number} Rev {revisioncode} është gati për rishikim",
    "{title} · review due {datelabel}": { sq: "{title} · afati i rishikimit {datelabel}", slots: { datelabel: "date" } },
    "review due {datelabel}": { sq: "afati i rishikimit {datelabel}", slots: { datelabel: "date!" } },
  },
  ENGINEERING_DOCUMENT_APPROVED: {
    "{number} Rev {revisioncode}: {decisionlabel}": { sq: "{number} Rev {revisioncode}: {decisionlabel}", slots: { decisionlabel: "reviewDecision" } },
  },
  ENGINEERING_DOCUMENT_REVISION_REQUIRED: {
    "{number} Rev {revisioncode}: {decisionlabel}": { sq: "{number} Rev {revisioncode}: {decisionlabel}", slots: { decisionlabel: "reviewDecision" } },
  },
  TRANSMITTAL_ISSUED: {
    "Transmittal {number} was issued": "Transmetimi {number} u lëshua",
    "{purposelabel} · {count} documents": { sq: "{purposelabel} · dokumente: {count}", slots: { purposelabel: "transmittalPurpose" } },
    "{count} documents": "Dokumente: {count}",
    "{purposelabel}": { sq: "{purposelabel}", slots: { purposelabel: "transmittalPurpose!" } },
  },
  DOCUMENT_REVIEW_REQUESTED: {
    "{requestername} asked you to review “{documentname}”": "{requestername} ju kërkoi të rishikoni “{documentname}”",
    "Version {versionnumber}": "Versioni {versionnumber}",
  },
  DOCUMENT_APPROVED: {
    "“{documentname}” was approved": "“{documentname}” u miratua",
    "By {reviewername}": "Nga {reviewername}",
  },
  DOCUMENT_REJECTED: {
    "“{documentname}” was rejected": "“{documentname}” u refuzua",
  },
  DOCUMENT_SUPERSEDED: {
    "A newer approved version of “{documentname}” replaced version {supersededversionnumber}": "Një version më i ri i miratuar i dokumentit “{documentname}” zëvendësoi versionin {supersededversionnumber}",
    "A newer approved version of “{documentname}” replaced version": "Një version më i ri i miratuar i dokumentit “{documentname}” zëvendësoi versionin e mëparshëm",
  },
  PO_APPROVAL_REQUIRED: {
    "{record} needs approval": { sq: "{record} pret miratim", slots: { record: "record" } },
    "Submitted by {submittedbyname}": "Dorëzuar nga {submittedbyname}",
  },
  GOODS_RECEIPT_RECORDED: {
    "Goods received against {ponumber}": "U morën mallra kundrejt {ponumber}",
    "Receipt {receiptnumber}": "Marrja {receiptnumber}",
  },
  QA_INSPECTION_REQUIRED: {
    "Inspection {inspectionnumber} is assigned to you": "Inspektimi {inspectionnumber} ju është caktuar",
    "Scheduled for {scheduleddate}": { sq: "Planifikuar më {scheduleddate}", slots: { scheduleddate: "date" } },
  },
  QA_ACTION_ASSIGNED: {
    "Corrective action {actionnumber} is assigned to you": "Veprimi korrigjues {actionnumber} ju është caktuar",
  },
  HSE_CRITICAL_RISK: {
    "Critical safety alert: {record}": { sq: "Alarm kritik sigurie: {record}", slots: { record: "record" } },
    "On {projectname}": "Në {projectname}",
  },
  HSE_ACTION_ASSIGNED: {
    "HSE action {actionnumber} is assigned to you": "Veprimi HSE {actionnumber} ju është caktuar",
  },
  CONTRACT_OBLIGATION_DUE: {
    "Obligation due {duedate}: {title}": { sq: "Detyrimi e ka afatin {duedate}: {title}", slots: { duedate: "date" } },
  },
  LEAVE_DECIDED: {
    "Your leave request was {decision}": { sq: "Kërkesa juaj për leje është {decision}", slots: { decision: "decision" } },
  },
  EMPLOYMENT_CHANGE_EFFECTIVE: {
    "Effective {effectivedate}.": { sq: "Në fuqi nga {effectivedate}.", slots: { effectivedate: "date" } },
    "{change}": { sq: "{change}", slots: { change: "employmentChange!" } },
  },
  EMPLOYMENT_CHANGE_FAILED: {
    "A scheduled change could not be applied: {change}": { sq: "Një ndryshim i planifikuar nuk u zbatua dot: {change}", slots: { change: "scheduledChange" } },
  },
  EMPLOYEE_DOCUMENT_ADDED: {
    "HR added a {categorylabel} to your file": { sq: "BNj shtoi një {categorylabel} në dosjen tuaj", slots: { categorylabel: "documentCategory" } },
  },
  EMPLOYEE_DOCUMENT_VERIFIED: {
    "Your {categorylabel} was verified": { sq: "Një {categorylabel} në dosjen tuaj u verifikua", slots: { categorylabel: "documentCategory" } },
  },
  EMPLOYEE_DOCUMENT_REJECTED: {
    "Your {categorylabel} was not accepted": { sq: "Një {categorylabel} në dosjen tuaj nuk u pranua", slots: { categorylabel: "documentCategory" } },
    "Open it to see why, and resubmit it with a corrected file.": "Hapeni për të parë pse dhe ridorëzojeni me një skedar të korrigjuar.",
  },
  QUALIFICATION_VERIFIED: {
    "Your qualification “{title}” was verified": "Kualifikimi juaj “{title}” u verifikua",
  },
  QUALIFICATION_REJECTED: {
    "Your qualification “{title}” was not accepted": "Kualifikimi juaj “{title}” nuk u pranua",
    "Open it to see why, and resubmit it once it is corrected.": "Hapeni për të parë pse dhe ridorëzojeni pasi të korrigjohet.",
  },
  EMPLOYEE_DOCUMENT_EXPIRING: {
    "{label} of {personname} expires {datelabel}": { sq: "{label} për {personname} skadon {datelabel}", slots: { label: "documentCategory", datelabel: "date" } },
    "In {days} days.": "Edhe {days} ditë.",
  },
  EMPLOYEE_DOCUMENT_EXPIRED: {
    "{label} of {personname} has expired": { sq: "{label} për {personname} ka skaduar", slots: { label: "documentCategory" } },
    "Expired {datelabel}. Renew it to keep the file current.": { sq: "Skadoi më {datelabel}. Rinovojeni që dosja të mbetet e përditësuar.", slots: { datelabel: "date" } },
  },
  QUALIFICATION_EXPIRING: {
    "{typelabel} “{title}” of {personname} expires {datelabel}": { sq: "{typelabel} “{title}” për {personname} skadon {datelabel}", slots: { typelabel: "qualificationType", datelabel: "date" } },
    "In {days} days.": "Edhe {days} ditë.",
  },
  QUALIFICATION_EXPIRED: {
    "{typelabel} “{title}” of {personname} has expired": { sq: "{typelabel} “{title}” për {personname} ka skaduar", slots: { typelabel: "qualificationType" } },
    "Expired {datelabel}. Renew it to keep it on the profile.": { sq: "Skadoi më {datelabel}. Rinovojeni që të mbetet në profil.", slots: { datelabel: "date" } },
  },
  CALENDAR_EVENT_CREATED: {
    "New on the calendar: {record}": "E re në kalendar: {record}",
    "{when}": { sq: "{when}", slots: { when: "date!" } },
  },
  CALENDAR_EVENT_UPDATED: {
    "{record} was changed": "{record} u ndryshua",
    "{when}": { sq: "{when}", slots: { when: "date!" } },
  },
  CALENDAR_EVENT_CANCELLED: {
    "{record} was cancelled": "{record} u anulua",
    "{when}": { sq: "{when}", slots: { when: "date!" } },
  },
  CALENDAR_PARTICIPANT_ADDED: {
    "{actorname} added you to {record}": "{actorname} ju shtoi në {record}",
    "{when}": { sq: "{when}", slots: { when: "date!" } },
  },
  CALENDAR_REMINDER: {
    "Reminder: {record}": "Kujtesë: {record}",
    "{when}": { sq: "{when}", slots: { when: "date!" } },
  },
  MEETING_INVITED: {
    "{actorname} invited you to {record}": "{actorname} ju ftoi në {record}",
    "{when} · {series}": { sq: "{when} · {series}", slots: { when: "date!", series: "meetingSeries" } },
    "{when}": { sq: "{when}", slots: { when: "date!" } },
    "{series}": { sq: "{series}", slots: { series: "meetingSeries!" } },
  },
  MEETING_UPDATED: {
    "{record} was rescheduled or moved": "{record} ndryshoi orarin ose vendin",
    "{when}": { sq: "{when}", slots: { when: "date!" } },
  },
  MEETING_CANCELLED: {
    "{record} was cancelled": "{record} u anulua",
    "{when}": { sq: "{when}", slots: { when: "date!" } },
  },
  MEETING_REMINDER: {
    "Coming up: {record}": "Së shpejti: {record}",
    "{when}": { sq: "{when}", slots: { when: "date!" } },
  },
  MEETING_RESPONSE_CHANGED: {
    "{respondername} replied to {record}": "{respondername} iu përgjigj ftesës për {record}",
    "{respondername} {verb} {record}": { sq: "{respondername} {verb} {record}", slots: { verb: "meetingResponse!" } },
  },
  MEETING_MINUTES_FINALIZED: {
    "Minutes finalized — {record}": "Procesverbali u bë përfundimtar — {record}",
    "Review the meeting record.": "Shikoni procesverbalin e takimit.",
  },
  MEETING_ACTION_ASSIGNED: {
    "New action for you: {actiontitle}": "Veprim i ri për ju: {actiontitle}",
  },
  MEETING_ACTION_COMPLETED: {
    "Action done: {actiontitle}": "Veprim i kryer: {actiontitle}",
  },
  UNIT_RESERVATION_EXPIRING: {
    "The reservation of {unitcode} expires {whenlabel}": { sq: "Rezervimi për {unitcode} skadon {whenlabel}", slots: { whenlabel: "date" } },
  },
  UNIT_RESERVATION_EXPIRED: {
    "The reservation of {unitcode} expired; the unit is for sale again": "Rezervimi për {unitcode} skadoi; njësia është sërish në shitje",
  },
  UNIT_RESERVATION_RELEASED: {
    "The reservation of {unitcode} was released": "Rezervimi për {unitcode} u lirua",
  },
  UNIT_MARKED_SOLD: {
    "{unitcode} was marked Sold": "{unitcode} u shënua e shitur",
  },
  UNIT_CONTRACT_REQUESTED: {
    "A contract is requested for {unitcode}": "Kërkohet kontratë për {unitcode}",
  },
  UNIT_CONTRACT_REQUEST_DECLINED: {
    "Legal declined the contract request for {unitcode}": "Ligjorja e refuzoi kërkesën për kontratë për {unitcode}",
    "The reason is on the unit's Legal section.": "Arsyeja gjendet te seksioni Ligjore i njësisë.",
  },
  UNIT_CONTRACT_SIGNED: {
    "Contract {contractnumber} for {unitcode} was signed": "Kontrata {contractnumber} për {unitcode} u nënshkrua",
    "Contract for {unitcode} was signed": "Kontrata për {unitcode} u nënshkrua",
  },
  UNIT_CONTRACT_CANCELLED: {
    "Contract {contractnumber} for {unitcode} was {verb}": { sq: "Kontrata {contractnumber} për {unitcode} është {verb}", slots: { verb: "contractStatus" } },
    "Contract for {unitcode} was {verb}": { sq: "Kontrata për {unitcode} është {verb}", slots: { verb: "contractStatus" } },
  },
  UNIT_INSTALLMENT_DUE_SOON: {
    "{installmentlabel} for {unitcode} is due {duelabel}": { sq: "{installmentlabel} për {unitcode} e ka afatin {duelabel}", slots: { duelabel: "date" } },
    "Contract {contractnumber}": "Kontrata {contractnumber}",
  },
  UNIT_INSTALLMENT_OVERDUE: {
    "{installmentlabel} for {unitcode} is overdue": "{installmentlabel} për {unitcode} është me vonesë",
    "Contract {contractnumber}, due {duedate}": { sq: "Kontrata {contractnumber}, afati {duedate}", slots: { duedate: "date" } },
  },
  UNIT_PAYMENT_RECEIVED: {
    "A payment was received on contract {contractnumber} for {unitcode}": "U arkëtua një pagesë ndaj kontratës {contractnumber} për {unitcode}",
    "A payment was received on contract for {unitcode}": "U arkëtua një pagesë ndaj kontratës për {unitcode}",
  },
  UNIT_FINANCIALLY_COMPLETE: {
    "Contract {contractnumber} for {unitcode} is paid in full": "Kontrata {contractnumber} për {unitcode} është paguar plotësisht",
    "Contract for {unitcode} is paid in full": "Kontrata për {unitcode} është paguar plotësisht",
    "It can be completed once Legal's conditions are met.": "Mund të përfundohet sapo të plotësohen kushtet e Ligjores.",
  },
  DEPARTMENT_HEAD_ASSIGNED: {
    "You were appointed head of {record}": "U emëruat për të drejtuar {record}",
    "You oversee the function across the group's companies.": "Mbikëqyrni funksionin në të gjitha kompanitë e grupit.",
  },
  DEPARTMENT_MANAGER_ASSIGNED: {
    "You now manage {record} in {companyname}": "Tani menaxhoni {record} në {companyname}",
  },
  DEPARTMENT_MEMBER_ADDED: {
    "You were added to {record} in {companyname}": "U shtuat te {record} në {companyname}",
  },
  DEPARTMENT_ASSIGNMENT_CHANGED: {
    "Your place in {record} changed": "Vendi juaj te {record} ndryshoi",
    "{change}": { sq: "{change}", slots: { change: "departmentChange!" } },
  },
} satisfies Record<string, Catalogue>;

/** Said in place of a notification's own title, whatever the event: its record is one the reader can no longer open. */
export const standing = {
  "About a record you can no longer open": "Për një regjistrim që nuk mund ta hapni më",
} satisfies Catalogue;

/**
 * Sentences that arrive whole inside a hole of another: what changed in somebody's employment, in a milestone,
 * in their place in a department. The services write them (the files are named beside each table); a hole that
 * carries one names its table as its kind. Where a sentence lists several changes with “; ” between them, each
 * is found on its own.
 */
export const sentences = {
  // lib/modules/hr/employment/employment.change.service.ts — as the bell says it to the employee.
  employmentChange: {
    "Promoted to {jobTitle}": "U promovuat në pozicionin {jobTitle}",
    "Promoted to a new position": "U promovuat në një pozicion të ri",
    "Title changed to {jobTitle}": "Titulli juaj i punës ndryshoi në {jobTitle}",
    "Title changed to none": "Titulli juaj i punës u hoq",
    "Moved to {departmentName}": "Kaluat në departamentin {departmentName}",
    "No longer in a department": "Nuk jeni më në asnjë departament",
    "Manager is now {managerName}": "Menaxheri juaj tani është {managerName}",
    "No manager": "Nuk keni më menaxher",
    "Works at {location}": { sq: "Vendi juaj i punës: {location}", slots: { location: "workLocation" } },
    "Employment type is now {employmentType}": { sq: "Lloji juaj i punësimit tani është “{employmentType}”", slots: { employmentType: "employmentType" } },
    "Supporting document linked": "U lidh një dokument mbështetës",
    "You now work for {companyName}": "Tani punoni për {companyName}",
  },
  // The same sentences on the employee's Activity tab, after the name of whoever made the change.
  employmentChangeLine: {
    "Promoted to {jobTitle}": "e promovoi në pozicionin {jobTitle}",
    "Promoted to a new position": "e promovoi në një pozicion të ri",
    "Title changed to {jobTitle}": "ndryshoi titullin e punës në {jobTitle}",
    "Title changed to none": "hoqi titullin e punës",
    "Moved to {departmentName}": "e kaloi në departamentin {departmentName}",
    "No longer in a department": "e hoqi nga departamenti",
    "Manager is now {managerName}": "caktoi si menaxher {managerName}",
    "No manager": "hoqi menaxherin",
    "Works at {location}": { sq: "ndryshoi vendin e punës në: {location}", slots: { location: "workLocation" } },
    "Employment type is now {employmentType}": { sq: "ndryshoi llojin e punësimit në “{employmentType}”", slots: { employmentType: "employmentType" } },
    "Supporting document linked": "lidhi një dokument mbështetës",
  },
  // lib/modules/hr/employment/employment.schedule.ts
  scheduledChange: {
    "{type} for {name}": { sq: "{type} për {name}", slots: { type: "changeType!" } },
    "Change for {name}": "Ndryshim për {name}",
  },
  // lib/modules/project-planning/planning.milestones.ts
  milestoneChange: {
    "Forecast {from} → {to}": { sq: "Parashikimi: {from} → {to}", slots: { from: "date", to: "date" } },
    "Now {status}": { sq: "Tani: {status}", slots: { status: "milestoneStatus!" } },
    "Reopened: {reason}": "U rihap: {reason}",
  },
  // lib/modules/meetings/meeting.service.ts
  meetingSeries: {
    // The Albanian for the frequency is the whole “Përsëritet çdo javë” the meeting's own page shows.
    "Repeats {frequency} · {count} meetings scheduled": { sq: "{frequency} · takime të planifikuara: {count}", slots: { frequency: "repeat!" } },
    "This and later meetings in the series": "Ky takim dhe takimet e mëvonshme të serisë",
  },
  // lib/modules/organization/departments/department.assignment.service.ts
  departmentChange: {
    "{personName} now heads {departmentName}.": "{personName} tani drejton {departmentName}.",
    "{personName} now manages {departmentName} in {companyName}.": "{personName} tani menaxhon {departmentName} në {companyName}.",
    "You moved from {from} to {to}.": "Kaluat nga {from} te {to}.",
    "Your appointment as head of {departmentName} ended.": "Emërimi juaj për të drejtuar {departmentName} përfundoi.",
    "Your appointment as manager of {departmentName} in {companyName} ended.": "Emërimi juaj si menaxher i {departmentName} në {companyName} përfundoi.",
    "You are no longer in {departmentName} in {companyName}.": "Nuk jeni më te {departmentName} në {companyName}.",
  },
} satisfies Record<string, Catalogue>;

/** The words a sentence falls back to when a record's own name is unknown; they land in a hole of the sentence. */
export const fallbackWords = {
  "a task": "një detyrë",
  "A task": "Një detyrë",
  "a new status": "e ri",
  "a record": "një regjistrim",
  "Someone": "Dikush",
  "a record you watch": "një regjistrim që ndiqni",
  "A record": "Një regjistrim",
  "Your record": "Regjistrimi juaj",
  "decided": "vendosur",
  "Your request": "Kërkesa juaj",
  "An approval": "Një miratim",
  "a colleague": "një koleg",
  "A colleague": "Një koleg",
  "the week": "javën",
  "last week": "javën e kaluar",
  "a site day": "një ditë kantieri",
  "a project": "një projekt",
  "the last working day": "ditën e fundit të punës",
  "a milestone": "një pikë kyçe",
  "A milestone": "Një pikë kyçe",
  "soon": "së shpejti",
  "earlier": "më herët",
  "today": "sot",
  "a new announcement": "një njoftim i ri",
  "read now": "lexojeni tani",
  "Please read it and confirm you have.": "Ju lutemi lexojeni dhe konfirmoni që e keni lexuar.",
  "an announcement": "një njoftim",
  "A contractor": "Një kontraktor",
  "changed": "me status të ndryshuar",
  "A compliance item": "Një element përputhshmërie",
  "a contractor": "një kontraktor",
  "a request for information": "një kërkesë për informacion",
  "approved": "miratuar",
  "A document": "Një dokument",
  "revision required": "kërkohet revizion",
  "a document": "një dokument",
  "A purchase order": "Një porosi blerjeje",
  "a purchase order": "një porosie blerjeje",
  "a new HSE record": "një regjistrim i ri HSE",
  "a contract obligation": "një detyrim kontrate",
  "Your employment changed": "Punësimi juaj ndryshoi",
  "employment change": "ndryshim punësimi",
  "document": "dokument",
  "qualification": "kualifikim",
  "HR document": "Dokument i BNj",
  "an employee": "një punonjës",
  "Qualification": "Kualifikimi",
  "an event": "një ngjarje",
  "An event": "Një ngjarje",
  "a meeting": "një takim",
  "A meeting": "Një takim",
  "your meeting": "takimin tuaj",
  "replied": "u përgjigj",
  "to your meeting": "për takimin tuaj",
  "an action item": "një veprim nga takimi",
  "within 24 hours": "brenda 24 orëve",
  "a unit": "një njësi",
  "A unit": "Një njësi",
  "cancelled": "anuluar",
  "An installment": "Një këst",
  "a department": "një departament",
  "a company": "një kompani",
} satisfies Record<string, string>;
