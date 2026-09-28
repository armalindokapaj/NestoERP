import type { Metadata } from "next";

import { MyWorkView, type MyWorkQuery } from "@/components/productivity/my-work-view";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { requireUserContext } from "@/lib/context/current-user";
import { listMyWork } from "@/lib/modules/productivity/my-work.service";
import { myWorkQuerySchema, myWorkRange } from "@/lib/modules/productivity/productivity.schema";
import { getTranslations } from "@/lib/i18n/server";
import { productivityAvailability } from "@/lib/modules/productivity/productivity.workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("misc"))("myWork.title") };
}

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * My Work — the full Recent Work and Favorites history (Fast Re-entry §10-§12,
 * §59-§67, §160-§169). Workspace-neutral: user-global in any workspace, never a
 * sidebar module (§9), reached from the search panel's "View all".
 */
export default async function MyWorkPage({ searchParams }: Params) {
  const context = await requireUserContext();
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => (typeof value === "string" && value !== "" ? [[key, value]] : [])));
  const parsed = myWorkQuerySchema.safeParse(flat);
  // A malformed parameter resets the filters rather than failing the page (§168).
  const input = parsed.success ? parsed.data : myWorkQuerySchema.parse({ tab: flat.tab === "favorites" ? "favorites" : "recent" });
  const m = await getTranslations("misc");
  const [page, availability] = await Promise.all([listMyWork(context, { ...input, ...myWorkRange(input), cursor: null }), productivityAvailability(context)]);

  // Only filters the service kept are echoed back into the form.
  const query: MyWorkQuery = {
    companyId: page.facets.companies.some((company) => company.id === input.companyId) ? input.companyId : undefined,
    module: page.facets.modules.includes(input.module as never) ? input.module : undefined,
    projectId: page.facets.projects.some((project) => project.id === input.projectId) ? input.projectId : undefined,
    q: input.q,
    range: input.tab === "recent" ? input.range : undefined,
    from: input.from,
    to: input.to,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Breadcrumbs items={[{ label: m("myWork.title") }]} />
      <header>
        <h1 className="text-page font-semibold tracking-tight text-fg">{m("myWork.title")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{m("myWork.description")}</p>
      </header>
      <MyWorkView key={JSON.stringify({ tab: input.tab, query })} tab={input.tab} query={query} initial={page} favoritesEnabled={availability.favoritesEnabled} recentEnabled={availability.recentWorkEnabled} />
    </div>
  );
}
