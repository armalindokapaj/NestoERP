"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, MoreHorizontal, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { departmentLifecycleAction } from "@/lib/actions/team";

/**
 * Department row actions (PRD #14 §118, §127, §128).
 *
 * Archiving is refused while active members remain, and the confirmation says
 * so before the press rather than after — the service enforces it either way
 * (PRD #14 §127).
 */
export function DepartmentActions({
  departmentId,
  name,
  archived,
  activeMembers,
  canUpdate,
  canArchive,
  canRestore,
}: {
  departmentId: string;
  name: string;
  archived: boolean;
  activeMembers: number;
  canUpdate: boolean;
  canArchive: boolean;
  canRestore: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function run(action: "archive" | "restore") {
    startTransition(async () => {
      const result = await departmentLifecycleAction(departmentId, action);
      setConfirming(false);
      if (result.ok) {
        toast({ title: action === "archive" ? "Department archived." : "Department restored." });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  const blocked = activeMembers > 0;

  return (
    <div className="flex items-center justify-end gap-1">
      {archived && canRestore ? (
        <Button variant="secondary" size="sm" onClick={() => run("restore")} disabled={pending}>
          <ArchiveRestore aria-hidden="true" />
          {pending ? "Restoring…" : "Restore"}
        </Button>
      ) : null}

      {!archived && (canUpdate || canArchive) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canUpdate ? (
              <DropdownMenuItem asChild>
                <Link href={`/team/departments/${departmentId}/edit`}>
                  <PenLine />
                  Edit department
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canArchive ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirming(true);
                }}
              >
                <Archive />
                Archive department
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Archive ${name}?`}
        description={
          blocked
            ? `${activeMembers} active member${
                activeMembers === 1 ? " is" : "s are"
              } still assigned to this department. Move them elsewhere first — archiving will be refused until the department is empty.`
            : "The department is removed from active lists and can no longer be assigned. Existing history keeps its department name."
        }
        confirmLabel="Archive department"
        pending={pending}
        onConfirm={() => run("archive")}
      />
    </div>
  );
}
