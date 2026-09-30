# Mobile Site Diary (MOB-07 §48-§52)

The Site Diary is the existing **Daily log** (PRD #43). No second model.

- Reached from a project (Capture -> Site diary, or Quick Create -> Daily log). Project and date come from context.
- Statuses are the repository's: DRAFT -> SUBMITTED -> REVIEWED -> LOCKED (+ CORRECTION_REQUIRED, VOID). A log is a draft from
  the moment it starts; saving entries is saving the draft; submit is the canonical transition.
- Photos are canonical Documents linked by `DailyLogDocumentLink` (category, caption, takenAt). The gallery already has a
  camera button, per-file rows with Retry, and removes JPEG location data before upload.
- Follow-up (not done): `evidence-gallery.tsx` still owns its two file inputs. Moving them onto `CaptureService` is mechanical
  but the existing E2E selects `data-testid="evidence-input"`, so it was left for MOB-08 when the native adapter needs it.
