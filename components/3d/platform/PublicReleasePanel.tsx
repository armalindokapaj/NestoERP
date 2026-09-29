"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { PUBLIC_3D_FIELD_LABELS, PUBLIC_3D_OPTIONAL_FIELDS, type Public3DOptionalField } from "@/lib/3d/public/public-manifest";

type Preview =
  | { prepared: false }
  | { prepared: true; approved: boolean; publicManifestHash: string; stale: boolean; bootstrap: { title: string; description: string | null; fields: Public3DOptionalField[]; models: unknown[]; units: unknown[] } };

/**
 * The public version of the active release (ADM-04A §5-§6): prepare it (title,
 * description, which unit facts visitors see), review what it holds, approve
 * it. Once approved, "Public" can be chosen under Publishing.
 */
export function PublicReleasePanel({ projectId, defaultTitle }: { projectId: string; defaultTitle: string }) {
  const releasesUrl = `/api/platform/3d/projects/${projectId}/releases`;
  const [releaseId, setReleaseId] = React.useState<string | null | undefined>(undefined);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [title, setTitle] = React.useState(defaultTitle);
  const [description, setDescription] = React.useState("");
  const [fields, setFields] = React.useState<Public3DOptionalField[]>(["description", "city", "unitCode", "unitFloor", "unitType", "unitArea", "availability"]);
  const [confirmed, setConfirmed] = React.useState(false);
  const [pending, setPending] = React.useState<"prepare" | "approve" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  const load = React.useCallback(async () => {
    try {
      const list = await engineeringApi<{ activeReleaseId: string | null }>(releasesUrl);
      setReleaseId(list.activeReleaseId);
      if (!list.activeReleaseId) return;
      const data = await engineeringApi<Preview>(`${releasesUrl}/${list.activeReleaseId}/public`);
      setPreview(data);
      if (data.prepared) {
        setTitle(data.bootstrap.title);
        setDescription(data.bootstrap.description ?? "");
        setFields(data.bootstrap.fields);
      }
    } catch (failure) { setError(failureMessage(failure, "The public version could not be loaded.")); }
  }, [releasesUrl]);
  React.useEffect(() => { void load(); }, [load]);

  async function prepare() {
    if (!releaseId) return;
    setPending("prepare"); setError(null); setConfirmed(false);
    try {
      await engineeringApi(`${releasesUrl}/${releaseId}/public`, { body: { title, description: description.trim() || null, fields } });
      toast({ title: "Public version prepared. Review it, then approve.", tone: "success" });
      await load();
    } catch (failure) { setError(failureMessage(failure, "The public version could not be prepared.")); }
    finally { setPending(null); }
  }

  async function approve() {
    if (!releaseId || !preview?.prepared) return;
    setPending("approve"); setError(null);
    try {
      await engineeringApi(`${releasesUrl}/${releaseId}/public/approve`, { body: { publicManifestHash: preview.publicManifestHash, confirmPublicDistribution: true, reason: "Approved for public distribution" } });
      toast({ title: "Public version approved. You can now choose Public under Publishing.", tone: "success" });
      await load(); router.refresh();
    } catch (failure) { setError(failureMessage(failure, "The public version could not be approved.")); }
    finally { setPending(null); }
  }

  const approved = preview?.prepared && preview.approved;
  const toggle = (field: Public3DOptionalField) => setFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);

  return <Card><CardHeader><div><CardTitle>Public version</CardTitle><CardDescription>What anonymous visitors get when the audience is Public. Prepare it from the active release, review it, then approve it.</CardDescription></div></CardHeader><CardContent className="space-y-4">
    {releaseId === null ? <p className="text-table text-fg-muted">Publish a release first.</p> : releaseId === undefined ? <p className="text-table text-fg-muted">Loading…</p> : <>
      <div className="flex flex-wrap items-center gap-2 text-table">
        <span className="font-medium">Status:</span>
        {!preview?.prepared ? <Badge tone="neutral">NOT PREPARED</Badge> : approved ? <Badge tone="success">APPROVED</Badge> : <Badge tone="warning">WAITING FOR APPROVAL</Badge>}
        {preview?.prepared && preview.stale ? <Badge tone="warning">UNIT FACTS CHANGED SINCE — PREPARE AGAIN</Badge> : null}
      </div>
      {approved ? <p className="text-table text-fg-muted">Approved. To change it, publish a new release and prepare its public version.</p> : <>
        <label className="block text-meta font-medium text-fg-muted">Public title<Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></label>
        <label className="block text-meta font-medium text-fg-muted">Public description<Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} /></label>
        <fieldset><legend className="text-meta font-medium text-fg-muted">Visitors may see</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{PUBLIC_3D_OPTIONAL_FIELDS.map((field) => <label key={field} className="flex items-center gap-2 text-table"><input type="checkbox" checked={fields.includes(field)} onChange={() => toggle(field)} />{PUBLIC_3D_FIELD_LABELS[field]}</label>)}</div></fieldset>
        <div className="flex justify-end"><Button type="button" variant={preview?.prepared ? "secondary" : "primary"} onClick={() => void prepare()} disabled={pending !== null || title.trim().length < 2}>{pending === "prepare" ? "Preparing…" : preview?.prepared ? "Prepare again" : "Prepare public version"}</Button></div>
        {preview?.prepared ? <div className="space-y-3 rounded-lg border border-line p-3 text-table">
          <p><span className="font-medium">{preview.bootstrap.title}</span> · {preview.bootstrap.models.length} model(s) · {preview.bootstrap.units.length} unit(s)</p>
          <p className="text-fg-muted">Includes: {preview.bootstrap.fields.length ? preview.bootstrap.fields.map((field) => PUBLIC_3D_FIELD_LABELS[field]).join(", ") : "the 3D scene only"}</p>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />This content is approved for public distribution.</label>
          <div className="flex justify-end"><Button type="button" onClick={() => void approve()} disabled={!confirmed || pending !== null}>{pending === "approve" ? "Approving…" : "Approve public version"}</Button></div>
        </div> : null}
      </>}
      {error ? <p className="text-table text-danger-strong">{error}</p> : null}
    </>}
  </CardContent></Card>;
}
