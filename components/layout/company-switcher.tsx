"use client";

import * as React from "react";
import { Building2, Check, ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import type { CompanyContextOptionDTO } from "@/lib/modules/organization/company-context.service";

/**
 * The company the session works in, for somebody who works in several
 * (E-06 §3.4, §96). Choosing one moves the session to that membership and
 * starts again from its dashboard: nothing on the current page belongs to the
 * next company. Shown only when there is a choice to make.
 */
export function CompanySwitcher({ companies }: { companies: CompanyContextOptionDTO[] }) {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const current = companies.find((company) => company.isCurrent);
  if (companies.length < 2 || !current) return null;

  function choose(companyId: string) {
    if (companyId === current?.companyId) return;
    setPending(true);
    void fetch("/api/me/company-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId }),
    })
      .catch(() => null)
      .then((response) => {
        if (!response?.ok) {
          setPending(false);
          toast({ title: "That company could not be opened.", tone: "danger" });
          return;
        }
        // The whole shell — navigation, modules, the company itself — belongs to
        // the new membership, so it is loaded again rather than patched.
        window.location.assign("/dashboard");
      });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-table text-fg transition-colors hover:bg-hover data-[state=open]:bg-hover"
        aria-label={`Company: ${current.companyName}. Switch company`}
        data-testid="company-switcher"
        disabled={pending}
      >
        <Building2 aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        <span className="hidden max-w-[11rem] truncate font-medium xl:block">{current.companyName}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel className="text-meta text-fg-subtle">{current.parentGroup.name}</DropdownMenuLabel>
        {companies.map((company) => (
          <DropdownMenuItem key={company.companyId} onSelect={() => choose(company.companyId)} data-testid="company-switcher-option">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-table font-medium text-fg">{company.companyName}</span>
              <span className="truncate text-micro text-fg-muted">{company.role.label}</span>
            </span>
            {company.isCurrent ? <Check aria-label="Current company" className="size-4 shrink-0 text-accent-strong" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
