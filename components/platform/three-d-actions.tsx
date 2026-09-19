"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

export function SceneConfigurationButton({ configurationId, initial }: { configurationId: string; initial: unknown }) {
  const [open, setOpen] = React.useState(false); const router = useRouter(); const toast = useToast();
  return <><Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Scene config</Button><FormDialog open={open} onOpenChange={setOpen} title="Scene configuration" description="JSON configuration for environment, lighting, sections, viewpoints and unit bindings." fields={[{ name: "json", label: "Configuration JSON", type: "textarea", required: true, rows: 12 }, { name: "reason", label: "Reason", type: "textarea", required: true }]} initial={{ json: JSON.stringify(initial ?? { environment: "default", lighting: "day", viewpoints: [] }, null, 2) }} submitLabel="Save scene" onSubmit={async (payload) => { let sceneConfiguration: Record<string, unknown>; try { sceneConfiguration = JSON.parse(String(payload.json)); } catch { throw { code: "VALIDATION_ERROR", message: "Configuration must be valid JSON.", details: { json: ["Configuration must be valid JSON."] } }; } await engineeringApi("/api/platform-admin/command", { body: { action: "3d.scene", configurationId, sceneConfiguration, reason: payload.reason } }); toast({ title: "Scene configuration saved.", tone: "success" }); router.refresh(); }} wide /></>;
}

type UploadIntent = { versionId: string; upload: { method: "PUT"; url: string; headers: Record<string, string> } };

export function ThreeDModelUploadButton({ configurationId }: { configurationId: string }) {
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !/\.(glb|gltf)$/i.test(file.name)) { setError("Choose a GLB or glTF file."); return; }
    if (!name.trim() || reason.trim().length < 3) { setError("Enter a version name and a reason."); return; }
    setPending(true); setError(null);
    try {
      const intent = await engineeringApi<UploadIntent>("/api/platform-admin/3d/uploads", { body: { configurationId, name, fileName: file.name, sizeBytes: file.size, reason } });
      const uploaded = await fetch(intent.upload.url, { method: intent.upload.method, headers: intent.upload.headers, body: file });
      if (!uploaded.ok) throw new Error(`The storage provider refused the upload (${uploaded.status}).`);
      await engineeringApi(`/api/platform-admin/3d/uploads/${intent.versionId}/complete`, { body: { reason } });
      toast({ title: "3D model uploaded and verified.", tone: "success" });
      setOpen(false); setFile(null); setName(""); setReason(""); router.refresh();
    } catch (failure) {
      setError(typeof failure === "object" && failure !== null && "message" in failure && typeof failure.message === "string" ? failure.message : "The model could not be uploaded.");
    } finally { setPending(false); }
  }

  return <><Button size="sm" onClick={() => setOpen(true)}>Upload model version</Button><Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}><DialogContent className="max-w-xl"><DialogTitle>Upload 3D model version</DialogTitle><DialogDescription>Upload a secured GLB or glTF viewer artifact. NESTO verifies its size and file signature before it can be published.</DialogDescription><form className="mt-4 space-y-4" onSubmit={submit}><div><label className="text-meta font-medium text-fg-muted" htmlFor={`model-name-${configurationId}`}>Version name</label><Input id={`model-name-${configurationId}`} value={name} onChange={(event) => setName(event.target.value)} required /></div><div><label className="text-meta font-medium text-fg-muted" htmlFor={`model-file-${configurationId}`}>Model file</label><Input id={`model-file-${configurationId}`} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /><p className="mt-1 text-meta text-fg-subtle">GLB or glTF, up to 200 MB.</p></div><div><label className="text-meta font-medium text-fg-muted" htmlFor={`model-reason-${configurationId}`}>Reason</label><Textarea id={`model-reason-${configurationId}`} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} required /></div>{error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">{error}</p> : null}<DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Uploading…" : "Upload and verify"}</Button></DialogFooter></form></DialogContent></Dialog></>;
}
