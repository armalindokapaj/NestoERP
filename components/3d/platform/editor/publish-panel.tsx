"use client";

import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";

import type { Project3DConfig } from "@/lib/3d/runtime/types";
import { cn } from "@/lib/utils/cn";
import { GroupCard, SectionHeading } from "./rozaris-fields";

/*
 * The Rozaris Web3D editor's Publish panel (panels/PublishPanel.tsx): the
 * pre-publish validation checklist and the way to the viewer. NESTO publishes
 * through Save and its Releases page, so those stay the actions; this is what
 * to check before them.
 */

type Version = { id: string; version: number; validationStatus: string; validationIssues: unknown; sceneManifest: unknown; asset: unknown; unitBindings: Array<{ meshName: string; unitId: string }> };
type Slot = { id: string; displayName: string; role: string; transformParentSlotId: string | null; versions: Version[] };
type Unit = { id: string; unitCode: string };

function CheckRow({ ok, label, detail }: { ok: boolean | "warn"; label: string; detail?: string }) {
  const Icon = ok === true ? CheckCircle2 : AlertTriangle;
  const color = ok === true ? "text-green-500" : ok === "warn" ? "text-amber-500" : "text-red-500";
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", color)} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[11px] text-neutral-300">{label}</p>
        {detail ? <p className="text-[10px] text-neutral-500">{detail}</p> : null}
      </div>
    </div>
  );
}

function issuesOf(version: Version): string[] {
  return Array.isArray(version.validationIssues) ? version.validationIssues.filter((issue): issue is string => typeof issue === "string") : [];
}

function unitBlockNames(version: Version): string[] {
  const nodes = Array.isArray(version.sceneManifest) ? (version.sceneManifest as Array<{ name?: unknown; autoClassification?: unknown }>) : [];
  return [...new Set(nodes.filter((node) => typeof node.name === "string" && (node.autoClassification === "unit_block" || /^Unit_/i.test(node.name))).map((node) => node.name as string))];
}

export function PublishPanel({ slots, units, draft, managementHref }: { slots: Slot[]; units: Unit[]; draft: Project3DConfig; managementHref: string }) {
  // The version a release would carry: each model's newest one that is ready.
  const chosen = slots.flatMap((slot) => {
    const version = slot.versions.find((candidate) => candidate.asset) ?? slot.versions[0];
    return version ? [{ slot, version }] : [];
  });
  const validUnitIds = new Set(units.map((unit) => unit.id));
  const links = chosen.flatMap(({ version }) => version.unitBindings);
  const brokenLinks = links.filter((link) => !validUnitIds.has(link.unitId));
  const hasOpeningShot = draft.cameraPresets.length > 0;
  const sectionCount = draft.sections.length;
  const unitsModels = chosen.filter(({ slot }) => slot.role === "UNITS");
  const mappedUnitIds = new Set(unitsModels.flatMap(({ version }) => version.unitBindings.map((link) => link.unitId)));
  const missingUnits = units.filter((unit) => !mappedUnitIds.has(unit.id));

  if (chosen.length === 0) return <p className="p-3 text-xs text-neutral-500">Upload a model on the Scene tab first.</p>;

  return (
    <div className="space-y-3">
      <SectionHeading>Preview</SectionHeading>
      <GroupCard>
        <a href={`${managementHref}/viewer`} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-300 hover:bg-neutral-800">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open Company Viewer
        </a>
        <p className="mt-1 px-1 text-[10px] text-neutral-600">Shows the currently PUBLISHED release, not this draft. Save publishes your changes as a new release.</p>
        <a href={`${managementHref}/releases`} target="_blank" rel="noopener noreferrer" className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-300 hover:bg-neutral-800">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open Releases
        </a>
      </GroupCard>

      <SectionHeading>Validation</SectionHeading>
      <GroupCard>
        {chosen.map(({ slot, version }) => (
          <CheckRow
            key={slot.id}
            ok={version.validationStatus === "READY" || version.validationStatus === "ready" ? true : /warn/i.test(version.validationStatus) ? "warn" : false}
            label={`${slot.displayName} v${version.version} · GLB validation: ${version.validationStatus.toLowerCase()}`}
            detail={issuesOf(version).join(", ") || undefined}
          />
        ))}
        <CheckRow ok={brokenLinks.length === 0} label={`Unit links: ${links.length} mapped`} detail={brokenLinks.length > 0 ? `${brokenLinks.length} reference a unit that no longer exists` : undefined} />
        <CheckRow ok={hasOpeningShot ? true : "warn"} label={hasOpeningShot ? "Opening Shot set" : "No Shots saved — a default framing will be used"} />
        <CheckRow ok="warn" label={`${sectionCount} section(s) authored`} detail={sectionCount === 0 ? "Optional — informational only" : undefined} />
        {unitsModels.map(({ slot, version }) => {
          const mapped = new Set(version.unitBindings.map((link) => link.meshName));
          const unmapped = unitBlockNames(version).filter((name) => !mapped.has(name));
          return (
            <div key={`units-${slot.id}`}>
              <CheckRow ok={!!slot.transformParentSlotId} label={slot.transformParentSlotId ? `${slot.displayName}: Building anchor set` : `${slot.displayName}: No Building anchor set`} detail={slot.transformParentSlotId ? undefined : "Set the Building Anchor on the Units tab so the blocks follow the building"} />
              <CheckRow ok={unmapped.length === 0} label={`Unit blocks: ${unmapped.length} unmapped`} detail={unmapped.length > 0 ? unmapped.slice(0, 5).join(", ") : undefined} />
            </div>
          );
        })}
        {unitsModels.length ? <CheckRow ok={missingUnits.length === 0} label={`Units missing a block: ${missingUnits.length}`} detail={missingUnits.length > 0 ? missingUnits.slice(0, 5).map((unit) => unit.unitCode).join(", ") : undefined} /> : null}
      </GroupCard>
    </div>
  );
}
