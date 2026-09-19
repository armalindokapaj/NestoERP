"use client";

import * as React from "react";
import { Box, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Grant = { url: string; expiresAt: string; version: { number: number; name: string } };

export function ThreeDViewer({ projectId }: { projectId: string }) {
  const [grant, setGrant] = React.useState<Grant | null>(null); const [error, setError] = React.useState<string | null>(null); const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => { setLoading(true); setError(null); try { await import("@google/model-viewer"); const response = await fetch(`/api/projects/${projectId}/3d/grant`, { method: "POST" }); const json = await response.json() as { data?: Grant; error?: { message?: string } }; if (!response.ok || !json.data) throw new Error(json.error?.message ?? "Could not open the 3D viewer."); setGrant(json.data); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not open the 3D viewer."); } finally { setLoading(false); } }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);
  if (loading) return <div className="grid min-h-[560px] place-items-center rounded-xl border border-line bg-surface-muted"><div className="text-center"><Box className="mx-auto size-10 animate-pulse text-fg-subtle" /><p className="mt-3 text-body text-fg-muted">Opening published model…</p></div></div>;
  if (error || !grant) return <div className="grid min-h-[420px] place-items-center rounded-xl border border-line bg-surface-muted"><div className="max-w-md text-center"><p className="text-body font-medium text-fg">{error ?? "No published model is available."}</p><Button className="mt-4" variant="secondary" onClick={() => void load()}><RefreshCw /> Try again</Button></div></div>;
  return <div className="overflow-hidden rounded-xl border border-line bg-[#eef1f4]"><div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3"><div><p className="text-table font-medium text-fg">Published model · v{grant.version.number}</p><p className="text-meta text-fg-subtle">{grant.version.name}</p></div><Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw /> Refresh grant</Button></div>{React.createElement("model-viewer", { src: grant.url, alt: `Published 3D model version ${grant.version.number}`, "camera-controls": true, "touch-action": "pan-y", "shadow-intensity": "1", "environment-image": "neutral", "auto-rotate": true, style: { width: "100%", height: "min(70dvh, 760px)", background: "linear-gradient(180deg,#eef2f5,#dfe5ea)" } })}</div>;
}
