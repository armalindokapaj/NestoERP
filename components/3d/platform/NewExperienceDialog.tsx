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
import { useTranslations } from "@/components/i18n/i18n-provider";

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

/** Where a project chosen elsewhere sits, so the dialog can open on it (Admin Projects & 3D PRD #5 §22). */
function locate(groups: ExperienceProvisioningGroup[], projectId: string | undefined) {
  for (const group of groups) for (const company of group.companies) if (company.projects.some((project) => project.id === projectId)) return { groupId: group.id, companyId: company.id, projectId: projectId! };
  return { groupId: "", companyId: "", projectId: "" };
}

export function NewExperienceDialog({ groups, triggerLabel, initialProjectId, defaultOpen = false }: { groups: ExperienceProvisioningGroup[]; triggerLabel?: string; initialProjectId?: string; defaultOpen?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("adminPlatform");
  const start = locate(groups, initialProjectId);
  const [open, setOpen] = React.useState(defaultOpen && Boolean(start.projectId));
  const [step, setStep] = React.useState(1);
  const [groupId, setGroupId] = React.useState(start.groupId);
  const [companyId, setCompanyId] = React.useState(start.companyId);
  const [projectId, setProjectId] = React.useState(start.projectId);
  const [experienceName, setExperienceName] = React.useState("");
  const [internalNotes, setInternalNotes] = React.useState("");
  const [structureMode, setStructureMode] = React.useState<StructureMode>("CREATE_LATER");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const group = groups.find((item) => item.id === groupId);
  const company = group?.companies.find((item) => item.id === companyId);
  const project = company?.projects.find((item) => item.id === projectId);
  const availableProjects = company?.projects.filter((item) => !item.project3DConfig) ?? [];
  const hasStructure = Boolean(project && project._count.buildings + project._count.floors + project._count.units > 0);

  function reset() {
    setStep(1); setGroupId(""); setCompanyId(""); setProjectId("");
    // Opened on one project from a list: closing it clears the address that asked for it.
    if (initialProjectId) { const url = new URL(window.location.href); url.searchParams.delete("configure"); window.history.replaceState(null, "", url.pathname + url.search); }
    setExperienceName(""); setInternalNotes(""); setStructureMode("CREATE_LATER");
    setError(null);
  }

  function chooseProject(value: string) {
    setProjectId(value);
    const selected = availableProjects.find((item) => item.id === value);
    if (selected) {
      setExperienceName(t("threeDAdmin.newExperience.defaultName", { name: selected.name }));
      const existing = selected._count.buildings + selected._count.floors + selected._count.units > 0;
      setStructureMode(existing ? "USE_EXISTING" : "CREATE_NOW");
    }
  }

  function advance() {
    setError(null);
    if (step === 1 && !project) return setError(t("threeDAdmin.newExperience.chooseAll"));
    if (step === 2 && experienceName.trim().length < 2) return setError(t("threeDAdmin.newExperience.nameRequired"));
    setStep((current) => Math.min(4, current + 1));
  }

  async function create() {
    if (!group || !company || !project) return setError(t("threeDAdmin.newExperience.invalidProject"));
    setPending(true); setError(null);
    try {
      const result = await engineeringApi<{ openPath: string }>("/api/platform/3d/experiences", {
        method: "POST",
        body: { parentGroupId: group.id, companyId: company.id, projectId: project.id, experienceName, internalNotes: internalNotes.trim() || null, activateEntitlement: true, structureMode },
      });
      toast({ title: t("threeDAdmin.newExperience.created"), tone: "success" });
      setOpen(false); reset();
      router.push(result.openPath); router.refresh();
    } catch (failure) {
      setError(failureMessage(failure, t("threeDAdmin.newExperience.createFailed")));
    } finally { setPending(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
    <DialogTrigger asChild><Button type="button"><Plus />{triggerLabel ?? t("threeDAdmin.newExperience.defaultTrigger")}</Button></DialogTrigger>
    <DialogContent className="max-w-2xl">
      <DialogTitle>{t("threeDAdmin.newExperience.title")}</DialogTitle>
      <DialogDescription>{t("threeDAdmin.newExperience.description")}</DialogDescription>
      <ol className="mt-5 grid grid-cols-4 gap-2" aria-label={t("threeDAdmin.newExperience.progressLabel")}>
        {(["project", "details", "structure", "review"] as const).map((key, index) => <li key={key} className={`rounded-lg border px-3 py-2 text-center text-meta font-medium ${step === index + 1 ? "border-accent bg-accent-soft text-accent-strong" : step > index + 1 ? "border-success/30 bg-success-soft text-success-strong" : "border-line text-fg-subtle"}`}>{step > index + 1 ? <Check className="mr-1 inline size-3" /> : null}{t(`threeDAdmin.newExperience.steps.${key}`)}</li>)}
      </ol>

      <div className="mt-5 min-h-72">
        {step === 1 ? <div className="space-y-4">
          <Field label={t("threeDAdmin.newExperience.group")}><select className={selectClass} value={groupId} onChange={(event) => { setGroupId(event.target.value); setCompanyId(""); setProjectId(""); }}><option value="">{t("threeDAdmin.newExperience.chooseGroup")}</option>{groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label={t("threeDAdmin.newExperience.company")}><select className={selectClass} value={companyId} disabled={!group} onChange={(event) => { setCompanyId(event.target.value); setProjectId(""); }}><option value="">{t("threeDAdmin.newExperience.chooseCompany")}</option>{group?.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label={t("threeDAdmin.newExperience.project")}><select className={selectClass} value={projectId} disabled={!company} onChange={(event) => chooseProject(event.target.value)}><option value="">{t("threeDAdmin.newExperience.chooseProject")}</option>{availableProjects.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field>
          {company && availableProjects.length === 0 ? <p className="rounded-lg bg-info-soft p-3 text-table text-info-strong">{t("threeDAdmin.newExperience.allProvisioned")}</p> : null}
        </div> : null}

        {step === 2 ? <div className="space-y-4">
          <Field label={t("threeDAdmin.newExperience.experienceName")}><Input value={experienceName} onChange={(event) => setExperienceName(event.target.value)} maxLength={160} /></Field>
          <Field label={t("threeDAdmin.newExperience.internalNotes")}><Textarea value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} maxLength={2000} placeholder={t("threeDAdmin.newExperience.notesPlaceholder")} /></Field>
          <div className="rounded-lg border border-line bg-surface-muted p-3 text-table text-fg-muted">{t("threeDAdmin.newExperience.coverNote")}</div>
          <label className="flex items-center gap-2 text-body text-fg"><input type="checkbox" checked disabled /> {t("threeDAdmin.newExperience.activateEntitlement")}</label>
        </div> : null}

        {step === 3 && project ? <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">{(["buildings", "floors", "units"] as const).map((key) => <div key={key} className="rounded-xl border border-line bg-surface-muted p-4"><p className="text-page font-semibold text-fg">{project._count[key]}</p><p className="capitalize text-meta text-fg-muted">{t(`threeDAdmin.newExperience.counts.${key}`)}</p></div>)}</div>
          <p className="text-body text-fg-muted">{hasStructure ? t("threeDAdmin.newExperience.structureAvailable") : t("threeDAdmin.newExperience.structureNone")}</p>
          {(hasStructure ? (["USE_EXISTING", "CREATE_NOW", "CREATE_LATER"] as const) : (["CREATE_NOW", "CREATE_LATER"] as const)).map((mode) => <label key={mode} className={`block cursor-pointer rounded-xl border p-4 ${structureMode === mode ? "border-accent bg-accent-soft" : "border-line"}`}><span className="flex items-start gap-3"><input type="radio" name="structureMode" checked={structureMode === mode} onChange={() => setStructureMode(mode)} /><span><span className="block text-body font-semibold text-fg">{t(`threeDAdmin.newExperience.modes.${mode}.title`)}</span><span className="text-table text-fg-muted">{t(`threeDAdmin.newExperience.modes.${mode}.detail`)}</span></span></span></label>)}
        </div> : null}

        {step === 4 && project && group && company ? <div className="space-y-4">
          <dl className="grid gap-3 rounded-xl border border-line bg-surface-muted p-4 sm:grid-cols-2"><Review label={t("threeDAdmin.newExperience.reviewExperience")} value={experienceName} /><Review label={t("threeDAdmin.newExperience.reviewProject")} value={`${project.code} · ${project.name}`} /><Review label={t("threeDAdmin.newExperience.reviewOrganization")} value={`${group.name} · ${company.name}`} /><Review label={t("threeDAdmin.newExperience.reviewStructure")} value={t(`threeDAdmin.newExperience.reviewModes.${structureMode}`)} /><Review label={t("threeDAdmin.newExperience.reviewEntitlement")} value={t("threeDAdmin.newExperience.entitlementValue")} /></dl>
        </div> : null}
      </div>

      {error ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-table text-danger-strong">{error}</p> : null}
      <DialogFooter className="justify-between">
        <Button type="button" variant="ghost" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || pending}><ArrowLeft />{t("threeDAdmin.newExperience.back")}</Button>
        {step < 4 ? <Button type="button" onClick={advance}>{t("threeDAdmin.newExperience.continue")}<ArrowRight /></Button> : <Button type="button" onClick={() => void create()} disabled={pending}>{pending ? t("threeDAdmin.newExperience.creating") : t("threeDAdmin.newExperience.create")}</Button>}
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
