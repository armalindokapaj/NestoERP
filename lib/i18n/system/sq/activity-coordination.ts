import type { Catalogue } from "@/lib/i18n/catalogue";

/**
 * Albanian for the activity lines of engineering, meetings, tasks, planning, documents, projects, discussion, media, work packages, announcements and calendar.
 *
 * An activity line is stored in English when the change happens, as a phrase that follows the name of
 * whoever made it (“approved invoice INV-2026-0012”), and is put into the reader's language when it is read
 * (lib/i18n/system). Each key is that English phrase as the code writes it, `{holes}` standing for its
 * values; each value is the same phrase in Albanian, third person, past tense, to follow a name.
 * A key is never edited by hand: tests/unit/i18n/system-text.test.ts holds the two in step.
 */
export const rows = {
  // core:collaboration
  "started watching": "filloi ta ndjekë",
  "commented and mentioned {length} person": "komentoi dhe përmendi {length} person",
  "commented and mentioned {length} people": "komentoi dhe përmendi {length} persona",
  "commented": "komentoi",
  // announcements
  "published the announcement “{title}”": "publikoi njoftimin “{title}”",
  // calendar
  "scheduled {title}": "planifikoi ngjarjen {title}",
  // documents
  "updated the document details": "përditësoi të dhënat e dokumentit",
  "archived {name}": "arkivoi {name}",
  "restored {name}": "riktheu {name}",
  "added {name}": "shtoi {name}",
  "uploaded version {versionNumber}": "ngarkoi versionin {versionNumber}",
  "requested a review of version {versionNumber}": "kërkoi rishikim të versionit {versionNumber}",
  "approved version {versionNumber} on behalf of the assigned reviewer": "miratoi versionin {versionNumber} në emër të rishikuesit të caktuar",
  "approved version {versionNumber}": "miratoi versionin {versionNumber}",
  "rejected version {versionNumber} on behalf of the assigned reviewer": "refuzoi versionin {versionNumber} në emër të rishikuesit të caktuar",
  "rejected version {versionNumber}": "refuzoi versionin {versionNumber}",
  "reassigned a review from {nameOf} to {nameOf2}": "ricaktoi një rishikim nga {nameOf} te {nameOf2}",
  // engineering
  "registered {documentNumber} {title}": "regjistroi {documentNumber} {title}",
  "voided {documentNumber}": "anuloi {documentNumber}",
  "marked {documentNumber} superseded": "shënoi {documentNumber} si të zëvendësuar",
  "submitted {label} for review": "dorëzoi {label} për rishikim",
  "added {number} Rev {revisionCode} as a draft": "shtoi {number} Rev {revisionCode} si draft",
  "started reviewing {label}": "filloi rishikimin e {label}",
  "reviewed {label}: {decision}": { sq: "rishikoi {label}: {decision}", slots: { decision: "reviewDecision" } },
  "discarded the draft {label}": "hodhi poshtë draftin {label}",
  "opened {label}": "hapi {label}",
  "drafted {label}": "hartoi {label}",
  "answered {label}": "dha përgjigje për {label}",
  "asked for clarification on {label}": "kërkoi sqarim për {label}",
  "closed {label}": "mbylli {label}",
  "voided {label}": "anuloi {label}",
  "registered submittal {submittalNumber} {title}": "regjistroi dorëzimin teknik {submittalNumber} {title}",
  "closed submittal {submittalNumber}": "mbylli dorëzimin teknik {submittalNumber}",
  "voided submittal {submittalNumber}": "anuloi dorëzimin teknik {submittalNumber}",
  "prepared transmittal {transmittalNumber}": "përgatiti transmetimin {transmittalNumber}",
  "issued transmittal {transmittalNumber}": "lëshoi transmetimin {transmittalNumber}",
  "voided transmittal {transmittalNumber}": "anuloi transmetimin {transmittalNumber}",
  // meetings
  "assigned an action": "caktoi një veprim",
  "added an action": "shtoi një veprim",
  "completed an action": "kreu një veprim",
  "recorded decision {decisionLabel}": "regjistroi vendimin {decisionLabel}",
  "finalized the minutes": "e bëri përfundimtar procesverbalin",
  "reopened the minutes": "rihapi procesverbalin",
  "added {get}": "shtoi {get}",
  "added {length} participants": "shtoi {length} pjesëmarrës",
  "handed the meeting to {get}": "kaloi takimin te {get}",
  "scheduled the meeting": "planifikoi takimin",
  "started the meeting": "filloi takimin",
  "completed the meeting": "përfundoi takimin",
  "cancelled the meeting": "anuloi takimin",
  // project-media
  "added “{mediaTitle}” to project media": "shtoi “{mediaTitle}” te media e projektit",
  "updated project media “{title}”": "përditësoi median e projektit “{title}”",
  "removed “{title}” from project media": "hoqi “{title}” nga media e projektit",
  "reordered project media": "rirenditi median e projektit",
  // project-planning
  "added a critical blocker to {name}": "shtoi një pengesë kritike te pika kyçe {name}",
  "raised a blocker on {name} to critical": "ngriti në nivel kritik një pengesë te pika kyçe {name}",
  "resolved the blocker {title}": "zgjidhi pengesën {title}",
  "added the milestone {name}": "shtoi pikën kyçe {name}",
  "moved the forecast of {name} to {dateLabel}": { sq: "zhvendosi parashikimin e pikës kyçe {name} në datën {dateLabel}", slots: { dateLabel: "date" } },
  "changed the owner of {name}": "ndryshoi përgjegjësin e pikës kyçe {name}",
  "completed {name}": "përfundoi pikën kyçe {name}",
  "reopened {name}": "rihapi {name}",
  "marked {name} {status}": { sq: "shënoi pikën kyçe {name} si “{status}”", slots: { status: "milestoneStatus!" } },
  "changed the baseline of {name} from {dateLabel} to {dateLabel2}": { sq: "ndryshoi bazën e pikës kyçe {name} nga {dateLabel} në {dateLabel2}", slots: { dateLabel: "date", dateLabel2: "date" } },
  "set the baseline of {name} to {dateLabel}": { sq: "vendosi bazën e pikës kyçe {name} në datën {dateLabel}", slots: { dateLabel: "date" } },
  "added the {name} phase": "shtoi fazën {name}",
  "archived the {name} phase": "arkivoi fazën {name}",
  // projects
  "created the project": "krijoi projektin",
  "updated the project": "përditësoi projektin",
  "changed the project manager": "ndryshoi menaxherin e projektit",
  "changed the status from {projectStatusLabelsfrom} to {projectStatusLabelsto}": { sq: "ndryshoi statusin nga “{projectStatusLabelsfrom}” në “{projectStatusLabelsto}”", slots: { projectStatusLabelsfrom: "projectStatus", projectStatusLabelsto: "projectStatus" } },
  "archived the project": "arkivoi projektin",
  "restored the project": "riktheu projektin",
  "added {name} to the project": "shtoi {name} në projekt",
  "updated a project team member": "përditësoi një anëtar të ekipit të projektit",
  "removed {name} from the project": "hoqi {name} nga projekti",
  // tasks
  "claimed the task": "mori përsipër detyrën",
  "started the task": "filloi detyrën",
  "marked the task blocked": "shënoi detyrën si të bllokuar",
  "marked the task blocked: {reason}": "shënoi detyrën si të bllokuar: {reason}",
  "completed the task": "përfundoi detyrën",
  "reopened the task": "rihapi detyrën",
  "archived the task": "arkivoi detyrën",
  "restored the task": "riktheu detyrën",
  "updated the task": "përditësoi detyrën",
  "changed the status from {status} to {status2}": { sq: "ndryshoi statusin nga “{status}” në “{status2}”", slots: { status: "taskStatus", status2: "taskStatus" } },
  "reassigned the task": "ricaktoi detyrën",
  "removed the assignee": "hoqi përgjegjësin",
  "moved the task to another project": "zhvendosi detyrën në një projekt tjetër",
  "created the task": "krijoi detyrën",
  "assigned the task": "caktoi detyrën",
  // work-packages
  "created the work package {code} {name}": "krijoi paketën e punës {code} {name}",
  "marked {code} {status}": { sq: "shënoi {code} si “{status}”", slots: { status: "status!" } },
  "completed the work package {code} {name}": "përfundoi paketën e punës {code} {name}",
} satisfies Catalogue;
