import type { Locale } from "../config";
import { adminEn } from "./admin/en";
import { adminSq } from "./admin/sq";
import { adminOrgsEn } from "./adminOrgs/en";
import { adminOrgsSq } from "./adminOrgs/sq";
import { adminAccessEn } from "./adminAccess/en";
import { adminAccessSq } from "./adminAccess/sq";
import { groupEn } from "./group/en";
import { groupSq } from "./group/sq";
import { adminPlatformEn } from "./adminPlatform/en";
import { adminPlatformSq } from "./adminPlatform/sq";
import { announcementsEn } from "./announcements/en";
import { announcementsSq } from "./announcements/sq";
import { approvalsEn } from "./approvals/en";
import { approvalsSq } from "./approvals/sq";
import { calendarEn } from "./calendar/en";
import { calendarSq } from "./calendar/sq";
import { clientsEn } from "./clients/en";
import { clientsSq } from "./clients/sq";
import { commonEn } from "./common/en";
import { commonSq } from "./common/sq";
import { contractorsEn } from "./contractors/en";
import { contractorsSq } from "./contractors/sq";
import { contractsEn } from "./contracts/en";
import { contractsSq } from "./contracts/sq";
import { dailyLogsEn } from "./dailyLogs/en";
import { dailyLogsSq } from "./dailyLogs/sq";
import { dashboardEn } from "./dashboard/en";
import { dashboardSq } from "./dashboard/sq";
import { documentsEn } from "./documents/en";
import { documentsSq } from "./documents/sq";
import { engineeringEn } from "./engineering/en";
import { engineeringSq } from "./engineering/sq";
import { financeEn } from "./finance/en";
import { financeSq } from "./finance/sq";
import { hrEn } from "./hr/en";
import { hrSq } from "./hr/sq";
import { hseEn } from "./hse/en";
import { hseSq } from "./hse/sq";
import { inventoryEn } from "./inventory/en";
import { inventorySq } from "./inventory/sq";
import { meetingsEn } from "./meetings/en";
import { meetingsSq } from "./meetings/sq";
import { miscEn } from "./misc/en";
import { miscSq } from "./misc/sq";
import { offlineEn } from "./offline/en";
import { offlineSq } from "./offline/sq";
import { organizationEn } from "./organization/en";
import { organizationSq } from "./organization/sq";
import { peopleEn } from "./people/en";
import { peopleSq } from "./people/sq";
import { procurementEn } from "./procurement/en";
import { procurementSq } from "./procurement/sq";
import { projectsEn } from "./projects/en";
import { projectsSq } from "./projects/sq";
import { qaqcEn } from "./qaqc/en";
import { qaqcSq } from "./qaqc/sq";
import { salesEn } from "./sales/en";
import { salesSq } from "./sales/sq";
import { tasksEn } from "./tasks/en";
import { tasksSq } from "./tasks/sq";
import { teamEn } from "./team/en";
import { teamSq } from "./team/sq";
import { threeDEn } from "./threeD/en";
import { threeDSq } from "./threeD/sq";
import { timesheetsEn } from "./timesheets/en";
import { timesheetsSq } from "./timesheets/sq";
import { workforceEn } from "./workforce/en";
import { workforceSq } from "./workforce/sq";

/**
 * Module dictionaries.
 *
 * Kept apart from the application frame's dictionary (`../messages`) because
 * that one ships to every page. A module's strings reach the browser only
 * where its layout mounts `ModuleMessages` for it; Server Components read them
 * directly through `getTranslations`, the same as any other namespace.
 *
 * English is the source: each Albanian module dictionary is typed against it.
 */
export const moduleMessagesEn = {
  dashboard: dashboardEn,
  tasks: tasksEn,
  common: commonEn,
  projects: projectsEn,
  hse: hseEn,
  finance: financeEn,
  qaqc: qaqcEn,
  inventory: inventoryEn,
  sales: salesEn,
  hr: hrEn,
  procurement: procurementEn,
  contracts: contractsEn,
  meetings: meetingsEn,
  documents: documentsEn,
  engineering: engineeringEn,
  approvals: approvalsEn,
  clients: clientsEn,
  dailyLogs: dailyLogsEn,
  timesheets: timesheetsEn,
  calendar: calendarEn,
  organization: organizationEn,
  team: teamEn,
  workforce: workforceEn,
  contractors: contractorsEn,
  people: peopleEn,
  announcements: announcementsEn,
  misc: miscEn,
  threeD: threeDEn,
  offline: offlineEn,
  admin: adminEn,
  adminOrgs: adminOrgsEn,
  adminAccess: adminAccessEn,
  adminPlatform: adminPlatformEn,
  group: groupEn,
};

export type ModuleMessages = typeof moduleMessagesEn;
export type ModuleNamespace = keyof ModuleMessages;

export const moduleMessages: Record<Locale, ModuleMessages> = {
  en: moduleMessagesEn,
  sq: {
    dashboard: dashboardSq,
    tasks: tasksSq,
    common: commonSq,
    projects: projectsSq,
    hse: hseSq,
    finance: financeSq,
    qaqc: qaqcSq,
    inventory: inventorySq,
    sales: salesSq,
    hr: hrSq,
    procurement: procurementSq,
    contracts: contractsSq,
    meetings: meetingsSq,
    documents: documentsSq,
    engineering: engineeringSq,
    approvals: approvalsSq,
    clients: clientsSq,
    dailyLogs: dailyLogsSq,
    timesheets: timesheetsSq,
    calendar: calendarSq,
    organization: organizationSq,
    team: teamSq,
    workforce: workforceSq,
    contractors: contractorsSq,
    people: peopleSq,
    announcements: announcementsSq,
    misc: miscSq,
    threeD: threeDSq,
    offline: offlineSq,
    admin: adminSq,
    adminOrgs: adminOrgsSq,
    adminAccess: adminAccessSq,
    adminPlatform: adminPlatformSq,
    group: groupSq,
  },
};
