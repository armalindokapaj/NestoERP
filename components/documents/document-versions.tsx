"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Check, Download, History, Loader2, Send, Upload, X } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { formatFileSize } from "@/lib/modules/documents/document.files";
import type {
  DocumentReviewDTO,
  DocumentVersionDTO,
  VersionHistoryDTO,
} from "@/lib/modules/documents/versions/version.service";
import { formatDateTime } from "@/lib/utils/format";
import { startDownload } from "@/lib/navigation/start-download";

/**
 * Version history and review (PRD #38 §56-§63, §67, §68).
 *
 * Every control here is a request the server decides again: a new version is
 * an upload grant, an old version is a download grant, and a review decision is
 * accepted only from the reviewer it was assigned to. The capabilities in the
 * response decide which controls are offered, never whether an action is
 * allowed.
 */

type Failure = { status: number; message: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: { message?: string; details?: unknown } }
    | null;
  if (!response.ok) {
    const details = json?.error?.details;
    const fieldMessage =
      details && typeof details === "object" && !Array.isArray(details)
        ? Object.values(details as Record<string, unknown>).flat().find((value) => typeof value === "string")
        : undefined;
    throw {
      status: response.status,
      message: (fieldMessage as string | undefined) ?? json?.error?.message ?? "Something went wrong.",
    } satisfies Failure;
  }
  return (json?.data ?? json) as T;
}

/** No answer came back (a lost connection): the step may or may not have happened (AUD-03 §6). */
function unconfirmed(error: unknown): boolean {
  const status = (error as Partial<Failure> | null)?.status;
  return !(typeof status === "number" && status > 0);
}

/**
 * A version dialog's input, registered with the tab's unsaved-work coordinator
 * (AUD-03 §3, §5). Each of these dialogs ends in a step — upload, send for
 * review, approve, reject — so closing with input asks, and Save and continue
 * never takes the step.
 */
function useDialogInput(dirty: boolean, workflow: string, label: string) {
  const editor = useUnsavedEditor({ module: "documents", saveKind: "none", workflow, label });
  const { setDirty } = editor;
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);
  return editor;
}

function failureText(error: unknown): string {
  const failure = error as Partial<Failure>;
  if (failure?.status === 404) return "This document or version is no longer available.";
  return failure?.message || "Something went wrong.";
}

const REVIEW_STATE: Record<DocumentVersionDTO["reviewState"], { label: string; tone: "default" | "info" | "success" | "danger" | "warning" }> = {
  DRAFT: { label: "Draft", tone: "default" },
  IN_REVIEW: { label: "In review", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  SUPERSEDED: { label: "Superseded", tone: "warning" },
};

const REVIEW_STATUS: Record<DocumentReviewDTO["status"], string> = {
  PENDING: "Waiting for a decision",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

function storageNote(status: DocumentVersionDTO["storageStatus"]): string | null {
  switch (status) {
    case "AVAILABLE":
    case "ARCHIVED":
      return null;
    case "REJECTED":
      return "This file was rejected and cannot be downloaded.";
    case "FAILED":
      return "This upload did not complete.";
    default:
      return "Being checked — it becomes the current version once verified.";
  }
}

export function DocumentVersions({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [history, setHistory] = React.useState<VersionHistoryDTO | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [reviewFor, setReviewFor] = React.useState<DocumentVersionDTO | null>(null);
  const [decision, setDecision] = React.useState<{ review: DocumentReviewDTO; outcome: "approve" | "reject" } | null>(null);

  const load = React.useCallback(async () => {
    try {
      setHistory(await api<VersionHistoryDTO>(`/api/documents/${documentId}/versions`));
      setError(null);
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [documentId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // A version still being checked settles on its own; look again a few times,
  // then stop — a backed-up scan queue should not be polled by every open tab.
  const polls = React.useRef(0);
  const processing = history?.versions.some((version) => ["PENDING_UPLOAD", "UPLOADED", "VERIFYING", "SCANNING"].includes(version.storageStatus));
  React.useEffect(() => {
    if (!processing || polls.current >= 24) return;
    const timer = window.setTimeout(() => {
      polls.current += 1;
      void load();
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [processing, history, load]);
  const wasProcessing = React.useRef(false);
  React.useEffect(() => {
    // The promoted version is now what the file panel above should serve.
    if (wasProcessing.current && !processing) router.refresh();
    wasProcessing.current = Boolean(processing);
  }, [processing, router]);

  async function changed() {
    polls.current = 0;
    await load();
    router.refresh();
  }

  return (
    <section className="nesto-card p-5" aria-labelledby="document-versions-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="document-versions-heading" className="flex items-center gap-2 text-card font-semibold text-fg">
          <History aria-hidden="true" className="size-4 text-fg-subtle" />
          Versions
        </h2>
        {history?.capabilities.canUploadVersion ? (
          <Button size="sm" variant="secondary" onClick={() => setUploadOpen(true)}>
            <Upload aria-hidden="true" />
            Upload new version
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-table text-danger-strong" role="alert">
          {error}
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : !history ? (
        <p className="mt-4 flex items-center gap-2 text-table text-fg-subtle">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading versions…
        </p>
      ) : history.versions.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">No versions recorded yet.</p>
      ) : (
        <ol className="mt-4 divide-y divide-line">
          {history.versions.map((version) => (
            <VersionRow
              key={version.id}
              documentId={documentId}
              version={version}
              reviewable={history.capabilities.reviewable}
              onRequestReview={() => setReviewFor(version)}
              onDecide={(review, outcome) => setDecision({ review, outcome })}
            />
          ))}
        </ol>
      )}

      <UploadVersionDialog
        documentId={documentId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={changed}
      />
      <RequestReviewDialog
        documentId={documentId}
        version={reviewFor}
        onOpenChange={(open) => (open ? null : setReviewFor(null))}
        onRequested={changed}
      />
      <DecisionDialog
        decision={decision}
        onOpenChange={(open) => (open ? null : setDecision(null))}
        onDecided={changed}
      />
    </section>
  );
}

function VersionRow({
  documentId,
  version,
  reviewable,
  onRequestReview,
  onDecide,
}: {
  documentId: string;
  version: DocumentVersionDTO;
  reviewable: boolean;
  onRequestReview: () => void;
  onDecide: (review: DocumentReviewDTO, outcome: "approve" | "reject") => void;
}) {
  const state = REVIEW_STATE[version.reviewState];
  const note = storageNote(version.storageStatus);

  return (
    <li className="py-4 first:pt-0 last:pb-0" data-testid={`document-version-${version.versionNumber}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-body font-medium text-fg">
            Version {version.versionNumber}
            {version.current ? <Badge tone="neutral">Current</Badge> : null}
            {reviewable ? <Badge tone={state.tone}>{state.label}</Badge> : null}
          </p>
          <p className="mt-1 truncate text-table text-fg-muted">
            {version.fileName ?? "Unnamed file"} · {formatFileSize(version.sizeBytes)}
          </p>
          <p className="text-meta text-fg-subtle">
            {version.uploadedBy ? <PersonLink memberId={version.uploadedBy.memberId} name={version.uploadedBy.fullName} /> : "Someone"} · {formatDateTime(version.createdAt)}
          </p>
          {version.changeNote ? (
            <p className="mt-2 whitespace-pre-wrap text-table text-fg">{version.changeNote}</p>
          ) : null}
          {note ? <p className="mt-2 text-table text-fg-muted">{note}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {version.capabilities.canDownload ? (
            <VersionDownload documentId={documentId} versionId={version.id} versionNumber={version.versionNumber} />
          ) : null}
          {version.capabilities.canRequestReview ? (
            <Button size="sm" variant="ghost" onClick={onRequestReview}>
              <Send aria-hidden="true" />
              Request review
            </Button>
          ) : null}
        </div>
      </div>

      {version.reviews.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {version.reviews.map((review) => (
            <li key={review.id} className="rounded-md border border-line bg-surface-muted px-3 py-2 text-table">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-fg">
                  <PersonLink memberId={review.reviewer.memberId} name={review.reviewer.fullName} />
                  <span className="text-fg-muted"> · {REVIEW_STATUS[review.status]}</span>
                </p>
                {review.canDecide ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onDecide(review, "reject")}>
                      <X aria-hidden="true" />
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => onDecide(review, "approve")}>
                      <Check aria-hidden="true" />
                      Approve
                    </Button>
                  </div>
                ) : null}
              </div>
              <p className="text-meta text-fg-subtle">
                Requested by <PersonLink memberId={review.requestedBy.memberId} name={review.requestedBy.fullName} /> · {formatDateTime(review.requestedAt)}
                {review.decidedAt ? ` · decided ${formatDateTime(review.decidedAt)}` : ""}
              </p>
              {review.dueDate && review.status === "PENDING" ? <p className="text-meta text-fg-subtle">Decision needed by {review.dueDate}</p> : null}
              {review.requestNote ? <p className="mt-1 whitespace-pre-wrap text-fg-muted">“{review.requestNote}”</p> : null}
              {review.decisionNote ? <p className="mt-1 whitespace-pre-wrap text-fg">{review.decisionNote}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function VersionDownload({ documentId, versionId, versionNumber }: { documentId: string; versionId: string; versionNumber: number }) {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);

  async function download() {
    setPending(true);
    try {
      const grant = await api<{ url: string }>(`/api/documents/${documentId}/versions/${versionId}/download`, { method: "POST" });
      startDownload(grant.url);
    } catch (failure) {
      toast({ title: failureText(failure), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="ghost" onClick={download} disabled={pending} aria-label={`Download version ${versionNumber}`}>
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
      Download
    </Button>
  );
}

type UploadIntent = {
  uploadSessionId: string;
  upload: { method: "PUT"; url: string; headers: Record<string, string> };
};

function putObject(grant: UploadIntent["upload"], file: File, onProgress: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(grant.method, grant.url, true);
    for (const [header, value] of Object.entries(grant.headers)) request.setRequestHeader(header, value);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      if (request.status === 413) return reject({ status: 413, message: "That file is larger than the upload limit." });
      if (request.status === 403) return reject({ status: 403, message: "This upload took too long. Start it again." });
      reject({ status: request.status, message: "The upload did not complete. Try again." });
    });
    request.addEventListener("error", () => reject({ status: 0, message: "The upload was interrupted. Try again." }));
    request.send(file);
  });
}

function UploadVersionDialog({
  documentId,
  open,
  onOpenChange,
  onUploaded,
}: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} locked={busy} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Upload new version</DialogTitle>
        <DialogDescription>
          The current version stays in place until the new file has been checked.
        </DialogDescription>
        {/* Mounted per opening: a fresh file, note and idempotency key each time. */}
        <UploadVersionForm documentId={documentId} onBusy={setBusy} onUploaded={onUploaded} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function UploadVersionForm({
  documentId,
  onBusy,
  onUploaded,
  onDone,
}: {
  documentId: string;
  onBusy: (busy: boolean) => void;
  onUploaded: () => Promise<void>;
  onDone: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = React.useState<File | null>(null);
  const [changeNote, setChangeNote] = React.useState("");
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const idempotencyKey = React.useRef<string>("");
  if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

  const busy = progress !== null;
  const editor = useDialogInput(file !== null || changeNote !== "", "Upload", "New version");
  const { setPendingUploads } = editor;
  React.useEffect(() => {
    setPendingUploads(busy);
    onBusy(busy);
  }, [busy, setPendingUploads, onBusy]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const intent = await api<UploadIntent>(`/api/documents/${documentId}/versions/upload-intent`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
          changeNote: changeNote.trim() || undefined,
        }),
      });
      await putObject(intent.upload, file, setProgress);
      const result = await api<{ status: string }>(`/api/documents/${documentId}/versions/complete`, {
        method: "POST",
        body: JSON.stringify({ uploadSessionId: intent.uploadSessionId }),
      });
      toast({
        title: result.status === "AVAILABLE" ? "New version uploaded" : "Upload received — the file is being checked",
        tone: "success",
      });
      editor.setUnresolved(false);
      editor.setDirty(false);
      onBusy(false);
      onDone();
      await onUploaded();
    } catch (failure) {
      editor.setUnresolved(unconfirmed(failure));
      setError(failureText(failure));
      // A failed attempt gets a fresh key so a retry is a new upload, not a replay.
      idempotencyKey.current = crypto.randomUUID();
    } finally {
      setProgress(null);
    }
  }

  return (
    <form className="mt-4 space-y-4" onSubmit={submit}>
      <div className="space-y-1.5">
        <Label htmlFor="version-file">File</Label>
        <Input
          id="version-file"
          type="file"
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="version-note">What changed</Label>
        <Textarea
          id="version-note"
          rows={3}
          maxLength={500}
          disabled={busy}
          value={changeNote}
          onChange={(event) => setChangeNote(event.target.value)}
          placeholder="Optional — for example, “Updated after client comments”."
        />
      </div>
      {progress !== null ? (
        <div aria-live="polite" className="text-table text-fg-muted">
          Uploading… {progress}%
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-table text-danger-strong">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy || !file}>
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Upload aria-hidden="true" />}
          Upload
        </Button>
      </DialogFooter>
    </form>
  );
}

type Reviewer = { memberId: string; fullName: string; jobTitle: string | null };

function RequestReviewDialog({
  documentId,
  version,
  onOpenChange,
  onRequested,
}: {
  documentId: string;
  version: DocumentVersionDTO | null;
  onOpenChange: (open: boolean) => void;
  onRequested: () => Promise<void>;
}) {
  const [pending, setPending] = React.useState(false);
  return (
    <Dialog open={version !== null} locked={pending} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Request review{version ? ` of version ${version.versionNumber}` : ""}</DialogTitle>
        <DialogDescription>
          Only people who can open this document and decide reviews are listed.
        </DialogDescription>
        {version ? <RequestReviewForm documentId={documentId} version={version} onPending={setPending} onRequested={onRequested} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RequestReviewForm({
  documentId,
  version,
  onPending,
  onRequested,
  onDone,
}: {
  documentId: string;
  version: DocumentVersionDTO;
  onPending: (pending: boolean) => void;
  onRequested: () => Promise<void>;
  onDone: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = React.useState("");
  const [reviewers, setReviewers] = React.useState<Reviewer[] | null>(null);
  const [selected, setSelected] = React.useState<string>("");
  const [note, setNote] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // The search is a filter, not input.
  const editor = useDialogInput(selected !== "" || note !== "" || dueDate !== "", "Send for review", `Review request for version ${version.versionNumber}`);
  const { setSaving } = editor;
  React.useEffect(() => {
    setSaving(pending);
    onPending(pending);
  }, [pending, setSaving, onPending]);

  React.useEffect(() => {
    let cancelled = false;
    setReviewers(null);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await api<Reviewer[]>(`/api/documents/${documentId}/reviewers?q=${encodeURIComponent(query)}`);
        if (!cancelled) setReviewers(rows);
      } catch (failure) {
        if (!cancelled) {
          setReviewers([]);
          setError(failureText(failure));
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, documentId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) {
      setError("Choose a reviewer.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api(`/api/document-versions/${version.id}/reviews`, {
        method: "POST",
        body: JSON.stringify({ reviewerMemberId: selected, note: note.trim() || undefined, dueDate: dueDate || undefined }),
      });
      toast({ title: "Review requested", tone: "success" });
      editor.setUnresolved(false);
      editor.setDirty(false);
      onPending(false);
      onDone();
      await onRequested();
    } catch (failure) {
      editor.setUnresolved(unconfirmed(failure));
      setError(failureText(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-4 space-y-4" onSubmit={submit}>
      <div className="space-y-1.5">
        <Label htmlFor="reviewer-search">Reviewer</Label>
        <Input
          id="reviewer-search"
          placeholder="Search by name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div role="radiogroup" aria-label="Eligible reviewers" className="max-h-52 overflow-y-auto rounded-md border border-line">
          {reviewers === null ? (
            <p className="px-3 py-2 text-table text-fg-subtle">Loading…</p>
          ) : reviewers.length === 0 ? (
            <p className="px-3 py-2 text-table text-fg-subtle">Nobody else can review this document.</p>
          ) : (
            reviewers.map((reviewer) => (
              <label
                key={reviewer.memberId}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 text-table hover:bg-hover has-[:checked]:bg-hover"
              >
                <input
                  type="radio"
                  name="reviewer"
                  value={reviewer.memberId}
                  checked={selected === reviewer.memberId}
                  onChange={() => setSelected(reviewer.memberId)}
                />
                <span className="text-fg">{reviewer.fullName}</span>
                {reviewer.jobTitle ? <span className="text-fg-subtle">{reviewer.jobTitle}</span> : null}
              </label>
            ))
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="review-due">Decision needed by</Label>
        <Input id="review-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        <p className="text-meta text-fg-subtle">Optional. A date puts the review on both calendars.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="review-note">Note</Label>
        <Textarea id="review-note" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
      </div>
      {error ? (
        <p role="alert" className="text-table text-danger-strong">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || !selected}>
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
          Send for review
        </Button>
      </DialogFooter>
    </form>
  );
}

function DecisionDialog({
  decision,
  onOpenChange,
  onDecided,
}: {
  decision: { review: DocumentReviewDTO; outcome: "approve" | "reject" } | null;
  onOpenChange: (open: boolean) => void;
  onDecided: () => Promise<void>;
}) {
  const [pending, setPending] = React.useState(false);
  const rejecting = decision?.outcome === "reject";
  return (
    <Dialog open={decision !== null} locked={pending} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{rejecting ? "Reject this version" : "Approve this version"}</DialogTitle>
        <DialogDescription>
          {rejecting
            ? "The person who asked will see your note."
            : "Approving makes this the approved version and supersedes any earlier approval."}
        </DialogDescription>
        {decision ? <DecisionForm decision={decision} onPending={setPending} onDecided={onDecided} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DecisionForm({
  decision,
  onPending,
  onDecided,
  onDone,
}: {
  decision: { review: DocumentReviewDTO; outcome: "approve" | "reject" };
  onPending: (pending: boolean) => void;
  onDecided: () => Promise<void>;
  onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const rejecting = decision.outcome === "reject";
  const editor = useDialogInput(note !== "", rejecting ? "Reject" : "Approve", rejecting ? "Rejection note" : "Approval note");
  const { setSaving } = editor;
  React.useEffect(() => {
    setSaving(pending);
    onPending(pending);
  }, [pending, setSaving, onPending]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (rejecting && note.trim().length === 0) {
      setError("Say what needs to change before rejecting.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api(`/api/document-reviews/${decision.review.id}/${decision.outcome}`, {
        method: "POST",
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      toast({ title: rejecting ? "Version rejected" : "Version approved", tone: "success" });
      editor.setUnresolved(false);
      editor.setDirty(false);
      onPending(false);
      onDone();
      await onDecided();
    } catch (failure) {
      editor.setUnresolved(unconfirmed(failure));
      setError(failureText(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-4 space-y-4" onSubmit={submit}>
      <div className="space-y-1.5">
        <Label htmlFor="decision-note">{rejecting ? "What needs to change" : "Note"}</Label>
        <Textarea
          id="decision-note"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={rejecting ? "Required" : "Optional"}
        />
      </div>
      {error ? (
        <p role="alert" className="text-table text-danger-strong">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant={rejecting ? "danger" : "primary"} disabled={pending}>
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : rejecting ? <X aria-hidden="true" /> : <Check aria-hidden="true" />}
          {rejecting ? "Reject" : "Approve"}
        </Button>
      </DialogFooter>
    </form>
  );
}
