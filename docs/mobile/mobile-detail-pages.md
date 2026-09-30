# Mobile detail pages (MOB-04 §6-§12, §57, §66-§76)

`components/detail/`

- `EntityDetailPage`: breadcrumbs, title, status, `actions` (header slot), `primaryAction` (pinned to the bottom of a phone in `StickyActions`, in the header from `md`), sections as children, optional `aside` (second column from `lg`). One column with hierarchy on a phone; DOM order never changes.
- `DetailSection`: titled group, optional contextual `action`, `empty`/`emptyLabel`, `collapsible` (native `<details>`) for secondary or system information.
- `DetailField` / `DetailFieldList`: label + value by `kind` (text, link, status, date, money, person, relation, email, phone, external). Missing value is an em dash. `copy` is opt-in. Money keeps its exact figure (`figure`). A `null`/`false` field is dropped, so a field the reader may not see is never rendered.
- `EntityActionSheet`: the `...` control. Bottom sheet on a phone, dropdown from `md`, same action list. Destructive last. Renders nothing for an empty list.

## Rules
1. Build the action list from canonical action resolution (permission, state, module); pass only what the reader can do. Never disable-to-advertise.
2. A state transition action calls the module's canonical transition; never write a status.
3. Read-only readers get this page, not a disabled form.
4. Field-level restrictions: leave the field out of `fields`; do not rely on the value being absent from the payload.
5. Related records: link to a filtered list; do not embed large tables.
6. Not found vs no access: keep the canonical 404 semantics; do not leak.

Migrated: the shared module record page (`ModuleRecordPage`, /support/*). Others adopt as their modules are redesigned (Projects: MOB-05).
