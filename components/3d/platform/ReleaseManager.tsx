"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

type Slot = { id: string; displayName: string; versions: Array<{ id: string; version: number; originalFileName: string; status: string; validationStatus: string; asset: unknown }> };
type ReleaseRow = { id: string; releaseNumber: number; manifestHash: string; status: string; publishedAt: string; activatedAt: string; supersededAt: string | null };
type ReleaseList = { activeReleaseId: string | null; releases: ReleaseRow[] };

export function ReleaseManager({ projectId, slots }: { projectId: string; slots: Slot[] }) {
  const endpoint = `/api/platform/3d/projects/${projectId}/releases`;
  const [releases, setReleases] = React.useState<ReleaseList | null>(null);
  const [selected, setSelected] = React.useState<Record<string, string>>(() => Object.fromEntries(slots.map((slot) => [slot.id, slot.versions.find((version) => version.asset && ["READY", "PUBLISHED"].includes(version.status))?.id ?? ""])));
  const [restoring, setRestoring] = React.useState<ReleaseRow | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  const load = React.useCallback(async () => {
    try { setReleases(await engineeringApi<ReleaseList>(endpoint)); }
    catch (failure) { setError(failureMessage(failure, "Release history could not be loaded.")); }
  }, [endpoint]);
  React.useEffect(() => { void load(); }, [load]);

  async function publish() {
    setPending(true); setError(null);
    try {
      await engineeringApi(endpoint, { body: { versionIds: Object.values(selected).filter(Boolean) } });
      toast({ title: "3D release published and activated.", tone: "success" });
      await load(); router.refresh();
    } catch (failure) { setError(failureMessage(failure, "The release could not be published.")); }
    finally { setPending(false); }
  }

  async function activate(releaseId: string) {
    setRestoring(null);
    setPending(true); setError(null);
    try {
      await engineeringApi(`${endpoint}/${releaseId}/activate`, { body: {} });
      toast({ title: "Previous 3D release restored.", tone: "success" });
      await load(); router.refresh();
    } catch (failure) { setError(failureMessage(failure, "The release could not be activated.")); }
    finally { setPending(false); }
  }

  return <Card><CardHeader><div><CardTitle>Releases</CardTitle><CardDescription>Publish one processed version per active slot. Every release is an immutable Company-viewer snapshot.</CardDescription></div></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{slots.map((slot) => <label key={slot.id} className="text-meta font-medium text-fg-muted">{slot.displayName}<select className={selectClass} value={selected[slot.id] ?? ""} onChange={(event) => setSelected((current) => ({ ...current, [slot.id]: event.target.value }))}><option value="">Choose a ready version</option>{slot.versions.filter((version) => version.asset && ["READY", "PUBLISHED"].includes(version.status) && ["READY", "WARNING"].includes(version.validationStatus)).map((version) => <option key={version.id} value={version.id}>v{version.version} · {version.originalFileName} · {version.validationStatus}</option>)}</select></label>)}</div><div className="flex justify-end"><Button type="button" onClick={() => void publish()} disabled={pending || slots.length === 0 || slots.some((slot) => !selected[slot.id])}>{pending ? "Publishing…" : "Publish release"}</Button></div>{error ? <p className="text-table text-danger-strong">{error}</p> : null}<div className="space-y-2"><h3 className="text-body font-semibold">Release history</h3>{releases?.releases.map((release) => { const active = release.id === releases.activeReleaseId; return <div key={release.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2 text-table"><span className="font-medium">Release {release.releaseNumber}</span>{active ? <Badge tone="success">ACTIVE</Badge> : <Badge tone="neutral">HISTORICAL</Badge>}<span className="font-mono text-micro text-fg-subtle">{release.manifestHash.slice(0, 12)}</span><span className="text-fg-muted">{new Date(release.publishedAt).toLocaleString()}</span>{!active ? <Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={() => setRestoring(release)} disabled={pending}>Restore</Button> : null}</div>; })}{releases && releases.releases.length === 0 ? <p className="text-table text-fg-muted">No release has been published.</p> : null}</div><ConfirmDialog open={restoring !== null} onOpenChange={(open) => { if (!open) setRestoring(null); }} title={`Restore Release ${restoring?.releaseNumber ?? ""}?`} description={`The published viewer switches back to Release ${restoring?.releaseNumber ?? ""}. The editor draft is not changed.`} confirmLabel="Restore" destructive={false} pending={pending} onConfirm={() => { if (restoring) void activate(restoring.id); }} /></CardContent></Card>;
}
