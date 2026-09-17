"use client";

import { useTransition } from "react";
import { Check, FlaskConical } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleList, roleLabel, type RoleKey } from "@/config/roles";
import { setDevRoleAction } from "@/lib/actions/dev";
import { RESET_DEV_ROLE } from "@/lib/auth/dev-role";
import { cn } from "@/lib/utils/cn";

/**
 * Development role switcher (spec §66).
 *
 * Rendered only when the shell is built in development — see AppShell — and the
 * server action behind it is independently gated, so it cannot reach production.
 *
 * It is also the piece of the top bar that gives way when the account cluster
 * runs out of room: `min-w-0` plus a truncating label lets the role name go —
 * down to the flask alone at tablet width — while the icon, and the signed-in
 * person's own name and role beside it, keep their size. Development chrome
 * should not be what decides how the product's own top bar lays out.
 */
export function DevRoleSwitcher({
  role,
  actualRole,
  isOverridden,
}: {
  role: RoleKey;
  actualRole: RoleKey;
  isOverridden: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const select = (value: string) => {
    startTransition(() => {
      void setDevRoleAction(value);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        className={cn(
          "flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2 text-micro font-medium transition-colors",
          isOverridden
            ? "border-warning/40 bg-warning-soft text-warning-strong"
            : "border-line-strong bg-surface text-fg-muted hover:bg-hover",
        )}
        title="Development role switcher"
      >
        <FlaskConical className="size-3.5 shrink-0" />
        <span className="hidden truncate lg:inline">{roleLabel(role)}</span>
        <span className="lg:hidden">DEV</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
        <DropdownMenuLabel>Dev role switcher</DropdownMenuLabel>
        <p className="px-2.5 pb-2 text-meta text-fg-subtle">
          Signed in as {roleLabel(actualRole)}. Development only.
        </p>
        <DropdownMenuSeparator />

        {isOverridden ? (
          <>
            <DropdownMenuItem onSelect={() => select(RESET_DEV_ROLE)}>
              Reset to {roleLabel(actualRole)}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        {roleList.filter((definition) => !definition.platformOnly).map((definition) => (
          <DropdownMenuItem
            key={definition.key}
            onSelect={() => select(definition.key)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <span className="text-micro tabular-nums text-fg-subtle">{definition.code}</span>
              {definition.label}
            </span>
            {definition.key === role ? <Check className="size-4 text-accent" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
