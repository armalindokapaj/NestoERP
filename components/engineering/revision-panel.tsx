"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, History, Upload } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { useUploadQueue } from "@/components/documents/upload-queue";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { REVIEW_DECISION_LABELS, SHARING_CLASSIFICATIONS, SHARING_LABELS, type Option, type ReviewDecision, type RevisionCapabilities, type RevisionDTO, type SharingClassification } from "@/lib/modules/engineering/engineering.types";
import { cn } from "@/lib/utils/cn";
import { engineeringApi, failureMessage, fieldErrorsOf } from "./engineering-api";
import { DecisionBadge, formatDateTime, ReviewBadge } from "./engineering-ui";

/**
 * Revisions and their review (PRD #46 §66-§75, §102-§105, §171, §172, §311).
 *
 * The timeline reads top down, newest first: code, status, decision, who
 * submitted and reviewed it, and what the reviewer said. A superseded revision
 * stays in full and is marked so nobody builds from it. The decision bar sits
 * with the revision under review and offers only the decisions this reader
 * may take — the server checks them all again.
 */

type Kind = "document" | "submittal";

const DECISION_ORDER: ReviewDecision[] = ["REJECTED", "REVISION_REQUIRED", "APPROVED_WITH_COMMENTS", "APPROVED"];

function paths(kind: Kind, recordId: string) {
  const record = kind === "document" ? `/api/engineering-documents/${recordId}` : `/api/submittals/${recordId}`;
  const revisions = kind === "document" ? "/api/engineering-document-revisions" : "/api/submittal-revisions";
  return { record, revisions };
}

function nextCode(revisions: RevisionDTO[]): string {
  const latest = revisions[0]?.revisionCode;
  if (!latest) return "A";
  if (/^[A-Y]$/.test(latest)) return String.fromCharCode(latest.charCodeAt(0) + 1);
  const match = /^(.*?)(\d+)$/.exec(latest);
  if (match) return `${match[1]}${String(Number(match[2]) + 1).padStart(match[2].length, "0")}`;
  return "";
}

export function RevisionPanel({
  kind,
  recordId,
  recordType,
  revisions,
  capabilities,
  canAddRevision,
  canUploadFiles,
  zone,
}: {
  kind: Kind;
  recordId: string;
  recordType: "engineering_document" | "technical_submittal";
  revisions: RevisionDTO[];
  capabilities: Record<string, RevisionCapabilities>;
  canAddRevision: boolean;
  canUploadFiles: boolean;
  zone: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const api = paths(kind, recordId);
  const [adding, setAdding] = React.useState(false);
  const [deciding, setDeciding] = React.useState<{ revision: RevisionDTO; decision: ReviewDecision } | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const inProgress = revisions.some((revision) => ["DRAFT", "SUBMITTED", "UNDER_REVIEW"].includes(revision.status));

  async function command(key: string, url: string, success: string, body?: unknown) {
    setPending(key);
    try {
      await engineeringApi(url, { body: body ?? {} });
      toast({ title: success, tone: "success" });
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="nesto-card min-w-0 p-5" aria-labelledby="revisions-title" data-testid="revision-panel">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="revisions-title" className="flex items-center gap-2 text-card font-semibold text-fg">
            <History aria-hidden="true" className="size-4 text-fg-subtle" />
            Revisions
          </h2>
          <p className="mt-0.5 text-table text-fg-muted">A submitted revision is never overwritten — a correction is the next revision.</p>
        </div>
        {canAddRevision ? (
          <Button type="button" size="sm" onClick={() => setAdding(true)} disabled={inProgress} title={inProgress ? "Finish the revision in progress first." : undefined} data-testid="add-revision">
            <Upload aria-hidden="true" />
            Add revision
          </Button>
        ) : null}
      </div>

      {revisions.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-table text-fg-muted">No revisions yet. Upload the first file as revision A, 01 or P01 — whatever the project uses.</p>
      ) : (
        <ol className="relative space-y-0">
          {revisions.map((revision, index) => {
            const caps = capabilities[revision.id];
            const superseded = revision.status === "SUPERSEDED";
            return (
              <li key={revision.id} className="relative flex gap-4 pb-6 last:pb-0" data-testid="revision-item" data-revision={revision.revisionCode} data-status={revision.status}>
                {index < revisions.length - 1 ? <span aria-hidden="true" className="absolute left-[1.3rem] top-11 bottom-0 w-px bg-line" /> : null}
                <div className={cn("relative z-[1] flex size-11 shrink-0 items-center justify-center rounded-lg border font-mono text-body font-semibold", revision.current ? "border-accent bg-accent-soft text-accent-strong" : superseded ? "border-line bg-surface-muted text-fg-subtle line-through" : "border-line-strong bg-surface text-fg")}>
                  {revision.revisionCode}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-medium text-fg">Rev {revision.revisionCode}</span>
                    {/* A finalized revision is described by its decision alone. */}
                    {revision.status === "FINALIZED" && revision.decision ? null : <ReviewBadge status={revision.status} testId="revision-status" />}
                    <DecisionBadge decision={revision.decision} />
                    {revision.current ? (
                      <Badge tone="info" data-testid="revision-current">
                        Current
                      </Badge>
                    ) : null}
                  </div>
                  {superseded ? <p className="mt-1 text-meta font-medium text-warning-strong">Superseded — do not build from this revision.</p> : null}
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-table sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt className="text-fg-subtle">Submitted</dt>
                      <dd className="text-fg">
                        {revision.submittedAt ? (
                          <>
                            {formatDateTime(revision.submittedAt, zone)}
                            {revision.submittedBy ? (
                              <>
                                {" · "}
                                <PersonLink memberId={revision.submittedBy.id} name={revision.submittedBy.name} />
                              </>
                            ) : null}
                          </>
                        ) : (
                          "Not yet"
                        )}
                      </dd>
                    </div>
                    {revision.reviewedAt ? (
                      <div className="flex gap-1.5">
                        <dt className="text-fg-subtle">Reviewed</dt>
                        <dd className="text-fg">
                          {formatDateTime(revision.reviewedAt, zone)}
                          {revision.reviewedBy ? (
                            <>
                              {" · "}
                              <PersonLink memberId={revision.reviewedBy.id} name={revision.reviewedBy.name} />
                            </>
                          ) : null}
                        </dd>
                      </div>
                    ) : revision.reviewStartedAt ? (
                      <div className="flex gap-1.5">
                        <dt className="text-fg-subtle">Review started</dt>
                        <dd className="text-fg">{formatDateTime(revision.reviewStartedAt, zone)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {revision.file ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-table">
                      <FileText aria-hidden="true" className="size-4 text-fg-subtle" />
                      <Link href={revision.file.href} className="text-fg underline-offset-4 hover:underline" data-testid="revision-file">
                        {revision.file.name}
                      </Link>
                      {revision.file.versionNumber ? <span className="text-fg-subtle">v{revision.file.versionNumber}</span> : null}
                      {canAddRevision ? (
                        <select
                          aria-label={`Sharing classification of ${revision.file.name}`}
                          className={cn(selectClass, "h-7 w-auto px-2 text-meta")}
                          value={revision.file.sharing}
                          onChange={(event) => void command(`share:${revision.id}`, `${api.record}/sharing`, "Sharing classification saved.", { documentId: revision.file!.documentId, classification: event.target.value as SharingClassification })}
                        >
                          {SHARING_CLASSIFICATIONS.map((value) => (
                            <option key={value} value={value}>
                              {SHARING_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      ) : revision.file.sharing !== "INTERNAL_ONLY" ? (
                        <Badge tone="default">{SHARING_LABELS[revision.file.sharing]}</Badge>
                      ) : null}
                    </div>
                  ) : null}
                  {revision.notes ? <p className="mt-2 text-table text-fg-muted">{revision.notes}</p> : null}
                  {revision.reviewComment ? (
                    <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-table text-fg" data-testid="revision-comment">
                      {revision.reviewComment}
                    </blockquote>
                  ) : null}

                  {caps && (caps.canSubmit || caps.canVoid || caps.canStartReview || caps.decisions.length || caps.reviewBlockedReason) ? (
                    <div className="mt-3 space-y-2">
                      {caps.reviewBlockedReason ? <p className="text-meta text-fg-muted">{caps.reviewBlockedReason}</p> : null}
                      <div className="flex flex-wrap gap-2" data-testid="review-decision-bar">
                        {caps.canSubmit ? (
                          <Button type="button" size="sm" disabled={pending !== null} onClick={() => void command(`submit:${revision.id}`, `${api.revisions}/${revision.id}/submit`, `Rev ${revision.revisionCode} submitted for review.`)}>
                            Submit for review
                          </Button>
                        ) : null}
                        {caps.canVoid ? (
                          <Button type="button" size="sm" variant="ghost" disabled={pending !== null} onClick={() => void command(`void:${revision.id}`, `${api.revisions}/${revision.id}/void`, "Draft revision discarded.")}>
                            Discard draft
                          </Button>
                        ) : null}
                        {caps.canStartReview ? (
                          <Button type="button" size="sm" variant="secondary" disabled={pending !== null} onClick={() => void command(`start:${revision.id}`, `${api.revisions}/${revision.id}/start-review`, "Review started.")}>
                            Start review
                          </Button>
                        ) : null}
                        {DECISION_ORDER.filter((decision) => caps.decisions.includes(decision)).map((decision) => (
                          <Button key={decision} type="button" size="sm" variant={decision === "APPROVED" ? "primary" : decision === "REJECTED" ? "ghost" : "secondary"} disabled={pending !== null} onClick={() => setDeciding({ revision, decision })}>
                            {decision === "APPROVED" ? "Approve" : decision === "APPROVED_WITH_COMMENTS" ? "Approve with comments" : decision === "REVISION_REQUIRED" ? "Revision required" : "Reject"}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {adding ? <AddRevisionDialog kind={kind} recordId={recordId} recordType={recordType} suggested={nextCode(revisions)} canUpload={canUploadFiles} onClose={() => setAdding(false)} /> : null}
      {deciding ? <DecisionDialog kind={kind} target={deciding} onClose={() => setDeciding(null)} /> : null}
    </section>
  );
}

function DecisionDialog({ kind, target, onClose }: { kind: Kind; target: { revision: RevisionDTO; decision: ReviewDecision }; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [comment, setComment] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const needsComment = target.decision !== "APPROVED";
  const base = kind === "document" ? "/api/engineering-document-revisions" : "/api/submittal-revisions";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await engineeringApi(`${base}/${target.revision.id}/review`, { body: { decision: target.decision, comment: comment.trim() || null } });
      toast({ title: `Rev ${target.revision.revisionCode}: ${REVIEW_DECISION_LABELS[target.decision].toLowerCase()}.`, tone: "success" });
      onClose();
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-lg" data-testid="decision-dialog">
        <DialogTitle>
          {REVIEW_DECISION_LABELS[target.decision]} — Rev {target.revision.revisionCode}
        </DialogTitle>
        <DialogDescription>{needsComment ? "Say what the reviewer found. It stays on the revision's history." : "Add a comment if there is anything to note."}</DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="review-comment" className="text-meta font-medium text-fg-muted">
              Review comment{needsComment ? <span className="text-danger-strong"> *</span> : null}
            </label>
            <Textarea id="review-comment" rows={5} value={comment} onChange={(event) => setComment(event.target.value)} required={needsComment} />
          </div>
          {error ? (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || (needsComment && !comment.trim())}>
              {pending ? "Saving…" : `Record: ${REVIEW_DECISION_LABELS[target.decision].toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddRevisionDialog({ kind, recordId, recordType, suggested, canUpload, onClose }: { kind: Kind; recordId: string; recordType: "engineering_document" | "technical_submittal"; suggested: string; canUpload: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const api = paths(kind, recordId);
  const [code, setCode] = React.useState(suggested);
  const [files, setFiles] = React.useState<Option[]>([]);
  const [documentId, setDocumentId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitNow, setSubmitNow] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const loadFiles = React.useCallback(async () => {
    const options = await engineeringApi<Option[]>(`${api.record}/revision-files`).catch(() => []);
    setFiles(options);
    return options;
  }, [api.record]);

  React.useEffect(() => {
    void loadFiles().then((options) => setDocumentId((current) => current || options[0]?.id || ""));
  }, [loadFiles]);

  const upload = useUploadQueue({
    parent: { context: "record", entityType: recordType, entityId: recordId },
    onUploaded: (uploaded) => {
      void loadFiles();
      setDocumentId(uploaded);
    },
  });
  const uploading = upload.items.some((item) => ["queued", "authorising", "uploading", "verifying", "processing"].includes(item.status));
  const failed = upload.items.find((item) => item.status === "failed");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setErrors({});
    try {
      await engineeringApi(`${api.record}/revisions`, { body: { revisionCode: code, documentId, notes: notes.trim() || null, submit: submitNow } });
      toast({ title: submitNow ? `Rev ${code} submitted for review.` : `Rev ${code} saved as a draft.`, tone: "success" });
      onClose();
      router.refresh();
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && !uploading && onClose()}>
      <DialogContent className="max-w-lg" data-testid="revision-dialog">
        <DialogTitle>Add revision</DialogTitle>
        <DialogDescription>Upload the revision&apos;s file, give it the project&apos;s revision code, and submit it for review.</DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <div className="flex flex-col gap-1">
              <label htmlFor="revision-code" className="text-meta font-medium text-fg-muted">
                Revision
              </label>
              <Input id="revision-code" value={code} onChange={(event) => setCode(event.target.value)} className="font-mono" required aria-invalid={Boolean(errors.revisionCode) || undefined} />
              {errors.revisionCode ? <p className="text-meta text-danger-strong">{errors.revisionCode}</p> : null}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="revision-file" className="text-meta font-medium text-fg-muted">
                File
              </label>
              <select id="revision-file" className={selectClass} value={documentId} onChange={(event) => setDocumentId(event.target.value)} required>
                <option value="">{files.length ? "Choose an uploaded file" : "Upload a file first"}</option>
                {files.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.label}
                  </option>
                ))}
              </select>
              {errors.documentId ? <p className="text-meta text-danger-strong">{errors.documentId}</p> : null}
            </div>
          </div>
          {canUpload ? (
            <div className="rounded-md border border-dashed border-line-strong px-4 py-3">
              <input ref={fileInput} type="file" className="sr-only" aria-label="Upload the revision file" data-testid="revision-upload" onChange={(event) => { if (event.target.files?.length) upload.enqueue([...event.target.files], (file) => ({ name: file.name })); event.target.value = ""; }} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-table text-fg-muted">{uploading ? "Uploading and checking the file…" : failed ? (failed.error ?? "The upload failed.") : "PDF, drawing or document file."}</p>
                <Button type="button" size="sm" variant="secondary" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  <Upload aria-hidden="true" />
                  Upload file
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <label htmlFor="revision-notes" className="text-meta font-medium text-fg-muted">
              What changed
            </label>
            <Textarea id="revision-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
          <label htmlFor="revision-submit" className="flex items-start gap-2.5 text-body text-fg">
            <Checkbox id="revision-submit" checked={submitNow} onCheckedChange={(checked) => setSubmitNow(checked === true)} />
            <span>
              Submit for review now
              <span className="block text-meta text-fg-subtle">Its file is frozen from the moment it is submitted.</span>
            </span>
          </label>
          {error ? (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending || uploading}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || uploading || !documentId || !code.trim()}>
              {pending ? "Saving…" : submitNow ? "Submit revision" : "Save draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
