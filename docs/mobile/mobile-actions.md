# Mobile actions (MOB-04 §11, §12, §61-§64, §79-§81)

- Primary action: one, visible (`primaryAction` on `EntityDetailPage`, pinned on a phone).
- Secondary: `EntityActionSheet`. Destructive: last, danger colour, opens `ConfirmAction` (dock-to-bottom on phone, centred from `sm`).
- Confirmation wording states the consequence ("This action cannot be undone."). Typing a name is reserved for high-risk entities.
- Authorization is never the UI: hiding an action is presentation; the server checks again.
- State machines: actions come from the current state and permissions and call the canonical transition. Financial, legal and state-machine actions wait for the server (no optimistic UI).
- Duplicate taps: the button is disabled while the request runs (`RecordForm` pending, `ConfirmAction` in-flight guard); critical workflows also use server idempotency.
