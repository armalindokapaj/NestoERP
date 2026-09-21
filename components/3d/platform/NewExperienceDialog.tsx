"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Plus } from "lucide-react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

export type ExperienceProvisioningGroup = {
  id: string;
  name: string;
  status: string;
  companies: Array<{
    id: string;
    name: string;
    projects: Array<{
      id: string;
      name: string;
      code: string;
      coverImageDocumentId: string | null;
      project3DConfig: { id: string } | null;
      _count: { buildings: number; floors: number; units: number };
    }>;
  }>;
};

type StructureMode = "USE_EXISTING" | "CREATE_NOW" | "CREATE_LATER";

export function NewExperienceDialog({ groups, triggerLabel = "New Experience" }: { groups: ExperienceProvisioningGroup[]; triggerLabel?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(1);
  const [groupId, setGroupId] = React.useState("");
  const [companyId, setCompanyId] = React.useState("");
  const [projectId, setProjectId] = React.useState("");
  const [experienceName, setExperienceName] = React.useState("");
  const [internalNotes, setInternalNotes] = React.useState("");
  const [structureMode, setStructureMode] = React.useState<StructureMode>("CREATE_LATER");
  const [reason, setReason] = React.useState("Provision new 3D Experience");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const group = groups.find((item) => item.id === groupId);
  const company = group?.companies.find((item) => item.id === companyId);
  const project = company?.projects.find((item) => item.id === projectId);
  const availableProjects = company?.projects.filter((item) => !item.project3DConfig) ?? [];
  const hasStructure = Boolean(project && project._count.buildings + project._count.floors + project._count.units > 0);

  function reset() {
    setStep(1); setGroupId(""); setCompanyId(""); setProjectId("");
    setExperienceName(""); setInternalNotes(""); setStructureMode("CREATE_LATER");
    setReason("Provision new 3D Experience"); setError(null);
  }

  function chooseProject(value: string) {
    setProjectId(value);
    const selected = availableProjects.find((item) => item.id === value);
    if (selected) {
      setExperienceName(`${selected.name} 3D Experience`);
      const existing = selected._count.buildings + selected._count.floors + selected._count.units > 0;
      setStructureMode(existing ? "USE_EXISTING" : "CREATE_NOW");
    }
  }

  function advance() {
    setError(null);
    if (step === 1 && !project) return setError("Choose a Group, Company, and Project.");
    if (step === 2 && experienceName.trim().length < 2) return setError("Give the Experience a name.");
    setStep((current) => Math.min(4, current + 1));
  }

  async function create() {
    if (!group || !company || !project) return setError("Choose a valid Project.");
    if (reason.trim().length < 3) return setError("Give a reason for provisioning.");
    setPending(true); setError(null);
    try {
      const result = await engineeringApi<{ openPath: string }>("/api/platform/3d/experiences", {
        method: "POST",
        body: { parentGroupId: group.id, companyId: company.id, projectId: project.id, experienceName, internalNotes: internalNotes.trim() || null, activateEntitlement: true, structureMode, reason },
      });
      toast({ title: "3D Experience created.", tone: "success" });
      setOpen(false); reset();
      router.push(result.openPath); router.refresh();
    } catch (failure) {
      setError(failureMessage(failure, "The 3D Experience could not be created."));
    } finally { setPending(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
    <DialogTrigger asChild><Button type="button"><Plus />{triggerLabel}</Button></DialogTrigger>
    <DialogContent className="max-w-2xl">
      <DialogTitle>New 3D Experience</DialogTitle>
      <DialogDescription>Provision the Platform workspace against one canonical NESTO Project.</DialogDescription>
      <ol className="mt-5 grid grid-cols-4 gap-2" aria-label="Creation progress">
        {["Project", "Details", "Structure", "Review"].map((label, index) => <li key={label} className={`rounded-lg border px-3 py-2 text-center text-meta font-medium ${step === index + 1 ? "border-accent bg-accent-soft text-accent-strong" : step > index + 1 ? "border-success/30 bg-success-soft text-success-strong" : "border-line text-fg-subtle"}`}>{step > index + 1 ? <Check className="mr-1 inline size-3" /> : null}{label}</li>)}
      </ol>

      <div className="mt-5 min-h-72">
        {step === 1 ? <div className="space-y-4">
          <Field label="Group"><select className={selectClass} value={groupId} onChange={(event) => { setGroupId(event.target.value); setCompanyId(""); setProjectId(""); }}><option value="">Choose a Group</option>{groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Company"><select className={selectClass} value={companyId} disabled={!group} onChange={(event) => { setCompanyId(event.target.value); setProjectId(""); }}><option value="">Choose a Company</option>{group?.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Project"><select className={selectClass} value={projectId} disabled={!company} onChange={(event) => chooseProject(event.target.value)}><option value="">Choose an unprovisioned Project</option>{availableProjects.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field>
          {company && availableProjects.length === 0 ? <p className="rounded-lg bg-info-soft p-3 text-table text-info-strong">Every Project in this Company already has an Experience.</p> : null}
        </div> : null}

        {step === 2 ? <div className="space-y-4">
          <Field label="Experience name"><Input value={experienceName} onChange={(event) => setExperienceName(event.target.value)} maxLength={160} /></Field>
          <Field label="Internal notes"><Textarea value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} maxLength={2000} placeholder="Platform-only implementation notes" /></Field>
          <div className="rounded-lg border border-line bg-surface-muted p-3 text-table text-fg-muted">The Experience uses the canonical Project cover. Change that cover from the Project workspace.</div>
          <label className="flex items-center gap-2 text-body text-fg"><input type="checkbox" checked disabled /> Activate the premium 3D entitlement</label>
        </div> : null}

        {step === 3 && project ? <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">{(["buildings", "floors", "units"] as const).map((key) => <div key={key} className="rounded-xl border border-line bg-surface-muted p-4"><p className="text-page font-semibold text-fg">{project._count[key]}</p><p className="capitalize text-meta text-fg-muted">{key}</p></div>)}</div>
          <p className="text-body text-fg-muted">{hasStructure ? "Canonical Project structure is available and can be used immediately." : "This Project has no canonical structure yet."}</p>
          {([hasStructure ? ["USE_EXISTING", "Use existing structure", "Keep the canonical Buildings, Floors, and Units already on this Project."] : null, ["CREATE_NOW", "Create structure now", "Open Project Structure after provisioning."], ["CREATE_LATER", "Create structure later", "Open the Overview and configure structure when ready."]] as Array<[StructureMode, string, string] | null>).filter(Boolean).map((option) => option && <label key={option[0]} className={`block cursor-pointer rounded-xl border p-4 ${structureMode === option[0] ? "border-accent bg-accent-soft" : "border-line"}`}><span className="flex items-start gap-3"><input type="radio" name="structureMode" checked={structureMode === option[0]} onChange={() => setStructureMode(option[0])} /><span><span className="block text-body font-semibold text-fg">{option[1]}</span><span className="text-table text-fg-muted">{option[2]}</span></span></span></label>)}
        </div> : null}

        {step === 4 && project && group && company ? <div className="space-y-4">
          <dl className="grid gap-3 rounded-xl border border-line bg-surface-muted p-4 sm:grid-cols-2"><Review label="Experience" value={experienceName} /><Review label="Project" value={`${project.code} · ${project.name}`} /><Review label="Organization" value={`${group.name} · ${company.name}`} /><Review label="Structure" value={structureMode === "USE_EXISTING" ? "Use existing" : structureMode === "CREATE_NOW" ? "Create now" : "Create later"} /><Review label="Entitlement" value="Active · viewer enabled" /></dl>
          <Field label="Provisioning reason"><Textarea className="min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></Field>
        </div> : null}
      </div>

      {error ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-table text-danger-strong">{error}</p> : null}
      <DialogFooter className="justify-between">
        <Button type="button" variant="ghost" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || pending}><ArrowLeft />Back</Button>
        {step < 4 ? <Button type="button" onClick={advance}>Continue<ArrowRight /></Button> : <Button type="button" onClick={() => void create()} disabled={pending}>{pending ? "Creating…" : "Create Experience"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-meta font-medium text-fg-muted"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function Review({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-meta text-fg-subtle">{label}</dt><dd className="mt-0.5 text-body font-medium text-fg">{value}</dd></div>;
}
