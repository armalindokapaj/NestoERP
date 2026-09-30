# Responsive data view (MOB-03)

One `DataTable` serves every list. Desktop renders the table; phones render the
same rows as records. There is no separate mobile list, route or API.

- **Columns** declare a `priority` (`primary`, `secondary`, `detail`). Primary is
  the card title; secondary become fact lines; detail sits behind "Show details".
- **Presentation** is chosen by `mobile` on `DataTable`: `card` (default, rich
  records) or `row` (dense: title, one line, status). Above `md` the table shows.
- **Never sideways**: no page-level horizontal scroll at 320px. Money and
  quantities keep their exact figure and currency and never truncate.
- **Whole-card link**: the title is a link stretched over the card
  (`after:absolute after:inset-0`); actions and the selection checkbox sit above it.
- **Loading / empty / error** reuse the MOB-01 states; skeletons match the record.

Migrated lists: tasks, team, documents, finance invoices, project units.
Projects grid is MOB-05's.

## Migrating another list
1. Give each column a `priority`.
2. Pass `mobile={{ title, subtitle, status, value, facts, actions }}` (see
   `components/tasks/task-table.tsx`).
3. Keep row actions in one `RecordActionSheet` so phone and desktop menus list the same actions.
4. Add the list to `tests/e2e/responsive/aud04-mob03-data.spec.ts`.
