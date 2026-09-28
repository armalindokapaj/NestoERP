import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "@/components/navigation/nav-link";

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
import { getTranslations } from "@/lib/i18n/server";
import { peopleLabel } from "@/lib/i18n/modules/people/labels";
import type { Translate } from "@/lib/i18n/translator";
import { ALL_COMPANIES, directoryQuerySchema } from "@/lib/modules/people/people.schema";
import { directoryFilterOptions, listPeople } from "@/lib/modules/people/people.service";
import type { PersonCardDTO } from "@/lib/modules/people/people.types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("people"))("meta.people") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * The people directory (E-01 §35-§40): everybody who works in the group,
 * across its companies, with where they work and how to reach them. Searched
 * by name, title or work contact; narrowed by company, department, NESTO role,
 * title, place, project or manager, or seen as the reader's own company,
 * department or project colleagues (E-08 §11, §41). Those who keep person
 * records may include people who no longer work here.
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
    manager: one(params.manager),
    role: one(params.role),
    view: one(params.view),
    status: one(params.status),
    page: one(params.page),
  });
  const [directory, options, t] = await Promise.all([listPeople(context, query), directoryFilterOptions(context), getTranslations("people")]);
  const directoryHref = (overrides: { page?: number; company?: string } = {}) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: query.q, company: overrides.company ?? query.company, department: query.department, title: query.title, location: query.location, project: query.project, manager: query.manager, role: query.role, view: query.view, status: query.status === "all" ? "all" : undefined })) {
      if (value) next.set(key, value);
    }
    if (overrides.page && overrides.page > 1) next.set("page", String(overrides.page));
    const text = next.toString();
    return text ? `/people?${text}` : "/people";
  };
  const pageHref = (page: number) => directoryHref({ page });
  // A page past the end moves once to the last real page, the filters kept (AUD-08 §4, DT-05).
  if (directory.pagination.page !== query.page) redirect(pageHref(directory.pagination.page));
  const filtered = Boolean(query.q || query.company || query.department || query.title || query.location || query.project || query.manager || query.role || query.view || query.status === "all");
  // The directory's views (E-08 §11): everybody, or the reader's own company, department or project colleagues.
  const inGroup = context.workspace.scopeType === "GROUP";
  // How many of the folded phone filters are set (AUD-04 §5, D-07-12).
  const moreFilters = [query.company, query.department, query.role, query.title, query.location].filter(Boolean).length;
  // In the Group workspace there is no "my company", department or project — those belong to the
  // session's company — so only the whole directory is offered; in a company workspace "everyone"
  // already is the company (Workspace Context §46).
  const VIEWS = (inGroup
    ? [{ key: undefined, label: t("directory.everyone") }]
    : [
        { key: undefined, label: t("directory.everyoneIn", { company: context.company.name }) },
        { key: "department", label: t("directory.myDepartment") },
        { key: "projects", label: t("directory.myProjects") },
      ]) as ReadonlyArray<{ key: "company" | "department" | "projects" | undefined; label: string }>;

  return (
    <ModulePage
      experience={resolveModuleExperience(context, "people")}
      activeSection=""
      title={t("meta.people")}
      description={
        inGroup || query.company === ALL_COMPANIES
          ? t("directory.groupDescription", { group: context.parentGroup.name })
          : t("directory.companyDescription", { company: context.company.name })
      }
      actions={
        <Button asChild size="sm" variant="secondary">
          <Link href="/people/me">{t("directory.yourProfile")}</Link>
        </Button>
      }
    >
      <div className="space-y-4">
        <nav aria-label={t("directory.views")} className="flex flex-wrap gap-2" data-testid="directory-views">
          {VIEWS.map((view) => (
            <Link
              key={view.label}
              href={view.key ? `/people?view=${view.key}` : "/people"}
              aria-current={query.view === view.key ? "page" : undefined}
              className={
                query.view === view.key
                  ? "inline-flex items-center rounded-full border border-accent/40 bg-accent-soft px-3 py-1 text-table font-medium text-accent-strong touch:min-h-11"
                  : "inline-flex items-center rounded-full border border-line px-3 py-1 text-table text-fg-muted hover:border-line-strong hover:text-fg touch:min-h-11"
              }
            >
              {view.label}
            </Link>
          ))}
        </nav>
        <form method="get" action="/people" className="nesto-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] lg:items-end" aria-label={t("directory.find")}>
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("directory.search")}
            <Input name="q" type="search" defaultValue={query.q ?? ""} placeholder={t("directory.searchPlaceholder")} />
          </label>
          {/*
            Below sm the five narrowing filters fold behind "More filters (N)",
            open when one is set, so the first person is not seven rows down.
            CSS only: the fields stay in this GET form (and submit) either way,
            and from sm up the wrapper is display: contents, so the grid is as
            before (AUD-04 §5, D-07-12, MW-06).
          */}
          <input id="people-more-filters" type="checkbox" className="peer sr-only" defaultChecked={moreFilters > 0} />
          <label
            htmlFor="people-more-filters"
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-body font-medium text-fg peer-focus-visible:ring-2 peer-focus-visible:ring-ring sm:hidden"
          >
            {t("directory.moreFilters")}{moreFilters > 0 ? ` (${moreFilters})` : ""}
          </label>
          <div className="max-sm:hidden max-sm:peer-checked:grid max-sm:peer-checked:gap-3 sm:contents">
          {/*
            The workspace is the default, not a wall: a company workspace opens on
            its own company and "Every company" widens to the group's directory,
            which everyone who works in the group may read (E-01 §103, §85, §86).
          */}
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("directory.company")}
            <select name="company" defaultValue={query.company ?? (inGroup ? ALL_COMPANIES : context.companyId)} className={selectClass}>
              <option value={ALL_COMPANIES}>{t("directory.everyCompany")}</option>
              {options.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("directory.department")}
            <select name="department" defaultValue={query.department ?? ""} className={selectClass}>
              <option value="">{t("directory.everyDepartment")}</option>
              {options.departments.map((department) => (
                <option key={department.key} value={department.key}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("directory.role")}
            <select name="role" defaultValue={query.role ?? ""} className={selectClass}>
              <option value="">{t("directory.anyRole")}</option>
              {options.roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("directory.jobTitle")}
            <Input name="title" defaultValue={query.title ?? ""} placeholder={t("directory.any")} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-muted">
            {t("directory.place")}
            <Input name="location" defaultValue={query.location ?? ""} placeholder={t("directory.placePlaceholder")} />
          </label>
          </div>
          <div className="flex items-end gap-2">
            {directory.canIncludeInactive ? (
              <label className="flex h-10 items-center gap-2 whitespace-nowrap text-meta text-fg-muted">
                <input type="checkbox" name="status" value="all" defaultChecked={query.status === "all"} className="size-4" />
                {t("directory.includeFormer")}
              </label>
            ) : null}
            {query.project ? <input type="hidden" name="project" value={query.project} /> : null}
            {query.manager ? <input type="hidden" name="manager" value={query.manager} /> : null}
            {query.view ? <input type="hidden" name="view" value={query.view} /> : null}
            <Button type="submit">{t("directory.search")}</Button>
          </div>
        </form>

        <p className="text-meta text-fg-subtle" aria-live="polite">
          {t("directory.count", { count: directory.pagination.total })}
          {query.manager ? t("directory.reportingTo") : ""}
          {filtered ? (
            <>
              {" · "}
              <Link href="/people" className="text-accent-strong hover:underline">
                {t("directory.clear")}
              </Link>
            </>
          ) : null}
        </p>

        {directory.data.length === 0 ? (
          // The workspace's company is the default, not a wall: somebody looking
          // for a colleague in another company is told where to find them rather
          // than left with an empty page (E-01 §103, Workspace Context §85, §86).
          <EmptyState
            title={t("directory.noMatch")}
            description={
              !inGroup && query.company !== ALL_COMPANIES
                ? t("directory.noMatchCompany", { company: context.company.name })
                : t("directory.tryAnother")
            }
            action={
              !inGroup && query.company !== ALL_COMPANIES
                ? { label: t("directory.searchEvery"), href: directoryHref({ company: ALL_COMPANIES }) }
                : undefined
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("directory.list")}>
            {directory.data.map((person) => (
              <PersonCard key={person.personId} person={person} t={t} />
            ))}
          </ul>
        )}

        {directory.pagination.totalPages > 1 ? (
          <nav aria-label={t("directory.pages")} className="flex items-center justify-between gap-2 text-table">
            {directory.pagination.page > 1 ? (
              <Link href={pageHref(directory.pagination.page - 1)} className="text-accent-strong hover:underline">
                {t("directory.previous")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-fg-subtle">
              {t("directory.page", { page: directory.pagination.page, total: directory.pagination.totalPages })}
            </span>
            {directory.pagination.page < directory.pagination.totalPages ? (
              <Link href={pageHref(directory.pagination.page + 1)} className="text-accent-strong hover:underline">
                {t("directory.next")}
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

function PersonCard({ person, t }: { person: PersonCardDTO; t: Translate<"people"> }) {
  const status = WORK_STATUS[person.status];
  return (
    <li className="nesto-card flex gap-3 p-4" data-testid="person-card">
      <Avatar firstName={person.initials.firstName} lastName={person.initials.lastName} src={person.photoUrl} size="lg" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link href={`/people/${person.personId}`} className="truncate text-card font-semibold text-fg hover:text-accent-strong hover:underline">
            {person.name}
          </Link>
          {person.status !== "ACTIVE" ? <Badge tone={status.tone}>{peopleLabel(t, "workStatus", person.status, status.label)}</Badge> : null}
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
              {person.workPhoneExtension ? t("directory.ext", { ext: person.workPhoneExtension }) : ""}
            </a>
          ) : null}
        </div>
        {person.officeLocation ? <p className="truncate text-meta text-fg-subtle">{person.officeLocation}</p> : null}
      </div>
    </li>
  );
}
