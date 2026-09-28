"use client";

import * as React from "react";
import { MapPin } from "lucide-react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand, type FormField } from "@/components/engineering/form-kit";
import { useWorkforceTranslations } from "@/components/workforce/workforce-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SiteDTO } from "@/lib/modules/workforce/workforce.types";
import type { Translate } from "@/lib/i18n/translator";

/**
 * A project's sites (E-04 §38): where its work happens on the ground. A
 * project with none is worked as one site. Anybody who can open the project
 * sees them; whoever sets up the physical project keeps them. A site people
 * are still assigned to cannot be archived — the server says so.
 */

const fieldsOf = (t: Translate<"workforce">): FormField[] => [
  { name: "name", label: t("sites.name"), type: "text", required: true, placeholder: t("sites.namePlaceholder"), wide: true },
  { name: "code", label: t("sites.code"), type: "text" },
  { name: "city", label: t("sites.city"), type: "text" },
  { name: "address", label: t("sites.address"), type: "text", wide: true },
  { name: "notes", label: t("sites.notes"), type: "textarea", rows: 2 },
];

export function SitesManager({ projectId, sites, canManage }: { projectId: string; sites: SiteDTO[]; canManage: boolean }) {
  const { run, pending } = useCommand();
  const t = useWorkforceTranslations();
  const [editing, setEditing] = React.useState<SiteDTO | "new" | null>(null);

  return (
    <section className="nesto-card p-0" aria-labelledby="sites-heading" data-testid="project-sites">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 id="sites-heading" className="text-card font-semibold text-fg">
          {t("sites.sites")}
        </h2>
        {canManage ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")} data-testid="add-site">
            {t("sites.addSite")}
          </Button>
        ) : null}
      </div>
      {sites.length === 0 ? (
        <p className="px-5 py-6 text-table text-fg-muted">{t("sites.empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {sites.map((site) => (
            <li key={site.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3" data-testid="project-site" data-site-name={site.name}>
              <MapPin aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-body font-medium text-fg">
                  <span className="truncate">{site.name}</span>
                  {site.code ? <span className="text-meta font-normal text-fg-subtle">{site.code}</span> : null}
                  {site.status === "ARCHIVED" ? <Badge>{t("sites.archived")}</Badge> : null}
                </p>
                <p className="text-meta text-fg-subtle">
                  {[site.address, site.city].filter(Boolean).join(", ") || t("sites.noAddress")} · {t("sites.workers", { count: site.workerCount })} · {t("sites.crews", { count: site.crewCount })}
                </p>
              </div>
              {canManage ? (
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(site)} disabled={pending !== null}>
                    {t("sites.edit")}<span className="sr-only"> {site.name}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending !== null}
                    onClick={() =>
                      void run(
                        site.id,
                        () => engineeringApi(`/api/projects/${projectId}/sites/${site.id}`, { method: "PATCH", body: { status: site.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" } }),
                        site.status === "ARCHIVED" ? t("sites.inUseAgain", { name: site.name }) : t("sites.isArchived", { name: site.name }),
                      )
                    }
                  >
                    {site.status === "ARCHIVED" ? t("sites.useAgain") : t("sites.archive")}
                    <span className="sr-only"> {site.name}</span>
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? t("sites.addTitle") : editing ? t("sites.editTitle", { name: editing.name }) : t("sites.site")}
        fields={fieldsOf(t)}
        initial={editing && editing !== "new" ? editing : {}}
        submitLabel={editing === "new" ? t("sites.addSite") : t("sites.save")}
        saveKind={editing === "new" ? "create" : "save"}
        module="workforce"
        testId="site-dialog"
        onSubmit={async (payload) => {
          if (editing === "new") await engineeringApi(`/api/projects/${projectId}/sites`, { body: payload });
          else if (editing) await engineeringApi(`/api/projects/${projectId}/sites/${editing.id}`, { method: "PATCH", body: payload });
          await run("site", async () => null, t("sites.saved"));
        }}
      />
    </section>
  );
}
