"use client";

import { apiRequest } from "@/lib/client/api-request";
import type { SheetApplyInput } from "@/lib/modules/unit-sheet/unit-sheet.schema";
import type { SheetApplyResultDTO, SheetLinkResultDTO, SheetPreviewDTO, SheetStatusDTO } from "@/lib/modules/unit-sheet/unit-sheet.types";
import { filenameFromDisposition } from "./sheet-choices";

/**
 * The Units tab's Google Sheet, over its routes (2026-11-10). Reading a sheet
 * takes up to ten seconds of Google's time, and confirming changes each unit
 * in its own transactions, so each call has the deadline its route allows.
 */

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/units/sheet`;

export const sheetApi = {
  status: (projectId: string, signal?: AbortSignal) => apiRequest<SheetStatusDTO>(base(projectId), { messageFrom: "envelope", signal }),
  link: (projectId: string, url: string, dryRun: boolean) => apiRequest<SheetLinkResultDTO>(base(projectId), { method: "PUT", body: { url, dryRun }, deadlineMs: 65_000, messageFrom: "envelope" }),
  unlink: (projectId: string) => apiRequest<{ unlinked: true }>(base(projectId), { method: "DELETE", messageFrom: "envelope" }),
  preview: (projectId: string, signal?: AbortSignal) => apiRequest<SheetPreviewDTO>(`${base(projectId)}/preview`, { method: "POST", body: {}, deadlineMs: 65_000, messageFrom: "envelope", signal }),
  apply: (projectId: string, body: SheetApplyInput) => apiRequest<SheetApplyResultDTO>(`${base(projectId)}/apply`, { method: "POST", body, deadlineMs: 305_000, messageFrom: "envelope" }),
  downloadUrl: (projectId: string, query?: string) => `${base(projectId)}/download${query ? `?${query}` : ""}`,
};

export type DownloadOutcome = { ok: true; count: number; filename: string } | { ok: false; message: string | null };

/**
 * Fetches a file and hands it to the browser to save. Only a complete .xlsx
 * answer is saved; a refusal comes back as the server's own sentence, never
 * as a file.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<DownloadOutcome> {
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("spreadsheetml")) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: body?.error?.message ?? null };
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get("content-disposition")) ?? fallbackName;
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    return { ok: true, count: Number(response.headers.get("x-export-row-count") ?? "0"), filename };
  } catch {
    return { ok: false, message: null };
  }
}

/** Google's own address of a linked sheet, built from its id and tab — never the pasted text. */
export function sheetHref(spreadsheetId: string, gid: string | null): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit${gid && /^\d{1,12}$/.test(gid) ? `#gid=${gid}` : ""}`;
}

/** After a confirmed sync the lists on the Units and Sales tabs read their units again. */
export const UNITS_CHANGED_EVENT = "nesto:units-changed";

export function announceUnitsChanged(projectId: string) {
  window.dispatchEvent(new CustomEvent(UNITS_CHANGED_EVENT, { detail: { projectId } }));
}
