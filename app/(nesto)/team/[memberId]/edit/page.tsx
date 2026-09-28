import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { MemberForm } from "@/components/team/member-form";
import { updateMemberAction } from "@/lib/actions/team";
import { getTranslations } from "@/lib/i18n/server";
import { teamFormOptions } from "@/lib/modules/team/team.options";
import { loadMember, memberBreadcrumbs } from "../member-context";

type Params = { params: Promise<{ memberId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("team"))("meta.editMembership") };
}

/**
 * Edit a membership (PRD #14 §85).
 *
 * The role list already excludes Owner unless the reader may assign it; the
 * service asserts the same grant, so the picker is a convenience rather than
 * the control (PRD #14 §95, §148).
 */
export default async function EditMemberPage({ params }: Params) {
  const { memberId } = await params;
  const { context, member } = await loadMember(memberId);

  if (!member.capabilities.canEditMembership) redirect(`/team/${memberId}`);

  const options = await teamFormOptions(context);
  const t = await getTranslations("team");

  // The member's current role must stay selectable even when the reader could
  // not assign it themselves — otherwise saving a job title would silently
  // demote an Owner (PRD #14 §96).
  const roles = options.roles.some((role) => role.value === member.membership.role.id)
    ? options.roles
    : [
        { value: member.membership.role.id, label: member.membership.role.name },
        ...options.roles,
      ];

  async function action(formData: FormData) {
    "use server";
    return updateMemberAction(memberId, formData);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RecordContextHeader
        breadcrumbs={memberBreadcrumbs(t, member, t("member.crumbEdit"))}
        title={member.profile.fullName}
        subtitle={member.membership.role.name}
        status={member.membership.status}
      />

      <MemberForm
        action={action}
        roles={roles}
        departments={options.departments}
        values={{
          roleId: member.membership.role.id,
          departmentId: member.membership.department?.id ?? null,
          jobTitle: member.membership.jobTitle,
        }}
        profile={{ fullName: member.profile.fullName, email: member.profile.email }}
        versionUpdatedAt={member.updatedAt}
        cancelHref={`/team/${member.id}`}
        canAssignRole={member.capabilities.canAssignRole}
        canAssignDepartment={member.capabilities.canAssignDepartment}
      />
    </div>
  );
}
