import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
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
import { getTranslations } from "@/lib/i18n/server";
import { fullName } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.users.label") };
}

export default async function UsersSettingsPage() {
  const context = await requireSettingsSection("users");
  const members = await getTeamMembers(context.companyId);
  const t = await getTranslations("settings");

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.users.label")}
        description={t("sections.users.description")}
      />

      <div className="nesto-card overflow-hidden">
        <Table label={t("sections.users.label")}>
          <TableHead>
            <tr>
              <TableHeaderCell>{t("users.user")}</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell">{t("users.email")}</TableHeaderCell>
              <TableHeaderCell>{t("users.role")}</TableHeaderCell>
              <TableHeaderCell>{t("users.account")}</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <PersonLink
                    memberId={member.id}
                    name={fullName(member.firstName, member.lastName)}
                    photoUrl={member.avatarUrl}
                    variant="name-avatar"
                    className="gap-2.5"
                  />
                  {/* Below md the e-mail column is hidden; the address stays, under the name (AUD-04 §5, D-07-07, MW-05). */}
                  <span className="mt-0.5 block text-meta text-fg-muted [overflow-wrap:anywhere] md:hidden">{member.email}</span>
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

      <p className="text-meta text-fg-subtle">{t("users.manageLater")}</p>
    </div>
  );
}
