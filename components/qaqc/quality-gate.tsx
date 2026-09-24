import Link from "@/components/navigation/nav-link";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/modules/status-badge";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import * as materials from "@/lib/modules/qaqc/materials/material.service";
import { inspectionResultLabels } from "@/lib/modules/qaqc/qaqc.status";

/**
 * The quality position on a delivery, shown where it matters
 * (PRD #21 §12, §13, §29).
 *
 * Procurement sees whether the material it accepted has been through quality;
 * Inventory sees how much it may actually book in. Neither gets the inspector's
 * findings — this is a gate, not a report (PRD #21 §28, §29).
 *
 * When nobody has inspected the delivery at all, quality is not gating it and
 * the panel says so rather than implying something is missing (§95).
 */
export async function QualityGate({
  context,
  goodsReceiptId,
}: {
  context: UserContext;
  goodsReceiptId: string;
}) {
  if (!can(context, "qaqc.material.view")) return null;

  const status = await materials.materialQualityStatus(context, goodsReceiptId);
  if (!status) return null;

  if (!status.inspectionId) {
    return (
      <p className="text-meta text-fg-subtle">
        Quality is not gating this delivery — no material inspection has been raised against it.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-table text-fg">
          <span className="font-medium">Quality</span>
          {can(context, "qaqc.inspection.view") ? (
            <Link
              href={`/qaqc/inspections/${status.inspectionId}`}
              className="text-accent-strong hover:underline"
            >
              {status.inspectionNumber}
            </Link>
          ) : (
            <span className="text-fg-muted">{status.inspectionNumber}</span>
          )}
          {status.inspectionStatus ? <StatusBadge status={status.inspectionStatus} /> : null}
          {status.result && status.result !== "NOT_SET" ? (
            <Badge tone={status.result === "PASS" ? "success" : status.result === "FAIL" ? "danger" : "warning"}>
              {inspectionResultLabels[status.result]}
            </Badge>
          ) : null}
        </p>

        {status.clearedForPosting ? (
          <Badge tone="success">Cleared for stock</Badge>
        ) : (
          <Badge tone="warning">Not cleared</Badge>
        )}
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        <Figure label="Released" value={status.releasedQuantity} />
        <Figure label="Rejected" value={status.rejectedQuantity} />
        <Figure label="Conditional" value={status.conditionalQuantity} />
      </dl>

      {status.blockedReason ? (
        <p className="mt-2 text-meta text-fg-subtle">{status.blockedReason}</p>
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table tabular-nums text-fg">{value}</dd>
    </div>
  );
}
