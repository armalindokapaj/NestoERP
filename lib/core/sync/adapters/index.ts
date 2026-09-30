import type { MutationType } from "../protocol";
import { siteDiaryAddEntry, siteDiaryCreate, siteDiarySubmit, siteDiaryUpdateDraft } from "./daily-log.adapters";
import { hseCreate } from "./hse.adapters";
import { taskAllowedUpdate, taskCommentCreate } from "./task.adapters";
import type { SyncAdapter } from "./types";

/**
 * Every mutation the device may queue, and who runs it (MOB-09 §30, §143).
 * A type missing here is not writable offline: the dispatcher refuses it.
 */
export const SYNC_ADAPTERS: Record<MutationType, SyncAdapter> = {
  SITE_DIARY_CREATE: siteDiaryCreate,
  SITE_DIARY_UPDATE_DRAFT: siteDiaryUpdateDraft,
  SITE_DIARY_ADD_ENTRY: siteDiaryAddEntry,
  SITE_DIARY_SUBMIT: siteDiarySubmit,
  TASK_COMMENT_CREATE: taskCommentCreate,
  TASK_ALLOWED_UPDATE: taskAllowedUpdate,
  HSE_CREATE: hseCreate,
};
