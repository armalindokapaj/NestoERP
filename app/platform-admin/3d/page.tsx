import Image from "next/image";
import Link from "next/link";
import { Box, Building2, CalendarClock, Layers3, Orbit, PackageOpen } from "lucide-react";

import { NewExperienceDialog } from "@/components/3d/platform/NewExperienceDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { project3DExperienceListQuerySchema } from "@/lib/modules/project-3d/project-3d.schema";
import { listProject3DExperiences, listProject3DProvisioningOptions } from "@/lib/modules/project-3d/project-3d.service";

export const metadata = { title: "3D Experiences" };
const selectClass = "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

type Search = { q?: string; group?: string; company?: string; state?: string; publication?: string; entitlement?: string };

export default async function ThreeDExperiencesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const context = await requirePlatformContext();
  const raw = await searchParams;
  const parsed = project3DExperienceListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : {};
  const [experiences, groups] = await Promise.all([listProject3DExperiences(context, query), listProject3DProvisioningOptions(context)]);
  const companies = groups.flatMap((group) => group.companies.map((company) => ({ ...company, groupName: group.name })));

  return <div className="space-y-5">
    <PageHeader title="3D Experiences" description="Provision, author, bind, and publish premium 3D Experiences from one Platform workspace." actions={<NewExperienceDialog groups={groups} />} />

    <form className="nesto-card grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-7">
      <Input name="q" defaultValue={query.q} placeholder="Search Experience or Project" className="xl:col-span-2" />
      <select name="group" defaultValue={query.group ?? ""} className={selectClass}><option value="">All groups</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <select name="company" defaultValue={query.company ?? ""} className={selectClass}><option value="">All companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.groupName} · {company.name}</option>)}</select>
      <select name="state" defaultValue={query.state ?? ""} className={selectClass}><option value="">Any model state</option><option value="READY">Ready</option><option value="PROCESSING">Processing</option><option value="NEEDS_MODEL">Needs model</option><option value="FAILED">Failed</option></select>
      <select name="publication" defaultValue={query.publication ?? ""} className={selectClass}><option value="">Any publication</option><option value="PUBLISHED">Published</option><option value="DRAFT">Draft</option></select>
      <div className="flex gap-2"><select name="entitlement" defaultValue={query.entitlement ?? ""} className={selectClass}><option value="">Any entitlement</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="INACTIVE">Inactive</option><option value="EXPIRED">Expired</option></select><Button type="submit" variant="secondary">Filter</Button></div>
    </form>

    {experiences.length ? <section className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3" aria-label="Provisioned 3D Experiences">
      {experiences.map((experience) => <article key={experience.id} className="nesto-card overflow-hidden">
        <div className="relative aspect-[16/7] overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-950">
          {experience.coverUrl ? <Image src={experience.coverUrl} alt="" fill unoptimized className="object-cover opacity-80" sizes="(min-width: 1536px) 32vw, (min-width: 768px) 50vw, 100vw" /> : <div className="absolute inset-0 flex items-center justify-center"><Orbit className="size-16 text-white/20" /></div>}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
            <Badge tone={readinessTone(experience.models.readiness)}>{experience.models.readiness.replace("_", " ")}</Badge>
            <Badge tone={publicationTone(experience.publicationState)}>{experience.publicationState.replace("_", " ")}</Badge>
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-card font-semibold text-fg">{experience.experienceName}</h2><p className="mt-1 truncate font-mono text-meta text-fg-subtle">{experience.project.code} · {experience.project.name}</p></div>{experience.entitlement ? <Badge tone={experience.entitlement.status === "ACTIVE" ? "success" : experience.entitlement.status === "SUSPENDED" ? "warning" : "neutral"}>{experience.entitlement.status}</Badge> : null}</div>
          <p className="mt-3 text-table text-fg-muted"><Building2 className="mr-1.5 inline size-4" />{experience.project.company.parentGroup.name} · {experience.project.company.name}</p>
          <dl className="mt-4 grid grid-cols-3 gap-3 border-y border-line py-4">
            <Stat icon={<Layers3 />} label="Structure" value={`${experience.structure.buildings}/${experience.structure.floors}/${experience.structure.units}`} />
            <Stat icon={<Box />} label="Model slots" value={String(experience.models.slots)} />
            <Stat icon={<PackageOpen />} label="Releases" value={String(experience.releases)} />
          </dl>
          <div className="mt-4 flex items-center justify-between gap-3"><p className="text-meta text-fg-subtle"><CalendarClock className="mr-1 inline size-3.5" />{experience.activeRelease ? `Release ${experience.activeRelease.releaseNumber} · ${new Date(experience.activeRelease.publishedAt).toLocaleDateString()}` : "Never published"}</p><Button asChild size="sm"><Link href={`/platform-admin/3d/projects/${experience.projectId}`}>Open Experience</Link></Button></div>
        </div>
      </article>)}
    </section> : <section className="nesto-card flex min-h-80 flex-col items-center justify-center p-8 text-center"><span className="rounded-2xl bg-accent-soft p-4 text-accent-strong"><Orbit className="size-8" /></span><h2 className="mt-4 text-card font-semibold text-fg">No 3D Experiences found</h2><p className="mt-1 max-w-md text-body text-fg-muted">Create the first Experience or change the filters to view another part of the library.</p><div className="mt-5 flex gap-2"><NewExperienceDialog groups={groups} triggerLabel="Create Experience" />{Object.keys(query).length ? <Button asChild variant="secondary"><Link href="/platform-admin/3d">Clear filters</Link></Button> : null}</div></section>}
  </div>;
}

function Stat({ icon, label, value }: { icon: React.ReactElement<{ className?: string }>; label: string; value: string }) {
  return <div><p className="flex items-center gap-1 text-meta text-fg-subtle">{icon}{label}</p><p className="mt-1 text-body font-semibold tabular-nums text-fg">{value}</p></div>;
}

function readinessTone(state: string): "success" | "warning" | "danger" | "neutral" {
  return state === "READY" ? "success" : state === "FAILED" ? "danger" : state === "PROCESSING" ? "warning" : "neutral";
}

function publicationTone(state: string): "success" | "warning" | "neutral" {
  return state === "PUBLISHED" ? "success" : state === "DRAFT_CHANGES" ? "warning" : "neutral";
}
