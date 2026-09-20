import { z } from "zod";

import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { AccessError } from "@/lib/access/guards";
import { createGroupCompanySchema } from "@/lib/modules/platform/platform.schema";
import { createGroupCompany } from "@/lib/modules/platform/platform-implementation.service";
import {
  accessInspectorSchema,
  companyStatusSchema,
  companyUpdateSchema,
  featureFlagOverrideSchema,
  featureFlagSchema,
  grantRevokeSchema,
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
  projectCreateSchema,
  sessionRevokeSchema,
  supportAccessSchema,
  userStatusSchema,
} from "@/lib/modules/platform/platform-control.schema";
import {
  createFeatureFlag,
  createMembership,
  createPlatformGrant,
  createPlatformProject,
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
        const input = createGroupCompanySchema.extend({ groupId: id }).parse(body);
        return apiOk({ data: await createGroupCompany(context, input.groupId, input) }, { status: 201 });
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
        await saveMaintenanceSetting(context, input);
        return apiOk({ data: { ok: true } });
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
