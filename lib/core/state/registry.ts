import { contractAmendmentMachine } from "@/lib/modules/contracts/amendments/amendment.machine";
import { contractMachine } from "@/lib/modules/contracts/contracts/contract.machine";
import { contractObligationMachine } from "@/lib/modules/contracts/obligations/obligation.machine";
import { documentMachine } from "@/lib/modules/documents/document.machine";
import { documentReviewMachine } from "@/lib/modules/documents/versions/review.machine";
import { documentVersionReviewMachine } from "@/lib/modules/documents/versions/version-review.machine";
import { engineeringDocumentMachine } from "@/lib/modules/engineering/engineering.document.machine";
import { engineeringRevisionMachine } from "@/lib/modules/engineering/engineering.revision.machine";
import { rfiMachine } from "@/lib/modules/engineering/engineering.rfi.machine";
import { submittalRevisionMachine } from "@/lib/modules/engineering/engineering.submittal-revision.machine";
import { technicalSubmittalMachine } from "@/lib/modules/engineering/engineering.submittal.machine";
import { documentTransmittalMachine } from "@/lib/modules/engineering/engineering.transmittal.machine";
import { projectBudgetMachine } from "@/lib/modules/finance/budgets/budget.machine";
import { commitmentMachine } from "@/lib/modules/finance/commitments/commitment.machine";
import { expenseMachine } from "@/lib/modules/finance/expenses/expense.machine";
import { invoiceMachine } from "@/lib/modules/finance/invoices/invoice.machine";
import { paymentMachine } from "@/lib/modules/finance/payments/payment.machine";
import { employeeDocumentVerificationMachine } from "@/lib/modules/hr/documents/employee-document.machine";
import { qualificationVerificationMachine } from "@/lib/modules/hr/qualifications/qualification.machine";
import { hseInspectionMachine } from "@/lib/modules/hse/inspections/inspection.machine";
import { hseActionMachine } from "@/lib/modules/hse/actions/action.machine";
import { hseHazardMachine } from "@/lib/modules/hse/hazards/hazard.machine";
import { hseIncidentMachine } from "@/lib/modules/hse/incidents/incident.machine";
import { hsePermitMachine } from "@/lib/modules/hse/permits/permit.machine";
import { stockAdjustmentMachine } from "@/lib/modules/inventory/documents/adjustment.machine";
import { stockIssueMachine } from "@/lib/modules/inventory/documents/issue.machine";
import { inventoryReceiptMachine } from "@/lib/modules/inventory/documents/receipt.machine";
import { stockReturnMachine } from "@/lib/modules/inventory/documents/return.machine";
import { stockTransferMachine } from "@/lib/modules/inventory/documents/transfer.machine";
import { inventoryItemMachine } from "@/lib/modules/inventory/items/item.machine";
import { stockReservationMachine } from "@/lib/modules/inventory/reservations/reservation.machine";
import { inventoryLocationMachine } from "@/lib/modules/inventory/warehouses/location.machine";
import { warehouseMachine } from "@/lib/modules/inventory/warehouses/warehouse.machine";
import { provisioningRequestMachine } from "@/lib/modules/organization/provisioning/provisioning.machine";
import { projectMachine } from "@/lib/modules/projects/project.machine";
import { unitPublicationMachine } from "@/lib/modules/project-structure/unit-publication.machine";
import { unitCommercialMachine } from "@/lib/modules/sales/units/unit-commercial.machine";
import { paymentScheduleMachine } from "@/lib/modules/finance/units/payment-schedule.machine";
import { unitContractRequestMachine } from "@/lib/modules/contracts/units/unit-contract-request.machine";
import { purchaseOrderMachine } from "@/lib/modules/procurement/orders/order.machine";
import { supplierQuoteMachine } from "@/lib/modules/procurement/quotes/quote.machine";
import { goodsReceiptMachine } from "@/lib/modules/procurement/receipts/receipt.machine";
import { purchaseRequestMachine } from "@/lib/modules/procurement/requests/request.machine";
import { rfqMachine } from "@/lib/modules/procurement/rfqs/rfq.machine";
import { supplierMachine } from "@/lib/modules/procurement/suppliers/supplier.machine";
import { correctiveActionMachine } from "@/lib/modules/qaqc/corrective-actions/action.machine";
import { qualityInspectionMachine } from "@/lib/modules/qaqc/inspections/inspection.machine";
import { taskMachine } from "@/lib/modules/tasks/task.machine";
import type { StateMachine } from "./machine";

/**
 * Every declared state machine, in one place (PRD #49 §154-§156).
 *
 * This is an aggregation point in the sense PRD #48 gave the word: it imports
 * every domain that declares a machine, and the dependency gate cuts it for
 * that reason. It exists so three things can be derived rather than
 * maintained by hand — the documentation in `docs/state-machines.md`, the
 * gate that checks a machine only governs a model its own domain owns, and
 * the transition matrix the tests walk.
 *
 * A machine is registered here or it does not exist: `applyTransition` reaches
 * its model through a delegate name, which is invisible to the ownership
 * scanner, so this list is what puts those writes back under the same rule as
 * every other write.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- machines differ in their state and action unions by design; the registry only reads the common fields.
export const STATE_MACHINES: ReadonlyArray<StateMachine<any, any>> = [
  hseInspectionMachine,
  hsePermitMachine,
  hseActionMachine,
  hseIncidentMachine,
  hseHazardMachine,
  qualityInspectionMachine,
  correctiveActionMachine,
  // HR: employee documents and qualifications, checked by a verifier (E-02 §29-§31)
  employeeDocumentVerificationMachine,
  qualificationVerificationMachine,
  // Projects (E-05A §12)
  provisioningRequestMachine,
  projectMachine,
  // Project structure: a unit's publication (E-05D §13, §14)
  unitPublicationMachine,
  // Sales: a unit's commercial status (E-05E §7, §8)
  unitCommercialMachine,
  // Documents
  documentMachine,
  documentVersionReviewMachine,
  documentReviewMachine,
  // Finance
  invoiceMachine,
  expenseMachine,
  paymentMachine,
  // A unit sale's payment schedule (E-05F §20, §25)
  paymentScheduleMachine,
  projectBudgetMachine,
  commitmentMachine,
  // Procurement
  purchaseRequestMachine,
  rfqMachine,
  supplierQuoteMachine,
  purchaseOrderMachine,
  goodsReceiptMachine,
  supplierMachine,
  // Inventory
  inventoryReceiptMachine,
  stockIssueMachine,
  stockReturnMachine,
  stockTransferMachine,
  stockAdjustmentMachine,
  stockReservationMachine,
  inventoryItemMachine,
  warehouseMachine,
  inventoryLocationMachine,
  // Legal
  contractMachine,
  contractAmendmentMachine,
  contractObligationMachine,
  // Sales asking Legal for a unit's contract (E-05F §12)
  unitContractRequestMachine,
  // Engineering
  engineeringDocumentMachine,
  engineeringRevisionMachine,
  rfiMachine,
  technicalSubmittalMachine,
  submittalRevisionMachine,
  documentTransmittalMachine,
  // Tasks: every command that moves a task, edits included (AUD-02 §5)
  taskMachine,
];

