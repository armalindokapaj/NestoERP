import type { Metadata } from "next";
import Link from "next/link";

import { selectClass } from "@/components/forms/record-form";
import { ModulePage } from "@/components/modules/module-page";
import { WORK_STATUS } from "@/components/people/work-status";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { directoryQuerySchema } from "@/lib/modules/people/people.schema";
import { directoryFilterOptions, listPeople } from "@/lib/modules/people/people.service";
import type { PersonCardDTO } from "@/lib/modules/people/people.types";

export const metadata: Metadata = { title: "People" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * The people directory (E-01 §35-§40): everybody who works in the group,
 * across its companies, with where they work and how to reach them. Searched
 * by name, title or work contact; narrowed by company, department, project,
 * title and place. Those who keep person records may include people who no
 * longer work here.
 */
export default async function PeoplePage({ searchParams }: Props) {
  const context = await requireModule("people");
  const params = await searchParams;
  const query = directoryQuerySchema.parse({
    q: one(params.q),
    company: one(params.company),
    department: one(params.department),
    title: one(params.title),
    project: one(params.project),
    location: one(params.location),
    status: one(params.status),
    page: one(params.page),
  });
  const [directory, options] = await Promise.all([listPeople(context, query), directoryFilterOptions(context)]);
  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: query.q, company: query.company, department: query.department, title: query.title, location: query.location, project: query.project, status: query.status === "all" ? "all" : undefined })) {
      if (value) next.set(key, value);
    }
    if (page > 1) next.set("page", String(page));
    const text = next.toString();
    return text ? `/people?${text}` : "/people";
  };
  const filtered = Boolean(query.q || query.company || query.department || query.title || query.location || query.project || query.status === "all");

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "people")}
      activeSection=""
      title="People"
      description={`Everyone who works in ${context.parentGroup.name}, across its companies.`}
      actions={
        <Button asChild size="sm" variant="secondary">
          <Link href="/people/me">Your profile</Link>
        </Button>
      }
    >
      <div className="space-y-4">
        <form method="get" action="/people" className="nesto-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end" aria-label="Find people">
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            Search
            <Input name="q" type="search" defaultValue={query.q ?? ""} placeholder="Name, title, email or phone" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            Company
            <select name="company" defaultValue={query.company ?? ""} className={selectClass}>
              <option value="">Every company</option>
              {options.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            Department
            <select name="department" defaultValue={query.department ?? ""} className={selectClass}>
              <option value="">Every department</option>
              {options.departments.map((department) => (
                <option key={department.key} value={department.key}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            Job title
            <Input name="title" defaultValue={query.title ?? ""} placeholder="Any" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            Place
            <Input name="location" defaultValue={query.location ?? ""} placeholder="Office or site" />
          </label>
          <div className="flex items-end gap-2">
            {directory.canIncludeInactive ? (
              <label className="flex h-10 items-center gap-2 whitespace-nowrap text-meta text-fg-muted">
                <input type="checkbox" name="status" value="all" defaultChecked={query.status === "all"} className="size-4" />
                Include former
              </label>
            ) : null}
            {query.project ? <input type="hidden" name="project" value={query.project} /> : null}
            <Button type="submit">Search</Button>
          </div>
        </form>

        <p className="text-meta text-fg-subtle" aria-live="polite">
          {directory.pagination.total === 1 ? "1 person" : `${directory.pagination.total} people`}
          {filtered ? (
            <>
              {" · "}
              <Link href="/people" className="text-accent-strong hover:underline">
                Clear
              </Link>
            </>
          ) : null}
        </p>

        {directory.data.length === 0 ? (
          <EmptyState title="Nobody matches" description="Try another name, or fewer filters." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="People">
            {directory.data.map((person) => (
              <PersonCard key={person.personId} person={person} />
            ))}
          </ul>
        )}

        {directory.pagination.totalPages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-table">
            {directory.pagination.page > 1 ? (
              <Link href={pageHref(directory.pagination.page - 1)} className="text-accent-strong hover:underline">
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-fg-subtle">
              Page {directory.pagination.page} of {directory.pagination.totalPages}
            </span>
            {directory.pagination.page < directory.pagination.totalPages ? (
              <Link href={pageHref(directory.pagination.page + 1)} className="text-accent-strong hover:underline">
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
    </ModulePage>
  );
}

function PersonCard({ person }: { person: PersonCardDTO }) {
  const status = WORK_STATUS[person.status];
  return (
    <li className="nesto-card flex gap-3 p-4" data-testid="person-card">
      <Avatar firstName={person.initials.firstName} lastName={person.initials.lastName} src={person.photoUrl} size="lg" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link href={`/people/${person.personId}`} className="truncate text-card font-semibold text-fg hover:text-accent-strong hover:underline">
            {person.name}
          </Link>
          {person.status !== "ACTIVE" ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        </div>
        {person.jobTitle ? <p className="truncate text-table text-fg">{person.jobTitle}</p> : null}
        <p className="truncate text-meta text-fg-muted">{[person.employingCompany?.name, person.department?.name].filter(Boolean).join(" · ") || "—"}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-meta">
          {person.workEmail ? (
            <a href={`mailto:${person.workEmail}`} className="truncate text-accent-strong hover:underline">
              {person.workEmail}
            </a>
          ) : null}
          {person.workPhone ? (
            <a href={`tel:${person.workPhone}`} className="text-accent-strong hover:underline">
              {person.workPhone}
              {person.workPhoneExtension ? ` ext. ${person.workPhoneExtension}` : ""}
            </a>
          ) : null}
        </div>
        {person.officeLocation ? <p className="truncate text-meta text-fg-subtle">{person.officeLocation}</p> : null}
      </div>
    </li>
  );
}
