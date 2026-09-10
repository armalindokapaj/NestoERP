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
import { roleLabel } from "@/config/roles";
import { signOutAction } from "@/lib/actions/auth";
import type { CurrentUser } from "@/lib/auth/types";
import { fullName } from "@/lib/utils/format";

/** Top-bar user menu (spec §11): name, role, company, then profile actions. */
export function UserMenu({ user }: { user: CurrentUser }) {
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md p-1 pr-1.5 transition-colors hover:bg-hover data-[state=open]:bg-hover"
        aria-label="Open user menu"
      >
        <Avatar firstName={user.firstName} lastName={user.lastName} src={user.avatar} size="sm" />
        <span className="hidden min-w-0 text-left lg:block">
          <span className="block truncate text-table font-medium leading-tight text-fg">
            {fullName(user.firstName, user.lastName)}
          </span>
          <span className="block truncate text-micro leading-tight text-fg-muted">
            {roleLabel(user.role)}
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-64">
        <div className="px-2.5 py-2">
          <p className="truncate text-body font-semibold text-fg">
            {fullName(user.firstName, user.lastName)}
          </p>
          <p className="truncate text-table text-fg-muted">{roleLabel(user.role)}</p>
          <p className="truncate text-table text-fg-subtle">{user.companyName}</p>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <User />
            Profile
          </Link>
        </DropdownMenuItem>
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
