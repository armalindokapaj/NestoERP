"use client";

import * as React from "react";

import { CircleAlert, FileQuestion, Lock, TriangleAlert, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useTranslations } from "@/components/i18n/i18n-provider";

export type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
  /** The Retry button's label, for callers that translate it. */
  retryLabel?: string;
  className?: string;
  /** Icon shown in the badge; the variants below choose theirs. */
  icon?: React.ReactNode;
  /** `section` sits inside a page (smaller); `page` is the whole content area. */
  size?: "page" | "section";
  /** A second way out (Back, Home), beside Retry. */
  action?: React.ReactNode;
};

/** The standard NESTO error component (spec §58). */
export function ErrorState({
  title: titleProp,
  description: descriptionProp,
  onRetry,
  retryLabel: retryLabelProp,
  className,
  icon,
  size = "page",
  action,
}: ErrorStateProps) {
  const t = useTranslations("ui");
  const title = titleProp ?? t("errorTitle");
  const description = descriptionProp ?? t("errorBody");
  const retryLabel = retryLabelProp ?? t("retry");
  // Announced when it appears: a failed load replaces what the reader was
  // waiting for (AUD-05 §6, §8).
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-line bg-surface px-4 text-center sm:px-6",
        size === "page" ? "py-14" : "py-8",
        className,
      )}
    >
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger-strong">
        {icon ?? <TriangleAlert aria-hidden="true" className="size-5" />}
      </div>
      <p className="text-card font-semibold text-fg [overflow-wrap:anywhere]">{title}</p>
      <p className="mt-1 max-w-sm text-table text-fg-muted">{description}</p>
      {onRetry || action ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}

/*
 * The MOB-01 §33 family. Every one is the same component with the right words,
 * so the look, the alert role and the wrapping are shared. None shows a raw
 * exception; pass `description` only with copy written for people.
 */
type Variant = Omit<ErrorStateProps, "icon" | "size">;

/** A whole content area failed to load. */
export function PageError(props: Variant) {
  return <ErrorState size="page" {...props} />;
}

/** One section of a page failed; the rest of the page still works. */
export function SectionError(props: Variant) {
  return <ErrorState size="section" {...props} />;
}

/** A single field or row failed. A line of text, announced, not a card. */
export function InlineError({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("flex items-start gap-1.5 text-table text-danger-strong [overflow-wrap:anywhere]", className)}>
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The request could not reach the server. Retry is the way out. */
export function NetworkError({ title, description, ...props }: Variant) {
  const t = useTranslations("ui");
  return (
    <ErrorState
      icon={<WifiOff aria-hidden="true" className="size-5" />}
      title={title ?? t("networkTitle")}
      description={description ?? t("networkBody")}
      {...props}
    />
  );
}

/** Signed in, but not allowed. Say who to ask, never what exists. */
export function PermissionError({ title, description, ...props }: Variant) {
  const t = useTranslations("ui");
  return (
    <ErrorState
      icon={<Lock aria-hidden="true" className="size-5" />}
      title={title ?? t("permissionTitle")}
      description={description ?? t("permissionBody")}
      {...props}
    />
  );
}

/** Nothing at this address, or nothing this person may see there. */
export function NotFound({ title, description, ...props }: Variant) {
  const t = useTranslations("ui");
  return (
    <ErrorState
      icon={<FileQuestion aria-hidden="true" className="size-5" />}
      title={title ?? t("notFoundTitle")}
      description={description ?? t("notFoundBody")}
      {...props}
    />
  );
}
