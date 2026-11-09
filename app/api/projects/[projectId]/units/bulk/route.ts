import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { unitBulkSchema } from "@/lib/modules/project-structure/unit-bulk.schema";
import { runStructureBulk } from "@/lib/modules/project-structure/unit-bulk.service";
import { runSalesBulk } from "@/lib/modules/sales/units/unit-sales.bulk";

type Params = { params: Promise<{ projectId: string }> };

/** Up to 500 units, each in its own transaction: well past the default function limit on a slow day. */
export const maxDuration = 120;

/**
 * POST — one change to many ticked units of the project (2026-11-09):
 * `{ action, units: [{ id, version }], …the change }`, at most 500 units.
 * `details`, `move` and `archive` are the unit's own changes; `price` and
 * `status` are Sales'. Each unit is changed by the service its own page uses,
 * with that service's permission and version check, and the answer names the
 * units changed and the units skipped, with the reason.
 */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = unitBulkSchema.parse(await readJson(request));
    const data = input.action === "price" || input.action === "status" ? await runSalesBulk(context, projectId, input) : await runStructureBulk(context, projectId, input);
    return apiOk({ data });
  });
}
