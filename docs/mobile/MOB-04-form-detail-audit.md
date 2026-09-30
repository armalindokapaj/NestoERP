# MOB-04 audit: forms, actions and detail pages

Audit of what NESTO already had before adding anything (MOB-04 §5). The finding
is that the *form* layer was already one system and the *detail* layer was not,
so MOB-04 extends the first and standardises the second.

## Forms: one system already (extended, not replaced)
| Existing | Where | Verdict |
|---|---|---|
| `RecordForm`, `Field`, `FormSection` (~128 uses) | components/forms/record-form.tsx | Canonical. Server action, field errors, unsaved contract, save outcomes. Kept. |
| Form contract: ids, required, `aria-describedby`, blur/submit validation, error summary + focus | components/forms/form-contract.tsx | Canonical (AUD-09). Kept. |
| Unsaved work: coordinator, guarded router, history guard, prompt | components/unsaved, lib/unsaved | Canonical (AUD-03). Covers back, nav, workspace switch, logout. Kept. |
| Conflict handling (`versionUpdatedAt`, task conflict review) | record-form, AUD-02 | Canonical. Kept. |
| `FormGrid`, `StickyActions`, `BottomSheet`, Dialog `presentation` | components/ui (MOB-01) | Reused. |
| Document upload engine (`useUploadQueue`, signed direct upload, retries) | components/documents/upload-queue.tsx | Canonical for Document files. Reused, not duplicated. |
| Shared validators (`decimalValidator`, `dateValidator`, server zod schemas) | lib/forms | Canonical. No mobile validation rules were added. |

Gaps found: the form's Save/Cancel row scrolled away on a phone; no relation
selector (every relation was a native `<select>` preloaded with its options);
no multi-step pattern; no attachment preview/progress row for plain form fields;
no unit-adorned number input; the destructive `ConfirmDialog` was a centred
dialog on a phone.

## Detail pages: several dialects (standardised)
- `RecordHeader` + `DetailGrid` (components/modules/record-header.tsx), used by ~58 files: the closest to canonical. Kept as the header; wrapped.
- `Facts` (engineering-ui), `<dl>` blocks in ~30 components, unit page, project page: module-specific. Not migrated in MOB-04 (out of scope, §4).
- Action menus: `RecordActionSheet` (MOB-03) and per-module dropdowns. Unified behind `EntityActionSheet`.

## Confirmation
`ConfirmDialog` (69 uses) is the only destructive-confirm pattern. Now docks to the bottom on a phone.

## Duplication identified
Per-module `<dl>` grids restating label/value markup, hand-made sticky bars (timesheets, daily logs, meetings, announcements), preloaded relation `<select>`s. Migration guidance is in mobile-detail-pages.md and mobile-forms.md.
