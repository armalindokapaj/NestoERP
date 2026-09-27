import { Badge } from "@/components/ui/badge";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { riskLevelLabels, likelihoodLabels, severityLabels as axisLabels } from "@/lib/modules/hse/hse.risk";
import { severityLabels, permitStatusLabels } from "@/lib/modules/hse/hse.status";
import { getTranslations } from "@/lib/i18n/server";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import type { RiskDTO } from "@/lib/modules/hse/hse.types";
import type { HsePermitStatus, HseRiskLevel, HseSeverity } from "@prisma/client";

/**
 * Reading risk at a glance (PRD #22 §330–§332, §358).
 *
 * Nothing here is colour-only. Every badge carries its words, and the risk
 * badge carries its number too: on a site tablet in daylight, and for anybody
 * who does not distinguish red from amber, the colour is decoration and the
 * text is the message (PRD #22 §332).
 */

const RISK_TONE: Record<HseRiskLevel, "default" | "neutral" | "warning" | "danger"> = {
  LOW: "default",
  MEDIUM: "neutral",
  HIGH: "warning",
  CRITICAL: "danger",
};

const SEVERITY_TONE: Record<HseSeverity, "default" | "neutral" | "warning" | "danger"> = {
  LOW: "default",
  MEDIUM: "neutral",
  HIGH: "warning",
  CRITICAL: "danger",
};

/** The level and the score together — "High 12", never a bare colour. */
export async function RiskBadge({ risk, showScore = true }: { risk: RiskDTO; showScore?: boolean }) {
  const t = await getTranslations("hse");
  return (
    <Badge tone={RISK_TONE[risk.level]}>
      {hseLabel(t, "riskLevel", risk.level, riskLevelLabels[risk.level])}
      {showScore ? ` ${risk.score}` : ""}
    </Badge>
  );
}

export async function SeverityBadge({ severity }: { severity: HseSeverity }) {
  const t = await getTranslations("hse");
  return <Badge tone={SEVERITY_TONE[severity]}>{hseLabel(t, "severity", severity, severityLabels[severity])}</Badge>;
}

/**
 * How a permit stands right now (PRD #22 §151, §360).
 *
 * When the stored status and the clock disagree, the clock wins and the badge
 * says so — a permit that ran out last night must never read as active.
 */
export async function PermitStatusBadge({
  status,
  effectiveStatus,
}: {
  status: HsePermitStatus;
  effectiveStatus: HsePermitStatus;
}) {
  const t = await getTranslations("hse");
  const lapsed = effectiveStatus !== status && effectiveStatus === "EXPIRED";

  return (
    <span className="flex items-center gap-2">
      <Badge tone={effectiveStatus === "ACTIVE" ? "success" : lapsed ? "danger" : "neutral"}>
        {hseLabel(t, "permitStatus", effectiveStatus, permitStatusLabels[effectiveStatus])}
      </Badge>
      {lapsed ? (
        <span className="text-meta text-fg-subtle">{t("format.was", { status: hseLabel(t, "permitStatus", status, permitStatusLabels[status]) })}</span>
      ) : null}
    </span>
  );
}

/** How long is left on a permit, in words (PRD #22 §322). */
export async function PermitClock({ hoursRemaining }: { hoursRemaining: number }) {
  const t = await getTranslations("hse");
  if (hoursRemaining < 0) {
    const hours = Math.abs(hoursRemaining);
    return (
      <span className="text-danger-strong">
        {t("format.expiredAgo", { time: hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d` })}
      </span>
    );
  }

  if (hoursRemaining < 24) {
    return <span className="text-warning-strong">{t("format.expiresIn", { hours: hoursRemaining })}</span>;
  }

  return <span>{t("format.daysLeft", { days: Math.floor(hoursRemaining / 24) })}</span>;
}

/**
 * The 5×5 grid, with a count of open hazards in each cell (PRD #22 §357).
 *
 * Rendered as a table rather than a grid of divs so a screen reader can read a
 * cell against its two axes. Each cell names its score and its level in the
 * accessible label, because a coloured square with a number in it says nothing
 * on its own (PRD #22 §358).
 */
export async function RiskMatrix({
  cells,
  hrefFor,
}: {
  cells: { likelihood: number; severity: number; count: number; score: number; level: string }[];
  hrefFor?: (cell: { likelihood: number; severity: number }) => string;
}) {
  const t = await getTranslations("hse");
  const axis = [1, 2, 3, 4, 5];
  const at = (likelihood: number, severity: number) =>
    cells.find((cell) => cell.likelihood === likelihood && cell.severity === severity);

  const tone: Record<string, string> = {
    LOW: "bg-success-subtle text-success-strong",
    MEDIUM: "bg-info-subtle text-info-strong",
    HIGH: "bg-warning-subtle text-warning-strong",
    CRITICAL: "bg-danger-subtle text-danger-strong",
  };

  /*
   * AUD-04 §3, §8 (D-03-01, D-03-02, MW-17, MW-19). The matrix fits the card at
   * 320px: fixed columns, axis numbers only on a phone with the words in a
   * legend under it, so the High/Critical corner is never off-screen. It stays
   * inside a labelled scroll region as a fallback for very large text. Every
   * cell carries its full reading as text (sr-only), linked or not: an
   * aria-label on a plain span is not announced.
   */
  return (
    <div className="space-y-2">
      <ScrollRegion label={t("format.riskMatrix")}>
        <table className="w-full table-fixed border-separate border-spacing-1 text-center text-meta">
          <caption className="sr-only">
            {t("format.matrixCaption")}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-10 text-left font-normal text-fg-subtle sm:w-28">
                <span aria-hidden="true" className="sm:hidden">L↓ S→</span>
                <span className="max-sm:sr-only">{t("format.matrixAxes")}</span>
              </th>
              {axis.map((severity) => (
                <th key={severity} scope="col" className="font-medium text-fg-muted">
                  {severity}
                  <span className="block text-fg-subtle max-sm:sr-only">{hseLabel(t, "axisSeverity", severity, axisLabels[severity])}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...axis].reverse().map((likelihood) => (
              <tr key={likelihood}>
                <th scope="row" className="text-left font-medium text-fg-muted">
                  {likelihood}
                  <span className="block font-normal text-fg-subtle max-sm:sr-only">
                    {hseLabel(t, "likelihood", likelihood, likelihoodLabels[likelihood])}
                  </span>
                </th>
                {axis.map((severity) => {
                  const cell = at(likelihood, severity);
                  if (!cell) return <td key={severity} />;

                  const label = t("format.cellLabel", { count: cell.count, score: cell.score, level: hseLabel(t, "riskLevel", cell.level, riskLevelLabels[cell.level as HseRiskLevel]) });
                  const body = (
                    <>
                      <span aria-hidden="true" className="flex flex-col py-2">
                        <span className="text-body font-semibold">{cell.count || "—"}</span>
                        <span className="text-meta">{cell.score}</span>
                      </span>
                      <span className="sr-only">{label}</span>
                    </>
                  );

                  return (
                    <td key={severity} className={`rounded ${tone[cell.level]}`}>
                      {hrefFor && cell.count > 0 ? (
                        <a href={hrefFor(cell)} className="block">
                          {body}
                        </a>
                      ) : (
                        body
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <dl className="grid grid-cols-1 gap-1 text-meta text-fg-subtle sm:hidden" aria-hidden="true">
        <div>
          <dt className="inline font-medium text-fg-muted">{t("format.likelihood")}</dt>
          <dd className="inline">{axis.map((n) => `${n} ${hseLabel(t, "likelihood", n, likelihoodLabels[n])}`).join(" · ")}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-fg-muted">{t("format.severity")}</dt>
          <dd className="inline">{axis.map((n) => `${n} ${hseLabel(t, "axisSeverity", n, axisLabels[n])}`).join(" · ")}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * What still stands between a record and its closure (PRD #22 §73, §95, §174).
 *
 * Named, not hidden behind a disabled button. Somebody looking at a hazard they
 * cannot close needs to know it is the unverified action, not a permission.
 */
export function BlockedList({
  title,
  reasons,
}: {
  title: string;
  reasons: string[];
}) {
  if (reasons.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning-border bg-warning-subtle p-4">
      <p className="text-body font-medium text-warning-strong">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-meta text-fg-muted">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The operational injury flags on an incident (PRD #22 §22, §317).
 *
 * Flags only. There is no diagnosis to render because there is none stored —
 * that boundary is the point, not an omission (PRD #22 §22).
 */
export async function InjuryFlags({
  flags,
}: {
  flags: {
    injuryOccurred: boolean;
    firstAidRequired: boolean;
    medicalTreatmentRequired: boolean;
    lostTime: boolean;
    propertyDamage: boolean;
    environmentalImpact: boolean;
  };
}) {
  const t = await getTranslations("hse");
  const set: { label: string; tone: "danger" | "warning" | "neutral" }[] = [];
  if (flags.injuryOccurred) set.push({ label: t("format.injury"), tone: "danger" });
  if (flags.lostTime) set.push({ label: t("format.lostTime"), tone: "danger" });
  if (flags.medicalTreatmentRequired) set.push({ label: t("format.medicalTreatment"), tone: "warning" });
  if (flags.firstAidRequired) set.push({ label: t("format.firstAid"), tone: "warning" });
  if (flags.propertyDamage) set.push({ label: t("format.propertyDamage"), tone: "neutral" });
  if (flags.environmentalImpact) set.push({ label: t("format.environmentalImpact"), tone: "neutral" });

  if (set.length === 0) {
    return <span className="text-meta text-fg-subtle">{t("format.noInjury")}</span>;
  }

  return (
    <span className="flex flex-wrap gap-1.5">
      {set.map((flag) => (
        <Badge key={flag.label} tone={flag.tone}>
          {flag.label}
        </Badge>
      ))}
    </span>
  );
}
