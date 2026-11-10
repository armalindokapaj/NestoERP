import Link from "@/components/navigation/nav-link";
import { ShieldCheck } from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PersonLink } from "@/components/people/person-link";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/i18n/format";
import type { CredentialWorkItemDTO, CredentialWorklistDTO } from "@/lib/modules/hr/credentials/credential.types";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translator";
import { CATEGORY_RULES } from "@/lib/modules/hr/documents/employee-document.types";
import { QUALIFICATION_TYPE_RULES } from "@/lib/modules/hr/qualifications/qualification.types";
import { hrLabel } from "./hr-labels";

/**
 * HR's credential worklists (E-02 §153, §154): a list of what to open, each
 * row linking to the employee file or the person's qualifications where it is
 * verified, renewed or put away. Nothing is decided here; the rows are the
 * ones the server found this reader may act on.
 */

/**
 * "Document · Working contract" in the reader's language. The DTO carries the
 * English line, so the kind's name is found by its English label.
 */
function kindText(t: Translate<"hr">, item: CredentialWorkItemDTO): string {
  const document = item.kind === "employee_document";
  const rules: Record<string, { label: string }> = document ? CATEGORY_RULES : QUALIFICATION_TYPE_RULES;
  const english = item.kindLabel.slice(item.kindLabel.indexOf(" · ") + 3);
  const key = Object.keys(rules).find((candidate) => rules[candidate].label === english);
  if (!key) return item.kindLabel;
  return t(document ? "worklist.kindDocument" : "worklist.kindQualification", { kind: hrLabel(t, document ? "documentCategory" : "qualificationType", key, english) });
}

async function When({ item, view, t }: { item: CredentialWorkItemDTO; view: CredentialWorklistDTO["view"]; t: Translate<"hr"> }) {
  const locale = await getLocale();
  if (view === "verify") return <span className="whitespace-nowrap text-fg-muted">{t("worklist.added", { date: formatDate(item.createdAt, locale) })}</span>;
  if (!item.expiryDate || item.daysToExpiry === null) return <span className="text-fg-subtle">—</span>;
  const overdue = item.daysToExpiry < 0;
  return (
    <span className={overdue ? "whitespace-nowrap text-danger-strong" : "whitespace-nowrap text-warning-strong"}>
      {formatDate(item.expiryDate, locale)}
      <span className="block text-meta">{overdue ? t("worklist.daysAgo", { count: -item.daysToExpiry }) : item.daysToExpiry === 0 ? t("worklist.today") : t("worklist.inDays", { count: item.daysToExpiry })}</span>
    </span>
  );
}

export async function CredentialWorklist({ data }: { data: CredentialWorklistDTO }) {
  const t = await getTranslations("hr");
  if (data.items.length === 0) {
    return <EmptyState icon={<ShieldCheck />} title={t(`worklist.empty.${data.view}.title`)} description={t(`worklist.empty.${data.view}.description`)} />;
  }
  return (
    <div className="space-y-3" data-testid="credential-worklist" data-view={data.view}>
      <div className="nesto-card hidden p-0 md:block">
        <Table aria-label={t("worklist.label")}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t("recruitment.person")}</TableHeaderCell>
              <TableHeaderCell>{t("worklist.what")}</TableHeaderCell>
              <TableHeaderCell>{t("worklist.issuer")}</TableHeaderCell>
              <TableHeaderCell>{data.view === "verify" ? t("worklist.waitingSince") : t("worklist.expires")}</TableHeaderCell>
              <TableHeaderCell>{t("worklist.verification")}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.items.map((item) => (
              <TableRow key={`${item.kind}:${item.id}`} data-testid="worklist-item" data-kind={item.kind}>
                <TableCell className="font-medium text-fg">
                  <PersonLink personId={item.personId} name={item.personName} />
                </TableCell>
                <TableCell className="max-w-[22rem]">
                  <Link href={item.href} className="font-medium text-fg hover:text-accent-strong hover:underline">
                    {item.title}
                  </Link>
                  <span className="block text-meta text-fg-muted">{kindText(t, item)}</span>
                </TableCell>
                <TableCell>{item.issuer ?? "—"}</TableCell>
                <TableCell>
                  <When item={item} view={data.view} t={t} />
                </TableCell>
                <TableCell>
                  <Badge tone={item.verificationStatus === "VERIFIED" ? "success" : item.verificationStatus === "UNVERIFIED" ? "info" : "warning"}>{hrLabel(t, "verification", item.verificationStatus)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 md:hidden" aria-label={t("worklist.label")}>
        {data.items.map((item) => (
          <li key={`${item.kind}:${item.id}`} data-testid="worklist-card">
            <Link href={item.href} className="nesto-card block space-y-1 p-3 hover:border-line-strong">
              <span className="block font-medium text-fg">{item.title}</span>
              <span className="block text-meta text-fg-muted">
                {item.personName} · {kindText(t, item)}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-meta">
                <When item={item} view={data.view} t={t} />
                <Badge tone={item.verificationStatus === "VERIFIED" ? "success" : item.verificationStatus === "UNVERIFIED" ? "info" : "warning"}>{hrLabel(t, "verification", item.verificationStatus)}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {data.truncated ? <p className="text-meta text-fg-subtle">{t("worklist.truncated", { shown: data.items.length, total: data.counts[data.view] })}</p> : null}
    </div>
  );
}
