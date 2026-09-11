"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ChevronDown, LogOut, Settings, User } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/lib/actions/auth";
import { fullName } from "@/lib/utils/format";

/**
 * The serialisable slice of the user context the menu needs. The full context
 * never crosses to the client — permissions stay on the server.
 */
export type UserMenuUser = {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  roleLabel: string;
  companyName: string;
};

/**
 * Top-bar user menu (PRD #3 §20): name, role and company are always visible,
 * then the profile actions.
 */
export function UserMenu({ user }: { user: UserMenuUser }) {
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md p-1 pr-1.5 transition-colors hover:bg-hover data-[state=open]:bg-hover"
        aria-label="Open user menu"
      >
        <Avatar firstName={user.firstName} lastName={user.lastName} src={user.avatarUrl} size="md" />
        <span className="hidden min-w-0 text-left lg:block">
          <span className="block truncate text-table font-medium leading-tight text-fg">
            {fullName(user.firstName, user.lastName)}
          </span>
          <span className="block truncate text-micro leading-tight text-fg-muted">
            {user.roleLabel}
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-64">
        <div className="px-2.5 py-2">
          <p className="truncate text-body font-semibold text-fg">
            {fullName(user.firstName, user.lastName)}
          </p>
          <p className="truncate text-table text-fg-muted">{user.roleLabel}</p>
          <p className="truncate text-table text-fg-subtle">{user.companyName}</p>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <User />
            Profile
          </Link>
        </DropdownMenuItem>
        {/*
         * Offered to everyone, not just roles with Settings module access
         * (PRD #5 §39). Profile and Appearance are personal — they belong to
         * the person rather than the company — and /settings lists exactly the
         * sections the reader may open, so a role with no company settings
         * still lands on a page with something on it. Gating this link on the
         * module was how twelve of the sixteen roles ended up with no way to
         * reach their own theme preferences.
         */}
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={isPending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(() => {
              void signOutAction();
            });
          }}
        >
          <LogOut />
          {isPending ? "Signing out…" : "Logout"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
