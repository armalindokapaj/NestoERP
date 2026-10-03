"use client";

import { Plus } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { adminText } from "@/components/platform/admin-i18n";
import { QUICK_CREATE } from "@/components/platform/quick-create-items";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** The one global Create (Admin IA §19, §20); its entries are in quick-create-items.ts, which server components read too. */
export function PlatformQuickCreate({ permissions }: { permissions: readonly string[] }) {
  const t = useTranslations("admin");
  const items = QUICK_CREATE.filter((item) => permissions.includes(item.permission));
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="accent" size="sm" data-testid="admin-quick-create"><Plus aria-hidden="true" /><span className="max-sm:sr-only">{t("shell.create")}</span></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {items.map((item) => (
          <DropdownMenuItem key={item.key} asChild>
            <Link href={item.href} className="cursor-pointer"><item.icon aria-hidden="true" className="size-4" />{adminText(t, `create.${item.key}`, item.label)}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
