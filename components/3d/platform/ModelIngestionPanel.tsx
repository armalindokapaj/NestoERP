"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Slot = { id: string; displayName: string; role: string; versions: Array<{ id: string; version: number; status: string; validationStatus: string; originalFileName: string }> };
type UploadIntent = { versionId: string; upload: { method: "PUT"; url: string; headers: Record<string, string> } };

export function ModelIngestionPanel({ projectId, slots }: { projectId: string; slots: Slot[] }) {
  const [slotId, setSlotId] = React.useState(slots[0]?.id ?? "");
  const [file, setFile] = React.useState<File | null>(null);
  const [reason, setReason] = React.useState("");
  const [newSlotName, setNewSlotName] = React.useState("");
  const [newSlotKey, setNewSlotKey] = React.useState("");
  const [newSlotRole, setNewSlotRole] = React.useState("BUILDING");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function createSlot() {
    if (reason.trim().length < 3) { setError("Give a reason for creating this slot."); return; }
    setPending(true); setError(null);
    try {
      await engineeringApi(`/api/platform/3d/projects/${projectId}/slots`, { body: { kind: "DETAIL", role: newSlotRole, slotKey: newSlotKey, displayName: newSlotName, sortOrder: slots.length, transformParentSlotId: null, reason } });
      toast({ title: "Model slot created.", tone: "success" });
      router.refresh();
    } catch (failure) { setError(failureMessage(failure, "The model slot could not be created.")); }
    finally { setPending(false); }
  }

  async function upload() {
    if (!file || !slotId) { setError("Choose a model slot and GLB file."); return; }
    if (reason.trim().length < 3) { setError("Give a reason for this upload."); return; }
    setPending(true); setError(null);
    try {
      const intent = await engineeringApi<UploadIntent>(`/api/platform/3d/projects/${projectId}/slots/${slotId}/uploads`, { body: { fileName: file.name, sizeBytes: file.size, scale: 1, rotationDeg: 0, altitudeOffset: 0, positionX: 0, positionZ: 0, rotationXDeg: 0, rotationZDeg: 0, reason } });
      const sent = await fetch(intent.upload.url, { method: intent.upload.method, headers: intent.upload.headers, body: file });
      if (!sent.ok) throw new Error(`Storage refused the upload (${sent.status}).`);
      await engineeringApi(`/api/platform/3d/projects/${projectId}/versions/${intent.versionId}/complete`, { body: { reason } });
      toast({ title: "GLB uploaded and queued for processing.", tone: "success" });
      setFile(null); setReason(""); router.refresh();
    } catch (failure) { setError(failureMessage(failure, failure instanceof Error ? failure.message : "The model could not be uploaded.")); }
    finally { setPending(false); }
  }

  return <Card><CardHeader><div><CardTitle>Models</CardTitle><CardDescription>Create semantic slots, upload private GLB sources, and monitor processed runtime versions.</CardDescription></div></CardHeader><CardContent className="grid gap-5 xl:grid-cols-2"><div className="space-y-3"><h3 className="text-body font-semibold">New slot</h3><div className="grid gap-3 sm:grid-cols-3"><Input value={newSlotName} onChange={(event) => { setNewSlotName(event.target.value); if (!newSlotKey) setNewSlotKey(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} placeholder="Display name" /><Input value={newSlotKey} onChange={(event) => setNewSlotKey(event.target.value)} placeholder="stable-slot-key" /><select className={selectClass} value={newSlotRole} onChange={(event) => setNewSlotRole(event.target.value)}>{["BUILDING", "UNITS", "SURROUNDINGS", "CONTEXT", "CUSTOM"].map((role) => <option key={role} value={role}>{role}</option>)}</select></div><Button type="button" variant="secondary" size="sm" onClick={() => void createSlot()} disabled={pending || !newSlotName || !newSlotKey}>Create slot</Button></div><div className="space-y-3"><h3 className="text-body font-semibold">Upload model version</h3><div className="grid gap-3 sm:grid-cols-2"><select className={selectClass} value={slotId} onChange={(event) => setSlotId(event.target.value)}><option value="">Choose slot</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.displayName} · {slot.role}</option>)}</select><Input type="file" accept=".glb,model/gltf-binary" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div><Button type="button" size="sm" onClick={() => void upload()} disabled={pending || !file || !slotId}>{pending ? "Working…" : "Upload GLB"}</Button></div><div className="xl:col-span-2"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for slot or model change" />{error ? <p className="mt-2 text-table text-danger-strong">{error}</p> : null}<div className="mt-3 flex flex-wrap gap-2">{slots.flatMap((slot) => slot.versions.map((version) => <span key={version.id} className="rounded-md border border-line px-2 py-1 text-meta text-fg-muted">{slot.displayName} · v{version.version} · {version.status}/{version.validationStatus}</span>))}</div></div></CardContent></Card>;
}
