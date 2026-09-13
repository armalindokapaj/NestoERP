"use client";

import * as React from "react";
import { Download, FileWarning, Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { DocumentDetailDTO } from "@/lib/modules/documents/document.types";

/**
 * The file panel: preview, download and storage state (PRD #29 §100-§107,
 * §162-§165, §281, §333).
 *
 * Both controls ask the server for a short-lived grant rather than linking at
 * a URL. That is the difference that matters: the grant is the access
 * decision, it is made at the moment of the click with the caller's current
 * permissions, and it expires in three minutes (PRD #29 §101, §306).
 */

export function DocumentFilePanel({ document }: { document: DocumentDetailDTO }) {
  const file = document.file;

  if (file.storageStatus === "REJECTED") return <RejectedState reason={file.rejectionReason} />;
  if (file.storageStatus === "FAILED") return <FailedState />;
  if (!file.available && file.storageStatus !== "ARCHIVED") {
    return <ProcessingState message={file.storageMessage} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {document.capabilities.canDownload ? <DownloadButton documentId={document.id} /> : null}
        {file.scanStatus === "CLEAN" ? (
          <Badge tone="success">Checked for malware</Badge>
        ) : null}
      </div>

      {document.capabilities.canPreview ? (
        <PreviewFrame documentId={document.id} name={document.name} />
      ) : file.available ? (
        // Not a failure — most business formats simply have no safe inline
        // rendering, and saying so beats an empty box (PRD #29 §53, §281).
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {file.typeLabel} files cannot be previewed in the browser. Download the file to open it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Asks for a grant, then follows it (PRD #29 §100, §102).
 *
 * A plain `<a download>` would be a URL somebody could copy, keep and share.
 * This is a request that has to succeed first.
 */
function DownloadButton({ documentId }: { documentId: string }) {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);

  async function download() {
    setPending(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/download`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast({ title: body?.error?.message ?? "The file could not be downloaded.", tone: "danger" });
        return;
      }

      const grant = await response.json();
      window.location.href = grant.url;
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" onClick={download} disabled={pending}>
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
      {pending ? "Preparing…" : "Download"}
    </Button>
  );
}

/**
 * Inline preview for the formats that cannot execute (PRD #29 §44, §46, §47).
 *
 * The grant is fetched on mount and the object element points at it. The
 * sandbox and `nosniff` come from the storage response itself, so a file that
 * somehow reached here as something else still cannot run (PRD #29 §107,
 * §200).
 */
function PreviewFrame({ documentId, name }: { documentId: string; name: string }) {
  const [grant, setGrant] = React.useState<{ url: string; mimeType: string } | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const response = await fetch(`/api/documents/${documentId}/preview`, { method: "POST" });
      if (cancelled) return;
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setGrant(await response.json());
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (failed) {
    // A preview that cannot be produced never blocks the original
    // (PRD #29 §235, §281).
    return (
      <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
        Preview unavailable. Download the file instead.
      </p>
    );
  }

  if (!grant) {
    return (
      <div className="flex h-[28rem] items-center justify-center rounded-md border border-line bg-surface-muted">
        <p className="text-table text-fg-muted">Preparing preview…</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface-muted">
      <object
        data={grant.url}
        type={grant.mimeType}
        aria-label={`Preview of ${name}`}
        className="h-[28rem] w-full"
      >
        <p className="p-4 text-table text-fg-muted">
          This file cannot be previewed here. Download it instead.
        </p>
      </object>
    </div>
  );
}

/** Still being verified or scanned. No download control (PRD #29 §163). */
function ProcessingState({ message }: { message: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-line bg-surface-muted px-4 py-3.5">
      <Loader2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-fg-muted" />
      <div>
        <p className="text-table font-medium text-fg">{message ?? "Processing…"}</p>
        <p className="mt-0.5 text-meta text-fg-muted">
          The file becomes available once it has been checked.
        </p>
      </div>
    </div>
  );
}

/**
 * Refused (PRD #29 §164).
 *
 * A safe, generic reason. Whatever a scanner actually matched stays in the
 * audit trail, not in a message somebody can use to iterate against it
 * (PRD #29 §211).
 */
function RejectedState({ reason }: { reason: string | null }) {
  const malware = reason === "FILE_REJECTED_MALWARE";

  return (
    <div className="flex items-start gap-3 rounded-md border border-danger/40 bg-danger-soft px-4 py-3.5">
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger-strong" />
      <div>
        <p className="text-table font-medium text-fg">Upload rejected.</p>
        <p className="mt-0.5 text-meta text-fg-muted">
          {malware
            ? "This file did not pass a security check and cannot be downloaded."
            : "This file did not pass validation and cannot be downloaded."}
        </p>
      </div>
    </div>
  );
}

/** The upload never completed, or the object went missing (PRD #29 §165). */
function FailedState() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning-soft px-4 py-3.5">
      <FileWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-strong" />
      <div>
        <p className="text-table font-medium text-fg">File processing failed.</p>
        <p className="mt-0.5 text-meta text-fg-muted">
          The document record exists, but its file did not arrive. Upload it again.
        </p>
      </div>
    </div>
  );
}
