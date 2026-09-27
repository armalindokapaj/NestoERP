import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { CompliancePanel } from "@/components/contractors/contractor-panels";
import { Due, EmptyNote, Panel, ReviewBadge } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requireModule } from "@/lib/context/current-user";
import { contractorLegalSummary } from "@/lib/modules/contractors/contractor.commercial";
import { listContractorCompliance } from "@/lib/modules/contractors/contractor.compliance";
import { getContractor } from "@/lib/modules/contractors/contractor.service";
import { companyToday } from "@/lib/modules/engineering/engineering.settings";
import { LEGAL_COMPLIANCE_TYPES } from "@/lib/modules/contractors/contractor.types";
import { statusLabel } from "@/lib/utils/status";

type Params = { params: Promise<{ contractorId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contractors"))("meta.contracts") };
}

/**
 * The contractor's legal workspace (PRD #46 §50-§58): the contracts in Legal
 * its assignments and work packages rely on, their open obligations and
 * amendments, and the guarantees and insurance on file. Legal owns every one
 * of these records; this page only gathers what the reader may already open.
 */
export default async function ContractorContractsPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const contractor = await orNotFound(getContractor(context, contractorId));
  if (!contractor.capabilities.canViewContracts) redirect("/access-denied");
  const [summary, compliance, { today }] = await Promise.all([contractorLegalSummary(context, contractor.id), contractor.capabilities.canViewCompliance ? listContractorCompliance(context, contractor.id) : Promise.resolve([]), companyToday(context.companyId)]);
  const t = await getTranslations("contractors");
  const guarantees = compliance.filter((item) => LEGAL_COMPLIANCE_TYPES.includes(item.type));

  return (
    <div className="space-y-5">
      <Panel title={t("contractsPage.contracts")} description={t("contractsPage.contractsDescription")} testId="contractor-contracts">
        {summary.contracts.length === 0 ? (
          <EmptyNote>{t("contractsPage.noContracts")}</EmptyNote>
        ) : (
          <Table flush>
            <TableHead>
              <TableRow>
                <TableHeaderCell scope="col">{t("contractsPage.contract")}</TableHeaderCell>
                <TableHeaderCell scope="col">{t("contractsPage.type")}</TableHeaderCell>
                <TableHeaderCell scope="col">{t("contractsPage.status")}</TableHeaderCell>
                <TableHeaderCell scope="col">{t("contractsPage.project")}</TableHeaderCell>
                <TableHeaderCell scope="col">{t("contractsPage.effective")}</TableHeaderCell>
                <TableHeaderCell scope="col">{t("contractsPage.expiry")}</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">
                  {t("contractsPage.value")}
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.contracts.map((row) => (
                <TableRow key={row.id} data-testid="contractor-contract-row">
                  <TableCell className="min-w-[14rem]">
                    <Link href={row.href} className="font-medium text-fg hover:underline">
                      {row.label}
                    </Link>
                    <p className="text-meta text-fg-muted">{row.via.join(" · ")}</p>
                  </TableCell>
                  <TableCell className="text-fg-muted">{statusLabel(row.type)}</TableCell>
                  <TableCell>
                    <ReviewBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-fg-muted">{row.project ?? "—"}</TableCell>
                  <TableCell>
                    <Due date={row.effectiveDate} />
                  </TableCell>
                  <TableCell>
                    <Due date={row.expiryDate} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.value ? `${Number(row.value).toLocaleString("en-GB", { minimumFractionDigits: 2 })} ${row.currency ?? ""}` : <span className="text-fg-subtle">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        <Panel title={t("contractsPage.openObligations")}>
          {summary.obligations.length === 0 ? (
            <EmptyNote>{t("contractsPage.noObligations")}</EmptyNote>
          ) : (
            <ul className="divide-y divide-line">
              {summary.obligations.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-table">
                  <Link href={row.href} className="min-w-0 truncate text-fg hover:underline">
                    {row.label} <span className="text-fg-subtle">· {row.contract}</span>
                  </Link>
                  <Due date={row.dueDate} overdue={Boolean(row.dueDate && row.dueDate < today)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t("contractsPage.amendments")}>
          {summary.amendments.length === 0 ? (
            <EmptyNote>{t("contractsPage.noAmendments")}</EmptyNote>
          ) : (
            <ul className="divide-y divide-line">
              {summary.amendments.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={row.href} className="min-w-0 truncate text-table text-fg hover:underline">
                    {row.label} <span className="text-fg-subtle">· {row.contract}</span>
                  </Link>
                  <ReviewBadge status={row.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {contractor.capabilities.canViewCompliance ? (
        <div className="space-y-2">
          <h2 className="text-section font-semibold text-fg">{t("contractsPage.guarantees")}</h2>
          <CompliancePanel contractorId={null} items={guarantees} canManage={false} canUpload={false} />
        </div>
      ) : null}
    </div>
  );
}
