import Link from "@/components/navigation/nav-link";

import { DeleteModelVersionButton } from "@/components/3d/platform/DeleteModelVersionButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listProject3DModels } from "@/lib/modules/project-3d/project-3d.service";

export const metadata = { title: "3D Model Library" };

export default async function ModelLibraryPage() {
  const context = await requirePlatformContext();
  const models = await listProject3DModels(context);
  const canDelete = canPlatform(context, "platform.3d.model.delete");
  return <div className="space-y-5"><PageHeader title="Model Library" description="Every private GLB source and processed runtime version across provisioned 3D Experiences. Removing a model from an Experience keeps its files; Delete removes them permanently." /><section className="nesto-card p-5"><Table flush aria-label="3D model versions"><TableHead><TableRow><TableHeaderCell>Model</TableHeaderCell><TableHeaderCell>Experience</TableHeaderCell><TableHeaderCell>Slot</TableHeaderCell><TableHeaderCell>State</TableHeaderCell><TableHeaderCell>Geometry</TableHeaderCell><TableHeaderCell>Size</TableHeaderCell><TableHeaderCell /></TableRow></TableHead><TableBody>{models.map((model) => <TableRow key={model.id}><TableCell><span className="font-medium text-fg">{model.originalFileName}</span><p className="text-meta text-fg-subtle">Version {model.version}</p></TableCell><TableCell>{model.project.name}<p className="text-meta text-fg-subtle">{model.project.company.parentGroup.name} · {model.project.company.name}</p></TableCell><TableCell>{model.slot.displayName}<p className="text-meta text-fg-subtle">{model.slot.role}</p></TableCell><TableCell><Badge tone={model.status === "READY" || model.status === "PUBLISHED" ? "success" : model.status === "FAILED" ? "danger" : "warning"}>{model.status}</Badge><p className="mt-1 text-meta text-fg-subtle">{model.validationStatus}</p></TableCell><TableCell>{model.meshCount ?? "—"} meshes<p className="text-meta text-fg-subtle">{model.triangleCount?.toLocaleString() ?? "—"} triangles</p></TableCell><TableCell>{formatBytes(model.runtimeSizeBytes ?? model.sourceSizeBytes)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button asChild size="sm" variant="secondary"><Link href={`/platform-admin/3d/projects/${model.project.id}/models`}>Open</Link></Button>{canDelete ? <DeleteModelVersionButton versionId={model.id} fileName={model.originalFileName} /> : null}</div></TableCell></TableRow>)}</TableBody></Table>{models.length === 0 ? <p className="py-10 text-center text-body text-fg-muted">No model versions have been uploaded.</p> : null}</section></div>;
}

function formatBytes(bytes: bigint | null) {
  if (bytes === null) return "—";
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
