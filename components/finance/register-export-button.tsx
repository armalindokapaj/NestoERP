"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import type { FinanceExportEligibility } from "@/lib/modules/finance/finance.workspace";

/**
 * Export filtered CSV (AUD-01 §8, §9).
 *
 * A fresh read of the register's current filters when clicked — every match,
 * not the page — fetched rather than followed, so a refusal or a failure reads
 * as a message beside the button instead of replacing the page, and nothing is
 * saved unless a whole file arrived. The button stays focusable when it cannot
 * be used and says why; a second click while one export runs does nothing.
 */
type State =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; count: number }
  | { kind: "failed"; message: string };

function filenameFrom(disposition: string | null): string | null {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

export function RegisterExportButton({
  endpoint,
  matchingCount,
  eligibility,
}: {
  endpoint: string;
  matchingCount: number;
  eligibility: FinanceExportEligibility;
}) {
  const t = useTranslations("financeRegister");
  const searchParams = useSearchParams();
  const [state, setState] = React.useState<State>({ kind: "idle" });
  const running = React.useRef(false);
  const hintId = React.useId();

  if (eligibility.state === "unavailable") return null;

  const blocked =
    eligibility.state === "choose-company"
      ? t("exportChooseCompany", { companies: eligibility.companies.map((company) => company.name).join(", ") })
      : matchingCount === 0
        ? t("exportNothing")
        : null;

  function messageFor(body: unknown): string {
    const error = (body as { error?: { code?: string; details?: { code?: string } } } | null)?.error;
    const code = error?.details?.code;
    if (code === "EXPORT_LIMIT_EXCEEDED") return t("exportTooMany");
    if (code === "EXPORT_COMPANY_REQUIRED") return t("exportCompanyRequired");
    if (error?.code === "FORBIDDEN" || error?.code === "MODULE_UNAVAILABLE") return t("exportUnavailable");
    return t("exportFailed");
  }

  async function run() {
    if (blocked || running.current) return;
    running.current = true;
    setState({ kind: "pending" });
    try {
      // The server ignores the page and the page size: an export is every match.
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      params.delete("limit");
      const query = params.toString();
      const response = await fetch(query ? `${endpoint}?${query}` : endpoint, { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "failed", message: messageFor(await response.json().catch(() => null)) });
        return;
      }
      const blob = await response.blob();
      const count = Number(response.headers.get("x-export-row-count") ?? "0");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFrom(response.headers.get("content-disposition")) ?? "nesto-export.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setState({ kind: "done", count });
    } catch {
      setState({ kind: "failed", message: t("exportFailed") });
    } finally {
      running.current = false;
    }
  }

  const pending = state.kind === "pending";

  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5 sm:items-end" data-testid="register-export-control">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={run}
        aria-disabled={blocked !== null || pending}
        aria-describedby={blocked ? hintId : undefined}
        data-testid="register-export"
        className={blocked !== null || pending ? "cursor-not-allowed opacity-60" : undefined}
      >
        <Download aria-hidden="true" />
        {pending ? t("exporting") : t("exportCsv")}
      </Button>
      {blocked ? (
        <p id={hintId} className="max-w-xs text-meta text-fg-muted sm:text-right">
          {blocked}
        </p>
      ) : null}
      <p role="status" className="sr-only" data-testid="register-export-status">
        {pending ? t("exporting") : state.kind === "done" ? t("exportDone", { count: state.count }) : ""}
      </p>
      {state.kind === "failed" ? (
        <div role="alert" data-testid="register-export-error" className="flex max-w-xs flex-wrap items-center gap-2 text-meta text-danger-strong sm:justify-end">
          <span>{state.message}</span>
          <Button type="button" variant="ghost" size="sm" onClick={run}>
            {t("exportRetry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
