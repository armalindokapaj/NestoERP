"use client";

import * as React from "react";
import { ExternalLink, MoreHorizontal, RotateCcw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SAVE_STATUS_LABEL, type EditorSaveStatus } from "./save-state";

const STATUS_TONE = { saved: "success", unsaved: "warning", saving: "info", failed: "danger" } as const;

/**
 * The editor's only chrome row (3D Editor PRD §33-§40, §52, §73, §164-§166).
 *
 * Context is read-only and minimal — the Experience, then Group · Company ·
 * Project — with no admin breadcrumb. The chip says what the published viewer
 * shows, so Save is never mistaken for Publish. The overflow links open the
 * management pages in a new tab: leaving this tab would drop unsaved work.
 */
export function EditorTopbar({
  experienceName,
  context,
  activeRelease,
  status,
  reason,
  onReasonChange,
  reasonRef,
  canEdit,
  onSave,
  onReset,
  managementHref,
}: {
  experienceName: string;
  context: string;
  activeRelease: { releaseNumber: number } | null;
  status: EditorSaveStatus;
  reason: string;
  onReasonChange: (value: string) => void;
  reasonRef: React.Ref<HTMLInputElement>;
  canEdit: boolean;
  onSave: () => void;
  onReset: () => void;
  managementHref: string;
}) {
  const saving = status === "saving";
  const dirty = status === "unsaved" || status === "failed";
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold leading-5 text-neutral-100">{experienceName}</h1>
        <p className="truncate text-[11px] leading-4 text-neutral-500">{context}</p>
      </div>
      <Badge tone={activeRelease ? "neutral" : "default"} className="shrink-0" title="What the published viewer shows. Saving never changes it; publish from Releases.">
        {activeRelease ? `Live: Release ${activeRelease.releaseNumber}` : "Not published"}
      </Badge>
      <span role="status" aria-live="polite" className="shrink-0">
        <Badge tone={STATUS_TONE[status]} data-testid="editor-save-status">{SAVE_STATUS_LABEL[status]}</Badge>
      </span>
      <Input
        ref={reasonRef}
        aria-label="Reason for this change"
        className="h-8 w-56 shrink border-neutral-700 bg-neutral-900 text-xs text-neutral-100 xl:w-64"
        value={reason}
        onChange={(event) => onReasonChange(event.target.value)}
        placeholder="Reason for this change"
        disabled={saving || !canEdit}
      />
      <Button type="button" variant="ghost" size="sm" className="shrink-0 text-neutral-300 hover:text-white" onClick={onReset} disabled={saving || !canEdit}>
        <RotateCcw aria-hidden="true" /> Reset defaults
      </Button>
      <Button type="button" size="sm" className="shrink-0" onClick={onSave} disabled={saving || !dirty || !canEdit} aria-keyshortcuts="Control+S Meta+S">
        <Save aria-hidden="true" />{saving ? "Saving…" : "Save"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 text-neutral-400 hover:text-white" aria-label="More editor actions">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={managementHref} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Open Experience details</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`${managementHref}/releases`} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Open Releases to publish</a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
