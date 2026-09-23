"use client";

import * as React from "react";
import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useToast } from "@/components/ui/toast";
import { requestWorkspaceSwitch } from "@/lib/workspace/client";

export type ChooseCompanyOption = { id: string; name: string; roleLabel: string };

/**
 * The companies a person may open a company-only module in, from the Group
 * workspace (Workspace Context §25, §29). Choosing one enters that company's
 * workspace and goes on to the module — the same switch the switcher makes.
 */
export function ChooseCompany({ companies, destination }: { companies: ChooseCompanyOption[]; destination: string }) {
  const t = useTranslations("workspace");
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  async function choose(company: ChooseCompanyOption) {
    if (pending) return;
    setPending(company.id);
    const result = await requestWorkspaceSwitch({ scopeType: "COMPANY", companyId: company.id });
    if (!result.ok) {
      setPending(null);
      toast({ title: t("switchFailed", { name: company.name }), tone: "danger" });
      return;
    }
    router.replace(destination);
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="choose-company">
      {companies.map((company) => (
        <li key={company.id}>
          <button
            type="button"
            disabled={Boolean(pending)}
            onClick={() => void choose(company)}
            data-testid="choose-company-option"
            data-company-id={company.id}
            className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
          >
            {pending === company.id ? (
              <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-accent-strong" />
            ) : (
              <Building2 aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-table font-medium text-fg">{company.name}</span>
              <span className="truncate text-micro text-fg-muted">{company.roleLabel}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
