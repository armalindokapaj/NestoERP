import { z } from "zod";

import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { previewImport } from "@/lib/modules/workforce/workforce.import";

const previewSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1, "The file is empty.").max(2_000_000, "The file is too large."),
});

/**
 * POST /api/hr/employees/import — check a CSV of employees and keep the result
 * as a batch to review (E-04 §93-§96, §163). Nothing else is written until the
 * batch is committed. Needs `hr.employee.import`.
 */
export async function POST(request: Request) {
  return withContext(async (context) => apiOk({ data: await previewImport(context, previewSchema.parse(await readJson(request))) }, { status: 201 }));
}
