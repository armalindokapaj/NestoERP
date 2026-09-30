# Mobile forms (MOB-04 §15-§56, §77-§89)

Same routes, same `RecordForm`, same server actions and schemas on every width.

- **Actions**: `RecordForm` renders its Save/Cancel in `StickyActions` on a phone (pinned above the safe area; the bottom navigation hides while it is present) and in the page flow from `md`. Inside a dialog it stays in the dialog's own flow (`useInDialog`).
- **Grid/sections**: `FormGrid`, `FormSection` (collapsible; an invalid submit opens a section holding an error and focuses the first error).
- **Validation**: the shared contract. Errors sit beside the field; `FormErrorSummary` after a failed submit; server field errors map onto fields; entered values survive a failed save; a dropped connection is reported as "unconfirmed", never as saved.
- **Keyboards**: `inputPropsFor(kind)` (email, tel, url, search, decimal, integer). No `type=number` for money or measurements. 16px input font is already global.
- **`UnitInput`**: number with a unit/currency adornment outside the value.
- **`RelationSelector`**: sheet with search; small `options` or server `load(query, cursor)`; hidden input carries the id; `locked` for a context-prefilled relation. The action behind `load` must return only records the user may reference.
- **`FormSteps`**: inside a `RecordForm`; all steps stay mounted so one submit, the unsaved guard and validation are unchanged. "Step 2 of 4 · Financial" + progress bar; Next checks the step's native constraints.
- **`UploadField`** (choose file / take photo, preview, size, remove) and **`UploadProgress`** (per-file state, retry, remove). Document files use the canonical upload queue; a captured file is not an attachment until the server accepts it.
- **`ConfirmAction`**: confirmation with `run()`; double-tap protected; a refusal stays in the dialog.
- **Drafts/autosave/optimistic UI**: unchanged; MOB-04 adds none. Full offline is MOB-09.

## Adoption so far
- `RecordForm` actions: every `RecordForm` page (sticky on phone).
- `RelationSelector`: the Client field of the sales opportunity form (preloaded scoped `options`; a large set should pass `load(query, cursor)` over an authorized endpoint).
- `ConfirmAction`: unit delete (unit page). A refusal now stays in the dialog instead of a toast.
- `EntityActionSheet`: the unit publishing `...` menu (Unpublish, Restore, Archive last, destructive).
- Not adopted anywhere yet (available for the next module): `FormSteps`, `UploadField`/`UploadProgress`, `UnitInput`. Document files must keep using the canonical upload queue.

## Tests
- Unit: tests/unit/forms/mob04-detail-forms.test.ts, mob04-form-components.test.ts.
- E2E (viewport matrix): aud04-mob04-forms.spec.ts (pinned actions, error focus, unsaved prompt), aud04-mob04-scenarios.spec.ts (unit, task, employee, document, finance, project, employee field-level, relation selector, axe on forms and project overview).
