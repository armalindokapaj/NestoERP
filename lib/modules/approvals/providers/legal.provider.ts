import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { approveAmendment, rejectAmendment, returnAmendment } from "@/lib/modules/contracts/amendments/amendment.service";
import * as legalApprovals from "@/lib/modules/contracts/approvals/approval.service";
import { canSeeCommercial } from "@/lib/modules/contracts/contract.dto";
import { buildAmendmentScopeWhere, buildContractScopeWhere } from "@/lib/modules/contracts/contract.scope";
import { approveContract, rejectContract, returnContractForRevision } from "@/lib/modules/contracts/contracts/contract.service";
import { createCycleProvider, type CycleTable, type RecordFacts } from "../approvals.cycle-provider";
import { excludesAmountFilter, formatAmount, formatDate, labelOf, MATCH_LIMIT, moneyOf, projectRef, startOfToday, term, valueSignals } from "./shared";

/**
 * Legal approvals in the Center (PRD #41 §71, §144, §183).
 *
 * Contracts and amendments, through Legal's scope. Confidential terms and
 * legal notes are never copied into the summary: they stay on the contract,
 * behind `legal.confidential_terms.view`, where Legal decides who reads them.
 *
 * Contract and amendment values are Legal's commercial curtain
 * (`legal.commercial.view`, PRD #18 §22). An approver without it gets no
 * amount, no value rows and no value-driven priority — "high value" is the
 * value by another name — and their amount filters match no legal record, as
 * for any record type whose amounts they cannot see; the amount sort then
 * treats these rows as having none (PRD #47 §68, §100).
 */

const DAY = 86_400_000;

export const legalApprovalProvider = createCycleProvider({
  key: "legal",
  moduleKey: "contracts",
  label: "Legal",
  table: () => prisma.contractApproval as unknown as CycleTable,
  records: {
    CONTRACT: {
      recordType: "contract",
      noun: "Contract",
      canView: (context) => can(context, "legal.approval.view") && can(context, "legal.contract.view"),
      canApprove: (context) => legalApprovals.canApproveType(context, "CONTRACT"),
      canReject: (context) => legalApprovals.canRejectType(context, "CONTRACT"),
      selfPermission: "legal.approval.self",
      reason: "A reviewed contract is approved before it is sent for signature.",
      async match(context, filters) {
        if (!canSeeCommercial(context) && excludesAmountFilter(filters)) return [];
        const rows = await prisma.contract.findMany({
          where: {
            AND: [
              buildContractScopeWhere(context),
              filters.projectId ? { projectId: filters.projectId } : {},
              filters.amountMin !== undefined || filters.amountMax !== undefined
                ? { contractValue: { ...(filters.amountMin !== undefined ? { gte: filters.amountMin } : {}), ...(filters.amountMax !== undefined ? { lte: filters.amountMax } : {}) } }
                : {},
              filters.q ? { OR: [{ contractNumber: term(filters.q) }, { title: term(filters.q) }, { counterpartyName: term(filters.q) }, { client: { is: { name: term(filters.q) } } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.contract.findMany({
          where: { AND: [buildContractScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            contractNumber: true,
            title: true,
            contractType: true,
            counterpartyName: true,
            currency: true,
            contractValue: true,
            effectiveDate: true,
            expiryDate: true,
            summary: true,
            client: { select: { name: true } },
            project: { select: { id: true, name: true, code: true } },
          },
        });
        const today = startOfToday();
        const commercial = canSeeCommercial(context);
        return new Map(
          rows.map((row): [string, RecordFacts] => {
            const counterparty = row.counterpartyName ?? row.client?.name ?? null;
            const warnings: RecordFacts["warnings"] = [];
            if (row.effectiveDate && row.effectiveDate < today) {
              warnings.push({ code: "EFFECTIVE_DATE_PASSED", message: `It was due to take effect ${formatDate(row.effectiveDate)}, before approval.`, severity: "WARNING" });
            }
            if (row.expiryDate && row.expiryDate.getTime() - today.getTime() < 30 * DAY) {
              warnings.push({ code: "CONTRACT_EXPIRES_SOON", message: `It expires ${formatDate(row.expiryDate)}.`, severity: "WARNING" });
            }
            return [
              row.id,
              {
                id: row.id,
                reference: row.contractNumber,
                title: `${row.contractNumber} — ${row.title}`,
                subtitle: counterparty,
                amount: commercial ? moneyOf(row.contractValue, row.currency) : null,
                project: projectRef(row.project),
                href: `/contracts/${row.id}`,
                ...(commercial ? valueSignals(row.contractValue) : {}),
                summary: [
                  { label: "Type", value: labelOf(row.contractType) },
                  { label: "Counterparty", value: counterparty ?? "—" },
                  { label: "Project", value: row.project?.name ?? "—" },
                  { label: "Effective", value: formatDate(row.effectiveDate) },
                  { label: "Expires", value: formatDate(row.expiryDate) },
                  ...(commercial ? [{ label: "Value", value: formatAmount(row.contractValue, row.currency), emphasis: "strong" as const }] : []),
                ],
                description: row.summary,
                warnings,
              },
            ];
          }),
        );
      },
      approve: (context, id, note, guard) => approveContract(context, id, note, guard),
      reject: (context, id, note, guard) => rejectContract(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnContractForRevision(context, id, note, guard),
    },

    AMENDMENT: {
      recordType: "amendment",
      noun: "Amendment",
      canView: (context) => can(context, "legal.approval.view") && can(context, "legal.amendment.view"),
      canApprove: (context) => legalApprovals.canApproveType(context, "AMENDMENT"),
      canReject: (context) => legalApprovals.canRejectType(context, "AMENDMENT"),
      selfPermission: "legal.approval.self",
      reason: "An amendment changes a signed agreement, so it is approved before it is sent.",
      async match(context, filters) {
        if (!canSeeCommercial(context) && excludesAmountFilter(filters)) return [];
        const rows = await prisma.contractAmendment.findMany({
          where: {
            AND: [
              buildAmendmentScopeWhere(context),
              filters.projectId ? { contract: { projectId: filters.projectId } } : {},
              filters.amountMin !== undefined || filters.amountMax !== undefined
                ? { newContractValue: { ...(filters.amountMin !== undefined ? { gte: filters.amountMin } : {}), ...(filters.amountMax !== undefined ? { lte: filters.amountMax } : {}) } }
                : {},
              filters.q ? { OR: [{ amendmentNumber: term(filters.q) }, { title: term(filters.q) }, { contract: { contractNumber: term(filters.q) } }] } : {},
            ],
          },
          select: { id: true },
          take: MATCH_LIMIT,
        });
        return rows.map((row) => row.id);
      },
      async hydrate(context, ids) {
        const rows = await prisma.contractAmendment.findMany({
          where: { AND: [buildAmendmentScopeWhere(context), { id: { in: ids } }] },
          select: {
            id: true,
            amendmentNumber: true,
            title: true,
            summary: true,
            effectiveDate: true,
            valueDelta: true,
            newContractValue: true,
            previousContractValue: true,
            newExpiryDate: true,
            previousExpiryDate: true,
            contract: { select: { id: true, contractNumber: true, title: true, currency: true, project: { select: { id: true, name: true, code: true } } } },
          },
        });
        const commercial = canSeeCommercial(context);
        return new Map(
          rows.map((row): [string, RecordFacts] => {
            const currency = row.contract.currency;
            const value = row.newContractValue ?? row.valueDelta;
            return [
              row.id,
              {
                id: row.id,
                reference: row.amendmentNumber,
                title: `${row.amendmentNumber} — ${row.title}`,
                subtitle: `${row.contract.contractNumber} · ${row.contract.title}`,
                amount: commercial ? moneyOf(value, currency) : null,
                project: projectRef(row.contract.project),
                href: `/contracts/${row.contract.id}/amendments/${row.id}`,
                ...(commercial ? valueSignals(row.valueDelta?.abs() ?? null) : {}),
                summary: [
                  { label: "Contract", value: `${row.contract.contractNumber} · ${row.contract.title}` },
                  { label: "Effective", value: formatDate(row.effectiveDate) },
                  ...(commercial
                    ? [
                        { label: "Value change", value: formatAmount(row.valueDelta, currency), emphasis: row.valueDelta && row.valueDelta.gt(0) ? ("warning" as const) : ("normal" as const) },
                        { label: "Value before", value: formatAmount(row.previousContractValue, currency) },
                        { label: "Value after", value: formatAmount(row.newContractValue, currency), emphasis: "strong" as const },
                      ]
                    : []),
                  ...(row.newExpiryDate ? [{ label: "New expiry", value: formatDate(row.newExpiryDate) }] : []),
                ],
                description: row.summary,
              },
            ];
          }),
        );
      },
      approve: (context, id, note, guard) => approveAmendment(context, id, note, guard),
      reject: (context, id, note, guard) => rejectAmendment(context, id, note, guard),
      returnForRevision: (context, id, note, guard) => returnAmendment(context, id, note, guard),
    },
  },
});
