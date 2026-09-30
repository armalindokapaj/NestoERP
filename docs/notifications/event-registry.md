# Notification event registry

Generated from `lib/core/notifications/notification.events.ts` and the push policy by `scripts/notifications-registry-doc.ts`. Do not edit by hand.

114 events. The definition for each event (recipient resolution, permission floor, title/body, dedupe key, email template) is the registry entry itself; this table is the delivery summary.

| Event | Category | Priority | Lock-screen privacy | Push | Android channel | Direct? | Mandatory | Email | Discussion |
|---|---|---|---|---|---|---|---|---|---|
| ANNOUNCEMENT_ACK_REQUIRED | announcements | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| ANNOUNCEMENT_CRITICAL | announcements | CRITICAL | PUBLIC_PREVIEW | urgent | general | routine | yes | default on |  |
| ANNOUNCEMENT_PUBLISHED | announcements | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| ANNOUNCEMENT_REMINDER | announcements | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| APPROVAL_APPROVED | approvals | NORMAL | LIMITED_PREVIEW | yes | approvals | routine |  |  |  |
| APPROVAL_DECIDED | approvals | NORMAL | LIMITED_PREVIEW | yes | approvals | routine |  |  |  |
| APPROVAL_DELEGATED | approvals | NORMAL | LIMITED_PREVIEW | yes | approvals | routine |  |  |  |
| APPROVAL_OVERDUE | approvals | HIGH | LIMITED_PREVIEW | yes | approvals | routine |  |  |  |
| APPROVAL_REASSIGNED | approvals | HIGH | LIMITED_PREVIEW | yes | approvals | routine |  |  |  |
| APPROVAL_REJECTED | approvals | HIGH | LIMITED_PREVIEW | yes | approvals | routine |  |  |  |
| APPROVAL_REQUESTED | approvals | HIGH | LIMITED_PREVIEW | yes | approvals | direct |  | opt-in |  |
| APPROVAL_RETURNED | approvals | HIGH | LIMITED_PREVIEW | yes | approvals | routine |  |  |  |
| CALENDAR_EVENT_CANCELLED | calendar | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| CALENDAR_EVENT_CREATED | calendar | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| CALENDAR_EVENT_UPDATED | calendar | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| CALENDAR_PARTICIPANT_ADDED | calendar | NORMAL | PUBLIC_PREVIEW | yes | general | direct |  |  |  |
| CALENDAR_REMINDER | calendar | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  | opt-in |  |
| COMMENT_ADDED | comments | LOW | PUBLIC_PREVIEW | no (inbox only) | tasks_mentions | routine |  |  | yes |
| COMMENT_REPLY | comments | NORMAL | PUBLIC_PREVIEW | yes | tasks_mentions | direct |  |  | yes |
| CONTRACTOR_ASSIGNED_TO_PROJECT | contractors | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| CONTRACTOR_COMPLIANCE_EXPIRED | contractors | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| CONTRACTOR_COMPLIANCE_EXPIRING | contractors | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| CONTRACTOR_STATUS_CHANGED | contractors | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| CONTRACT_OBLIGATION_DUE | contracts | HIGH | SENSITIVE | yes | general | routine |  |  |  |
| UNIT_CONTRACT_CANCELLED | contracts | HIGH | SENSITIVE | yes | general | routine |  |  |  |
| UNIT_CONTRACT_REQUEST_DECLINED | contracts | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| UNIT_CONTRACT_REQUESTED | contracts | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| UNIT_CONTRACT_SIGNED | contracts | HIGH | SENSITIVE | yes | general | routine |  |  |  |
| DAILY_LOG_CORRECTION_ADDED | daily_logs | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| DAILY_LOG_LOCKED | daily_logs | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| DAILY_LOG_MISSING_REMINDER | daily_logs | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| DAILY_LOG_RETURNED | daily_logs | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| DAILY_LOG_REVIEWED | daily_logs | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| DAILY_LOG_SUBMITTED | daily_logs | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| DOCUMENT_APPROVED | documents | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| DOCUMENT_REJECTED | documents | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| DOCUMENT_REVIEW_REQUESTED | documents | HIGH | PUBLIC_PREVIEW | yes | general | direct |  | opt-in |  |
| DOCUMENT_SUPERSEDED | documents | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| ENGINEERING_DOCUMENT_APPROVED | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| ENGINEERING_DOCUMENT_REVISION_REQUIRED | engineering | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| ENGINEERING_DOCUMENT_SUBMITTED | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| RFI_ANSWERED | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| RFI_ASSIGNED | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | direct |  |  |  |
| RFI_CLARIFICATION_REQUIRED | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| RFI_CLOSED | engineering | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| RFI_DUE_SOON | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| RFI_OPENED | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| RFI_OVERDUE | engineering | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| SUBMITTAL_APPROVED | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| SUBMITTAL_DUE_SOON | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| SUBMITTAL_OVERDUE | engineering | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| SUBMITTAL_REJECTED | engineering | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| SUBMITTAL_REVIEW_ASSIGNED | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | direct |  |  |  |
| SUBMITTAL_REVISION_REQUIRED | engineering | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| SUBMITTAL_SUBMITTED | engineering | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| TRANSMITTAL_ISSUED | engineering | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| UNIT_FINANCIALLY_COMPLETE | finance | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| UNIT_INSTALLMENT_DUE_SOON | finance | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| UNIT_INSTALLMENT_OVERDUE | finance | HIGH | SENSITIVE | yes | general | routine |  |  |  |
| UNIT_PAYMENT_RECEIVED | finance | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| EMPLOYEE_DOCUMENT_ADDED | hr | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| EMPLOYEE_DOCUMENT_EXPIRED | hr | HIGH | SENSITIVE | yes | general | routine |  |  |  |
| EMPLOYEE_DOCUMENT_EXPIRING | hr | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| EMPLOYEE_DOCUMENT_REJECTED | hr | HIGH | SENSITIVE | yes | general | routine |  |  |  |
| EMPLOYEE_DOCUMENT_VERIFIED | hr | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| EMPLOYMENT_CHANGE_EFFECTIVE | hr | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| EMPLOYMENT_CHANGE_FAILED | hr | HIGH | SENSITIVE | yes | general | routine |  |  |  |
| LEAVE_DECIDED | hr | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| QUALIFICATION_EXPIRED | hr | HIGH | SENSITIVE | yes | general | routine |  |  |  |
| QUALIFICATION_EXPIRING | hr | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| QUALIFICATION_REJECTED | hr | HIGH | SENSITIVE | yes | general | routine |  |  |  |
| QUALIFICATION_VERIFIED | hr | NORMAL | SENSITIVE | yes | general | routine |  |  |  |
| HSE_ACTION_ASSIGNED | hse | HIGH | PUBLIC_PREVIEW | yes | general | direct |  |  |  |
| HSE_CRITICAL_RISK | hse | CRITICAL | PUBLIC_PREVIEW | urgent | critical_hse | routine | yes | default on |  |
| MEETING_ACTION_ASSIGNED | meetings | NORMAL | PUBLIC_PREVIEW | yes | general | direct |  |  |  |
| MEETING_ACTION_COMPLETED | meetings | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| MEETING_CANCELLED | meetings | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| MEETING_INVITED | meetings | NORMAL | PUBLIC_PREVIEW | yes | general | direct |  | opt-in |  |
| MEETING_MINUTES_FINALIZED | meetings | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| MEETING_REMINDER | meetings | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| MEETING_RESPONSE_CHANGED | meetings | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| MEETING_UPDATED | meetings | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| COMMENT_MENTIONED | mentions | NORMAL | PUBLIC_PREVIEW | yes | tasks_mentions | direct |  | opt-in | yes |
| DEPARTMENT_ASSIGNMENT_CHANGED | organization | LOW | LIMITED_PREVIEW | no (inbox only) | general | routine |  |  |  |
| DEPARTMENT_HEAD_ASSIGNED | organization | NORMAL | LIMITED_PREVIEW | yes | general | direct |  |  |  |
| DEPARTMENT_MANAGER_ASSIGNED | organization | NORMAL | LIMITED_PREVIEW | yes | general | direct |  |  |  |
| DEPARTMENT_MEMBER_ADDED | organization | LOW | LIMITED_PREVIEW | no (inbox only) | general | routine |  |  |  |
| GOODS_RECEIPT_RECORDED | procurement | NORMAL | LIMITED_PREVIEW | yes | general | routine |  |  |  |
| PO_APPROVAL_REQUIRED | procurement | HIGH | LIMITED_PREVIEW | yes | general | direct |  |  |  |
| BASELINE_CHANGED | project_planning | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| MILESTONE_ASSIGNED | project_planning | NORMAL | PUBLIC_PREVIEW | yes | general | direct |  |  |  |
| MILESTONE_BLOCKER_ASSIGNED | project_planning | HIGH | PUBLIC_PREVIEW | yes | general | direct |  |  |  |
| MILESTONE_BLOCKER_RESOLVED | project_planning | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| MILESTONE_COMPLETED | project_planning | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| MILESTONE_DUE_SOON | project_planning | NORMAL | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| MILESTONE_OVERDUE | project_planning | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| MILESTONE_UPDATED | project_planning | LOW | PUBLIC_PREVIEW | no (inbox only) | general | routine |  |  |  |
| QA_ACTION_ASSIGNED | qa_qc | NORMAL | PUBLIC_PREVIEW | yes | general | direct |  |  |  |
| QA_INSPECTION_REQUIRED | qa_qc | HIGH | PUBLIC_PREVIEW | yes | general | routine |  |  |  |
| UNIT_MARKED_SOLD | sales | NORMAL | LIMITED_PREVIEW | yes | general | routine |  |  |  |
| UNIT_RESERVATION_EXPIRED | sales | HIGH | LIMITED_PREVIEW | yes | general | routine |  |  |  |
| UNIT_RESERVATION_EXPIRING | sales | HIGH | LIMITED_PREVIEW | yes | general | routine |  |  |  |
| UNIT_RESERVATION_RELEASED | sales | NORMAL | LIMITED_PREVIEW | yes | general | routine |  |  |  |
| TASK_ASSIGNED | tasks | NORMAL | PUBLIC_PREVIEW | yes | tasks_mentions | direct |  |  |  |
| TASK_BLOCKED | tasks | HIGH | PUBLIC_PREVIEW | yes | tasks_mentions | routine |  |  |  |
| TASK_COMPLETED | tasks | NORMAL | PUBLIC_PREVIEW | yes | tasks_mentions | routine |  |  |  |
| TASK_OVERDUE | tasks | HIGH | PUBLIC_PREVIEW | yes | tasks_mentions | routine |  |  |  |
| TASK_STATUS_CHANGED | tasks | LOW | PUBLIC_PREVIEW | no (inbox only) | tasks_mentions | routine |  |  |  |
| TIMESHEET_APPROVAL_ASSIGNED | timesheets | NORMAL | LIMITED_PREVIEW | yes | general | direct |  |  |  |
| TIMESHEET_APPROVED | timesheets | NORMAL | LIMITED_PREVIEW | yes | general | routine |  |  |  |
| TIMESHEET_REJECTED | timesheets | HIGH | LIMITED_PREVIEW | yes | general | routine |  |  |  |
| TIMESHEET_REMINDER | timesheets | NORMAL | LIMITED_PREVIEW | yes | general | routine |  |  |  |
| TIMESHEET_RETURNED | timesheets | HIGH | LIMITED_PREVIEW | yes | general | routine |  |  |  |
| TIMESHEET_SUBMITTED | timesheets | NORMAL | LIMITED_PREVIEW | yes | general | routine |  |  |  |

## Reading the table

- **Originating module, trigger, recipients, permission floor, title/body, dedupe key** — in the registry entry. Recipients are candidates: the dispatcher re-reads the event's record in each candidate's own context and writes a notification only for someone who could open it at that moment.
- **Priority** — `LOW` is inbox only, never pushed. `NORMAL`/`HIGH` push. `CRITICAL` pushes urgently, bypasses category and project-mute preferences, and (unless the person turned the override off) quiet hours. Only critical safety and critical announcement events are critical.
- **Push** — the decision with default preferences. A category switch, a muted project or quiet hours change it per person (see notification-preferences.md).
- **Direct** — addressed to one person by name (assignment, mention, approval request, invitation). A project mute never hides these.
- **Deep link** — every notification opens `/notifications/{id}/open`, which re-authorises the record and redirects to its canonical path.
- **Grouping** — `threadKey` is `{entityType}:{entityId}`: one record, one lock-screen thread (APNs `thread-id`/collapse id, FCM collapse key and tag).
