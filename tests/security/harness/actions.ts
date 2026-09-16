import { readdirSync, readFileSync } from "node:fs";

import ts from "typescript";

/**
 * Server actions as endpoints (PRD #47 §103, §155).
 *
 * An exported function in a `"use server"` module is callable from any browser
 * with arguments of the caller's choosing, exactly like a route. This finds
 * them and describes each parameter well enough to build an attack call.
 */

export type ActionParameter = { name: string; type: string; optional: boolean; literals: string[] };
export type ServerAction = { file: string; name: string; parameters: ActionParameter[] };

/** Files whose actions have no workspace context by design (verify:authorization lists why). */
const NON_SESSION_FILES = new Set(["lib/actions/auth.ts", "lib/actions/contact.ts", "lib/actions/demo.ts", "lib/actions/dev.ts"]);

function literalsOf(typeNode: ts.TypeNode | undefined, source: ts.SourceFile): string[] {
  if (!typeNode) return [];
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) return [typeNode.literal.text];
  if (ts.isUnionTypeNode(typeNode)) return typeNode.types.flatMap((member) => literalsOf(member, source));
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const alias = typeNode.typeName.text;
    for (const statement of source.statements) {
      if (ts.isTypeAliasDeclaration(statement) && statement.name.text === alias) return literalsOf(statement.type, source);
    }
  }
  return [];
}

export function discoverServerActions(): ServerAction[] {
  const actions: ServerAction[] = [];
  for (const entry of readdirSync("lib/actions").sort()) {
    const file = `lib/actions/${entry}`;
    if (!entry.endsWith(".ts") || NON_SESSION_FILES.has(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!text.startsWith('"use server"')) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
      if (!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      actions.push({
        file,
        name: statement.name.text,
        parameters: statement.parameters.map((parameter) => ({
          name: parameter.name.getText(source),
          type: parameter.type?.getText(source) ?? "unknown",
          optional: Boolean(parameter.questionToken || parameter.initializer),
          literals: literalsOf(parameter.type, source),
        })),
      });
    }
  }
  return actions;
}

/** Record kinds whose id argument names differ by module. */
const FILE_MODELS: Record<string, Record<string, string>> = {
  "lib/actions/hse.ts": { templateId: "HseInspectionTemplate", inspectionId: "HseInspection", actionId: "HseAction", hazardId: "HseHazard", incidentId: "HseIncident", assessmentId: "HseRiskAssessment", riskId: "HseRiskAssessment", permitId: "HseWorkPermit", talkId: "ToolboxTalk", checkId: "PpeCheck", observationId: "EnvironmentalObservation", stopWorkId: "StopWorkRecord", recordId: "HseRecord" },
  "lib/actions/qaqc.ts": { templateId: "InspectionTemplate", inspectionId: "QualityInspection", actionId: "CorrectiveAction", requestId: "InspectionRequest", defectId: "QualityDefect", ncrId: "NonConformanceReport", recordId: "QualityRecord" },
  "lib/actions/procurement.ts": { requestId: "PurchaseRequest", rfqId: "RFQ", quoteId: "SupplierQuote", purchaseOrderId: "PurchaseOrder", orderId: "PurchaseOrder", receiptId: "GoodsReceipt", supplierId: "Supplier" },
  "lib/actions/inventory.ts": { itemId: "InventoryItem", warehouseId: "Warehouse", receiptId: "InventoryReceipt", issueId: "StockIssue", returnId: "StockReturn", transferId: "StockTransfer", adjustmentId: "StockAdjustment", reservationId: "StockReservation", locationId: "InventoryLocation", goodsReceiptId: "GoodsReceipt" },
  "lib/actions/finance.ts": { invoiceId: "Invoice", expenseId: "Expense", budgetId: "ProjectBudget", commitmentId: "Commitment", paymentId: "Payment", proposalId: "Proposal" },
  "lib/actions/hr.ts": { leaveId: "LeaveRequest", attendanceId: "AttendanceRecord", memberId: "CompanyMember", compensationId: "Compensation" },
  "lib/actions/contracts.ts": { contractId: "Contract", amendmentId: "ContractAmendment", obligationId: "ContractObligation", partyId: "ContractParty" },
  "lib/actions/sales.ts": { leadId: "Lead", opportunityId: "Opportunity", proposalId: "Proposal" },
  "lib/actions/team.ts": { memberId: "CompanyMember", inviteId: "CompanyInvite", departmentId: "Department" },
  "lib/actions/documents.ts": { documentId: "Document" },
};

export function modelForArgument(file: string, parameter: string): string | null {
  return FILE_MODELS[file]?.[parameter] ?? null;
}
