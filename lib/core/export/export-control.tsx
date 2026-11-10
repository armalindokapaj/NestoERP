"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Download } from "@/components/icons";

import { useLocale } from "@/components/i18n/i18n-provider";
import { FoldIntoPageMenu, usePageMenuInline } from "@/components/navigation/page-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * The one Export control (AUD-08 §7, §8; DT-14, DT-17).
 *
 * It states its scope — every record the list's filters match, in the standard
 * columns — and exports exactly that: the page's own address, the section it
 * is on and every filter, minus the page and page size. The file is fetched,
 * not followed, so:
 *
 *   - Preparing → Ready → Failed is shown as it happens, and a second click
 *     while one export prepares does nothing;
 *   - a refusal (too many rows, a filter the export does not support, no
 *     permission) reads as the server's own sentence beside the button, with
 *     Try again — it is never saved as a `.csv`;
 *   - only a complete CSV response is handed to the browser, and the message
 *     says the download started — a browser cannot tell a page whether the
 *     person kept the file.
 *
 * Nothing here decides what may leave: the endpoint re-checks permission,
 * scope and every filter on each request.
 *
 * Below `lg` it is a secondary page action (mobile audit 2c): the button is an
 * item of the page's ⋯ at the end of the title row (`FoldIntoPageMenu`,
 * components/navigation/page-menu.tsx), and only what it has to say —
 * Preparing, the download started, a failure with Try again — is drawn where
 * it sat. A blocked export stays a button, so its reason is on screen, and a
 * control outside a page header passes `inPageMenu={false}`.
 */

type State =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "ready"; count: number }
  | { kind: "failed"; message: string };

/**
 * The control's own sentences, English and Albanian, until they move into the
 * message catalogue (`lib/i18n/messages`, not this lane's file).
 */
const COPY = {
  en: {
    scope: "All matching records · Standard columns",
    preparing: "Preparing CSV…",
    ready: (count: number) => `Download started: ${count.toLocaleString("en-US")} ${count === 1 ? "record" : "records"}.`,
    failed: "The CSV could not be prepared.",
    retry: "Try again",
  },
  sq: {
    scope: "Të gjitha regjistrimet që përputhen · Kolonat standarde",
    preparing: "Po përgatitet CSV…",
    ready: (count: number) => `Shkarkimi filloi: ${count.toLocaleString("en-US")} ${count === 1 ? "regjistrim" : "regjistrime"}.`,
    failed: "CSV nuk u përgatit dot.",
    retry: "Provo përsëri",
  },
} as const;

function filenameFrom(disposition: string | null): string | null {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

export type ExportControlProps = {
  /** The export route, e.g. `/api/sales/export`. */
  endpoint: string;
  /** The parameter that picks the file, e.g. `{ param: "type", value: "leads" }`. */
  selector?: { param: string; value: string };
  /** Rewrites the page's query into the export's (a section from the path, a renamed filter). */
  adjust?: (params: URLSearchParams, pathname: string) => void;
  label: string;
  /** A reason the export cannot run now, shown instead of running it. */
  blocked?: string | null;
  /** A localised sentence for a refusal code; the server's own sentence otherwise. */
  messageFor?: (error: { code?: string; businessCode?: string; message?: string }) => string | undefined;
  /** Replaces the scope line, e.g. a translated one. */
  scopeLabel?: string;
  /** Replaces the Ready sentence, e.g. a translated one. */
  readyLabel?: (count: number) => string;
  /** Replaces the generic failure and Try again sentences, e.g. translated ones. */
  failedLabel?: string;
  retryLabel?: string;
  testId?: string;
  /** Below lg the button is an item of the page's ⋯ (the default, for a page header's Export); false keeps it where it is. */
  inPageMenu?: boolean;
};

export function ExportControl({
  endpoint,
  selector,
  adjust,
  label,
  blocked = null,
  messageFor,
  scopeLabel,
  readyLabel,
  failedLabel,
  retryLabel,
  testId = "export",
  inPageMenu = true,
}: ExportControlProps) {
  const locale = useLocale();
  const base = COPY[locale === "sq" ? "sq" : "en"];
  const copy = { ...base, ready: readyLabel ?? base.ready, failed: failedLabel ?? base.failed, retry: retryLabel ?? base.retry };
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [state, setState] = React.useState<State>({ kind: "idle" });
  const running = React.useRef(false);
  const scopeId = React.useId();
  const inline = usePageMenuInline();

  function href(): string {
    const params = new URLSearchParams(searchParams.toString());
    // An export is every match: the page and the page size are the screen's, not the file's.
    params.delete("page");
    params.delete("limit");
    params.delete("pageSize");
    adjust?.(params, pathname);
    if (selector) params.set(selector.param, selector.value);
    const query = params.toString();
    return query ? `${endpoint}?${query}` : endpoint;
  }

  async function run() {
    if (blocked || running.current) return;
    running.current = true;
    setState({ kind: "preparing" });
    try {
      const response = await fetch(href(), { cache: "no-store", credentials: "same-origin" });
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !type.startsWith("text/csv")) {
        const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: { code?: string } } } | null;
        const error = body?.error;
        const message = messageFor?.({ code: error?.code, businessCode: error?.details?.code, message: error?.message }) ?? error?.message ?? copy.failed;
        setState({ kind: "failed", message });
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
      setState({ kind: "ready", count });
    } catch {
      setState({ kind: "failed", message: copy.failed });
    } finally {
      running.current = false;
    }
  }

  const preparing = state.kind === "preparing";
  const unavailable = blocked !== null || preparing;
  // Folded into the page's ⋯ below lg; a blocked export stays a button there, its reason beside it.
  const fold = inPageMenu && blocked === null;

  const control = (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={run}
        aria-disabled={unavailable}
        aria-busy={preparing}
        aria-describedby={scopeId}
        data-testid={testId}
        data-state={state.kind}
        className={unavailable ? "cursor-not-allowed opacity-60" : undefined}
      >
        <Download aria-hidden="true" />
        {preparing ? copy.preparing : label}
      </Button>
      {/* The scope line names the columns, which a phone's cards do not show: below md it is the button's description only, unless it says why the export cannot run. */}
      <p id={scopeId} className={cn("max-w-xs text-meta text-fg-muted sm:text-right", blocked === null && "max-md:sr-only")} data-testid={`${testId}-scope`}>
        {blocked ?? scopeLabel ?? copy.scope}
      </p>
    </>
  );

  return (
    <>
      {/* Below lg, while the folded button has nothing to say, the block takes no room in the header row. */}
      <div className={cn("flex min-w-0 flex-col items-start gap-1 sm:items-end", fold && !inline && state.kind === "idle" && "max-lg:hidden")} data-testid={`${testId}-control`}>
        {fold ? <FoldIntoPageMenu item={{ kind: "action", label, icon: <Download aria-hidden="true" />, onSelect: () => void run() }}>{control}</FoldIntoPageMenu> : control}
        {/* What the folded button would say while it prepares; from lg the button says it. */}
        {fold && !inline && preparing ? (
          <p className="text-meta text-fg-muted lg:hidden" aria-hidden="true">
            {copy.preparing}
          </p>
        ) : null}
        {state.kind === "ready" ? (
          <p className="max-w-xs text-meta text-fg-muted sm:text-right" aria-hidden="true" data-testid={`${testId}-ready`}>
            {copy.ready(state.count)}
          </p>
        ) : null}
        {state.kind === "failed" ? (
          <div role="alert" data-testid={`${testId}-error`} className="flex max-w-xs flex-wrap items-center gap-2 text-meta text-danger-strong sm:justify-end">
            <span>{state.message}</span>
            <Button type="button" variant="ghost" size="sm" onClick={run}>
              {copy.retry}
            </Button>
          </div>
        ) : null}
      </div>
      {/* Outside the block, so it is announced at every width, folded or not. */}
      <p role="status" className="sr-only" data-testid={`${testId}-status`}>
        {preparing ? copy.preparing : state.kind === "ready" ? copy.ready(state.count) : ""}
      </p>
    </>
  );
}
