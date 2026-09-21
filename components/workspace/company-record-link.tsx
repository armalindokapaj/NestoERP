"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useToast } from "@/components/ui/toast";
import { requestWorkspaceSwitch } from "@/lib/workspace/client";

/**
 * A link to a record that lives in one company, from the Group workspace
 * (Workspace Context §31, §74).
 *
 * Every record page is a company page, so opening one from a group list enters
 * that company's workspace first — the one rule for a cross-company link, the
 * same hop the Projects page makes. The click asks the server (which checks the
 * person's own membership) and only then goes on; the header then says which
 * company they are in, and the switcher takes them back to the group. A
 * modified click (new tab) is left to the browser.
 */
export function CompanyRecordLink({
  companyId,
  companyName,
  href,
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<"a">, "href" | "onClick"> & { companyId: string; companyName?: string; href: string }) {
  const t = useTranslations("workspace");
  const toast = useToast();
  const [pending, setPending] = React.useState(false);

  async function open(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await requestWorkspaceSwitch({ scopeType: "COMPANY", companyId });
    if (!result.ok) {
      setPending(false);
      toast({ title: t("switchFailed", { name: companyName ?? "" }), tone: "danger" });
      return;
    }
    window.location.assign(href);
  }

  return (
    <a {...rest} href={href} onClick={open} aria-busy={pending || undefined} data-company-id={companyId} className={className}>
      {children}
    </a>
  );
}
