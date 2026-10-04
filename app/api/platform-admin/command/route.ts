import { z } from "zod";

import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { AccessError } from "@/lib/access/guards";
import { attachCompanySchema, createCompanySchema, createGroupCompanySchema, detachCompanySchema, moveCompanySchema } from "@/lib/modules/platform/platform.schema";
import { sendTestEmail } from "@/lib/modules/platform/platform-system.service";
import { platformDeviceAction, savePlatformMobilePolicy } from "@/lib/modules/platform/platform-mobile-security.service";
import { applyEntitlementChanges, previewPlanChange, savePlan, setCompanyLimits } from "@/lib/modules/entitlements/entitlement.service";
import { attachCompanyToGroup, createCompany, detachCompanyFromGroup, moveCompanyToGroup } from "@/lib/modules/platform/platform-company.service";
import { deleteCompany, deleteGroup, purgeCompany, purgeGroup, restoreArchivedDocument, restoreCompany, restoreGroup, restoreRemovedProjectMedia } from "@/lib/modules/platform/platform-recovery.service";
import { assignProjectToCompany, previewProjectAssignment } from "@/lib/modules/platform/platform-project-assignment.service";
import { restoreProject3DExperience } from "@/lib/modules/project-3d/project-3d.lifecycle";
import { createGroupCompany } from "@/lib/modules/platform/platform-implementation.service";
import { addGroupUser, removeGroupUser } from "@/lib/modules/platform/platform-group-users.service";
import { addOrganizationUser, changeOrganizationMemberRole, removeOrganizationMember, setOrganizationMemberProjects } from "@/lib/modules/platform/platform-organization-admin.service";
import {
  accessInspectorSchema,
  companyStatusSchema,
  companyUpdateSchema,
  featureFlagOverrideSchema,
  featureFlagSchema,
  grantRevokeSchema,
  groupBrandingSchema,
  groupStatusSchema,
  maintenanceSettingSchema,
  membershipSchema,
  membershipRepairSchema,
  membershipUpdateSchema,
  moduleToggleSchema,
  platformGrantSchema,
  platformSettingSchema,
  platformUserCreateSchema,
  personCreateSchema,
  personUpdateSchema,
  projectAssignPreviewSchema,
  projectAssignSchema,
  projectCreateSchema,
  projectUpdateSchema,
  sessionRevokeSchema,
  tenantDeleteSchema,
  tenantRestoreSchema,
  supportAccessSchema,
  userStatusSchema,
} from "@/lib/modules/platform/platform-control.schema";
import {
  createFeatureFlag,
  createMembership,
  createPlatformGrant,
  archivePlatformProject,
  revokeUserSessions,
  sendUserPasswordReset,
  createPlatformProject,
  updatePlatformProject,
  createPlatformPerson,
  createPlatformUser,
  createSupportAccess,
  repairBrokenMembership,
  revokePlatformGrant,
  revokePlatformSession,
  revokeSupportAccess,
  runAccessInspection,
  saveMaintenanceSetting,
  savePlatformSetting,
  setCompanyStatus,
  setFeatureFlagOverride,
  setGroupBranding,
  setGroupStatus,
  setPlatformModule,
  setUserStatus,
  updateMembership,
  updatePlatformCompany,
  updatePlatformPerson,
} from "@/lib/modules/platform/platform-control.service";

const command = z.object({ action: z.string().trim().min(1) });
const id = z.string().trim().min(1).max(128);

/** One audited command boundary for control-plane mutations. */
export async function POST(request: Request) {
  return withPlatformContext(async (context) => {
    const body = await readJson(request);
    const { action } = command.parse(body);
    switch (action) {
      case "group.status": {
        const input = groupStatusSchema.extend({ groupId: id }).parse(body);
        await setGroupStatus(context, input.groupId, input.status, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "company.delete": {
        const input = tenantDeleteSchema.extend({ companyId: id }).parse(body);
        await deleteCompany(context, input.companyId, input);
        return apiOk({ data: { ok: true } });
      }
      case "group.delete": {
        const input = tenantDeleteSchema.extend({ groupId: id }).parse(body);
        await deleteGroup(context, input.groupId, input);
        return apiOk({ data: { ok: true } });
      }
      case "company.restore": {
        const input = tenantRestoreSchema.extend({ companyId: id }).parse(body);
        await restoreCompany(context, input.companyId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "group.restore": {
        const input = tenantRestoreSchema.extend({ groupId: id }).parse(body);
        await restoreGroup(context, input.groupId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "company.purge": {
        const input = tenantDeleteSchema.extend({ companyId: id }).parse(body);
        await purgeCompany(context, input.companyId, input);
        return apiOk({ data: { ok: true } });
      }
      case "group.purge": {
        const input = tenantDeleteSchema.extend({ groupId: id }).parse(body);
        await purgeGroup(context, input.groupId, input);
        return apiOk({ data: { ok: true } });
      }
      case "document.restore": {
        const input = tenantRestoreSchema.extend({ documentId: id }).parse(body);
        await restoreArchivedDocument(context, input.documentId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "experience3d.restore": {
        const input = tenantRestoreSchema.extend({ projectId: id, expectedControlVersion: z.coerce.number().int().min(0) }).parse(body);
        await restoreProject3DExperience(context, input.projectId, { expectedControlVersion: input.expectedControlVersion, reason: input.reason });
        return apiOk({ data: { ok: true } });
      }
      case "projectMedia.restore": {
        const input = tenantRestoreSchema.extend({ eventId: id }).parse(body);
        await restoreRemovedProjectMedia(context, input.eventId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "group.branding": {
        const input = groupBrandingSchema.extend({ groupId: id }).parse(body);
        await setGroupBranding(context, input.groupId, input);
        return apiOk({ data: { ok: true } });
      }
      case "company.status": {
        const input = companyStatusSchema.extend({ companyId: id }).parse(body);
        await setCompanyStatus(context, input.companyId, input.status, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "company.update": {
        const input = companyUpdateSchema.extend({ companyId: id }).parse(body);
        await updatePlatformCompany(context, input.companyId, input);
        return apiOk({ data: { ok: true } });
      }
      case "company.create": {
        // Name alone makes a standalone company (Simplified Company Creation §10); a group adds it there.
        if (typeof body === "object" && body !== null && "groupId" in body && body.groupId) {
          const input = createGroupCompanySchema.extend({ groupId: id }).parse(body);
          return apiOk({ data: await createGroupCompany(context, input.groupId, input) }, { status: 201 });
        }
        return apiOk({ data: await createCompany(context, createCompanySchema.parse(body)) }, { status: 201 });
      }
      case "company.attach": {
        const input = attachCompanySchema.extend({ companyId: id }).parse(body);
        await attachCompanyToGroup(context, input.companyId, input.groupId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "company.move": {
        const input = moveCompanySchema.extend({ companyId: id }).parse(body);
        await moveCompanyToGroup(context, input.companyId, input.groupId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "entitlements.apply": {
        const input = z.object({ companyId: id }).passthrough().parse(body);
        return apiOk({ data: await applyEntitlementChanges(context, input.companyId, body) });
      }
      case "entitlements.preview": {
        const input = z.object({ companyId: id, planId: z.string().trim().max(64).nullable() }).parse(body);
        return apiOk({ data: await previewPlanChange(context, input.companyId, input.planId) });
      }
      case "entitlements.limits": {
        const input = z.object({ companyId: id }).passthrough().parse(body);
        await setCompanyLimits(context, input.companyId, body);
        return apiOk({ data: { ok: true } });
      }
      case "plan.save": {
        const input = z.object({ planId: id.nullable().optional() }).passthrough().parse(body);
        // The form sends one checkbox per module ("module:finance": true).
        const moduleKeys = Object.entries(input).filter(([key, value]) => key.startsWith("module:") && value === true).map(([key]) => key.slice("module:".length));
        return apiOk({ data: await savePlan(context, input.planId ?? null, { ...input, moduleKeys }) });
      }
      case "company.detach": {
        const input = detachCompanySchema.extend({ companyId: id }).parse(body);
        await detachCompanyFromGroup(context, input.companyId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "user.signOutEverywhere": {
        const input = z.object({ userId: id, reason: z.string().trim().min(3).max(500) }).parse(body);
        return apiOk({ data: await revokeUserSessions(context, input.userId, input.reason) });
      }
      case "user.passwordReset": {
        const input = z.object({ userId: id }).parse(body);
        return apiOk({ data: await sendUserPasswordReset(context, input.userId) });
      }
      case "system.testEmail": {
        return apiOk({ data: await sendTestEmail(context, body) });
      }
      case "user.status": {
        const input = userStatusSchema.extend({ userId: id }).parse(body);
        await setUserStatus(context, input.userId, input.status, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "person.create": {
        const input = personCreateSchema.parse(body);
        return apiOk({ data: await createPlatformPerson(context, input) }, { status: 201 });
      }
      case "person.update": {
        const input = personUpdateSchema.extend({ personId: id }).parse(body);
        await updatePlatformPerson(context, input.personId, input);
        return apiOk({ data: { ok: true } });
      }
      case "user.create": {
        const input = platformUserCreateSchema.parse(body);
        return apiOk({ data: await createPlatformUser(context, input) }, { status: 201 });
      }
      case "organization.user.add":
        return apiOk({ data: await addOrganizationUser(context, body) }, { status: 201 });
      case "group.user.add":
        return apiOk({ data: await addGroupUser(context, body) }, { status: 201 });
      case "group.user.remove":
        await removeGroupUser(context, body);
        return apiOk({ data: { ok: true } });
      case "organization.member.role":
        await changeOrganizationMemberRole(context, body);
        return apiOk({ data: { ok: true } });
      case "organization.member.projects":
        await setOrganizationMemberProjects(context, body);
        return apiOk({ data: { ok: true } });
      case "organization.member.remove":
        await removeOrganizationMember(context, body);
        return apiOk({ data: { ok: true } });
      case "membership.create": {
        const input = membershipSchema.parse(body);
        return apiOk({ data: await createMembership(context, input) }, { status: 201 });
      }
      case "membership.update": {
        const input = membershipUpdateSchema.extend({ membershipId: id }).parse(body);
        await updateMembership(context, input.membershipId, input);
        return apiOk({ data: { ok: true } });
      }
      case "membership.repair": {
        const input = membershipRepairSchema.parse(body);
        await repairBrokenMembership(context, input.membershipId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "session.revoke": {
        const input = sessionRevokeSchema.extend({ sessionId: id }).parse(body);
        await revokePlatformSession(context, input.sessionId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "device.action": {
        const input = z.object({ deviceId: id, kind: z.enum(["REVOKE", "LOST", "BLOCK", "RESTORE"]), reason: z.string().trim().min(3).max(500) }).parse(body);
        return apiOk({ data: await platformDeviceAction(context, input.deviceId, { action: input.kind, reason: input.reason }) });
      }
      case "mobilePolicy.save": {
        const input = z.object({ settings: z.record(z.string(), z.unknown()), reason: z.string().trim().min(3).max(500) }).parse(body);
        return apiOk({ data: await savePlatformMobilePolicy(context, input.settings, input.reason) });
      }
      case "module.set": {
        const input = moduleToggleSchema.parse(body);
        await setPlatformModule(context, input);
        return apiOk({ data: { ok: true } });
      }
      case "featureFlag.create": {
        const input = featureFlagSchema.parse(body);
        return apiOk({ data: await createFeatureFlag(context, input) }, { status: 201 });
      }
      case "featureFlag.override": {
        const input = featureFlagOverrideSchema.extend({ flagId: id }).parse(body);
        await setFeatureFlagOverride(context, input.flagId, input);
        return apiOk({ data: { ok: true } });
      }
      case "project.create": {
        const input = projectCreateSchema.parse(body);
        return apiOk({ data: await createPlatformProject(context, input) }, { status: 201 });
      }
      case "project.assignPreview": {
        return apiOk({ data: await previewProjectAssignment(context, projectAssignPreviewSchema.parse(body)) });
      }
      case "project.assign": {
        const input = projectAssignSchema.parse(body);
        return apiOk({ data: await assignProjectToCompany(context, input) });
      }
      case "project.update": {
        await updatePlatformProject(context, projectUpdateSchema.parse(body));
        return apiOk({ data: { ok: true } });
      }
      case "project.archive": {
        const input = z.object({ projectId: id, reason: z.string().trim().min(3).max(500) }).parse(body);
        await archivePlatformProject(context, input.projectId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "grant.create": {
        const input = platformGrantSchema.parse(body);
        return apiOk({ data: await createPlatformGrant(context, input) }, { status: 201 });
      }
      case "grant.revoke": {
        const input = grantRevokeSchema.extend({ grantId: id }).parse(body);
        await revokePlatformGrant(context, input.grantId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "setting.save": {
        const input = platformSettingSchema.parse(body);
        await savePlatformSetting(context, input);
        return apiOk({ data: { ok: true } });
      }
      case "maintenance.save": {
        const input = maintenanceSettingSchema.parse(body);
        // `ok` stays for older callers; the rest says whether pages have caught up (NAV-02 CACHE-02).
        return apiOk({ data: await saveMaintenanceSetting(context, input) });
      }
      case "support.create": {
        const input = supportAccessSchema.parse(body);
        return apiOk({ data: await createSupportAccess(context, input) }, { status: 201 });
      }
      case "support.revoke": {
        const input = grantRevokeSchema.extend({ supportSessionId: id }).parse(body);
        await revokeSupportAccess(context, input.supportSessionId, input.reason);
        return apiOk({ data: { ok: true } });
      }
      case "access.inspect": {
        const input = accessInspectorSchema.parse(body);
        return apiOk({ data: await runAccessInspection(context, input) });
      }
      default:
        throw new AccessError("VALIDATION_ERROR", "Unknown platform command.", { action });
    }
  });
}
