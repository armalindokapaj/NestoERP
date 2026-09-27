import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { NewCandidateButton } from "@/components/hr/recruitment/new-candidate-button";
import { ModulePage } from "@/components/modules/module-page";
import { StatusBadge } from "@/components/modules/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { recruitmentFormOptions } from "@/lib/modules/hr/recruitment/candidate.options";
import { CANDIDATE_STATUSES, candidateListQuerySchema } from "@/lib/modules/hr/recruitment/candidate.schema";
import { listCandidates } from "@/lib/modules/hr/recruitment/candidate.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { StatusText } from "@/components/i18n/common-text";
import { getTranslations } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.recruitment") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * Candidates (E-06 §22, §23, §62): the people HR is recruiting, each a person
 * of the group with no login yet. The Head of Group HR sees every company's;
 * HR in one company sees that company's.
 */
export default async function RecruitmentPage({ searchParams }: Props) {
  const context = await requireModule("hr");
  if (!can(context, "candidate.view")) redirect("/access-denied");

  const params = await searchParams;
  const query = candidateListQuerySchema.parse({ status: one(params.status), q: one(params.q), page: one(params.page) });
  const [list, choices] = await Promise.all([
    listCandidates(context, query),
    can(context, "candidate.manage") && can(context, "person_profile.create") ? recruitmentFormOptions(context) : null,
  ]);
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (list.meta.page !== query.page) redirect(listPageRedirect("/hr/recruitment", params, list.meta.page));
  // A status chip keeps the search; the search keeps the chip (AUD-08 §3).
  const chipHref = (status?: string) => {
    const next = new URLSearchParams();
    if (query.q) next.set("q", query.q);
    if (status) next.set("status", status);
    const search = next.toString();
    return search ? `/hr/recruitment?${search}` : "/hr/recruitment";
  };
  const t = await getTranslations("hr");
  const chip = (active: boolean) =>
    cn("inline-flex items-center rounded-full border px-3 py-1 text-table transition-colors touch:min-h-11", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "hr")}
      activeSection="recruitment"
      title={t("meta.recruitment")}
      description={t("recruitment.description")}
      actions={choices ? <NewCandidateButton choices={choices} defaultCompanyId={context.companyId} /> : null}
    >
      <div className="space-y-4">
        <nav aria-label={t("recruitment.statusNav")} className="flex flex-wrap gap-2">
          <Link href={chipHref()} className={chip(!query.status)}>
            {t("recruitment.all")}
          </Link>
          {CANDIDATE_STATUSES.map((status) => (
            <Link key={status} href={chipHref(status)} className={chip(query.status === status)}>
              <StatusText status={status} />
            </Link>
          ))}
        </nav>

        {/* The service always searched name and work email; the page now offers it (AUD-08 §3). */}
        <ListToolbar searchParam="q" searchPlaceholder={t("recruitment.searchPlaceholder")} />

        {list.data.length === 0 ? (
          query.q || query.status ? (
            <EmptyState
              title={t("recruitment.noMatchTitle")}
              description={t("common.adjustFilters")}
              action={{ label: t("common.clearFilters"), href: "/hr/recruitment" }}
            />
          ) : (
            <EmptyState title={t("recruitment.emptyTitle")} description={t("recruitment.emptyDescription")} />
          )
        ) : (
          <section className="nesto-card p-0">
            <Table flush aria-label={t("recruitment.candidates")}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t("recruitment.candidate")}</TableHeaderCell>
                  <TableHeaderCell>{t("recruitment.company")}</TableHeaderCell>
                  <TableHeaderCell>{t("columns.department")}</TableHeaderCell>
                  <TableHeaderCell>{t("employee.role")}</TableHeaderCell>
                  <TableHeaderCell>{t("recruitment.stage")}</TableHeaderCell>
                  <TableHeaderCell>{t("columns.status")}</TableHeaderCell>
                  <TableHeaderCell>{t("recruitment.updated")}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.data.map((candidate) => (
                  <TableRow key={candidate.id} data-testid="candidate-row">
                    <TableCell className="font-medium">
                      <Link href={`/hr/recruitment/${candidate.id}`} className="text-fg hover:text-accent-strong hover:underline">
                        {candidate.name}
                      </Link>
                    </TableCell>
                    <TableCell>{candidate.targetCompany?.name ?? "—"}</TableCell>
                    <TableCell>{candidate.targetDepartment?.name ?? "—"}</TableCell>
                    <TableCell>{candidate.targetRole?.label ?? "—"}</TableCell>
                    <TableCell>{candidate.interviewStage ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={candidate.status} />
                    </TableCell>
                    <TableCell>{formatDate(candidate.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        )}
        <Pagination meta={list.meta} buildHref={(next) => pageHref("/hr/recruitment", params, next)} />
      </div>
    </ModulePage>
  );
}
