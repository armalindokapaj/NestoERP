"use client";

import * as React from "react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { autoMatchUnitNodes } from "@/lib/3d/shared/unit-matching";

type Unit = {
  id: string;
  unitCode: string;
  name: string | null;
  publicationStatus: string;
  floor: { name: string; number: number | null; building: { name: string } };
};

type Binding = {
  meshName: string;
  projectUnitId: string;
  mappingStatus: "MAPPED" | "CARRIED" | "NEEDS_REVIEW";
  poiYawDeg: number;
  poiEnabled: boolean;
  poiDistanceOverride: number | null;
  poiHeightOverride: number | null;
};

type Workspace = {
  version: { id: string; status: string };
  detectedNodes: string[];
  units: Unit[];
  bindings: Binding[];
};

function emptyBinding(meshName: string, projectUnitId = ""): Binding {
  return {
    meshName,
    projectUnitId,
    mappingStatus: "MAPPED",
    poiYawDeg: 0,
    poiEnabled: true,
    poiDistanceOverride: null,
    poiHeightOverride: null,
  };
}

export function UnitBindingEditor({
  projectId,
  versionId,
  onDirtyChange,
}: {
  projectId: string;
  versionId: string;
  /** Told whether links differ from the saved ones, so a host can protect them from being closed away. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const endpoint = `/api/platform/3d/projects/${projectId}/versions/${versionId}/bindings`;
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null);
  const [draft, setDraft] = React.useState<Record<string, Binding>>({});
  const [saved, setSaved] = React.useState("{}");
  const [reason, setReason] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await engineeringApi<Workspace>(endpoint);
      const bindingNodes = Array.from(new Set([...next.detectedNodes, ...next.bindings.map((binding) => binding.meshName)]));
      const normalized = { ...next, detectedNodes: bindingNodes };
      setWorkspace(normalized);
      const byMesh = new Map(next.bindings.map((binding) => [binding.meshName, binding]));
      const loaded = Object.fromEntries(bindingNodes.map((meshName) => [meshName, byMesh.get(meshName) ?? emptyBinding(meshName)]));
      setDraft(loaded);
      setSaved(JSON.stringify(loaded));
    } catch (failure) {
      setError(failureMessage(failure, "The unit links could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const dirty = workspace !== null && JSON.stringify(draft) !== saved;
  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function setBinding(meshName: string, patch: Partial<Binding>) {
    setDraft((current) => ({ ...current, [meshName]: { ...(current[meshName] ?? emptyBinding(meshName)), ...patch } }));
  }

  function autoMatch() {
    if (!workspace) return;
    const current = Object.fromEntries(Object.values(draft).map((binding) => [binding.meshName, binding.projectUnitId]));
    const matches = autoMatchUnitNodes(workspace.detectedNodes, workspace.units, current);
    setDraft((existing) => Object.fromEntries(Object.entries(existing).map(([meshName, binding]) => [meshName, { ...binding, projectUnitId: matches[meshName] ?? "" }])));
  }

  async function save() {
    if (reason.trim().length < 3) {
      setError("Give a reason for this binding change.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await engineeringApi(endpoint, {
        method: "PUT",
        body: { bindings: Object.values(draft).filter((binding) => binding.projectUnitId), reason },
      });
      toast({ title: "Unit links saved.", tone: "success" });
      setReason("");
      await load();
    } catch (failure) {
      setError(failureMessage(failure, "The unit links could not be saved."));
    } finally {
      setPending(false);
    }
  }

  if (loading) return <div className="nesto-card p-5 text-body text-fg-muted">Loading scene nodes and project units…</div>;
  if (!workspace) return <div className="nesto-card p-5 text-body text-danger-strong">{error ?? "The unit links could not be loaded."}</div>;

  const selectedUnitIds = new Set(Object.values(draft).map((binding) => binding.projectUnitId).filter(Boolean));
  const linkedCount = selectedUnitIds.size;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Unit binding</CardTitle>
          <CardDescription>
            Link named model nodes to canonical NESTO units. {linkedCount} of {workspace.detectedNodes.length} detected nodes are linked.
          </CardDescription>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={autoMatch} disabled={pending || workspace.detectedNodes.length === 0}>
          Match by unit code
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {workspace.detectedNodes.length === 0 ? (
          <p className="rounded-md border border-line bg-surface-subtle px-4 py-3 text-body text-fg-muted">
            This model has no nodes named like <code>Unit_A-101</code>. Rename unit nodes in the source GLB and upload a new version.
          </p>
        ) : (
          <Table flush>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Scene node</TableHeaderCell>
                <TableHeaderCell>Project unit</TableHeaderCell>
                <TableHeaderCell>POI</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {workspace.detectedNodes.map((meshName) => {
                const binding = draft[meshName] ?? emptyBinding(meshName);
                return (
                  <TableRow key={meshName}>
                    <TableCell className="font-mono text-table">{meshName}</TableCell>
                    <TableCell className="min-w-72">
                      <select
                        aria-label={`Unit for ${meshName}`}
                        className={selectClass}
                        value={binding.projectUnitId}
                        onChange={(event) => setBinding(meshName, { projectUnitId: event.target.value })}
                        disabled={pending}
                      >
                        <option value="">Unlinked</option>
                        {workspace.units.map((unit) => (
                          <option
                            key={unit.id}
                            value={unit.id}
                            disabled={selectedUnitIds.has(unit.id) && unit.id !== binding.projectUnitId}
                          >
                            {unit.unitCode} · {unit.floor.building.name} / {unit.floor.name}{unit.name ? ` · ${unit.name}` : ""}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <label className="flex items-center gap-2 text-table text-fg-muted">
                        <input
                          type="checkbox"
                          checked={binding.poiEnabled}
                          onChange={(event) => setBinding(meshName, { poiEnabled: event.target.checked })}
                          disabled={pending || !binding.projectUnitId}
                        />
                        Show
                      </label>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor={`binding-reason-${versionId}`} className="text-meta font-medium text-fg-muted">Reason</label>
            <Input
              id={`binding-reason-${versionId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why these unit links are changing"
              disabled={pending}
            />
          </div>
          <Button type="button" onClick={() => void save()} disabled={pending || !["READY", "PUBLISHED"].includes(workspace.version.status)}>
            {pending ? "Saving…" : "Save unit links"}
          </Button>
        </div>
        {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
