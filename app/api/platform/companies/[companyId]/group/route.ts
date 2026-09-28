import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { attachCompanyToGroup, detachCompanyFromGroup } from "@/lib/modules/platform/platform-company.service";
import { attachCompanySchema, detachCompanySchema } from "@/lib/modules/platform/platform.schema";

type Params = { params: Promise<{ companyId: string }> };

/** PUT /api/platform/companies/:companyId/group — attaches a standalone company to a Parent Group (§6). */
export async function PUT(request: Request, { params }: Params) {
  const { companyId } = await params;
  return withPlatformContext(async (context) => {
    const input = attachCompanySchema.parse(await readJson(request));
    await attachCompanyToGroup(context, companyId, input.groupId, input.reason);
    return apiOk({ data: { ok: true } });
  });
}

/** DELETE /api/platform/companies/:companyId/group — detaches it, leaving it standalone (§7). */
export async function DELETE(request: Request, { params }: Params) {
  const { companyId } = await params;
  return withPlatformContext(async (context) => {
    const input = detachCompanySchema.parse(await readJson(request));
    await detachCompanyFromGroup(context, companyId, input.reason);
    return apiOk({ data: { ok: true } });
  });
}
