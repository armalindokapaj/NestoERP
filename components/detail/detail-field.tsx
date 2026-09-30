import * as React from "react";
import { ExternalLink } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { StatusBadge } from "@/components/modules/status-badge";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils/cn";

/**
 * One label and its value on a record's detail page (MOB-04 §9).
 *
 * The value keeps its meaning by `kind`: a plain string, a link to another
 * record, a status badge, a date, a money amount (exact figure, currency kept,
 * never truncated), a person, a relation, an e-mail or a phone number. Long
 * content breaks anywhere instead of widening the page. Copy is offered only
 * where `copy` says a person would use it (an ID, a reference, an e-mail) —
 * never as a permanent icon on every row (§71).
 *
 * A field a reader may not see is not rendered at all: pass `null`/`false` in
 * the list (`DetailFieldList` drops it) rather than an empty value, and never
 * infer access from the API object carrying a value (§58).
 */
export type DetailFieldKind = "text" | "link" | "status" | "date" | "money" | "person" | "relation" | "email" | "phone" | "external";

export type DetailFieldProps = {
  label: string;
  /** Text or already-formatted content. Empty renders an em dash, so a missing value is visible. */
  value?: React.ReactNode;
  kind?: DetailFieldKind;
  /** Destination for `link`, `relation`, `person` and `external`. */
  href?: string;
  /** What Copy puts on the clipboard; omit for no Copy. */
  copy?: string;
  /** Right-align and tabulate a figure (money, quantity). */
  figure?: boolean;
  className?: string;
};

const EMPTY = "—";

export function DetailField({ label, value, kind = "text", href, copy, figure, className }: DetailFieldProps) {
  const empty = value === undefined || value === null || value === "";
  const text = typeof value === "string" ? value : undefined;
  let body: React.ReactNode = empty ? <span className="text-fg-subtle">{EMPTY}</span> : value;

  if (!empty) {
    if (kind === "status" && text) body = <StatusBadge status={text} />;
    else if ((kind === "link" || kind === "relation" || kind === "person") && href) {
      body = (
        <Link href={href} className="inline-flex min-h-6 items-center text-accent-strong hover:underline touch:min-h-11">
          {value}
        </Link>
      );
    } else if (kind === "email" && text) {
      body = (
        <a href={`mailto:${text}`} className="text-accent-strong hover:underline touch:inline-flex touch:min-h-11 touch:items-center">
          {text}
        </a>
      );
    } else if (kind === "phone" && text) {
      body = (
        <a href={`tel:${text.replace(/[^\d+]/g, "")}`} className="text-accent-strong hover:underline touch:inline-flex touch:min-h-11 touch:items-center">
          {text}
        </a>
      );
    } else if (kind === "external" && href) {
      // Marked as leaving NESTO; the native shell decides in-app or system browser (MOB-04 §73).
      body = (
        <a href={href} target="_blank" rel="noopener noreferrer" data-external-link className="inline-flex items-center gap-1 text-accent-strong hover:underline">
          {value}
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      );
    }
  }

  return (
    <div className={cn("min-w-0", className)} data-detail-field={label}>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className={cn("mt-1 flex min-w-0 items-start gap-1 text-body text-fg [overflow-wrap:anywhere]", figure && "tabular-nums")}>
        <span className="min-w-0">{body}</span>
        {copy ? <CopyButton value={copy} label={label} /> : null}
      </dd>
    </div>
  );
}

export type DetailFieldSpec = (DetailFieldProps & { key?: string }) | null | false | undefined;

/** A `dl` of fields: one column on a phone, two from `sm` (three with `columns={3}` from `lg`). */
export function DetailFieldList({ fields, columns = 2, className }: { fields: DetailFieldSpec[]; columns?: 1 | 2 | 3; className?: string }) {
  const visible = fields.filter((field): field is DetailFieldProps & { key?: string } => Boolean(field));
  return (
    <dl className={cn("grid gap-x-8 gap-y-4", columns >= 2 && "sm:grid-cols-2", columns === 3 && "lg:grid-cols-3", className)}>
      {visible.map((field) => (
        <DetailField key={field.key ?? field.label} {...field} />
      ))}
    </dl>
  );
}
