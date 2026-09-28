import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { createCompany } from "@/lib/modules/platform/platform-company.service";
import { createCompanySchema } from "@/lib/modules/platform/platform.schema";

/** POST /api/platform/companies — a company from its name alone, with or without a group later (Simplified Company Creation §10). */
export async function POST(request: Request) {
  return withPlatformContext(async (context) => {
    const input = createCompanySchema.parse(await readJson(request));
    return apiOk({ data: await createCompany(context, input) }, { status: 201 });
  });
}
