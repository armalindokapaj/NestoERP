# Unsaved-work coverage manifest

AUD-03 §10 requires every editable surface to either take part in the
unsaved-work contract ([unsaved-work.md](unsaved-work.md),
[ADR 0018](adr/0018-unsaved-work-protection.md)) or be excluded here with a
reason. A new editor adds its row in the same change.

**Totals (26 September 2026):** 371 surfaces — 277 migrated, 94 excluded (no
input, read-only, confirmations, or a filter that only rebuilds a URL) — plus
one shared helper row, and the design-level exclusions below.

**Keys.** Departure paths: *nav* = links, the sidebar, search, the bell and
the guarded router; *history* = Back/Forward; *dialog-close* = X, Escape,
backdrop; *cancel* = the editor's own Cancel; *workspace* = a workspace switch,
here or in another tab; *identity* = sign-out, the demo user switch, another
person signing in; *in-place* = a tab, selection or view swap that destroys
the editor. Every registered editor also gets *reload* (the one
`beforeunload`) from the host. Save adapters: *RecordForm* and
*useEditorSave* for native forms whose action returns `committed(href)`;
*FormDialog* / *ReasonDialog* (`components/engineering/form-kit.tsx`) and
*useRequestEditor* for API-backed dialogs; *useUnsavedEditor* directly, or
*UnsavedValue*, for controlled editors; *saveKind "none"* marks a workflow step
the prompt never runs.

**Excluded by design, across modules**

| Surface | Reason |
|---|---|
| The 3D Experience Editor (`components/3d/**`, `app/(experience-editor)`, `/projects/:id/3d`) | Owned by another workstream; it keeps its own save model. |
| Sign-in, invitation acceptance, password reset, the public site | Outside the application shell: no session, nothing to lose to a workspace or identity change. |
| Quick Create's pickers | A launcher: it chooses a form to open and holds no values of its own. Its launch asks about the page it leaves. |
| List filters, search boxes, sort and view toggles | They only rebuild a URL; the query is the state. |
| Confirmation dialogs (archive, delete, restore) and single-click commands | No input to lose. |

## Lead — foundation, shell and shared editors

| Surface (route → component) | Module | Editor type | Save adapter | Departure / dismiss paths | Risk | Coverage |
|---|---|---|---|---|---|---|
| Application shell → `UnsavedHost` (prompt, freeze notice, `beforeunload`, history guard, fetch header, identity channel) | shell | host | — | all | high | migrated |
| Platform administration layout → `UnsavedHost` (no workspace) | platform | host | — | nav, history, identity, reload | medium | migrated |
| Sidebar, breadcrumbs, search, bell, record navigation → `NavLink`, guarded `useRouter`, record-navigation provider | shell | navigation | — | nav | high | migrated |
| Workspace header, choose-company, company links, notification "enter company" → `requestWorkspaceSwitch` | shell | navigation | approval passed through; `prior` for a later step | workspace | high | migrated |
| Another tab's workspace switch → `WorkspaceSync` | shell | context | freeze while dirty, reload while clean | workspace | high | migrated |
| User menu logout, `SignOutButton`, "sign out everywhere", demo user switch | shell | identity | asks, then announces on the identity channel | identity | high | migrated |
| Quick Create → launch and company switch | shell | launcher | navigate approval, `prior` on the switch | nav, workspace | medium | migrated |
| Panel frame reload | shell | navigation | reload intent | reload | low | migrated |
| Every `Dialog` / `Drawer` → `GuardedRoot` (`locked` while its request runs) | shared | dialog root | dismiss(scope) | dialog-close, cancel | high | migrated |
| Document downloads → `startDownload` | documents | download | one unload let through | reload | low | migrated |
| `RecordForm` (every module's record pages) | shared | record-form | useEditorSave → `committed(href)` actions | nav, history, cancel, workspace, identity | high | migrated |
| /clients/new, /clients/[id]/edit → ClientForm (duplicate warning = decision) | clients | custom-form | useEditorSave → create/updateClientAction | nav, history, cancel, workspace, identity | high | migrated |
| /projects/new, /projects/[id]/edit → ProjectForm | projects | custom-form | useEditorSave → create/updateProjectAction | nav, history, cancel, workspace, identity | high | migrated |
| /tasks/new, /tasks/[id]/edit → TaskForm, TaskEditForm (version conflict = conflict) | tasks | record-form | RecordForm → create/updateTaskAction | nav, history, cancel, workspace, identity | high | migrated |
| /tasks/[id] → TaskActions › block dialog | tasks | workflow-only | UnsavedValue (none, "Mark blocked") | dialog-close, cancel | medium | migrated |
| Record headers → AssignMemberControl | shared | workflow-only | UnsavedValue (none, "Assign"); Cancel is `DialogClose` | dialog-close, cancel | low | migrated |
| HSE record actions → `useRunner` | hse | commands | a thrown request reports "outcome unknown" | — | medium | migrated |

## P1 — Sales, contracts and legal, client contacts, pricing, unit sales/finance/legal

Departure keys: nav = links/router, history = Back/Forward, dialog-close = X/Escape/backdrop, cancel = in-editor Cancel, workspace = workspace switch, identity = sign-out/user switch. Every registered editor gets nav/history/workspace/identity from the coordinator; the column lists the ones that apply to the surface.

| Surface (route → component) | Module | Editor type | Save adapter | Departure / dismiss paths | Risk | Coverage |
|---|---|---|---|---|---|---|
| /clients/new, /clients/[id]/edit → ClientForm | clients | custom-form | useEditorSave → createClientAction / updateClientAction (committed) | nav, history, cancel, workspace, identity | medium-high | migrated (by lead, before P1) |
| /clients/[id]/contacts → ContactList › ContactDialog/ContactForm | clients | dialog-form | useEditorSave → createContactAction / updateContactAction (already result-returning) | dialog-close, cancel (DialogClose), nav, history, workspace, identity | medium | migrated |
| /clients/[id] → ClientActions (archive/restore) | clients | excluded | — | — | none | excluded: ConfirmDialog buttons, no input |
| /clients, /clients/{all,active,archived} → clients-list, ClientTable; client-tabs | clients | excluded | — | — | none | excluded: read-only list / tab links |
| /contracts/new → ContractForm | contracts | record-form | RecordForm → createContractAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /contracts/[id]/edit → ContractForm / ContractMetadataForm | contracts | record-form | RecordForm → updateContractAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /contracts/[id]/amendments/new, …/[amendmentId]/edit → AmendmentForm | contracts | record-form | RecordForm → saveAmendmentAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /contracts/[id] → ContractActions › MarkSignedDialog | contracts | dialog-form (controlled) | useUnsavedEditor via DialogEditor (none, workflow "Record as signed"); thrown action → unresolved | dialog-close, cancel (DialogClose), nav, history, workspace, identity | medium | migrated |
| /contracts/[id] → ContractActions › TerminateDialog | contracts | dialog-form (controlled) | DialogEditor (none, workflow "Terminate") | dialog-close, cancel (DialogClose) | medium | migrated |
| /contracts/[id] → ContractActions › RejectDialog ×3 (reject, return to draft, cancel) | contracts | workflow-only | shared components/finance/reject-dialog.tsx (already registers workflow-only) | dialog-close, cancel | low | migrated (shared primitive, other owner) |
| /contracts/[id] → ContractActions › AssignMemberControl (owner) | contracts | dialog-form (1 select) | components/modules/assign-member-control.tsx — not in P1 | dialog-close, cancel | low | migrated (shared primitive, by the lead: registers workflow "Assign", Cancel is `DialogClose`) |
| /contracts/[id] → ContractActions › ConfirmDialogs (expire, archive), lifecycle buttons | contracts | excluded | — | — | none | excluded: buttons / confirm, no input |
| /contracts/[id]/amendments/[amendmentId] → AmendmentActions › SignedDialog | contracts | dialog-form (controlled) | DialogEditor (none, workflow "Record as signed") | dialog-close, cancel (DialogClose) | low | migrated |
| /contracts/[id]/amendments/[amendmentId] → AmendmentActions › RejectDialog ×2, ConfirmDialog | contracts | workflow-only | shared RejectDialog | dialog-close, cancel | low | migrated (shared primitive) / confirm excluded |
| /contracts/[id]/obligations → ContractObligationList › ObligationDialog/ObligationForm | contracts | dialog-form | useEditorSave → saveObligationAction (save/create) | dialog-close, cancel (DialogClose), nav, history, workspace, identity | medium | migrated |
| /contracts/[id]/obligations → TaskDialog/TaskForm | contracts | dialog-form | useEditorSave → createObligationTaskAction (create) | dialog-close, cancel (DialogClose) | medium | migrated |
| /contracts/[id]/obligations → complete/cancel obligation buttons | contracts | excluded | — | — | none | excluded: buttons, no input |
| /contracts/[id]/parties → ContractPartyList › PartyDialog/PartyForm | contracts | dialog-form | useEditorSave → saveContractPartyAction (save/create; field errors via save.fieldErrors) | dialog-close, cancel (DialogClose) | medium | migrated |
| /contracts/[id]/parties → remove party ConfirmDialog | contracts | excluded | — | — | none | excluded: confirm, no input |
| /contracts/approvals → ContractApprovalQueue | contracts | workflow-only | shared RejectDialog; approve = button | dialog-close, cancel | low | migrated (shared primitive) |
| /contracts/requests → ContractRequestQueue › FieldsDialog (decline) | contracts | workflow-only | FieldsDialog → DialogEditor (none, workflow "Decline") | dialog-close, cancel (DialogClose) | low | migrated |
| /contracts/* lists, reports, review, contract-table/kpis/activity/approval-history/export-link/record-documents/sales-handoff | contracts | excluded | — | — | none | excluded: read-only |
| /projects/[id]/units/[unitId]/legal → UnitLegalPanel › CreateContractDialog (number, title, units, per-unit value/note rows) | units | dialog-form + grid (controlled) | FormDialog save {kind: create} → POST /api/project-units/{id}/contracts via the same `draft()` as its button | dialog-close, cancel (DialogClose), nav, history, workspace, identity | high | migrated |
| /projects/[id]/units/[unitId]/legal → UnitValueDialog (FieldsDialog) | units | dialog-form | FieldsDialog saveKind="save" → PATCH /api/contracts/{id}/units/{unitId} | dialog-close, cancel | high (money) | migrated |
| /projects/[id]/units/[unitId]/legal → FieldsDialog ×12 (request, decline, withdraw, submit review/approval, return, mark sent, record signature, activate, complete, cancel, terminate) | units | workflow-only | FieldsDialog → DialogEditor (none, workflow = confirm label) | dialog-close, cancel | medium | migrated |
| /projects/[id]/units/[unitId]/legal → post-save `?action=` cleanup | units | — | panel submit now drops `?action` with history.replaceState (no navigation, so the just-saved dialog is not asked about) | — | low | migrated |
| /projects/[id]/units/[unitId]/sales → UnitSalesPanel › PriceDialog | units | dialog-form (controlled) | FormDialog save {kind: save} → PATCH /api/project-units/{id}/sales (same `send()` as button) | dialog-close, cancel (DialogClose), nav, history, workspace, identity | high (money) | migrated |
| /projects/[id]/units/[unitId]/sales → CorrectDialog | units | dialog-form (controlled) | FormDialog save {kind: save} → POST /api/unit-reservations/{id}/correct (same reason check) | dialog-close, cancel | high (money) | migrated |
| /projects/[id]/units/[unitId]/sales → ReserveDialog (client search, inline new client, deal, expiry, price, notes) | units | dialog-form (controlled, multi-field) | DialogEditor (none, workflow "Reserve"); search text not part of the snapshot | dialog-close, cancel | high | migrated |
| /projects/[id]/units/[unitId]/sales → ReopenDialog; ReasonDialog ×3 (hold, extend, release) | units | workflow-only | DialogEditor (none, workflow = confirm label) | dialog-close, cancel | medium | migrated |
| /projects/[id]/units/[unitId]/sales → FieldsDialog ×3 (ask approval, approve, reject sale) | units | workflow-only | FieldsDialog → DialogEditor (none) | dialog-close, cancel | medium | migrated |
| /projects/[id]/units/[unitId]/sales → ConfirmDialogs (put on / take off sale, release hold, mark sold), "cannot be sold" info dialog | units | excluded | — | — | none | excluded: confirm/info, no input |
| /projects/[id]/units/[unitId]/sales → post-save `?action=` cleanup | units | — | history.replaceState instead of router.replace | — | low | migrated |
| /projects/[id]/units/[unitId]/finance → UnitFinancePanel › ScheduleDialog (installment rows) | finance | grid (controlled) | FormDialog save {kind: save (edit draft) / create (new draft)} → PATCH /api/finance/payment-schedules/{id} or POST /api/contracts/{id}/payment-schedules; added/removed rows are dirty | dialog-close, cancel, nav, history, workspace, identity | high (money) | migrated |
| /projects/[id]/units/[unitId]/finance → PaymentDialog (amount, date, method, reference, notes, allocation rows) | finance | dialog-form + grid | DialogEditor (none, workflow "Record payment"); "Record anyway" only by its button | dialog-close, cancel | high (money) | migrated |
| /projects/[id]/units/[unitId]/finance → AllocateDialog (allocation rows) | finance | grid | DialogEditor (none, workflow "Allocate") | dialog-close, cancel | high | migrated |
| /projects/[id]/units/[unitId]/finance → ActivateDialog, discard, raise invoice, reverse, void (FieldsDialog) | finance | workflow-only | FieldsDialog → DialogEditor (none) | dialog-close, cancel | medium | migrated |
| /projects/[id]/finance/units → FinanceInventory; finance-status, finance-views | finance | excluded | — | — | none | excluded: filter / read-only |
| components/finance/unit-finance/fields-dialog.tsx › FieldsDialog (primitive) | units | dialog-form primitive | registers through FormDialog; optional saveKind for ordinary saves, otherwise workflow-only | dialog-close, cancel | medium | migrated |
| components/sales/unit-sales/unit-sales-dialogs.tsx › FormDialog (primitive), useDialogRequest | units | dialog-form primitive | DialogEditor inside DialogContent (dirty from `useOpenedWith`, saving = request pending, unresolved = thrown/NETWORK); Cancel → DialogClose; request tracks `done`/`unresolved` | dialog-close, cancel | high (one place) | migrated |
| /sales/leads/new, /sales/leads/[id]/edit → LeadForm | sales | record-form | RecordForm → createLeadAction / updateLeadAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /sales/leads/[id]/convert → ConvertLeadForm | sales | workflow-only (full page) | WorkflowForm → useEditorSave (none, workflow "Convert") → convertLeadAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /sales/opportunities/new, …/[id]/edit → OpportunityForm | sales | record-form | RecordForm → createOpportunityAction / updateOpportunityAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /sales/opportunities/[id]/won → WonForm | sales | workflow-only (full page) | WorkflowForm (none, workflow "Mark won") → markWonAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /sales/opportunities/[id]/lost → LostForm | sales | workflow-only (full page) | WorkflowForm (none, workflow "Mark lost") → markLostAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /sales/opportunities/[id]/project → LinkProjectForm | sales | custom-form (1 select) | useEditorSave → linkProjectAction, adapted to committed(cancelHref) | nav, history, cancel (guarded router), workspace, identity | low | migrated |
| /sales/proposals/new, …/[id]/edit → ProposalForm (+ PricedLineItems, named `lineItems[i].*` inputs) | sales | record-form + grid | RecordForm → createProposalAction / updateProposalAction (committed) | nav, history, cancel, workspace, identity | medium (money) | migrated |
| /sales/pipeline → PipelineBoard stage select | sales | excluded | changeStageAction on change | — | low | excluded: immediate one-field write, nothing held locally |
| sales lead/opportunity/proposal detail → LeadActions, OpportunityActions, ProposalActions | sales | workflow-only / excluded | RejectDialog (shared, registered); AssignMemberControl (components/modules, migrated by the lead); ConfirmDialogs | dialog-close, cancel | low | migrated via shared RejectDialog; AssignMemberControl not in P1; confirms excluded |
| /sales, /sales/{leads,opportunities,proposals,reports,tasks} lists; group-company-filter; sales-inventory; deal-units; deal-unit-remove; tables/kpis/export/activity/record-documents | sales | excluded | — | — | none | excluded: read-only / filter / confirm |
| /platform-admin/pricing → PricingAdministration › CreateDraft/CreateDraftForm | pricing | dialog-form | useEditorSave (create) → POST /api/platform/pricing/versions (refusal → result; network → thrown/unknown) | dialog-close, cancel (DialogClose), nav, history, identity | medium | migrated |
| /platform-admin/pricing → PricingVersionEditor (price-book config, effective date) | pricing | controlled | useUnsavedEditor (save) → PATCH /api/platform/pricing/versions/{id}, same `save()` as Save draft; rebaselined only on success | nav, history, identity | high (money) | migrated |
| /platform-admin/pricing → PricingVersionEditor › Publish dialog (reason) | pricing | workflow-only | DialogEditor (none, workflow "Publish") | dialog-close, cancel (DialogClose) | medium | migrated |
| /platform-admin/pricing → PromotionEditor | pricing | controlled | useUnsavedEditor (save) → PATCH /api/platform/pricing/promotions/{id} | nav, history, identity | medium | migrated |
| /pricing (public site) → PricingWizard, ProposalDialog (lead form) | pricing | excluded | — | — | medium | excluded: public page outside AppShell (no host); configurator state is mirrored to the URL |

## P2 — Finance, procurement, inventory

Departure paths: nav = link/sidebar/router.push, history = Back/Forward, dialog-close = X/Escape/backdrop/Cancel in a dialog, cancel = in-page Cancel, workspace = workspace switch, identity = sign-out/user switch. Every registered editor also gets reload through the host's beforeunload.

| Surface (route → component) | Module | Editor type | Save adapter | Departure / dismiss paths | Risk | Coverage |
|---|---|---|---|---|---|---|
| /finance/invoices/new, /finance/invoices/[id]/edit → InvoiceForm + PricedLineItems | finance | record-form + grid | RecordForm → createInvoiceAction / updateInvoiceAction (committed) | nav, history, cancel, workspace, identity | high | migrated (the line rows were already named `lineItems[i].field`, so adding or removing a row changes the snapshot, and add-then-remove is clean) |
| /finance/budgets/new, /finance/budgets/[id]/edit → BudgetForm + BudgetLineItems | finance | record-form + grid | RecordForm → createBudgetAction / updateBudgetAction (committed) | nav, history, cancel, workspace, identity | high | migrated (named rows, as above) |
| /finance/expenses/new, /[id]/edit → ExpenseForm | finance | record-form | RecordForm → createExpenseAction / updateExpenseAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /finance/commitments/new, /[id]/edit → CommitmentForm | finance | record-form | RecordForm → createCommitmentAction / updateCommitmentAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /finance/payments/new → PaymentForm | finance | record-form | RecordForm → recordPaymentAction (committed to the invoice or expense); saveKind create inferred from "Record …" | nav, history, cancel, workspace, identity | high | migrated |
| /finance/settings → FinanceSettingsForm | finance | custom-form | useEditorSave → updateFinanceSettingsAction (onCommitted: toast + refresh, stays on the page) | nav, history, workspace, identity | medium | migrated |
| components/finance/reject-dialog.tsx → RejectDialog (shared primitive) | route module | workflow-only (dialog) | useUnsavedEditor (none, workflow = confirmLabel, "Reject" by default) registered inside the dialog; no save adapter | dialog-close (the X, Escape, the backdrop, and Cancel through useDialogClose), nav, history, workspace, identity | medium | migrated. A refused close keeps the reason. Closing mid-submit asks, because the dialog is saving. A thrown step → unresolved + "couldn't confirm". Every caller inherits this (finance, procurement, contracts, hr, hse, sales, qaqc). |
| /finance/{invoices,expenses,budgets,commitments}/[id] → FinanceRecordActions | finance | workflow-only (via RejectDialog) + ConfirmDialog | RejectDialog (none, workflow Reject) | dialog-close | low | migrated (through the primitive; ConfirmDialog has no input) |
| /finance/approvals → ApprovalQueue | finance | workflow-only (via RejectDialog) | RejectDialog (none, workflow Reject) | dialog-close, nav | low | migrated (through the primitive) |
| payment tables (/finance/payments, invoice and expense detail) → VoidPaymentButton | finance | workflow-only (via RejectDialog) | RejectDialog (none, workflow "Void payment") | dialog-close | low | migrated (through the primitive) |
| /finance/budgets/[id]/revise → ReviseBudgetForm | finance | excluded | — | — | — | excluded: one button, no input (reviseBudgetAction still redirects) |
| invoice-from-proposal-button, proposal-invoice-handoff | finance | excluded | — | — | — | excluded: button-only (invoiceFromProposalAction still redirects) |
| register-filters, register-results, register-export-button, register-summary | finance | excluded | — | — | — | excluded: read-only filters and export (URL sync only) |
| budget-actions, invoice-actions, expense-actions, commitment-actions | finance | excluded | — | — | — | excluded: wrappers that pass actions into FinanceRecordActions |
| approval-history, budget-risk-badge, budget/commitment/expense/invoice/payment tables, group-rows, money, record-documents; app finance lists, group overview, reports | finance | excluded | — | — | — | excluded: read-only |
| components/finance/unit-finance/** | finance | — | — | — | — | excluded: another agent owns it |
| /procurement/suppliers/new, /[id]/edit → SupplierForm | procurement | record-form | RecordForm → createSupplierAction / updateSupplierAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /procurement/requests/new, /[id]/edit → RequestForm + LineItemsEditor | procurement | record-form + grid | RecordForm → createRequestAction / updateRequestAction (committed) | nav, history, cancel, workspace, identity | high | migrated (rows already named `items[i][field]`) |
| /procurement/rfqs/new, /[id]/edit → RfqForm + LineItemsEditor + supplier checkboxes | procurement | record-form + grid | RecordForm → createRfqAction / updateRfqAction (committed) | nav, history, cancel, workspace, identity | high | migrated (the checkboxes write hidden `supplierIds` inputs in list order, so ticking and unticking comes back clean) |
| /procurement/orders/new, /[id]/edit → OrderForm + LineItemsEditor | procurement | record-form + grid | RecordForm → createOrderAction / updateOrderAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /procurement/rfqs/[id]/quotes → QuoteForm | procurement | custom-form + grid | useEditorSave → recordQuoteAction (create); the client adds redirectTo …/comparison | nav, history, workspace, identity | high | migrated |
| /procurement/orders/[id]/receipts → ReceiptForm | procurement | custom-form + grid | useEditorSave → recordReceiptAction (create). OVER_RECEIPT is classified as a decision; the acknowledgement checkbox is ignored for dirtiness. The form remounts after its own committed save, once the refreshed order arrives | nav, history, workspace, identity | high | migrated |
| /procurement/approvals/limits → ApprovalPolicyForm | procurement | custom-form | useEditorSave → PUT /api/procurement/approval-policy (the inputs are named now) | nav, history, workspace, identity | medium | migrated |
| /procurement/rfqs/[id] → InviteSupplierControl | procurement | workflow-only (dialog, one select) | useUnsavedEditor (none, workflow Invite) inside the dialog | dialog-close (the X, Escape, the backdrop, Cancel via DialogClose) | low | migrated |
| /procurement/rfqs/[id]/comparison → QuoteComparison | procurement | workflow-only (RejectDialog: Disqualify) + ConfirmDialog | RejectDialog (none, workflow Disqualify) | dialog-close | low | migrated (through the primitive; orderFromQuoteAction is a button and still redirects) |
| order/request/rfq detail → OrderActions, RequestActions, RfqActions | procurement | workflow-only (RejectDialog: reject, cancel, close notes) + ConfirmDialog | RejectDialog (none, workflow = confirm label) | dialog-close | low | migrated (through the primitive) |
| /procurement/orders/[id]/receipts → ReceiptList | procurement | workflow-only (RejectDialog: Void delivery); hosts ProcurementHandoff | RejectDialog (none, workflow "Void delivery") | dialog-close | low | migrated (through the primitive) |
| /procurement/approvals → ProcurementApprovalQueue | procurement | workflow-only (RejectDialog) | RejectDialog (none, workflow Reject) | dialog-close, nav | low | migrated (through the primitive) |
| supplier-actions | procurement | excluded | — | — | — | excluded: ConfirmDialog only, no input |
| approval-history, company-cells, tables, kpis, formatters; app procurement lists and reports | procurement | excluded | — | — | — | excluded: read-only |
| /inventory/{receipts,issues,returns,transfers,adjustments}/new, /[id]/edit → DocumentForm + StockLinesEditor | inventory | record-form + grid | RecordForm → createDocumentAction / updateDocumentAction (committed); saveKind create on new ("Save draft") | nav, history, cancel, workspace, identity | high | migrated (rows already named `lines[i][field]`) |
| /inventory/items/new, /[id]/edit → ItemForm | inventory | record-form | RecordForm → createItemAction / updateItemAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /inventory/warehouses/new, /[id]/edit → WarehouseForm | inventory | record-form | RecordForm → createWarehouseAction / updateWarehouseAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /inventory/warehouses/[id], /[id]/locations → LocationList "Add a location" | inventory | dialog-form | useEditorSave → createLocationAction (create), inside the dialog; Cancel through DialogClose | dialog-close, nav | low | migrated |
| /inventory/reservations/new → ReservationForm | inventory | custom-form | useEditorSave → createReservationAction (create); the client adds redirectTo /inventory/reservations | cancel (guarded router.push), nav, history, workspace, identity | medium | migrated |
| /procurement/orders/[id]/receipts → ProcurementHandoff (inline, per delivery) | inventory | custom-form + grid | useEditorSave → postFromGoodsReceiptAction (committed → /inventory/receipts/:id, create); Cancel through editor.requestDismiss | cancel, nav, history, workspace, identity | medium | migrated |
| document-actions, item-actions, reservation-actions, warehouse-actions | inventory | excluded | — | — | — | excluded: ConfirmDialog only (post/cancel/reverse/archive/release) |
| document-list, document-lines-table, document-tables, item/stock/movement/reservation/warehouse tables, kpis, export-link, record-activity, record-documents, stock-level-badge; app inventory lists, reports, low-stock, movements | inventory | excluded | — | — | — | excluded: read-only (record-documents wraps components/documents, which another agent owns) |
| CollaborationPanel on finance/procurement/inventory detail pages | collaboration | composer | — | — | — | excluded here: the collaboration partition owns it |

## P3 — HSE and QA/QC

Departure paths: nav = links and programmatic push, history = Back/Forward, dialog-close = X/Escape/backdrop/Cancel of a dialog, cancel = the form's own Cancel, workspace = workspace switch, identity = sign-out or user switch. The shell supplies reload/beforeunload for every registered editor.

| Surface (route → component) | Module | Editor type | Save adapter | Departure / dismiss paths | Risk | Coverage |
|---|---|---|---|---|---|---|
| /hse/hazards/new, /hse/hazards/:id/edit → `hse/hse-forms.tsx` HazardForm | hse | record-form | RecordForm → createHazardAction / updateHazardAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /hse/incidents/new, /:id/edit → `hse/hse-forms.tsx` IncidentForm | hse | record-form | RecordForm → createIncidentAction / updateIncidentAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /hse/inspections/new, /:id/edit → `hse-forms.tsx` InspectionForm | hse | record-form | RecordForm → createInspectionAction / updateInspectionAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /hse/permits/new, /:id/edit → PermitForm | hse | record-form | RecordForm → createPermitAction / updatePermitAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /hse/actions/new, /:id/edit → ActionForm | hse | record-form | RecordForm → createHseActionAction / updateHseActionAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /hse/environment/new, /:id/edit → ObservationForm | hse | record-form | RecordForm → createObservationAction / updateObservationAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /hse/stop-work/new → StopWorkForm | hse | record-form | RecordForm (saveKind create, set explicitly because the label is "Stop work") → createStopWorkAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /hse/risk-assessments/new, /:id/edit → `hse/risk-assessment-form.tsx` (hazard rows) | hse | record-form + grid | RecordForm → createRiskAssessmentAction / updateRiskAssessmentAction (committed). Rows are named `items[i][…]`, so adding or removing a row changes the snapshot | nav, history, cancel, workspace, identity | high | migrated |
| /hse/templates/new, /:id/edit → `hse/template-form.tsx` (check rows) | hse | record-form + grid | RecordForm → createTemplateAction / updateTemplateAction (committed). Rows are named `items[i][…]` and the Radix checkboxes carry names | nav, history, cancel, workspace, identity | high | migrated |
| /hse/toolbox-talks/new, /:id/edit → `hse/toolbox-form.tsx` (participant rows) | hse | record-form + grid | RecordForm → createToolboxTalkAction / updateToolboxTalkAction (committed). Rows are named `participants[i][…]` | nav, history, cancel, workspace, identity | medium | migrated |
| /hse/ppe/new, /hse/ppe/:id/edit → `hse/ppe-form.tsx` | hse | record-form | RecordForm → createPpeCheckAction / updatePpeCheckAction (committed to /hse/ppe) | nav, history, cancel, workspace, identity | medium | migrated |
| /hse/hazards/:id/assess → `hse/hazard-panels.tsx` HazardAssessForm | hse | record-form | RecordForm → assessHazardAction (answers ok with no destination, so the form stays) | nav, history, cancel, workspace, identity | medium | migrated |
| /hse/hazards/:id/control → HazardControlForm | hse | record-form | RecordForm (saveKind save, set explicitly: "Record control" would otherwise infer create) → controlHazardAction (answers ok, stays) | nav, history, cancel, workspace, identity | medium | migrated |
| /hse/hazards/:id/close → HazardCloseForm | hse | workflow-only (custom form) | useEditorSave (none, workflow "Close hazard") → closeHazardAction | nav, history, cancel, workspace, identity | medium | migrated |
| /hse/incidents/:id/investigation → `hse/investigation-form.tsx` | hse | record-form | RecordForm → recordInvestigationAction (answers ok, stays) | nav, history, cancel, workspace, identity | medium-high | migrated |
| /hse/actions/:id/task → `hse/task-form.tsx` | hse | record-form | RecordForm → createHseTaskAction (answers ok, stays) | nav, history, cancel, workspace, identity | low | migrated |
| /hse/inspections/:id/execute → `hse/checklist-executor.tsx` | hse | grid (custom form) | useEditorSave (save, "Save checklist") → executeInspectionAction. A normal save shows a toast and refreshes; Save and continue only saves | nav, history, workspace, identity (it has no Cancel) | high | migrated |
| /hse/inspections/:id → `hse/checklist-executor.tsx` (readOnly) | hse | excluded | none | none | none | excluded: read-only (no form rendered, so the registration stays clean) |
| /hse/inspections/:id/execute → `hse/submit-inspection.tsx` | hse | workflow-only (custom form) | useEditorSave (none, workflow "Submit for approval") → submitInspectionAction (committed → /hse/inspections/:id) | nav, history, workspace, identity | medium | migrated |
| /hse/{hazards,inspections,incidents,actions}/:id → `hse/assign-control.tsx` | hse | dialog-form | useUnsavedEditor (none, workflow "Assign") in AssignBody, inside the Dialog. Cancel now uses the guarded useDialogClose | dialog-close | low | migrated |
| /hse/incidents/:id, /hse/permits/:id → `hse/workforce-panels.tsx` IncidentPeople, PermitWorkers | hse | dialog-form | FormDialog (shared form-kit; registers itself; "Add" = create) → POST /api/hse/incidents/:id/people, /api/hse/permits/:id/workers. `module="hse"` passed | dialog-close | low | migrated (by the shared FormDialog) |
| All /hse/*/:id detail pages → `hse/record-actions.tsx` (about 30 reason/note dialogs) | hse | dialog-form (workflow) | RejectDialog (shared, finance partition: useUnsavedEditor none, workflow = confirm label) → lifecycle actions | dialog-close | low-medium | migrated (by the shared RejectDialog); ConfirmDialogs have no input |
| /hse/approvals → `hse/approval-queue.tsx` | hse | dialog-form (workflow) | RejectDialog (shared) → reject*/close* actions | dialog-close | low | migrated (by the shared RejectDialog) |
| Start inspection / start investigation buttons (record-actions) | hse | excluded | startInspectionAction / startInvestigationAction still redirect | none | none | excluded: input-less workflow buttons |
| /hse/templates/:id → `hse/template-actions.tsx` | hse | excluded | none | none | none | excluded: buttons and a ConfirmDialog with no input |
| /hse/reports → `hse/hse-format.tsx` RiskMatrix (raw `<a href>`) | hse | excluded | none | none | none | excluded: read-only report page with no editor. A raw link is a full load that beforeunload covers |
| hse-list, hse-tables, hse-kpis, export-link, record-activity, record-documents, gap-labels | hse | excluded | none | none | none | excluded: read-only or link-only (list filters are links) |
| /qaqc/requests/new, /:id/edit → `qaqc/qaqc-forms.tsx` RequestForm | qaqc | record-form | RecordForm → createRequestAction / updateRequestAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /qaqc/inspections/new, /:id/edit → InspectionForm | qaqc | record-form | RecordForm → createInspectionAction / updateInspectionAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /qaqc/defects/new, /:id/edit → DefectForm | qaqc | record-form | RecordForm → createDefectAction / updateDefectAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /qaqc/ncrs/new, /:id/edit → NcrForm | qaqc | record-form | RecordForm → createNcrAction / updateNcrAction (committed) | nav, history, cancel, workspace, identity | high | migrated |
| /qaqc/corrective-actions/new, /:id/edit → CorrectiveActionForm | qaqc | record-form | RecordForm → createActionAction / updateActionAction (committed) | nav, history, cancel, workspace, identity | medium | migrated |
| /qaqc/templates/new, /:id/edit → `qaqc/template-form.tsx` (check rows) | qaqc | record-form + grid | RecordForm → createTemplateAction / updateTemplateAction (committed). Rows are named `items[i][…]` | nav, history, cancel, workspace, identity | high | migrated |
| /qaqc/defects/:id/escalate → inline RecordForm in the page | qaqc | record-form | RecordForm ("Raise NCR" → create) → escalateDefectAction (committed → /qaqc/ncrs/:newId) | nav, history, cancel, workspace, identity | low | migrated |
| /qaqc/inspections/:id/reinspect → inline RecordForm in the page | qaqc | record-form | RecordForm ("Raise reinspection" → create) → createReinspectionAction (committed) | nav, history, cancel, workspace, identity | low-medium | migrated |
| /qaqc/inspections/:id/execute → `qaqc/checklist-executor.tsx` | qaqc | grid (custom form) | useEditorSave (save, "Save answers") → saveChecklistAction. A normal save shows a toast and refreshes | nav, history, workspace, identity | high | migrated |
| /qaqc/inspections/:id/execute → `qaqc/checklist-executor.tsx` (readOnly) | qaqc | excluded | none | none | none | excluded: read-only |
| /qaqc/inspections/:id/execute → `qaqc/submit-inspection.tsx` | qaqc | workflow-only (custom form) | useEditorSave (none, workflow "Submit for approval") → submitInspectionAction (answers ok; onCommitted pushes to the inspection, as before) | nav, history, workspace, identity | medium | migrated |
| /qaqc/inspections/:id → `qaqc/material-panel.tsx` DecisionForm | qaqc | custom-form | useEditorSave (create, "Record decision") → recordMaterialDecisionAction. The balance rule is applied in the adapter too. Remounted after each commit | nav, history, workspace, identity | medium | migrated |
| /qaqc/inspections/:id → `material-panel.tsx` release/revoke dialogs | qaqc | dialog-form (workflow) | RejectDialog (shared) → releaseMaterialAction / revokeReleaseAction | dialog-close | low | migrated (by the shared RejectDialog) |
| /qaqc/inspections/:id → `material-panel.tsx` Remove decision | qaqc | excluded | removeMaterialDecisionAction | none | none | excluded: input-less button |
| /qaqc/requests/:id → `qaqc/assign-control.tsx` (via request-actions) | qaqc | dialog-form | useUnsavedEditor (none, workflow "Assign") in AssignBody; Cancel uses useDialogClose | dialog-close | low | migrated |
| qaqc detail pages → `qaqc/inspection-actions.tsx`, `record-actions.tsx`, `request-actions.tsx` | qaqc | dialog-form (workflow) | RejectDialog (shared) and ConfirmDialog (no input) → lifecycle actions | dialog-close | low | migrated (by the shared RejectDialog) |
| /qaqc/approvals → `qaqc/approval-queue.tsx` | qaqc | dialog-form (workflow) | RejectDialog (shared) and ConfirmDialog | dialog-close | low | migrated (by the shared RejectDialog) |
| /qaqc/templates/:id → `qaqc/template-actions.tsx` | qaqc | excluded | none | none | none | excluded: buttons and a ConfirmDialog |
| qaqc-list, qaqc-tables, qaqc-kpis, qaqc-format, quality-gate, export-link, record-activity, record-documents; /qaqc/{materials,work,reinspections,reports} | qaqc | excluded | none | none | none | excluded: read-only or filter-only |
| HSE/QAQC detail pages → CollaborationPanel comment composer | collaboration | composer | not in this partition | — | medium | migrated (by P6: the composer registers, save kind "save") |

## P4 — HR, team, people, workforce, timesheets, settings, organization, platform administration

FD = `FormDialog` / `ReasonDialog` from `components/engineering/form-kit.tsx` (migrated by the engineering partition: registers inside the dialog, saveKind inferred from the submit label unless passed). P4 passes `module` and, where the label misleads, `saveKind`.

| Surface (route → component) | Module | Editor type | Save adapter | Departure / dismiss paths | Risk | Coverage |
|---|---|---|---|---|---|---|
| /hr/employees/new → hr/employment-form (EmploymentForm) | hr | record-form | RecordForm → createEmployeeProfileAction (committed; duplicates → decision) | nav, history, workspace, identity, cancel | high | migrated |
| /hr/employees/[id]/employment/edit → hr/employment-form | hr | record-form | RecordForm → updateEmployeeProfileAction (committed) | nav, history, workspace, identity, cancel | high | migrated |
| /hr/employees/[id]/compensation/new → hr/compensation-form | hr | record-form | RecordForm → recordCompensationAction (committed) | nav, history, workspace, identity, cancel | high | migrated |
| /hr/leave/new, /hr/leave/[id]/edit → hr/leave-form | hr | record-form | RecordForm → createLeaveAction / updateLeaveAction (committed) | nav, history, workspace, identity, cancel | medium | migrated |
| /hr/attendance/new, /hr/attendance/[id] → hr/attendance-form | hr | record-form | RecordForm → page action → create/updateAttendanceAction, page returns committed(href) instead of redirect() | nav, history, workspace, identity, cancel | medium | migrated |
| /hr/employees/[id] (+ /employment) → hr/employment-changes ChangeDialog | hr | multistep | useUnsavedEditor (none, workflow Apply); saving while applying, unresolved on a thrown request; one request per review | dialog-close (X/Esc/backdrop/Cancel via useDialogClose, also mid-submit), nav, workspace, identity | high | migrated |
| /hr/employees/[id]/history → hr/employment-history-actions CorrectHistoryRow | hr | dialog-form | useUnsavedEditor (save) → correctEmploymentHistoryAction via same checkValidity + action; no navigation | dialog-close, cancel (useDialogClose), nav, workspace, identity | medium | migrated |
| /hr/employees/[id]/history → hr/employment-history-actions CancelScheduledChange | hr | excluded | — | ConfirmDialog | low | excluded: confirmation only, no input |
| /hr/employees/[id]/leave → hr/leave-balance-form | hr | dialog-form | useEditorSave → setLeaveBalanceAction (inner EntitlementForm inside the dialog) | dialog-close, cancel (useDialogClose), nav, workspace, identity | low | migrated |
| /hr/employees/[id]/documents, /people/[personId] → hr/employee-documents AddDocumentDialog | hr | dialog-form + file-select | FD (saveKind create, module hr); file input now named `file` so a chosen file is dirty | dialog-close, nav, workspace, identity | medium | migrated |
| same → EditDocumentDialog | hr | dialog-form | FD (Save → save) | dialog-close, nav, workspace, identity | medium | migrated |
| same → Verify dialog (FD), Reject / Supersede / Archive (ReasonDialog) | hr | workflow-only | FD / ReasonDialog (none, workflow = label) | dialog-close | low | migrated |
| same → Replace file (immediate upload) | hr | file-select | UnsavedValue saving=true while the new version uploads | nav, workspace, identity (waiting) | low | migrated |
| same → DocumentDrawer, search filter | hr | excluded | — | — | — | excluded: read-only drawer / filter |
| /hr/employees/import → hr/employee-import | hr | multistep file-select | useUnsavedEditor (none, workflow Import): dirty while a checked batch waits, saving while checking/importing, unresolved on a thrown commit | nav, history, workspace, identity | medium | migrated |
| /hr/employees/[id] → hr/request-account | hr | workflow-only | FD (Submit request → none, module hr) | dialog-close | low | migrated |
| /hr/recruitment → hr/recruitment/new-candidate-button | hr | dialog-form | FD (Add candidate → create); router.push to the new candidate moved out of onSubmit to the clean close, skipped while a prompt is open | dialog-close, nav | medium | migrated |
| /hr/recruitment/[id] → hr/recruitment/candidate-actions Edit | hr | dialog-form | FD (Save) | dialog-close | medium | migrated |
| same → Hire (Create employment) | hr | workflow-only | FD saveKind none (label would have inferred create) | dialog-close | medium | migrated |
| same → Request access (Submit request), Reject / Withdraw (ReasonDialog), Select (ConfirmDialog) | hr | workflow-only | FD / ReasonDialog (none) | dialog-close | low | migrated (Select: excluded, confirm only) |
| /hr/leave/[id] → hr/leave-actions | hr | workflow-only | RejectDialog (migrated by finance partition); ConfirmDialog | dialog-close | low | migrated |
| /hr/attendance, /hr/leave → hr/date-range-filter | hr | excluded | — | guarded router push | — | excluded: filter only (router already guarded) |
| /hr/onboarding, /hr/offboarding → hr/progress-actions | hr | excluded | — | — | — | excluded: action buttons, no input |
| /hr/reports?report=organization (GET filter) | hr | excluded | — | — | — | excluded: read-only filter |
| /team/[memberId]/edit → team/member-form | team | record-form | RecordForm → updateMemberAction (committed) | nav, history, workspace, identity, cancel | medium | migrated |
| /team/invite → team/invite-form | team | workflow-only (custom form) | useEditorSave (none, workflow Send) → inviteMemberAction; fields in fieldset; remounted per invitation | nav (Cancel NavLink), history, workspace, identity | medium | migrated |
| /team/[id] → team/member-actions; /team/invitations → team/invitation-list | team | excluded | — | ConfirmDialog | low | excluded: confirmations, no input |
| /people/[personId] → people/work-profile-editor (own + managed) | people | dialog-form | FD (Save) | dialog-close | medium | migrated |
| /people/[personId] → people/person-project-actions AssignProjectButton | people | dialog-form | FD saveKind create (Assign would have inferred none) | dialog-close | low | migrated |
| /people/[personId] → people/person-project-actions RemoveFromProjectButton | people | excluded | — | ConfirmDialog | low | excluded: confirmation only |
| /people/[personId] → people/person-qualifications QualificationDialog | people | dialog-form + file-select | FD (edit → save, add/renew → create); file input named | dialog-close | high | migrated |
| same → ResubmitDialog | people | workflow-only + file | FD (Resubmit → none); file state cleared on close | dialog-close | medium | migrated |
| same → Verify (FD), Reject / Archive (ReasonDialog) | people | workflow-only | FD / ReasonDialog (none) | dialog-close | low | migrated |
| /people/[personId] → people/profile-photo | people | file-select (immediate) | UnsavedValue saving=true while uploading | nav, workspace, identity (waiting) | low | migrated |
| /people (GET filter + person cards) | people | excluded | — | — | — | excluded: read-only filter |
| /workforce/attendance → workforce/attendance-sheet AttendanceSheet | workforce | grid | useUnsavedEditor (save) → same POST /api/workforce/attendance; dirty vs sheet as loaded; unresolved on no answer | nav, history, workspace, identity, "Open sheet" filter | high | migrated |
| /workforce/attendance → "Open sheet" GET filter (page) | workforce | filter | AttendanceSheetFilter: GET submit → guardNavigation + router.push (asks even for the same URL, which also resets drafts) | nav | high | migrated |
| /workforce/trades → workforce/trades-manager Add a trade | workforce | inline-editor | useUnsavedEditor (create) → same POST /api/workforce/trades | nav, workspace, identity | low | migrated |
| same → Rename | workforce | inline-editor | useUnsavedEditor (save) → same PATCH; Cancel and starting another rename use requestDismiss | cancel (in place), nav, workspace, identity | low | migrated |
| same → retire / reorder / delete | workforce | excluded | — | ConfirmDialog | low | excluded: immediate actions |
| /workforce/crews, crews/[id], /projects/[id]/workforce, /people/[id] → workforce/workforce-actions AssignCrew / CrewForm | workforce | dialog-form | FD (Add to crew / Create crew → create, Save → save) | dialog-close | medium | migrated |
| same → AssignProject | workforce | dialog-form | FD saveKind create | dialog-close | medium | migrated |
| same → EndMembership | workforce | workflow-only | FD (End → none) | dialog-close | medium | migrated |
| same → CrewStatusButton | workforce | excluded | — | — | — | excluded: button only |
| /projects/[id]/workforce → workforce/project-inductions | workforce | dialog-form / workflow-only | FD (Record → create; Void → none) | dialog-close | low | migrated |
| /projects/[id]/workforce → workforce/sites-manager | workforce | dialog-form | FD (Add site → create, Save → save); archive immediate | dialog-close | low | migrated |
| workforce/worker-workforce, workforce/workforce-tables | workforce | excluded | — | — | — | excluded: display only |
| /timesheets → timesheets/timesheet-week + timesheet-grid | timesheets | grid (autosave) | useUnsavedEditor (none): saving while a cell saves; dirty while a cell failed, a typed value is not yet committed (incl. invalid), or an added row holds no time | nav (week links), history, workspace, identity | high | migrated |
| /timesheets → timesheets/timesheet-entry-drawer | timesheets | dialog-form (drawer) | useUnsavedEditor (edit → save, new → create) → same PUT/POST path and checks; inner EntryForm registered inside the drawer; remove sets saving | dialog-close (X/Esc/backdrop/Cancel), nav, workspace, identity | medium | migrated |
| /timesheets → week Submit / shortfall ConfirmDialog / entries list dialog / Copy last week | timesheets | excluded | — | — | — | excluded: workflow buttons and read-only list |
| /timesheets/[timesheetId] → timesheets/timesheet-review reopen dialog | timesheets | workflow-only | UnsavedValue (none, workflow Reopen week); Cancel → DialogClose; note cleared after an approved close | dialog-close | low | migrated |
| /timesheets/settings → timesheets/timesheet-settings-form | timesheets | controlled custom-form | useUnsavedEditor (save) → same PUT /api/timesheets/settings with same checks | nav, history, workspace, identity | medium | migrated |
| /timesheets/settings → ApproverAssignments | timesheets | excluded | — | — | low | excluded: immediate per-row select + filter |
| /timesheets/projects (GET filter) | timesheets | excluded | — | — | — | excluded: read-only filter |
| /settings/localization → settings/localization-form | settings | custom-form | useEditorSave → updateCompanySettingsAction (message mapped to error) | nav, history, workspace, identity | low | migrated |
| /settings/localization (non-finance) → app/(nesto)/settings/localization/localization-basics-form | settings | custom-form | useEditorSave → updateCompanySettingsAction | nav, history, workspace, identity | low | migrated |
| /settings/integrations → settings/integration-settings-form | settings | custom-form | useEditorSave → updateIntegrationSettingsAction | nav, history, workspace, identity | low | migrated |
| /settings/numbering → settings/numbering-scheme-form (one editor per scheme) | settings | custom-form | useEditorSave → updateNumberingSchemeAction, label = scheme | nav, history, workspace, identity | low | migrated |
| /settings/sales → app/(nesto)/settings/sales/sales-settings-form | settings | controlled custom-form | useUnsavedEditor (save) → same PATCH /api/settings/sales with same check | nav, history, workspace, identity | low | migrated |
| /settings/profile → settings/profile-form | settings | controlled custom-form | useUnsavedEditor (save) → updateProfileAction(values) | nav, history, workspace, identity | low | migrated |
| /settings/profile → settings/password-form | settings | workflow-only | useUnsavedEditor (none, workflow Change password); values only in form state, coordinator holds flags + section title | nav, history, workspace, identity | low | migrated |
| /settings/profile → settings/session-list "Sign out everywhere" | settings | departure | requestDeparture({identity, sign-out}) before signOutEverywhereAction | identity | low | migrated |
| /settings/modules, /settings (preferences) → module-toggle-list, language/navigation/theme/notification preferences | settings | excluded | — | — | — | excluded: immediate toggles, no draft |
| /settings/company, /settings/profile page fields | settings | excluded | — | — | — | excluded: read-only/disabled display |
| /organization/departments[/id], /organization/companies/[id], /platform-admin/groups/[id]/departments → organization/department-actions | other | dialog-form / workflow-only | FD: New (create), Edit (save), Add member (create); Activate selected, Appoint/Replace, Move → none | dialog-close | medium | migrated |
| same → status / branch / end-assignment ConfirmDialogs | other | excluded | — | — | — | excluded: confirmations |
| /organization/departments/[id] → organization/department-member-actions | other | dialog-form | FD saveKind create (Assign) | dialog-close | low | migrated |
| /organization/access → organization/access-grants Grant | other | workflow-only | FD (Delegate → none, reason required) | dialog-close | low | migrated |
| /organization/access → Revoke (ConfirmDialog), ?view=check GET filter | other | excluded | — | — | — | excluded: confirmation / filter |
| /organization/provisioning/[id] → organization/provisioning-actions | other | workflow-only | FD provision saveKind none (credentials shown once); ReasonDialog return/reject; ConfirmDialogs | dialog-close | low | migrated |
| /organization/departments/[id]?tab=team GET filter | other | excluded | — | — | — | excluded: filter |
| /platform-admin (overview, organizations/groups, groups/[id]) → platform/platform-actions CreateGroup | other | dialog-form | FD (Create group); push to the new group moved to the clean close | dialog-close (window.confirm fallback: no host) | medium | migrated |
| same → GroupImplementationActions identity (Save), new company (Create company), project (Assign → none) | other | dialog-form | FD | dialog-close | medium | migrated |
| same → initial roster "Create account" | other | workflow-only | FD saveKind none (credentials shown once) | dialog-close | medium | migrated |
| same → Send for validation / Activate | other | excluded | — | ConfirmDialog | — | excluded: confirmations |
| many platform-admin pages → platform/platform-command | other | workflow-only / dialog-form | FD / ReasonDialog (kind inferred from label) | dialog-close | low | migrated |
| /platform-admin/people → platform/platform-people-actions Create/Edit person | other | dialog-form | FD (Create person → create, Save → save) | dialog-close | medium | migrated |
| same → CreateUserButton | other | workflow-only | FD saveKind none (credentials shown once) | dialog-close | medium | migrated |
| platform-admin shell + pages links (platform-shell, platform-search, 17 app/platform-admin pages) | other | navigation | next/link → NavLink (guarded; no host → window.confirm) | nav | medium | migrated |
| platform/access-inspector, platform-search, audit-table | other | excluded | — | — | — | excluded: read-only query/search |
| /platform-admin/3d GET filter + NewExperienceDialog; 3d project pages; /platform-admin/pricing | platform 3D / pricing | — | owned by the 3D and pricing partitions (components/3d, components/pricing) | — | — | excluded from P4: other partition (only their page links were swapped to NavLink here) |
| app/platform-admin/layout SignOutButton (components/auth) | other | departure | — | identity | low | excluded from P4: components/auth is outside the partition |
| components/access/permission-gate | — | excluded | — | — | — | excluded: no input |

## P5 — Projects, project structure and units, planning, documents

Shared local helper (in partition): `components/project-planning/use-values-editor.ts` — `useValuesEditor(values, options)` = `useUnsavedEditor` + dirtiness from JSON(values) vs the baseline they opened with, `track(request)` (saving while it runs, rebaseline to what was sent only on success, `unresolved` when no answer came back), `failureOutcome(error)` (planningApi/announcementApi failure → SaveOutcome; status 0 / non-failure → unknown). Dialog editors are split into a shell (`Dialog`/`Drawer`) and an inner form mounted per opening, so the editor registers inside the dialog's scope and the old "reset on open" effects become initial state.

| Surface (route → component) | Module | Editor type | Save adapter | Departure / dismiss paths | Risk | Coverage |
|---|---|---|---|---|---|---|
| /projects/new, /projects/:id/edit → components/projects/project-form.tsx | projects | custom-form | `useEditorSave → createProjectAction / updateProjectAction (committed)` (done before P5) | nav, history, cancel, workspace, identity | high | migrated (pre-existing, untouched) |
| /projects/:id (header) → projects/change-project-status-dialog.tsx `StatusForm` | projects | workflow-only (dialog) | `useUnsavedEditor (none, workflow "Change status")`; saving + unresolved on lost connection | dialog-close (X/Esc/backdrop/Cancel→DialogClose), nav, history, workspace, identity | low | migrated |
| /projects/:id/team → projects/project-team.tsx `MemberForm` (Add member) | projects | dialog-form | `useEditorSave → addProjectMemberAction (create)`; closes + refresh on committed | dialog-close (Cancel→DialogClose), nav, history, workspace, identity | medium | migrated |
| /projects/:id/team → project-team.tsx `MemberForm` (Edit project role) | projects | dialog-form | `useEditorSave → updateProjectMemberAction (save)` | dialog-close, nav, history, workspace, identity | medium | migrated |
| /projects/:id/team → project-team.tsx Remove (ConfirmDialog) | projects | — | button action `removeProjectMemberAction` | — | low | excluded: confirm button, no input (error now a toast; it was set but never shown) |
| /projects/:id/media → projects/project-media-manager.tsx upload (useUploadQueue) | projects | file-select | queue `setPendingUploads` (see upload-queue row) | nav, history, workspace, identity, reload | medium | migrated |
| /projects/:id/media → project-media-manager.tsx `EditMediaForm` | projects | dialog-form (controlled) | `useValuesEditor (save) → PATCH /api/projects/:id/media/:mediaId` (same `mutate` as Save; outcome via `Refusal` vs thrown fetch) | dialog-close (Cancel→DialogClose), nav, history, workspace, identity | medium | migrated |
| /projects/:id/media → set cover / reorder / remove | projects | — | buttons | — | low | excluded: action buttons, no input |
| /projects/types → projects/project-types-manager.tsx add form | projects | controlled (inline) | `useUnsavedEditor (create) → POST /api/projects/types` (same `add()`) | nav, history, workspace, identity | low | migrated |
| /projects/types → project-types-manager.tsx inline rename | projects | controlled (inline) | `useUnsavedEditor (save) → PATCH /api/projects/types/:id` (same `rename()`); Cancel / starting another rename → `requestDismiss` | cancel, nav, history, workspace, identity | low | migrated |
| /projects/types → retire / reorder / delete | projects | — | buttons | — | low | excluded: action buttons |
| /projects/unit-types → projects/unit-types-manager.tsx add form | units | controlled (inline) | `useUnsavedEditor (create) → POST /api/projects/unit-types` (baseline category = last used) | nav, history, workspace, identity | low | migrated |
| /projects/unit-types → unit-types-manager.tsx inline edit | units | controlled (inline) | `useUnsavedEditor (save) → PATCH /api/projects/unit-types/:id`; Cancel / another edit → `requestDismiss` | cancel, nav, history, workspace, identity | low | migrated |
| /projects (portfolio), /projects/all, /archived, /my-projects → portfolio/projects-portfolio.tsx, projects-list.tsx, project-card*, project-table | projects | filter-only | — | — | — | excluded: search/filter only (guarded router already swapped) |
| /projects/:id → projects/project-actions.tsx | projects | — | archive/restore buttons; hosts status dialog | — | — | excluded: host + confirm buttons |
| /projects/:id/media → project-media-gallery.tsx | projects | — | — | — | — | excluded: viewer |
| /projects/:id/open → open-project-in-company.tsx | projects | — | automatic `router.replace` on mount | — | — | excluded: no editor |
| /projects/:id/units → project-structure/unit-dialog.tsx `UnitForm` | units | dialog-form (controlled) | `useValuesEditor (create/save) → POST /api/project-floors/:id/units, PATCH /api/project-units/:id` (same `persist`) | dialog-close (X/Esc/backdrop/Cancel→DialogClose), nav, history, workspace, identity, reload | high | migrated — own `beforeunload` and own "discard?" ConfirmDialog removed (no double prompt) |
| /projects/:id/units/:unitId (UnitActions) → unit-dialog.tsx `UnitForm` (edit) | units | dialog-form | same as above | same | high | migrated |
| /projects/:id/units → structure-dialogs.tsx `BuildingForm` | units | dialog-form | `useValuesEditor (create/save) → POST /api/projects/:id/buildings, PATCH /api/project-buildings/:id` | dialog-close, nav, history, workspace, identity | medium | migrated |
| /projects/:id/units → structure-dialogs.tsx `FloorForm` | units | dialog-form | `useValuesEditor (create/save) → POST /api/project-buildings/:id/floors, PATCH /api/project-floors/:id` | dialog-close, nav, history, workspace, identity | medium | migrated |
| /projects/:id/units → structure-dialogs.tsx `MoveFloorForm` | units | workflow-only (dialog) | `useValuesEditor (none, workflow "Move floor")`; track for saving/unresolved | dialog-close, nav, history, workspace, identity | low | migrated |
| /projects/:id/units[/unitId] → structure-dialogs.tsx `MoveUnitForm` | units | workflow-only (dialog) | `useValuesEditor (none, workflow "Move unit")` | dialog-close, nav, history, workspace, identity | low | migrated |
| /projects/:id/units → bulk-dialogs.tsx `BulkFloorsBody` | units | multistep (dialog) | `useValuesEditor (none, workflow "Create floors")` — reviewed batch, never created by Save and continue | dialog-close (Cancel→DialogClose), nav, history, workspace, identity | medium | migrated |
| /projects/:id/units → bulk-dialogs.tsx `BulkUnitsBody` | units | multistep (dialog) | `useValuesEditor (none, workflow "Create units")` | dialog-close, nav, history, workspace, identity | medium | migrated |
| /projects/:id/units → bulk-dialogs.tsx `CopyFloorBody` | units | multistep (dialog) | `useValuesEditor (none, workflow "Copy units")`; dirty = chosen floor + rows changed from the loaded suggestion | dialog-close, nav, history, workspace, identity | medium | migrated |
| /projects/:id/units → structure-workspace.tsx (tree search, filters, sort, reorder, delete CD) | units | filter-only / host | — | — | — | excluded: filters + `history.replaceState`; hosts the dialogs above |
| /projects/:id/units/:unitId → unit-actions.tsx, unit-table, structure-ui, badges, unit-image | units | — | — | — | — | excluded: hosts / read-only |
| /projects/:id/units/:unitId header → unit-page/publishing-actions.tsx `ReasonForm` (Revision required / Return changes / Unpublish) | units | workflow-only (dialog) | `useUnsavedEditor (none, workflow = confirm label)`; saving from `pending`, unresolved on lost connection; reason cleared on the (guarded) close | dialog-close (Cancel→DialogClose), nav, history, workspace, identity | low | migrated |
| unit header → publishing-actions.tsx submit / publish / archive / restore, "not ready" dialog | units | — | buttons / ConfirmDialog; "Close" → DialogClose | — | low | excluded: no input |
| /projects/:id/units/:unitId/documents → unit-documents.tsx Sales Plan new version (`uploadNewVersion`) | units | file-select | `useUnsavedEditor (none)` + `setPendingUploads(planBusy)` | nav, history, workspace, identity, reload | medium | migrated |
| unit documents → unit-documents.tsx `UploadDocumentForm` | units | file-select (dialog) | `useValuesEditor (none, workflow "Upload")` (category + chosen files by name/size/time) | dialog-close (Cancel→DialogClose), nav, history, workspace, identity | medium | migrated |
| unit documents / media → unit-documents.tsx `AttachForm` (document or image) | units | dialog-form | `useValuesEditor (create) → POST /api/project-units/:id/documents` or `/media` (same `persist` as Attach); search is a filter, not input | dialog-close, nav, history, workspace, identity | low | migrated |
| unit documents → queue uploads, remove link CD | units | file-select | queue `setPendingUploads` | nav, history, workspace, identity | medium | migrated (via upload-queue) |
| /projects/:id/units/:unitId/media → unit-media.tsx `MediaDetailsForm` | units | dialog-form | `useValuesEditor (save) → PATCH /api/project-units/:id/media/:mediaId` (`call` now answers a SaveOutcome) | dialog-close (Cancel→DialogClose), nav, history, workspace, identity | low | migrated |
| unit media → upload, make primary, reorder, remove, viewer ("Open in Documents" `<a>` → NavLink) | units | file-select / — | queue `setPendingUploads`; buttons | nav | low | migrated (upload) / excluded: buttons, viewer |
| /projects/:id/planning → project-planning/milestone-form.tsx `MilestoneForm` (new, and edit from the drawer) | planning | dialog-form (controlled) | `useValuesEditor (create/save) → POST /api/projects/:id/milestones, PATCH /api/project-milestones/:id` | dialog-close (Cancel→DialogClose), nav, history, workspace, identity | high | migrated |
| /projects/:id/planning → milestone-form.tsx `PhaseForm` | planning | dialog-form (controlled) | `useValuesEditor (create/save; none for read-only) → POST /api/projects/:id/phases, PATCH /api/project-phases/:id`; Archive is a command | dialog-close, nav, history, workspace, identity | medium | migrated |
| /projects/:id/planning?milestone= → milestone-drawer.tsx quick update | planning | controlled | `useUnsavedEditor (save) → POST …/quick-update` (same `saveQuick` as "Save update"); "Discard" → `requestDismiss`; other refreshes keep a typed update | drawer-close (X→useDialogClose, Esc, backdrop), nav, history, workspace, identity | high | migrated — the drawer used to close over `quickDirty` without asking |
| drawer → milestone-drawer.tsx inline panels: task / blocker / dependency / link task / link meeting / link daily log | planning | controlled (inline) | `useUnsavedEditor (create) → the panel's own POST` (`persistPanel`, same as its button) | panel Cancel / another panel → `requestDismiss`; drawer-close, nav, history, workspace, identity | high | migrated |
| drawer → milestone-drawer.tsx inline panels: complete / reopen / baseline, blocker resolve line | planning | workflow-only (inline) | `useUnsavedEditor (none, workflow "Complete milestone" / "Reopen milestone" / "Save baseline" / "Resolve")` | same as above | high | migrated |
| drawer → milestone-drawer.tsx document upload | planning | file-select | queue `setPendingUploads` (registered inside the drawer scope) | drawer-close, nav, history, workspace, identity | medium | migrated |
| drawer → CollaborationPanel composer | collaboration | composer | owned by the collaboration partition | drawer-close (now inside the drawer's scope) | medium | migrated (by P6; asked about inside the drawer's scope) |
| drawer → archive, unlink, remove dependency, "Use it" suggestion, favorite | planning | — | commands; no longer close the open panel or reset a typed quick update | — | low | excluded: action buttons |
| /projects/:id/planning → planning-shell.tsx copy-plan dialog (`CopyChoiceEditor`) | planning | workflow-only (dialog) | `useValuesEditor (none, workflow "Copy planning")`; choice cleared on the guarded close | dialog-close (Cancel→DialogClose), nav, history, workspace, identity | low | migrated |
| /projects/:id/planning → planning-shell.tsx template confirm, filters, search, phase reorder | planning | — | — | — | — | excluded: confirm without input / view filters |
| planning-timeline, milestone-list, planning-ui | planning | — | — | — | — | excluded: read-only |
| /projects/milestones → planning-settings-form.tsx | planning | controlled (settings) | `useValuesEditor (save) → PUT /api/project-planning/settings` (same `save()`); `UnsavedIndicator` | nav, history, workspace, identity; report filters | low | migrated |
| /projects/milestones → report filters (GET form) → report-filter-form.tsx | planning | filter-only | guarded `router.push(?query)` instead of a native GET reload; settings form keyed on the query so an approved filter change really discards | nav | low | migrated (navigation) |
| /documents/:id/edit → app/(nesto)/documents/[documentId]/edit/page.tsx | documents | record-form | `RecordForm → updateDocumentAction (committed)`, `module="documents"` | nav, history, cancel, workspace, identity | low | migrated |
| /documents/new → documents/document-uploader.tsx | documents | file-select + controlled metadata | `useUnsavedEditor (none, workflow "Upload")` for context/name/description; rebaselined when an upload starts; Cancel/Back/Done `<a>` → NavLink | nav, history, cancel, workspace, identity, reload | medium | migrated |
| all queue users → documents/upload-queue.tsx `useUploadQueue` | (route) | file-select engine | `useUnsavedEditor (none)` + `setPendingUploads` while queued/authorising/uploading/verifying — replaces its own `beforeunload` | nav, history, dialog-close (when inside one), workspace, identity, reload | high | migrated — also covers announcements, daily-logs, engineering, contractors callers |
| /documents/:id → document-versions.tsx `UploadVersionForm` | documents | file-select (dialog) | `useUnsavedEditor (none, workflow "Upload")` + `setPendingUploads` while transferring | dialog-close (Cancel→DialogClose), nav, history, workspace, identity | medium | migrated |
| /documents/:id → document-versions.tsx `RequestReviewForm` | documents | workflow-only (dialog) | `useUnsavedEditor (none, workflow "Send for review")`; reviewer search is a filter | dialog-close, nav, history, workspace, identity | medium | migrated |
| /documents/:id → document-versions.tsx `DecisionForm` | documents | workflow-only (dialog) | `useUnsavedEditor (none, workflow "Approve" / "Reject")` | dialog-close, nav, history, workspace, identity | medium | migrated |
| /documents/:id → document-actions.tsx, document-file-panel.tsx, version download | documents | — | downloads (`location.href = signedUrl`) | — | — | excluded: action buttons, no input |
| /documents, /all, /recent, /archived, /documents/:id/activity → documents-list.tsx, document-table, record-documents | documents | filter-only | — | — | — | excluded: lists |
| /projects/:id/{activity,calendar,documents,tasks,…} → project-tabs, project-context | projects | — | — | — | — | excluded: read-only / navigation |
| /projects/:id/{daily-logs,engineering/*,contractors,contracts,finance,hse,inventory,meetings,qaqc,sales,workforce,work-packages}, /projects/:id/units/:unitId/{sales,legal,finance,publishing} | other modules | hosted editors | owned by the daily-logs / engineering / contractors / contracts / finance / hse / inventory / meetings / qaqc / sales / workforce partitions | — | — | excluded: route in P5, editors in other partitions |
| /projects/:id/3d, components/3d/** (ExperienceEditor, UnitBindingEditor, ExperienceMetadataForm, NewExperienceDialog …) | 3d | — | — | — | — | excluded: another session is editing 3D |

## P6 — Meetings, calendar, daily logs, engineering, contractors, announcements, collaboration, approvals

No server actions in this partition: every editor saves through an API route (fetch). Failure mapping helpers added per module API client:
`failureOutcome` (engineering-api.ts), `meetingFailureOutcome` (meeting-api.ts), `dailyLogFailureOutcome` (daily-log-api.ts),
`announcementFailureOutcome` (announcement-api.ts), `approvalsFailureOutcome` (approvals-api.ts): status 0 / thrown → unknown, else `outcomeOf(code)`.
Departure keys: nav = links / guarded router; history = Back/Forward; dialog-close = X/Escape/backdrop; cancel = in-editor Cancel/Done;
workspace = workspace switch; identity = sign-out / user switch; in-place = tab / selection / view swap that destroys the editor.

| Surface (route → component) | Module | Editor type | Save adapter | Departure / dismiss paths | Risk | Coverage |
|---|---|---|---|---|---|---|
| shared → components/engineering/form-kit.tsx `FormDialog` (~24 callers: contractors, hr, hse, organization, people, platform, workforce, engineering) | engineering (caller may pass `module`) | dialog-form (shared primitive) | `useUnsavedEditor` inside the dialog; kind from `saveKind` prop or submit label (Create/Add/New/Log/Record/Raise/Report/Start/Register → create, Save/Update → save, else none + workflow = label); save = same `onSubmit` path; values + named children inputs (`useFormDirty`) are dirty; values survive a refused close (state lives in a body mounted on open) | dialog-close, cancel (`useDialogClose`), nav, history, workspace, identity | high | migrated |
| shared → form-kit.tsx `ReasonDialog` | caller's | workflow-only | `FormDialog saveKind="none"`, workflow = confirm label | dialog-close, cancel, nav, workspace, identity | medium | migrated |
| shared → form-kit.tsx `useRequestEditor` / `RequestMessages` (new helper for controlled request editors) | — | helper | registers, one request per attempt, clean-before-not-saving, unknown on no answer | — | — | n/a (helper) |
| /projects/[id]/engineering/rfis → record-dialogs `NewRfiButton` | engineering | dialog-form | `FormDialog saveKind="create"` → POST /api/projects/{id}/rfis (push to record on normal save only) | dialog-close, cancel, nav, history, workspace, identity | medium | migrated |
| /projects/[id]/engineering/rfis/[id] → record-dialogs `EditRfiButton` | engineering | dialog-form | `FormDialog` (save) → PATCH /api/rfis/{id} | same | medium | migrated |
| /projects/[id]/engineering/submittals → `NewSubmittalButton` / `EditSubmittalButton` | engineering | dialog-form | `FormDialog` (create "Register submittal" / save) → POST …/submittals, PATCH /api/submittals/{id} | same | medium | migrated |
| /projects/[id]/engineering/documents → `NewDocumentButton` / `EditDocumentButton` | engineering | dialog-form | `FormDialog` (create "Register" / save) → POST …/engineering/documents, PATCH /api/engineering-documents/{id} | same | medium | migrated |
| engineering record pages → record-dialogs `CommandButton` (reason variant) | engineering | workflow-only | `ReasonDialog` (none, workflow = confirm label) → POST spec.url | dialog-close, cancel, nav, workspace, identity | low | migrated |
| /projects/[id]/engineering/rfis/[id] → rfi-workspace response composer | engineering | composer / workflow-only | `useRequestEditor` (none, workflow "Send response") → POST /api/rfis/{id}/respond; dirty = text or "final" unticked | nav, history, workspace, identity | medium | migrated |
| same → rfi-workspace "Request clarification" | engineering | workflow-only | `FormDialog` (label "Send back" → none) → POST /api/rfis/{id}/clarification | dialog-close, cancel, nav, workspace, identity | low | migrated |
| same → rfi-workspace follow-up task | engineering | dialog-form | `FormDialog` (create) → POST /api/rfis/{id}/tasks | same | low | migrated |
| same → rfi-workspace `ReferenceDialog` | engineering | dialog-form | `useRequestEditor` (create) → POST /api/rfis/{id}/references | dialog-close, cancel, nav, workspace, identity | low | migrated |
| submittal / engineering document detail → revision-panel `AddRevisionDialog` | engineering | dialog-form + file-select | `useRequestEditor`: "Save draft" → create (POST {record}/revisions submit:false); "Submit for review now" → none, workflow "Submit revision"; upload in flight → `setPendingUploads` | dialog-close, cancel, nav, workspace, identity | medium | migrated |
| same → revision-panel `DecisionDialog` | engineering | workflow-only | `useRequestEditor` (none, workflow "Record: …") → POST …/review | dialog-close, cancel, nav, workspace, identity | medium | migrated |
| /projects/[id]/engineering/transmittals[/id] → transmittal-editor `TransmittalDialog` | engineering | dialog-form + grid (document picks) | `useUnsavedEditor` (create "Create draft" / save "Save draft") → POST …/transmittals, PATCH /api/transmittals/{id}; dirty = header values + picked revisions vs loaded | dialog-close, cancel, nav, workspace, identity | medium | migrated |
| WP / submittal / eng. document detail → links-panel `LinkDialog` | engineering | dialog-form | `useRequestEditor` (create) → POST {apiBase}/links | dialog-close, cancel, nav, workspace, identity | low | migrated |
| same → links-panel task dialog | engineering | dialog-form | `FormDialog` (create) → POST {apiBase}/tasks | same | low | migrated |
| /engineering/settings → settings-form `EngineeringSettingsForm` | engineering | custom-form (controlled) | `useRequestEditor` (save) → PUT /api/engineering/settings; `UnsavedIndicator`, persistent `RequestMessages` | nav, history, workspace, identity | low | migrated |
| /engineering/reports → project-filter | engineering | filter-only | — | — | — | excluded: read-only filter |
| /engineering, /drawings, /rfis, /submittals, /transmittals → registers, project-registers, section-nav, engineering-ui | engineering | view | — | — | — | excluded: no input |
| /meetings/new, /meetings/[id]/edit → meeting-form `MeetingForm` | meetings | controlled form (large) | `useUnsavedEditor`: edit → save (PATCH /api/meetings/{id}); new → create = "Save as draft" (POST saveAsDraft:true), none + workflow "Schedule meeting" when repeating (no draft offered); no navigation on Save and continue; "Reload latest" goes through `guardNavigation({kind:"reload"})` | nav (Cancel is NavLink), history, workspace, identity, reload | high | migrated |
| /meetings/[id] → meeting-workspace tab switch / meeting-mode toggle / start / complete | meetings | host (in-place swap) | panels wrapped in `UnsavedScope` "meeting-tab" / "meeting-view"; swap asks `dismiss` of that scope, approval released at once; `?tab=` sync uses Next's router (same page) | in-place | medium | migrated |
| /meetings/[id] → meeting-workspace `CancelDialog` | meetings | workflow-only | `useUnsavedEditor` (none, workflow "Cancel meeting") → POST …/cancel | dialog-close, cancel ("Keep meeting" = DialogClose), nav, workspace, identity | medium | migrated |
| /meetings/[id] → meeting-workspace `DuplicateDialog` | meetings | dialog-form | `useUnsavedEditor` (create) → POST …/duplicate (push only on normal save) | dialog-close, cancel, nav, workspace, identity | low | migrated |
| /meetings/[id] → minutes-panel `SectionEditor` (autosave 1.2 s + blur) | meetings | controlled autosave | `useUnsavedEditor` (save) → PATCH …/minutes/sections/{id}; dirty while typed-not-sent or failed, saving while in flight, unknown on no answer; typing during a save re-queues it | nav, history, workspace, identity, in-place | high | migrated |
| /meetings/[id] → minutes-panel reopen dialog | meetings | workflow-only | `useUnsavedEditor` (none, workflow "Reopen minutes") | dialog-close, cancel, nav, workspace, identity | low | migrated |
| /meetings/[id] → minutes-panel finalize / remove section (ConfirmDialog) | meetings | action-only | — | — | — | excluded: no input |
| /meetings/[id] → agenda-panel add topic + inline edit | meetings | composer + inline editor | `useMeetingDraft` (create / save) → POST/PATCH …/agenda[/id]; Done/Cancel/other-topic-edit ask (`dismissEditor`, approval released) | nav, history, workspace, identity, cancel, in-place | medium | migrated |
| /meetings/[id] → decisions-panel record + inline edit | meetings | composer + inline editor | `useMeetingDraft` (create / save) → POST/PATCH …/decisions[/id] | same | medium | migrated |
| /meetings/[id] → actions-panel quick capture | meetings | composer | `useMeetingDraft` (create) → POST …/actions; owner kept as baseline after add | same | low | migrated |
| /meetings/[id] → participants-panel `AddPeopleDialog` | meetings | dialog-form | `useUnsavedEditor`: draft meeting → create (POST …/participants); otherwise none, workflow "Add and invite" (invites are sent) | dialog-close, cancel, nav, workspace, identity | low | migrated |
| /meetings/[id] → participants-panel remove / hand-over / attendance select | meetings | action-only / immediate | — | — | — | excluded: buttons or immediate PATCH, nothing pending |
| /meetings/actions, actions-panel → action-status-toggle | meetings | immediate toggle | — | — | — | excluded: immediate save, nothing pending |
| meeting-form / participants → people-picker | meetings | search | — | — | — | excluded: search query only |
| /meetings, /mine, /past (meetings-section), meeting-list, meeting-ui, print-button, /meetings/[id]/print | meetings | view | — | — | — | excluded: no input |
| /calendar → event-form `EventFormDrawer` | calendar | dialog-form (drawer) | `DrawerEditor` probe inside the drawer, `useUnsavedEditor` (create / save) → POST /api/calendar/events, PATCH …/{id}; X and Cancel are `DrawerClose` | dialog-close, cancel, nav, history, workspace, identity | medium-high | migrated |
| /calendar, /projects/[id]/calendar → event-drawer (RSVP, archive), calendar-shell, calendar-sidebar, views, project-schedule | calendar | action-only / filter / view | — | — | — | excluded: no typed input (drag-move saves at once) |
| /projects/[id]/daily-logs/[id] → daily-log-workspace `OverviewField` ×6 (autosave on blur) | daily_logs | controlled autosave | `useUnsavedEditor` per field (save) → PATCH /api/daily-logs/{id}; dirty = exactly what the blur save would send | nav, history, workspace, identity | high | migrated |
| same → site-condition select (saves on change) | daily_logs | immediate | workspace "Daily log overview" editor (none): saving while any overview PATCH is in flight, unresolved on no answer | nav, history, workspace, identity | low | migrated |
| same → entry-dialog `EntryDialog` (dialog / bottom sheet) | daily_logs | dialog-form | `EntryEditor` probe inside, `useUnsavedEditor` (create "Add" / save) → POST/PATCH {base}/{section}; Cancel = DialogClose | dialog-close, cancel, nav, workspace, identity | medium | migrated |
| same → return / void `ReasonDialog` (local) | daily_logs | workflow-only | `useDialogStep` (none, workflow "Return"/"Void log") → POST {base}/return, /void | dialog-close, cancel, nav, workspace, identity | medium | migrated |
| same → `CorrectionDialog` | daily_logs | workflow-only | `useDialogStep` (none, workflow "Add correction") → POST {base}/corrections | same | medium | migrated |
| same → `TaskDialog` | daily_logs | dialog-form | `useDialogStep` (create) → POST {base}/tasks/create | same | low | migrated |
| same → `LinkTaskDialog` | daily_logs | dialog-form | `useDialogStep` (create) → POST {base}/tasks | same | low | migrated |
| same → `LinkRecordDialog` | daily_logs | action-only | — | — | — | excluded: each "Link" button saves at once, no input held |
| same → evidence-gallery uploads | daily_logs | file-select | gallery editor (none): `setPendingUploads` while a file is on its way; stored files never deleted | nav, history, workspace, identity | low | migrated |
| same → evidence-gallery "Describe this file" | daily_logs | dialog-form | `useUnsavedEditor` (save) → PUT /api/daily-logs/{id}/evidence/{doc} | dialog-close, cancel, nav, workspace, identity | low | migrated |
| same → workforce-suggestions dialog | daily_logs | dialog-form (picks) | `PicksEditor` probe, `useUnsavedEditor` (create) → POST {base}/workforce-suggestions; dirty = a suggestion unpicked | dialog-close, cancel, nav, workspace, identity | low | migrated |
| /projects/[id]/daily-logs[/new] → start-log-form | daily_logs | custom-form (one date) | — | — | low | excluded: a single date choice for an open-or-create action; nothing typed to lose |
| /daily-logs/settings → daily-log-settings-form | daily_logs | custom-form (controlled) | `useUnsavedEditor` (save) → PUT /api/daily-logs/settings; `UnsavedIndicator` | nav, history, workspace, identity | low | migrated |
| /daily-logs, /daily-logs/review, /daily-logs/reports | daily_logs | list / GET filter | — | — | — | excluded: read-only filter |
| /announcements/new, /announcements/[id]/edit → announcement-editor | announcements | controlled form | `useUnsavedEditor` (create "Save draft" / save "Save changes") → POST/PATCH /api/announcements[/id]; "Publish now" is a workflow step never run from the prompt; fieldset during save | nav (Cancel NavLink), history, workspace, identity | high | migrated |
| /announcements/[id] → announcement-detail "Schedule for" + attachments | announcements | workflow-only + file-select | `useUnsavedEditor` (none, workflow "Schedule"); cleared after scheduling; `setPendingUploads` while attaching | nav, history, workspace, identity | low | migrated |
| /announcements/[id] → publish / archive / pin / duplicate / acknowledge buttons | announcements | action-only | — | — | — | excluded: no input |
| /announcements?tab=manage → productivity-settings-form | announcements | custom-form (controlled) | `useUnsavedEditor` (save) → PUT /api/productivity/settings; `UnsavedIndicator` | nav, history, workspace, identity (the page's GET filter submit is a full load → host beforeunload) | low | migrated |
| /announcements?tab=manage → page GET filter form, announcement-list, body, ui, shell (banner) | announcements | filter / view | — | — | — | excluded: read-only filter |
| ~37 record pages (tasks, clients, sales, contracts, daily logs, work packages, engineering, QA/QC, HSE, procurement, inventory, HR, finance, meetings, documents, timesheets, approvals, milestones) → collaboration-panel `CommentComposer` (new comment) | collaboration | composer | `useUnsavedEditor` (save — posting is an ordinary save) → POST /api/collaboration/{type}/{id}/comments; dirty = text; unknown on no answer | nav, history, workspace, identity, in-place (keyed remount) | medium | migrated |
| same → collaboration-panel inline edit of own comment | collaboration | composer | `useUnsavedEditor` (save) → PATCH /api/comments/{id}; Cancel asks (`dismiss` of the editor, approval released) | cancel, nav, history, workspace, identity | medium | migrated |
| same → watch toggle, delete comment (ConfirmDialog), load older | collaboration | action-only | — | — | — | excluded: no input |
| /approvals → approval-decision `DecisionBar` note | approvals | composer / workflow-only | `useUnsavedEditor` (none, workflow "Approve"); selecting another approval / changing tab / closing the review asks first (`DETAIL_SCOPE` dismiss); a selection after a recorded decision does not | in-place, nav, history, workspace, identity, dialog-close (phone sheet) | medium | migrated |
| /approvals → approval-decision reject / return `ReasonDialog` | approvals | workflow-only | `useUnsavedEditor` (none, workflow "Reject"/"Return") → POST /api/approvals/{p}/{id}/reject\|return | dialog-close, cancel, nav, workspace, identity | medium | migrated |
| /approvals → approval-decision `StrongApproveDialog` | approvals | workflow-only | `useUnsavedEditor` (none, workflow "Approve"); dirty = note changed from the bar's | dialog-close, cancel, nav, workspace, identity | low | migrated |
| /approvals → approvals-shell phone detail sheet (was raw `@radix-ui/react-dialog` Root) | approvals | host | `GuardedRoot` + `UnsavedScope` "approval-detail"; URL sync on Next's router (same page) | dialog-close, in-place | medium | migrated |
| /approvals → delegation-dialog (new delegation) | approvals | dialog-form | `DelegationEditor` probe, `useUnsavedEditor` (create) → POST /api/approvals/delegations | dialog-close, nav, workspace, identity | medium | migrated |
| /approvals → approval-filters (FilterDrawer), search, sort, density, approval-list, approval-ui | approvals | filter-only | — | — | — | excluded: read-only filter |
| /approvals → approval-detail | approvals | host | covered by DecisionBar / CollaborationPanel rows | — | — | excluded: host (editors listed above) |
| /activity → activity-view | other | filter-only (GET form) | — | — | — | excluded: read-only filter |
| /my-work → productivity/my-work-view; favorite-button; record-favorite | other | filter / immediate toggle | — | — | — | excluded: read-only filter / immediate star |
| topbar / pages → notifications/attention-list, notification-center, enter-company | other | action-only | — | — | — | excluded: no input |
| /search → search/search-page-field | other | filter-only | — | — | — | excluded: search query only |
| /dashboard → dashboard/* | other | view | — | — | — | excluded: no input |
