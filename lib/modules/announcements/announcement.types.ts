/**
 * Announcement contracts (PRD #45 §8-§15, §60, §61, §176, §177, §219). Client-safe.
 */

export const ANNOUNCEMENT_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED", "EXPIRED", "ARCHIVED"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_PRIORITIES = ["NORMAL", "IMPORTANT", "CRITICAL"] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export const AUDIENCE_TYPES = ["COMPANY", "DEPARTMENT", "PROJECT", "SELECTED_MEMBERS"] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export const STATUS_LABELS: Record<AnnouncementStatus, string> = { DRAFT: "Draft", SCHEDULED: "Scheduled", PUBLISHED: "Published", EXPIRED: "Expired", ARCHIVED: "Archived" };
export const PRIORITY_LABELS: Record<AnnouncementPriority, string> = { NORMAL: "Normal", IMPORTANT: "Important", CRITICAL: "Critical" };
export const AUDIENCE_LABELS: Record<AudienceType, string> = { COMPANY: "Company", DEPARTMENT: "Department", PROJECT: "Project", SELECTED_MEMBERS: "Selected members" };

export const FEED_TABS = ["for_me", "pinned", "unread", "acknowledge", "history", "manage"] as const;
export type FeedTab = (typeof FEED_TABS)[number];
export const FEED_TAB_LABELS: Record<FeedTab, string> = { for_me: "For Me", pinned: "Pinned", unread: "Unread", acknowledge: "To Acknowledge", history: "History", manage: "Manage" };

export const TITLE_MAX = 180;
export const BODY_MAX = 50_000;
export const PINNED_LIMIT = 3;

export type AudienceDTO = {
  type: AudienceType;
  /** "Company", "Project · Riverside Residences", "Department · Finance", "Selected members" (§219). */
  label: string;
  project: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
};

export type AnnouncementCardDTO = {
  id: string;
  title: string;
  excerpt: string;
  status: AnnouncementStatus;
  priority: AnnouncementPriority;
  audience: AudienceDTO;
  author: { memberId: string; name: string } | null;
  publishAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  pinned: boolean;
  requiresAcknowledgment: boolean;
  read: boolean;
  acknowledgedAt: string | null;
  attachmentCount: number;
  edited: boolean;
  updatedAt: string;
  href: string;
};

export type AnnouncementCapabilities = {
  canEdit: boolean;
  canEditAudience: boolean;
  canEditContent: boolean;
  canPublish: boolean;
  canSchedule: boolean;
  canUnschedule: boolean;
  canArchive: boolean;
  canPin: boolean;
  canDuplicate: boolean;
  canAcknowledge: boolean;
  canViewMetrics: boolean;
  canUploadDocuments: boolean;
};

export type AnnouncementDocumentDTO = { documentId: string; name: string; extension: string | null; size: number | null; href: string; previewable: boolean };

export type AnnouncementDetailDTO = AnnouncementCardDTO & {
  body: string;
  version: number;
  selectedMembers: Array<{ memberId: string; name: string }> | null;
  documents: AnnouncementDocumentDTO[] | null;
  capabilities: AnnouncementCapabilities;
};

export type AnnouncementMetricsDTO = {
  audience: number;
  read: number;
  acknowledged: number;
  pending: number;
  readRate: number | null;
  acknowledgmentRate: number | null;
  requiresAcknowledgment: boolean;
};

export type AcknowledgmentRowDTO = { memberId: string; name: string; readAt: string | null; acknowledgedAt: string | null };

export type AnnouncementFeedDTO = { items: AnnouncementCardDTO[]; nextCursor: string | null; counts: { unread: number; acknowledge: number } };
