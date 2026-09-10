import type { Metadata } from "next";
import Link from "next/link";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { roleLabel } from "@/config/roles";
import { requirePermission } from "@/lib/auth/session";
import { getTeamMembers } from "@/lib/database/queries";
import { fullName } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Users",
};

const userStatusTone = {
  ACTIVE: "success",
  INVITED: "warning",
  SUSPENDED: "danger",
} as const;

const userStatusLabel = {
  ACTIVE: "Active",
  INVITED: "Invited",
  SUSPENDED: "Suspended",
} as const;

export default async function UsersSettingsPage() {
  const user = await requirePermission("settings.manage");
  const members = await getTeamMembers(user.companyId);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Users"
        description="Accounts, invitations and access status."
      />

      <div className="nesto-card overflow-hidden">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell">Email</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Account</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <Link
                    href={`/team/${member.userId}`}
                    className="flex items-center gap-2.5 transition-colors hover:text-accent"
                  >
                    <Avatar
                      firstName={member.firstName}
                      lastName={member.lastName}
                      src={member.avatar}
                      size="sm"
                    />
                    <span className="truncate font-medium">
                      {fullName(member.firstName, member.lastName)}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden text-fg-muted md:table-cell">{member.email}</TableCell>
                <TableCell className="text-fg-muted">{roleLabel(member.role)}</TableCell>
                <TableCell>
                  <Badge tone={userStatusTone[member.userStatus]}>
                    {userStatusLabel[member.userStatus]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-meta text-fg-subtle">
        Inviting, editing and deactivating users arrives with the settings module.
      </p>
    </div>
  );
}
