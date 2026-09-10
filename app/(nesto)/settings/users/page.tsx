import type { Metadata } from "next";
import Link from "next/link";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/modules/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { requireSettingsSection } from "../settings-access";
import { getTeamMembers } from "@/lib/database/queries";
import { fullName } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersSettingsPage() {
  const context = await requireSettingsSection("users");
  const members = await getTeamMembers(context.companyId);

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
                      src={member.avatarUrl}
                      size="sm"
                    />
                    <span className="truncate font-medium">
                      {fullName(member.firstName, member.lastName)}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden text-fg-muted md:table-cell">{member.email}</TableCell>
                <TableCell className="text-fg-muted">{member.roleName}</TableCell>
                <TableCell>
                  <StatusBadge status={member.userStatus} />
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
