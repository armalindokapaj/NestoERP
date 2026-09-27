import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";

import { ProjectForm } from "@/components/projects/project-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { createProjectAction } from "@/lib/actions/projects";
import { requireUserContext } from "@/lib/context/current-user";
import { contextForCompany, creatableCompanies } from "@/lib/modules/projects/project.portfolio";
import { projectFormOptions } from "@/lib/modules/projects/project.options";
import { projectTypeChoices } from "@/lib/modules/projects/project-type.service";
import { EDITABLE_STATUSES } from "@/lib/modules/projects/project.status";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("pages.newProject") };
}

type Props = { searchParams: Promise<{ company?: string | string[] }> };

/**
 * Create a project (PRD #10 §30; E-05A §30, §31).
 *
 * The route requires `project.create` in at least one of the person's
 * companies. With one, it is preselected; with several, the company is chosen
 * first, because the clients and managers the form offers belong to it. The
 * service checks the company again on submit — the page choosing it is a
 * convenience, not the authorisation.
 */
export default async function NewProjectPage({ searchParams }: Props) {
  const session = await requireUserContext();
  const t = await getTranslations("projects");
  const companies = await creatableCompanies(session);
  if (companies.length === 0) redirect("/access-denied");

  const requested = (await searchParams).company;
  const chosen =
    companies.length === 1 ? companies[0] : companies.find((company) => company.id === (typeof requested === "string" ? requested : undefined));

  if (!chosen) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <Header description={t("pages.chooseCompany")} />
        <ul className="nesto-card divide-y divide-line p-0" data-testid="new-project-companies">
          {companies.map((company) => (
            <li key={company.id}>
              <Link
                href={`/projects/new?company=${encodeURIComponent(company.id)}`}
                className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-row-hover focus-visible:bg-row-hover focus-visible:outline-none"
              >
                <span className="flex size-9 items-center justify-center rounded-md border border-line bg-surface-muted text-fg-subtle">
                  <Building2 aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-fg">{company.name}</span>
                  {company.isCurrent ? <span className="block text-meta text-fg-subtle">{t("pages.currentCompany")}</span> : null}
                </span>
                <ChevronRight aria-hidden="true" className="size-4 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const context = await contextForCompany(session, chosen.id, "project.create");
  const [options, projectTypes] = await Promise.all([projectFormOptions(context), projectTypeChoices(context)]);

  async function action(formData: FormData) {
    "use server";
    return createProjectAction(formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Header description={t("pages.createIntro")} />

      <ProjectForm
        mode="create"
        cancelHref="/projects"
        company={{ id: chosen.id, name: chosen.name, changeHref: companies.length > 1 ? "/projects/new" : undefined }}
        clients={options.clients}
        managers={options.managers}
        projectTypes={projectTypes}
        statuses={
          // Starting a project anywhere but Pending is the status decision (E-05A §31).
          can(context, "project.status.manage")
            ? EDITABLE_STATUSES.map((status) => ({ value: status, label: t(`status.${status}`) }))
            : []
        }
        initial={{
          code: "",
          name: "",
          description: "",
          clientId: "",
          projectManagerMemberId: "",
          status: "PENDING",
          priority: "",
          projectTypeId: "",
          coverImageDocumentId: "",
          startDate: "",
          endDate: "",
          address: "",
          city: "",
          country: "",
          builtArea: "",
          isKeyProject: "NO",
        }}
        action={action}
      />
    </div>
  );
}

async function Header({ description }: { description: string }) {
  const t = await getTranslations("projects");
  return (
    <div>
      <Breadcrumbs items={[{ label: t("meta.projects"), href: "/projects" }, { label: t("pages.newProject") }]} />
      <h1 className="mt-3 text-page font-semibold text-fg">{t("pages.newProject")}</h1>
      <p className="mt-1.5 text-body text-fg-muted">{description}</p>
    </div>
  );
}
