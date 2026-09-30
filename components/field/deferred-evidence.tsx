"use client";

import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import Link from "@/components/navigation/nav-link";

import { UploadQueueList } from "@/components/documents/document-uploader";
import { useDocumentsTranslations } from "@/components/documents/documents-text";
import { UPLOAD_IN_FLIGHT, useUploadQueue, type UploadContextInput } from "@/components/documents/upload-queue";
import { StagedCaptureView, useStagedCapture } from "./evidence-capture";

/**
 * DeferredEvidence (MOB-07 §54-§56, §89): photos chosen on a "report" form
 * before the record exists.
 *
 * The photos stay on this device, shown as "Not uploaded yet", until the form
 * has saved. The canonical create action runs first — every HSE rule, approval
 * and escalation applies to it unchanged — and only then are the files sent to
 * the new record through the normal upload pipeline, with that record's id as
 * their immutable context. The form goes on to the record when they have all
 * arrived; if some fail it stays, with Retry and a link to continue without
 * them, so nothing is silently dropped.
 */

export type DeferredEvidenceHandle = {
  hasFiles: () => boolean;
  /** Uploads the staged files to the record that was just created, then calls `onDone`. */
  commit: (target: { entityType: string; entityId: string; continueHref: string; onDone: () => void }) => Promise<void>;
};

export const DeferredEvidence = React.forwardRef<
  DeferredEvidenceHandle,
  {
    groups?: readonly string[];
    keepOriginal?: boolean;
    persistKey: string;
    /**
     * Where the upload list and its Retry buttons render. A saved RecordForm disables
     * every control inside it, so once the record exists the list has to live outside
     * the form's fieldset; the form passes an element placed after it.
     */
    queueHost?: HTMLElement | null;
  }
>(function DeferredEvidence({ groups, keepOriginal, persistKey, queueHost }, ref) {
    const t = useDocumentsTranslations();
    const state = useStagedCapture({ keepOriginal });
    const [parent, setParent] = React.useState<UploadContextInput>({ context: "company" });
    const queue = useUploadQueue({ parent, persistKey, groups });
    const [continueHref, setContinueHref] = React.useState<string | null>(null);
    const doneRef = React.useRef<(() => void) | null>(null);
    const stagedCount = React.useRef(0);
    stagedCount.current = state.staged.length;

    React.useImperativeHandle(
      ref,
      () => ({
        hasFiles: () => stagedCount.current > 0,
        commit: async ({ entityType, entityId, continueHref: href, onDone }) => {
          const files = await state.take();
          if (!files.length) return onDone();
          // The context is fixed here, before the first byte moves.
          flushSync(() => setParent({ context: "record", entityType, entityId }));
          setContinueHref(href);
          doneRef.current = onDone;
          queue.enqueue(files, (file) => ({ name: file.name }));
        },
      }),
      [queue, state],
    );

    const settled = queue.items.length > 0 && queue.items.every((item) => !UPLOAD_IN_FLIGHT.includes(item.status));
    const failed = queue.items.some((item) => item.status === "failed" || item.status === "pending");
    React.useEffect(() => {
      if (settled && !failed && doneRef.current) {
        const done = doneRef.current;
        doneRef.current = null;
        done();
      }
    }, [settled, failed]);

    const queueView = (
      <div className="space-y-3" data-testid="deferred-evidence-queue">
        {queue.items.length ? (
          <UploadQueueList
            items={queue.items}
            lost={queue.lost}
            onRetry={(item) => queue.retry(item.id)}
            onRecheck={(item) => queue.recheck(item.id)}
            onCancel={(item) => queue.cancel(item.id)}
            onClear={queue.clear}
            onReselect={(lost, file) => queue.reselect(lost.id, file, (f) => ({ name: f.name }))}
          />
        ) : null}
        {settled && failed && continueHref ? (
          <Link href={continueHref} className="text-table text-accent underline" data-testid="deferred-evidence-continue">
            {t("capture.continueWithout")}
          </Link>
        ) : null}
      </div>
    );

    return (
      <div className="space-y-3 sm:col-span-2" data-testid="deferred-evidence">
        <StagedCaptureView state={state} groups={groups} hideUse />
        {queueHost ? createPortal(queueView, queueHost) : queueView}
      </div>
    );
  },
);
